import { describe, expect, it } from 'vitest';
import { parseGitHubOAuthReturn, githubOAuthAttempt } from '../github-oauth-return';

describe('GitHub OAuth browser return', () => {
  const attempt = { state: 'safe-state', connectionId: 'cloud-a', userId: 'alice', libraryId: 'library', redirectUri: 'https://lattice.test/', expiresAt: new Date(Date.now() + 60000).toISOString() };
  it('records only non-secret OAuth binding metadata', () => {
    const value = githubOAuthAttempt('https://github.com/login/oauth/authorize?state=safe-state', { ...attempt, state: undefined });
    expect(value).toMatchObject({ state: 'safe-state', userId: 'alice' });
    expect(JSON.stringify(value)).not.toMatch(/access_token|refresh_token|client_secret/);
  });
  it('takes and scrubs the authorization code without touching unrelated query values', () => {
    const result = parseGitHubOAuthReturn('https://lattice.test/?code=one-time&state=safe-state&library=library', attempt);
    expect(result.callback).toMatchObject({ code: 'one-time', state: 'safe-state' });
    expect(result.cleanUrl).toBe('https://lattice.test/?library=library');
  });
  it('recognizes the server callback on its original deep page without passing a GitHub code', () => {
    const bound = { ...attempt, flow: 'server' as const, returnTo: 'https://lattice.test/workspace?keep=1', redirectUri: 'https://api.lattice.test/v1/integrations/github/callback' };
    expect(parseGitHubOAuthReturn('https://lattice.test/workspace?keep=1&github_state=safe-state', bound)).toMatchObject({ cleanUrl: 'https://lattice.test/workspace?keep=1', callback: { state: 'safe-state' } });
  });
  it('rejects state mismatch and expired returns and still scrubs sensitive fields', () => {
    const bad = parseGitHubOAuthReturn('https://lattice.test/?code=secret&state=attacker', attempt);
    expect(bad.error).toBeTruthy(); expect(bad.callback).toBeUndefined(); expect(bad.cleanUrl).not.toContain('secret');
    expect(parseGitHubOAuthReturn('https://lattice.test/?code=secret&state=safe-state', { ...attempt, expiresAt: '2020-01-01' }).error).toBeTruthy();
  });
  it('does not consume another authentication flow when no GitHub attempt exists', () => {
    const url = 'https://lattice.test/?code=email-code';
    expect(parseGitHubOAuthReturn(url, null)).toEqual({ cleanUrl: url });
  });
  it('rejects authorization URLs outside the official endpoint', () => {
    expect(() => githubOAuthAttempt('https://evil.test/?state=safe-state', attempt)).toThrow();
  });
});
