import type { CloudIntegrationContext } from './integration-context';
import { decryptServerSecret, encryptServerSecret } from './server-secret-crypto';

/** Server-only configuration. Never serialize this object or a GitHub token. */
export interface GitHubIntegrationEnv {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  /** Standard base64 encoding of a random 32-byte AES-256 key. */
  GITHUB_TOKEN_ENCRYPTION_KEY?: string;
  GITHUB_OAUTH_REDIRECT_URI?: string;
  /** Operator-owned GitHub App slug; never supplied by an end user. */
  GITHUB_APP_SLUG?: string;
  GITHUB_OAUTH_ALLOWED_RETURN_ORIGINS?: string;
  GITHUB_WEBHOOK_SECRET?: string;
}
type Row = Record<string, unknown>;
type Context = CloudIntegrationContext;
type Env = Context['env'] & GitHubIntegrationEnv;
class GitHubError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}
const fail = (code: string, message: string, status: number): never => { throw new GitHubError(code, message, status); };
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : [];
const first = (value: unknown): Row | undefined => rows(value)[0];
const numericId = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) fail('INVALID_INPUT', 'A positive numeric GitHub ID is required', 400);
  return value as number;
};
function text(value: unknown, max = 1000): string {
  if (typeof value !== 'string' || !value || value.length > max) fail('INVALID_INPUT', 'Invalid GitHub request value', 400);
  return value as string;
}
function base64(bytes: Uint8Array): string {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw);
}
function unbase64(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
const base64url = (bytes: Uint8Array): string => base64(bytes).split('+').join('-').split('/').join('_').replace(/=+$/, '');
const random = (): string => base64url(crypto.getRandomValues(new Uint8Array(32)));
const hash = async (value: string): Promise<string> => base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
export async function encryptGitHubSecret(secret: string, key: string, identity: string): Promise<string> {
  try { return await encryptServerSecret(secret, key, identity); }
  catch { return fail('GITHUB_NOT_CONFIGURED', 'Invalid GitHub encryption key', 503); }
}
export async function decryptGitHubSecret(ciphertext: string, key: string, identity: string): Promise<string> {
  return decryptServerSecret(ciphertext, key, identity);
}
function configuration(context: Context): Required<GitHubIntegrationEnv> {
  const env = context.env as Env;
  for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET', 'GITHUB_TOKEN_ENCRYPTION_KEY', 'GITHUB_OAUTH_REDIRECT_URI'] as const) {
    if (!env[key]) fail('GITHUB_NOT_CONFIGURED', 'GitHub App integration is not configured', 503);
  }
  return env as Required<GitHubIntegrationEnv>;
}
async function authenticate(context: Context): Promise<void> {
  const response = await fetch(new URL('/auth/v1/user', context.env.SUPABASE_URL), { headers: { apikey: context.env.SUPABASE_ANON_KEY, authorization: `Bearer ${context.actor.accessToken}` }, redirect: 'error' });
  if (!response.ok) fail('UNAUTHORIZED', 'A verified Lattice session is required', 401);
  const user = object(await response.json());
  if (user.id !== context.actor.userId) fail('UNAUTHORIZED', 'Authenticated user mismatch', 401);
}
async function database(context: Context, table: string, init: RequestInit = {}, query: Record<string, string> = {}): Promise<unknown> {
  const env = configuration(context);
  const url = new URL(`/rest/v1/${table}`, context.env.SUPABASE_URL);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const headers = new Headers({ 'content-type': 'application/json', prefer: 'return=representation', ...Object.fromEntries(new Headers(init.headers)) });
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  // Modern secret keys are opaque API keys; only legacy service_role keys are JWTs.
  if (env.SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_secret_')) headers.delete('authorization');
  else headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  const response = await fetch(url, { ...init, headers, redirect: 'error' });
  if (!response.ok) {
    if (response.status === 409) fail('SYNC_CONFLICT', 'GitHub identity or repository is already connected', 409);
    if (response.status === 403) fail('FORBIDDEN', 'GitHub integration database permission denied', 403);
    fail('GITHUB_DATABASE_ERROR', 'GitHub integration storage request failed', 502);
  }
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}
const rpc = (context: Context, name: string, body: Row): Promise<unknown> => database(context, `rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
async function body(request: Request): Promise<Row> {
  const raw = await request.text();
  if (raw.length > 1_500_000) fail('INVALID_INPUT', 'GitHub request is too large', 413);
  try { return object(JSON.parse(raw)); } catch { return fail('INVALID_INPUT', 'Invalid JSON request', 400); }
}
async function github(path: string, token: string, init: RequestInit = {}, allowMissing = false): Promise<{ body: unknown; response: Response }> {
  const response = await fetch(`https://api.github.com${path}`, { ...init, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'user-agent': 'Lattice-GitHub-App', ...(init.body ? { 'content-type': 'application/json' } : {}) }, redirect: 'error' });
  if (allowMissing && response.status === 404) return { body: null, response };
  if (!response.ok) {
    if (response.status === 401) fail('GITHUB_REAUTH_REQUIRED', 'Reconnect your GitHub account', 401);
    if (response.status === 409 || response.status === 422) fail('SYNC_CONFLICT', 'GitHub file changed; pull before publishing again', 409);
    if (response.status === 403 || response.status === 404) fail('FORBIDDEN', 'GitHub App or user lacks repository access', 403);
    fail('GITHUB_UPSTREAM_ERROR', 'GitHub API request failed', 502);
  }
  return { body: await response.json(), response };
}
async function githubPages(path: string, token: string, field?: string): Promise<Row[]> {
  const result: Row[] = [];
  for (let page = 1; page <= 100; page++) {
    const { body: value, response } = await github(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, token);
    const entries = field ? object(value)[field] : value;
    if (!Array.isArray(entries)) fail('GITHUB_UPSTREAM_ERROR', 'GitHub returned an invalid paginated response', 502);
    const pageRows = rows(entries); result.push(...pageRows);
    const hasNext = /rel="next"/.test(response.headers.get('link') ?? '');
    if (!hasNext && pageRows.length < 100) return result;
    if (!hasNext && field && typeof object(value).total_count === 'number' && result.length >= Number(object(value).total_count)) return result;
  }
  return fail('GITHUB_RESULT_LIMIT', 'Repository listing is too large to synchronize safely', 422);
}
function expiration(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail('GITHUB_EXPIRING_TOKENS_REQUIRED', 'Enable expiring GitHub App user tokens before connecting', 503);
  return new Date(Date.now() + Number(value) * 1000).toISOString();
}
async function tokenExchange(context: Context, input: Record<string, string>): Promise<Row> {
  const env = configuration(context);
  const response = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ client_id: env.GITHUB_APP_CLIENT_ID, client_secret: env.GITHUB_APP_CLIENT_SECRET, ...input }), redirect: 'error' });
  if (!response.ok) fail('GITHUB_REAUTH_REQUIRED', 'GitHub authorization could not be exchanged', 401);
  const token = object(await response.json());
  if (token.error || typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string') fail('GITHUB_REAUTH_REQUIRED', 'GitHub authorization expired; connect again', 401);
  return token;
}
async function encryptedTokens(context: Context, token: Row): Promise<Row> {
  const key = configuration(context).GITHUB_TOKEN_ENCRYPTION_KEY; const user = context.actor.userId;
  return { access_cipher: await encryptGitHubSecret(text(token.access_token, 5000), key, `${user}:access`), refresh_cipher: await encryptGitHubSecret(text(token.refresh_token, 5000), key, `${user}:refresh`), expires_at: expiration(token.expires_in), refresh_expires_at: expiration(token.refresh_token_expires_in), refresh_locked_until: null };
}
async function accessToken(context: Context): Promise<string> {
  const user = context.actor.userId; const key = configuration(context).GITHUB_TOKEN_ENCRYPTION_KEY;
  let token = first(await database(context, 'cloud_github_tokens', {}, { user_id: `eq.${user}`, select: '*' }));
  if (!token || !Number.isFinite(Date.parse(String(token.refresh_expires_at))) || Date.parse(String(token.refresh_expires_at)) <= Date.now() || !Number.isFinite(Date.parse(String(token.expires_at)))) fail('GITHUB_REAUTH_REQUIRED', 'Connect your GitHub account again', 401);
  if (Date.parse(String(token!.expires_at)) <= Date.now() + 60_000) {
    const claimed = first(await rpc(context, 'cloud_github_claim_refresh', { p_user_id: user }));
    if (!claimed) fail('GITHUB_REFRESH_IN_PROGRESS', 'GitHub authentication is refreshing; try again shortly', 409);
    try {
      const refresh = await decryptGitHubSecret(String(claimed!.refresh_cipher), key, `${user}:refresh`);
      const renewed = await tokenExchange(context, { grant_type: 'refresh_token', refresh_token: refresh });
      const encrypted = await encryptedTokens(context, renewed);
      await database(context, 'cloud_github_tokens', { method: 'PATCH', body: JSON.stringify(encrypted) }, { user_id: `eq.${user}` });
      token = { ...token, ...encrypted };
    } catch (error) {
      // Keep the lease until expiry: a timed-out upstream may have consumed the refresh token.
      throw error;
    }
  }
  return decryptGitHubSecret(String(token!.access_cipher), key, `${user}:access`);
}
export interface GitHubRepositoryRecord {
  id: number; installationId: number; owner: string; name: string; fullName: string; private: boolean; defaultBranch: string; permissions: { push: boolean; maintain: boolean; admin: boolean };
}
const writable = (repository: GitHubRepositoryRecord): boolean => repository.permissions.push || repository.permissions.maintain || repository.permissions.admin;
async function installationRepositories(token: string, installationId: number): Promise<GitHubRepositoryRecord[]> {
  return (await githubPages(`/user/installations/${installationId}/repositories`, token, 'repositories')).map(repository => {
    const permissions = object(repository.permissions);
    return { id: numericId(repository.id), installationId, owner: text(object(repository.owner).login, 100), name: text(repository.name, 100), fullName: text(repository.full_name, 250), private: repository.private === true, defaultBranch: text(repository.default_branch, 250), permissions: { push: permissions.push === true, maintain: permissions.maintain === true, admin: permissions.admin === true } };
  });
}
async function repositories(token: string): Promise<GitHubRepositoryRecord[]> {
  const installations = await githubPages('/user/installations', token, 'installations'); const result: GitHubRepositoryRecord[] = [];
  for (const installation of installations) {
    const installationId = numericId(installation.id);
    result.push(...await installationRepositories(token, installationId));
  }
  return result;
}
async function allowedRepository(context: Context, connection: Row, token: string, write = false): Promise<GitHubRepositoryRecord> {
  const repository = (await installationRepositories(token, Number(connection.installation_id))).find(repo => repo.id === Number(connection.repository_id));
  if (!repository || write && !writable(repository)) return fail('FORBIDDEN', 'GitHub repository write permission is required', 403);
  return repository;
}
async function libraryPermission(context: Context, libraryId: string, minimum: 'viewer' | 'editor' | 'admin'): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(libraryId)) fail('INVALID_INPUT', 'Invalid library ID', 400);
  const membership = await context.db('library_members', {}, { library_id: `eq.${libraryId}`, user_id: `eq.${context.actor.userId}`, status: 'eq.active', select: 'role,status' });
  const rank: Record<string, number> = { viewer: 0, commenter: 1, editor: 2, admin: 3, owner: 4 };
  const role = String(first(membership.body)?.role ?? '');
  if (!membership.response.ok || rank[role] === undefined || rank[role] < rank[minimum]) fail('FORBIDDEN', `Library ${minimum} permission is required`, 403);
}
function connectionView(connection: Row): Row {
  const lastSyncedAt = connection.last_synced_at ?? null;
  return { id: connection.id, libraryId: connection.library_id, repositoryId: Number(connection.repository_id), installationId: Number(connection.installation_id), owner: connection.owner, name: connection.name, fullName: `${connection.owner}/${connection.name}`, branch: connection.branch, private: connection.private, connectedAt: connection.created_at, lastSyncedAt, stale: !lastSyncedAt || Date.parse(String(lastSyncedAt)) < Date.now() - 15 * 60_000 };
}
async function connectionFor(context: Context, libraryId: string): Promise<Row | undefined> { return first(await database(context, 'cloud_github_connections', {}, { library_id: `eq.${libraryId}`, select: '*' })); }
const repoPath = (repository: GitHubRepositoryRecord): string => `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
function filePath(value: unknown): string {
  const path = text(value, 1000);
  if (path.startsWith('/') || path.includes(String.fromCharCode(92)) || Array.from(path).some(char => char.charCodeAt(0) < 32) || path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')) fail('INVALID_INPUT', 'Unsafe repository file path', 400);
  return path;
}
const encodedPath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');
async function sync(context: Context, connection: Row, token: string, repository: GitHubRepositoryRecord): Promise<Row> {
  const collaborators = await githubPages(`${repoPath(repository)}/collaborators?affiliation=all`, token);
  const ids = collaborators.filter(collaborator => { const permissions = object(collaborator.permissions); return permissions.push === true || permissions.maintain === true || permissions.admin === true; }).map(collaborator => numericId(collaborator.id));
  const result = object(await rpc(context, 'cloud_github_sync_members', { p_connection_id: connection.id, p_actor_id: context.actor.userId, p_github_user_ids: ids }));
  return { ...result, lastSyncedAt: new Date().toISOString() };
}
async function identityStatus(context: Context): Promise<Row> {
  const installationUrl = githubInstallationUrl(context.env as GitHubIntegrationEnv);
  const identity = first(await database(context, 'cloud_github_identities', {}, { user_id: `eq.${context.actor.userId}`, select: 'github_user_id,login,updated_at' }));
  if (!identity) return { connected: false, configured: true, installationUrl };
  const token = first(await database(context, 'cloud_github_tokens', {}, { user_id: `eq.${context.actor.userId}`, select: 'expires_at,refresh_expires_at' }));
  return { connected: true, configured: true, installationUrl, githubUserId: Number(identity.github_user_id), login: identity.login, expiresAt: token?.expires_at, requiresReauth: !token || !Number.isFinite(Date.parse(String(token.refresh_expires_at))) || Date.parse(String(token.refresh_expires_at)) <= Date.now() };
}
function githubInstallationUrl(env: GitHubIntegrationEnv): string | null {
  return env.GITHUB_APP_SLUG && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(env.GITHUB_APP_SLUG)
    ? `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new` : null;
}
interface OAuthBinding { type: 'server-v1'; verifier?: string; connectionId: string; libraryId: string; returnTo: string | null; code?: string; denied?: boolean; processingAt?: string; completed?: Row; failed?: boolean }
function trustedReturnTo(value: unknown, env: GitHubIntegrationEnv & { ALLOWED_ORIGINS?: string }): string {
  let url: URL; let callback: URL;
  try { url = new URL(text(value, 2000)); callback = new URL(env.GITHUB_OAUTH_REDIRECT_URI!); } catch { return fail('INVALID_INPUT', 'Invalid GitHub return destination', 400); }
  const origins = [callback.origin, ...(env.GITHUB_OAUTH_ALLOWED_RETURN_ORIGINS ?? env.ALLOWED_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean)];
  if (!origins.includes(url.origin) || url.username || url.password || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) fail('INVALID_INPUT', 'Unregistered GitHub return origin', 400);
  for (const key of ['code', 'state', 'error', 'error_description', 'error_uri', 'github_state']) url.searchParams.delete(key);
  return url.toString();
}
async function bindAuthorizedIdentity(context: Context, code: string, verifier: string): Promise<Row> {
  const env = configuration(context);
  const token = await tokenExchange(context, { code, redirect_uri: env.GITHUB_OAUTH_REDIRECT_URI, code_verifier: verifier });
  const verifiedGitHubUser = object((await github('/user', String(token.access_token))).body);
  const githubUserId = numericId(verifiedGitHubUser.id); const login = text(verifiedGitHubUser.login, 100);
  await rpc(context, 'cloud_github_bind_identity', { p_user_id: context.actor.userId, p_github_user_id: githubUserId, p_login: login, p_tokens: await encryptedTokens(context, token) });
  const accessible = (await repositories(String(token.access_token))).filter(writable);
  const joined = await rpc(context, 'cloud_github_join_connections', { p_user_id: context.actor.userId, p_repository_ids: accessible.map(repository => repository.id) });
  return { connected: true, configured: true, githubUserId, login, installationUrl: githubInstallationUrl(env), joinedLibraries: joined };
}
/** Public callback: stores only an encrypted code. Completion still requires the original cloud account. */
export async function handleGitHubOAuthCallback(request: Request, env: Context['env'] & GitHubIntegrationEnv): Promise<Response | null> {
  if (!env.GITHUB_OAUTH_REDIRECT_URI) return null;
  const url = new URL(request.url), callback = new URL(env.GITHUB_OAUTH_REDIRECT_URI);
  if (request.method !== 'GET' || url.origin !== callback.origin || url.pathname !== callback.pathname) return null;
  const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'content-type': 'text/html; charset=utf-8' };
  try {
    const state = text(url.searchParams.get('state'), 200); const context = serviceContext(env);
    const query = { state_hash: `eq.${await hash(state)}`, redirect_uri: `eq.${callback.toString()}`, expires_at: `gt.${new Date().toISOString()}`, select: '*' };
    const saved = first(await database(context, 'cloud_github_oauth_states', {}, query));
    if (!saved) fail('INVALID_INPUT', 'GitHub authorization expired', 400);
    const identity = `${saved!.user_id}:oauth`;
    const binding = JSON.parse(await decryptGitHubSecret(String(saved!.verifier_cipher), configuration(context).GITHUB_TOKEN_ENCRYPTION_KEY, identity)) as OAuthBinding;
    if (binding.type !== 'server-v1' || binding.code || binding.denied || binding.processingAt || binding.completed || binding.failed) fail('INVALID_INPUT', 'GitHub callback already received', 400);
    const returnTo = binding.returnTo ? trustedReturnTo(binding.returnTo, env) : null;
    if (url.searchParams.has('error')) binding.denied = true;
    else binding.code = text(url.searchParams.get('code'), 1000);
    const changed = rows(await database(context, 'cloud_github_oauth_states', { method: 'PATCH', body: JSON.stringify({ verifier_cipher: await encryptGitHubSecret(JSON.stringify(binding), configuration(context).GITHUB_TOKEN_ENCRYPTION_KEY, identity) }) }, { ...query, verifier_cipher: `eq.${saved!.verifier_cipher}` }));
    if (!changed.length) fail('INVALID_INPUT', 'GitHub callback already received', 400);
    if (returnTo) { const destination = new URL(returnTo); destination.searchParams.set('github_state', state); return new Response(null, { status: 303, headers: { ...headers, location: destination.toString() } }); }
    return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Lattice GitHub</title><body><h1>请返回 Lattice</h1><p>授权结果已安全接收，请返回 Lattice 原窗口继续。此页面可以关闭。</p></body></html>', { headers });
  } catch {
    return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Lattice GitHub</title><body><h1>授权未完成</h1><p>请返回 Lattice 原窗口重新连接 GitHub。</p></body></html>', { status: 400, headers });
  }
}
/** Returns null only for routes owned by another integration/the core API. */
export async function dispatchGitHubIntegration(request: Request, context: Context): Promise<Response | null> {
  const segments = context.segments[0] === 'v1' ? context.segments.slice(1) : context.segments;
  const globalRoute = segments[0] === 'integrations' && segments[1] === 'github';
  const libraryRoute = segments[0] === 'libraries' && segments[2] === 'github';
  if (!globalRoute && !libraryRoute) return null;
  try {
    await authenticate(context);
    if (globalRoute && segments[2] === 'status' && request.method === 'GET' && !configurationPresent(context)) return context.json({ data: { configured: false, connected: false } });
    const env = configuration(context);
    if (globalRoute) {
      const action = segments[2];
      if (segments.length !== 3) fail('NOT_FOUND', 'Unknown GitHub route', 404);
      if (action === 'status' && request.method === 'GET') return context.json({ data: await identityStatus(context) });
      if (action === 'authorize' && request.method === 'POST') {
        const input = await body(request); const redirectUri = env.GITHUB_OAUTH_REDIRECT_URI;
        const legacy = typeof input.redirectUri === 'string';
        if (legacy && input.redirectUri !== redirectUri) fail('INVALID_INPUT', 'Unregistered GitHub callback URI', 400);
        const returnTo = legacy || input.desktop === true ? null : trustedReturnTo(input.returnTo, context.env);
        const state = random(); const verifier = random(); const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
        const binding: OAuthBinding | null = legacy ? null : { type: 'server-v1', verifier, returnTo, connectionId: text(input.connectionId, 200), libraryId: input.libraryId ? text(input.libraryId, 100) : '' };
        await database(context, 'cloud_github_oauth_states', { method: 'POST', body: JSON.stringify({ state_hash: await hash(state), user_id: context.actor.userId, verifier_cipher: await encryptGitHubSecret(binding ? JSON.stringify(binding) : verifier, env.GITHUB_TOKEN_ENCRYPTION_KEY, `${context.actor.userId}:oauth`), redirect_uri: redirectUri, expires_at: expiresAt }) });
        const url = new URL('https://github.com/login/oauth/authorize');
        for (const [key, value] of Object.entries({ client_id: env.GITHUB_APP_CLIENT_ID, redirect_uri: redirectUri, state, code_challenge: await hash(verifier), code_challenge_method: 'S256' })) url.searchParams.set(key, value);
        return context.json({ data: { authorizationUrl: url.toString(), redirectUri, returnTo, expiresAt, flow: legacy ? 'legacy' : 'server' } });
      }
      if (action === 'claim' && request.method === 'POST') {
        const input = await body(request); const state = text(input.state, 200); const connectionId = text(input.connectionId, 200);
        const query = { state_hash: `eq.${await hash(state)}`, user_id: `eq.${context.actor.userId}`, expires_at: `gt.${new Date().toISOString()}`, redirect_uri: `eq.${env.GITHUB_OAUTH_REDIRECT_URI}`, select: '*' };
        const saved = first(await database(context, 'cloud_github_oauth_states', {}, query));
        if (!saved) fail('INVALID_INPUT', 'GitHub authorization expired or was already completed', 400);
        const binding = JSON.parse(await decryptGitHubSecret(String(saved!.verifier_cipher), env.GITHUB_TOKEN_ENCRYPTION_KEY, `${context.actor.userId}:oauth`)) as OAuthBinding;
        if (binding.type !== 'server-v1' || binding.connectionId !== connectionId) fail('FORBIDDEN', 'Return to the original cloud account and connection', 403);
        if (binding.completed) return context.json({ data: binding.completed });
        if (binding.failed) fail('GITHUB_REAUTH_REQUIRED', 'Reconnect your GitHub account to complete authorization', 401);
        if (binding.denied) {
          await database(context, 'cloud_github_oauth_states', { method: 'DELETE' }, { ...query, verifier_cipher: `eq.${saved!.verifier_cipher}` });
          fail('GITHUB_AUTHORIZATION_DENIED', 'GitHub authorization was not completed; connect again', 400);
        }
        if (binding.processingAt) {
          if (Date.now() - Date.parse(binding.processingAt) < 60_000) return context.json({ data: { pending: true } });
          const recovered = await identityStatus(context);
          if (recovered.connected && !recovered.requiresReauth) return context.json({ data: recovered });
          fail('GITHUB_REAUTH_REQUIRED', 'Authorization was interrupted; connect again', 401);
        }
        if (!binding.code && !binding.denied) return context.json({ data: { pending: true } });
        const claim: OAuthBinding = { ...binding, processingAt: new Date().toISOString() };
        const claimingCipher = await encryptGitHubSecret(JSON.stringify(claim), env.GITHUB_TOKEN_ENCRYPTION_KEY, `${context.actor.userId}:oauth`);
        const claimed = rows(await database(context, 'cloud_github_oauth_states', { method: 'PATCH', body: JSON.stringify({ verifier_cipher: claimingCipher }) }, { ...query, verifier_cipher: `eq.${saved!.verifier_cipher}` }));
        if (!claimed.length) fail('INVALID_INPUT', 'GitHub authorization was already completed', 400);
        try {
          const result = await bindAuthorizedIdentity(context, binding.code!, binding.verifier!);
          const receipt: OAuthBinding = { type: 'server-v1', connectionId, libraryId: binding.libraryId, returnTo: binding.returnTo, completed: result };
          const receiptCipher = await encryptGitHubSecret(JSON.stringify(receipt), env.GITHUB_TOKEN_ENCRYPTION_KEY, `${context.actor.userId}:oauth`);
          const savedReceipt = rows(await database(context, 'cloud_github_oauth_states', { method: 'PATCH', body: JSON.stringify({ verifier_cipher: receiptCipher }) }, { ...query, verifier_cipher: `eq.${claimingCipher}` }));
          if (!savedReceipt.length) fail('GITHUB_REAUTH_REQUIRED', 'Authorization completed; reload your GitHub connection', 409);
          return context.json({ data: result });
        } catch (error) {
          const failed: OAuthBinding = { type: 'server-v1', connectionId, libraryId: binding.libraryId, returnTo: binding.returnTo, failed: true };
          await database(context, 'cloud_github_oauth_states', { method: 'PATCH', body: JSON.stringify({ verifier_cipher: await encryptGitHubSecret(JSON.stringify(failed), env.GITHUB_TOKEN_ENCRYPTION_KEY, `${context.actor.userId}:oauth`) }) }, { ...query, verifier_cipher: `eq.${claimingCipher}` });
          throw error;
        }
      }
      if (action === 'exchange' && request.method === 'POST') {
        const input = await body(request); const state = text(input.state, 200); const code = text(input.code, 1000);
        if (input.redirectUri !== env.GITHUB_OAUTH_REDIRECT_URI) fail('INVALID_INPUT', 'Unregistered GitHub callback URI', 400);
        // Atomic DELETE claims state once, before any upstream token exchange.
        const saved = first(await database(context, 'cloud_github_oauth_states', { method: 'DELETE' }, { state_hash: `eq.${await hash(state)}`, user_id: `eq.${context.actor.userId}`, expires_at: `gt.${new Date().toISOString()}`, redirect_uri: `eq.${env.GITHUB_OAUTH_REDIRECT_URI}`, select: '*' }));
        if (!saved) fail('INVALID_INPUT', 'GitHub state expired or was already consumed', 400);
        const verifier = await decryptGitHubSecret(String(saved!.verifier_cipher), env.GITHUB_TOKEN_ENCRYPTION_KEY, `${context.actor.userId}:oauth`);
        return context.json({ data: await bindAuthorizedIdentity(context, code, verifier) });
      }
      if (action === 'identity' && request.method === 'DELETE') {
        const saved = first(await database(context, 'cloud_github_tokens', {}, { user_id: `eq.${context.actor.userId}`, select: 'access_cipher' }));
        if (saved) {
          const token = await decryptGitHubSecret(String(saved.access_cipher), env.GITHUB_TOKEN_ENCRYPTION_KEY, `${context.actor.userId}:access`);
          const revoked = await fetch(`https://api.github.com/applications/${encodeURIComponent(env.GITHUB_APP_CLIENT_ID)}/grant`, { method: 'DELETE', headers: { accept: 'application/vnd.github+json', authorization: `Basic ${btoa(`${env.GITHUB_APP_CLIENT_ID}:${env.GITHUB_APP_CLIENT_SECRET}`)}`, 'X-GitHub-Api-Version': '2022-11-28', 'content-type': 'application/json', 'user-agent': 'Lattice-GitHub-App' }, body: JSON.stringify({ access_token: token }), redirect: 'error' });
          if (!revoked.ok && revoked.status !== 404 && revoked.status !== 422) fail('GITHUB_UPSTREAM_ERROR', 'GitHub authorization could not be revoked; try again', 502);
        }
        await rpc(context, 'cloud_github_unbind_identity', { p_user_id: context.actor.userId });
        return context.json({ data: { disconnected: true } });
      }
      if (action === 'repositories' && request.method === 'GET') return context.json({ data: await repositories(await accessToken(context)) });
      fail('NOT_FOUND', 'Unknown GitHub route', 404);
    }
    const libraryId = segments[1]; const action = segments[3];
    const minimum = request.method === 'PUT' ? 'editor' : request.method === 'GET' ? 'viewer' : 'admin';
    await libraryPermission(context, libraryId, minimum);
    let connection = await connectionFor(context, libraryId);
    if (!action && request.method === 'POST') {
      const input = await body(request); const repositoryId = numericId(input.repositoryId); const installationId = numericId(input.installationId); const token = await accessToken(context);
      const repository = (await installationRepositories(token, installationId)).find(repo => repo.id === repositoryId);
      if (!repository || !writable(repository)) fail('FORBIDDEN', 'GitHub repository write permission is required', 403);
      connection = object(await rpc(context, 'cloud_github_connect', { p_library_id: libraryId, p_actor_id: context.actor.userId, p_repository: { repository_id: repositoryId, installation_id: installationId, owner: repository!.owner, name: repository!.name, branch: repository!.defaultBranch, private: repository!.private } }));
      const synced = await sync(context, connection, token, repository!);
      return context.json({ data: { ...connectionView(connection), lastSyncedAt: synced.lastSyncedAt, stale: false, sync: synced } });
    }
    if (!connection) { if (!action && request.method === 'GET') return context.json({ data: null }); return fail('NOT_FOUND', 'No GitHub repository is connected', 404); }
    if (!action && request.method === 'DELETE') {
      await rpc(context, 'cloud_github_disconnect', { p_connection_id: connection.id, p_actor_id: context.actor.userId });
      return context.json({ data: { disconnected: true } });
    }
    const token = await accessToken(context); const repository = await allowedRepository(context, connection, token, request.method !== 'GET');
    if (!action && request.method === 'GET') return context.json({ data: { ...connectionView(connection), accessVerifiedAt: new Date().toISOString() } });
    if (action === 'sync' && segments.length === 4 && request.method === 'POST') return context.json({ data: await sync(context, connection, token, repository) });
    if (action === 'tree' && segments.length === 4 && request.method === 'GET') {
      const result = object((await github(`${repoPath(repository)}/git/trees/${encodeURIComponent(String(connection.branch))}?recursive=1`, token)).body);
      if (result.truncated) fail('GITHUB_RESULT_LIMIT', 'Repository tree is truncated; use a smaller repository', 422);
      const entries = rows(result.tree).filter(entry => entry.type === 'blob').map(entry => ({ path: entry.path, sha: entry.sha, size: entry.size ?? 0, type: entry.type }));
      return context.json({ data: { branch: connection.branch, sha: result.sha, entries } });
    }
    if (action === 'file' && segments.length === 4) {
      if (request.method === 'GET') {
        const path = filePath(context.url.searchParams.get('path'));
        const file = object((await github(`${repoPath(repository)}/contents/${encodedPath(path)}?ref=${encodeURIComponent(String(connection.branch))}`, token)).body);
        if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string' || Number(file.size) > 1_000_000) fail('INVALID_INPUT', 'Only regular files up to 1 MB can be imported', 422);
        return context.json({ data: { path, sha: file.sha, content: String(file.content).split(String.fromCharCode(10)).join(''), encoding: 'base64', size: file.size, branch: connection.branch, repositoryId: repository.id } });
      }
      if (request.method === 'PUT') {
        const input = await body(request); const path = filePath(input.path); const expectedSha = input.expectedSha;
        if (input.expectedRepositoryId !== undefined && input.expectedRepositoryId !== repository.id || input.expectedBranch !== undefined && input.expectedBranch !== connection.branch) fail('SYNC_CONFLICT', 'The connected GitHub repository or branch changed', 409);
        if (typeof input.content !== 'string' || input.content.length > 1_333_336) fail('INVALID_INPUT', 'File content must be base64, up to 1 MB', 400);
        const content = String(input.content);
        if (expectedSha !== null && (typeof expectedSha !== 'string' || !/^[a-f0-9]{40,64}$/.test(expectedSha))) fail('INVALID_INPUT', 'expectedSha is required; null creates a new file', 400);
        try { if (unbase64(content).byteLength > 1_000_000) fail('INVALID_INPUT', 'Files must be at most 1 MB', 413); } catch (error) { if (error instanceof GitHubError) throw error; fail('INVALID_INPUT', 'File content must be base64', 400); }
        const current = await github(`${repoPath(repository)}/contents/${encodedPath(path)}?ref=${encodeURIComponent(String(connection.branch))}`, token, {}, true);
        if ((object(current.body).sha ?? null) !== expectedSha) fail('SYNC_CONFLICT', 'Repository file changed; pull before publishing', 409);
        const result = object((await github(`${repoPath(repository)}/contents/${encodedPath(path)}`, token, { method: 'PUT', body: JSON.stringify({ message: text(input.message ?? `Update ${path} from Lattice`, 1000), content, branch: connection.branch, ...(expectedSha ? { sha: expectedSha } : {}) }) })).body);
        return context.json({ data: { path, sha: object(result.content).sha, commitSha: object(result.commit).sha, branch: connection.branch, repositoryId: repository.id } });
      }
    }
    return fail('NOT_FOUND', 'Unknown GitHub route', 404);
  } catch (error) {
    if (error instanceof GitHubError) return context.error(error.code, error.message, error.status);
    return context.error('GITHUB_INTEGRATION_ERROR', 'GitHub integration request failed', 502, true);
  }
}
function configurationPresent(context: Context): boolean {
  const env = context.env as Env;
  return !!(env.SUPABASE_SERVICE_ROLE_KEY && env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_CLIENT_SECRET && env.GITHUB_TOKEN_ENCRYPTION_KEY && env.GITHUB_OAUTH_REDIRECT_URI);
}

const membershipEvents = new Set(['member', 'membership', 'team', 'repository', 'installation', 'installation_repositories', 'organization']);
type GitHubWorkerEnv = Context['env'] & GitHubIntegrationEnv;
function serviceContext(env: GitHubWorkerEnv, userId = ''): Context {
  return { env, actor: { userId, accessToken: '' }, segments: [], url: new URL('https://internal.invalid'),
    db: async () => { throw new Error('Background jobs cannot impersonate a user database session'); },
    json: (value, status = 200) => Response.json(value, { status }),
    error: (code, message, status) => Response.json({ error: { code, message } }, { status }),
  };
}
async function webhookConnections(context: Context, delivery: Row): Promise<Row[]> {
  const payload = object(delivery.payload); const repository = object(payload.repository); const installation = object(payload.installation);
  const organization = object(payload.organization); let match: Record<string, string>;
  if (typeof repository.id === 'number') match = { repository_id: `eq.${numericId(repository.id)}` };
  else if (typeof installation.id === 'number' && (delivery.event === 'installation' || delivery.event === 'installation_repositories')) match = { installation_id: `eq.${numericId(installation.id)}` };
  else if (typeof organization.login === 'string' && ['membership', 'team', 'organization'].includes(String(delivery.event))) match = { owner: `eq.${text(organization.login, 100)}` };
  else return [];
  const result: Row[] = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const page = rows(await database(context, 'cloud_github_connections', {}, { ...match, select: '*', order: 'id', limit: '100', offset: String(offset) })); result.push(...page);
    if (page.length < 100) return result;
  }
  return fail('GITHUB_RESULT_LIMIT', 'Too many matching GitHub repository connections', 422);
}
/** Durable retry worker. Invoke from the platform scheduler as well as ingestion. */
export async function processGitHubWebhookDeliveries(env: GitHubWorkerEnv, deliveryId?: string): Promise<{ processed: number; failed: number }> {
  const context = serviceContext(env); const deliveries = rows(await rpc(context, 'cloud_github_claim_webhooks', { p_delivery_id: deliveryId ?? null }));
  let processed = 0; let failed = 0;
  for (const delivery of deliveries) {
    try {
      for (const connection of await webhookConnections(context, delivery)) {
        const actorContext = serviceContext(env, String(connection.connected_by));
        let ids: number[] = [];
        try {
          const token = await accessToken(actorContext);
          const repository = (await installationRepositories(token, Number(connection.installation_id))).find(repo => repo.id === Number(connection.repository_id));
          if (repository && writable(repository)) {
            const collaborators = await githubPages(`${repoPath(repository)}/collaborators?affiliation=all`, token);
            ids = collaborators.filter(collaborator => { const permission = object(collaborator.permissions); return permission.push === true || permission.maintain === true || permission.admin === true; }).map(collaborator => numericId(collaborator.id));
          }
          // No access or no push permission can only remove GitHub-owned grants.
          await rpc(context, 'cloud_github_sync_members', { p_connection_id: connection.id, p_actor_id: null, p_github_user_ids: ids });
        } catch (error) {
          if (error instanceof GitHubError && [401, 403].includes(error.status)) {
            await rpc(context, 'cloud_github_sync_members', { p_connection_id: connection.id, p_actor_id: null, p_github_user_ids: [] });
          }
          throw error;
        }
      }
      await database(context, 'cloud_github_webhook_deliveries', { method: 'PATCH', body: JSON.stringify({ status: 'complete', completed_at: new Date().toISOString(), leased_until: null, last_error: null }) }, { delivery_id: `eq.${delivery.delivery_id}`, status: 'eq.processing' }); processed++;
    } catch (error) {
      const lastError = error instanceof GitHubError ? error.code : 'GITHUB_WEBHOOK_RETRY_REQUIRED';
      const retrySeconds = Math.min(3600, 30 * 2 ** Math.min(Number(delivery.attempts ?? 1), 7));
      await database(context, 'cloud_github_webhook_deliveries', { method: 'PATCH', body: JSON.stringify({ status: 'failed', last_error: lastError, leased_until: null, available_at: new Date(Date.now() + retrySeconds * 1000).toISOString() }) }, { delivery_id: `eq.${delivery.delivery_id}`, status: 'eq.processing' }); failed++;
    }
  }
  return { processed, failed };
}
/** Fixed unauthenticated ingress; HMAC verification is the sole ingress authority. */
export async function handleGitHubWebhook(request: Request, env: GitHubWorkerEnv): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: { code: 'METHOD_NOT_ALLOWED' } }, { status: 405 });
  if (!env.GITHUB_WEBHOOK_SECRET) return Response.json({ error: { code: 'GITHUB_NOT_CONFIGURED' } }, { status: 503 });
  const signature = request.headers.get('x-hub-signature-256') ?? '';
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) return Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const rawBytes = new Uint8Array(await request.arrayBuffer());
  if (rawBytes.byteLength > 2_000_000) return Response.json({ error: { code: 'INVALID_INPUT' } }, { status: 413 });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, pair => Number.parseInt(pair, 16));
  if (!await crypto.subtle.verify('HMAC', key, bytes, rawBytes)) return Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const event = request.headers.get('x-github-event') ?? ''; const deliveryId = request.headers.get('x-github-delivery') ?? '';
  if (event === 'ping') return Response.json({ accepted: true });
  if (!membershipEvents.has(event)) return Response.json({ accepted: true, ignored: true });
  if (!/^[a-f0-9-]{36}$/i.test(deliveryId)) return Response.json({ error: { code: 'INVALID_INPUT' } }, { status: 400 });
  let payload: Row;
  try { payload = object(JSON.parse(new TextDecoder().decode(rawBytes))); } catch { return Response.json({ error: { code: 'INVALID_INPUT' } }, { status: 400 }); }
  const context = serviceContext(env);
  try {
    const inserted = rows(await database(context, 'cloud_github_webhook_deliveries', { method: 'POST', headers: { prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ delivery_id: deliveryId, event, payload }) }, { on_conflict: 'delivery_id' }));
    if (!inserted.length) return Response.json({ accepted: true, duplicate: true }, { status: 202 });
    // Persist before doing network work; a crash or a 5xx leaves a leased job for
    // the next scheduled retry, rather than losing the membership update.
    const result = await processGitHubWebhookDeliveries(env, deliveryId);
    return Response.json({ accepted: true, ...result }, { status: 202 });
  } catch { return Response.json({ error: { code: 'GITHUB_WEBHOOK_STORAGE_ERROR' } }, { status: 503 }); }
}
