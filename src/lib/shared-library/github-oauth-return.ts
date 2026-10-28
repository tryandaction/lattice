export const GITHUB_OAUTH_ATTEMPT_KEY = 'lattice-github-oauth-attempt-v1';
export const GITHUB_OAUTH_RETURN_KEY = 'lattice-github-oauth-return-v1';
export const GITHUB_OAUTH_STARTED_EVENT = 'lattice-github-oauth-started';
export interface GitHubOAuthAttempt { state: string; connectionId: string; userId: string; libraryId: string; redirectUri: string; expiresAt: string; flow?: 'server' | 'legacy'; returnTo?: string | null }
export interface GitHubOAuthPendingReturn { attempt: GitHubOAuthAttempt; code?: string; state: string; exchangeStarted: boolean }
export function readGitHubOAuthAttempt(raw: string | null): GitHubOAuthAttempt | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as GitHubOAuthAttempt;
    if (!value || ['state', 'connectionId', 'userId', 'redirectUri', 'expiresAt'].some(key => typeof value[key as keyof GitHubOAuthAttempt] !== 'string' || !value[key as keyof GitHubOAuthAttempt]) || typeof value.libraryId !== 'string'
      || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now() || value.state.length > 256) return null;
    new URL(value.redirectUri);
    if (value.flow === 'server' && value.returnTo) new URL(value.returnTo);
    return value;
  } catch { return null; }
}
/** Legacy direct callbacks may temporarily keep their one-time code for reload recovery. */
export function readGitHubOAuthPendingReturn(raw: string | null): GitHubOAuthPendingReturn | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as GitHubOAuthPendingReturn;
    if (!value || typeof value !== 'object' || !readGitHubOAuthAttempt(JSON.stringify(value.attempt)) || typeof value.state !== 'string' || value.state !== value.attempt.state) return null;
    if (value.attempt.flow === 'server') return { attempt: value.attempt, state: value.state, exchangeStarted: value.exchangeStarted === true };
    if (typeof value.code !== 'string') return null;
    const callback = new URL(value.attempt.redirectUri);
    callback.searchParams.set('code', value.code); callback.searchParams.set('state', value.state);
    if (!parseGitHubOAuthReturn(callback.toString(), value.attempt).callback) return null;
    return { attempt: value.attempt, code: value.code, state: value.state, exchangeStarted: value.exchangeStarted === true };
  } catch { return null; }
}
export function githubOAuthAttempt(authorizationUrl: string, binding: Omit<GitHubOAuthAttempt, 'state'> & { state?: string }): GitHubOAuthAttempt {
  const url = new URL(authorizationUrl);
  const state = url.searchParams.get('state');
  if (url.origin !== 'https://github.com' || url.pathname !== '/login/oauth/authorize' || !state || state.length > 256) throw new Error('GitHub 授权地址无效。');
  return { connectionId: binding.connectionId, userId: binding.userId, libraryId: binding.libraryId, redirectUri: binding.redirectUri, expiresAt: binding.expiresAt, flow: binding.flow, returnTo: binding.returnTo, state };
}
export function parseGitHubOAuthReturn(href: string, attempt: GitHubOAuthAttempt | null): { cleanUrl: string; callback?: { code?: string; state: string }; error?: string } {
  if (!attempt) return { cleanUrl: href };
  if (attempt.flow === 'server') {
    const url = new URL(href);
    if (!attempt.returnTo || !url.searchParams.has('github_state')) return { cleanUrl: href };
    const target = new URL(attempt.returnTo);
    if (url.origin !== target.origin || url.pathname !== target.pathname) return { cleanUrl: href };
    const state = url.searchParams.get('github_state'); url.searchParams.delete('github_state');
    const cleanUrl = url.toString();
    if (state !== attempt.state || !Number.isFinite(Date.parse(attempt.expiresAt)) || Date.parse(attempt.expiresAt) <= Date.now()) return { cleanUrl, error: 'GitHub 授权已过期，请重新连接。' };
    return { cleanUrl, callback: { state } };
  }
  const url = new URL(href), redirect = new URL(attempt.redirectUri);
  if (url.origin !== redirect.origin || url.pathname !== redirect.pathname || (!url.searchParams.has('code') && !url.searchParams.has('error'))) return { cleanUrl: href };
  const code = url.searchParams.get('code'), state = url.searchParams.get('state'), denied = url.searchParams.has('error');
  for (const key of ['code', 'state', 'error', 'error_description', 'error_uri']) url.searchParams.delete(key);
  const cleanUrl = url.toString();
  if (denied) return { cleanUrl, error: 'GitHub 授权未完成，请重新连接。' };
  if (!Number.isFinite(Date.parse(attempt.expiresAt)) || Date.parse(attempt.expiresAt) <= Date.now() || state !== attempt.state || !code || code.length > 1024) return { cleanUrl, error: 'GitHub 授权已过期或校验不一致，请重新连接。' };
  return { cleanUrl, callback: { code, state } };
}
