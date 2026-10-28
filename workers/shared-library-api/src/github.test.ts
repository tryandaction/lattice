// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchGitHubIntegration, handleGitHubOAuthCallback, encryptGitHubSecret, decryptGitHubSecret } from './github';
import type { CloudIntegrationContext } from './integration-context';

const user = '11111111-1111-4111-8111-111111111111';
function fixture(path: string, body?: unknown, method = body ? 'POST' : 'GET') {
  const url = new URL(`https://api.example/v1/${path}`);
  const request = new Request(url, { method, headers: { authorization: 'Bearer signed-token', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const context: CloudIntegrationContext = {
    env: { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', ...{ SUPABASE_SERVICE_ROLE_KEY: 'service', GITHUB_APP_CLIENT_ID: 'Iv1.app', GITHUB_APP_CLIENT_SECRET: 'app-secret', GITHUB_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), GITHUB_OAUTH_REDIRECT_URI: 'https://lattice.example/cloud' } },
    actor: { userId: user, accessToken: 'signed-token' }, segments: path.split('/'), url,
    db: vi.fn(async () => ({ response: Response.json([{ role: 'admin', status: 'active' }]), body: [{ role: 'admin', status: 'active' }] })),
    json: (body, status = 200) => Response.json(body, { status }),
    error: (code, message, status) => Response.json({ error: { code, message } }, { status }),
  };
  return { request, context };
}
afterEach(() => vi.restoreAllMocks());
describe('GitHub integration trust boundary', () => {
  it.each(['sb_secret_fixture-server-only', 'e30.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.legacy-signature'])('uses the correct server headers for Supabase service key %s', async serviceKey => {
    const f = fixture('integrations/github/status'); f.context.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).includes('/auth/v1/user') ? Response.json({ id: user }) : Response.json([]));
    expect((await dispatchGitHubIntegration(f.request, f.context))!.status).toBe(200);
    const databaseCall = fetch.mock.calls.find(call => String(call[0]).includes('/rest/v1/'))!; const headers = new Headers(databaseCall[1]?.headers);
    expect(headers.get('apikey')).toBe(serviceKey);
    expect(headers.get('authorization')).toBe(serviceKey.startsWith('sb_secret_') ? null : `Bearer ${serviceKey}`);
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer signed-token');
  });
  it('ignores unrelated routes without accessing credentials', async () => {
    const f = fixture('libraries'); const fetch = vi.spyOn(globalThis, 'fetch');
    expect(await dispatchGitHubIntegration(f.request, f.context)).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects forged Supabase actor before service-role database access', async () => {
    const f = fixture('integrations/github/status'); const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ message: 'invalid JWT' }, { status: 401 }));
    expect((await dispatchGitHubIntegration(f.request, f.context))?.status).toBe(401); expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe('https://db.example/auth/v1/user');
  });
  it('rejects an authenticated user whose id differs from the context subject', async () => {
    const f = fixture('integrations/github/status'); vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 'another-user' }));
    expect((await dispatchGitHubIntegration(f.request, f.context))?.status).toBe(401);
  });
  it('encrypts tokens with random AES-GCM nonces and binds ciphertext to the user', async () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const one = await encryptGitHubSecret('github-secret-token', key, user); const two = await encryptGitHubSecret('github-secret-token', key, user);
    expect(one).not.toContain('github-secret-token'); expect(one).not.toBe(two);
    expect(await decryptGitHubSecret(one, key, user)).toBe('github-secret-token');
    await expect(decryptGitHubSecret(one, key, 'other-user')).rejects.toThrow();
  });
  it('issues a persisted expiring random state and PKCE challenge without exposing a verifier', async () => {
    const f = fixture('integrations/github/authorize', { redirectUri: 'https://lattice.example/cloud' });
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => String(input).includes('/auth/v1/user') ? Response.json({ id: user }) : Response.json([]));
    const response = await dispatchGitHubIntegration(f.request, f.context); const body = await response!.json();
    const authorization = new URL(body.data.authorizationUrl);
    expect(authorization.origin).toBe('https://github.com'); expect(authorization.searchParams.get('state')!.length).toBeGreaterThanOrEqual(43);
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256'); expect(authorization.searchParams.get('code_challenge')).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain('code_verifier');
    const saved = JSON.parse(String(fetch.mock.calls[1][1]?.body)); expect(saved.state_hash).not.toBe(authorization.searchParams.get('state'));
    expect(new Date(saved.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
  it('rejects callback redirects outside the configured URI before storing state', async () => {
    const f = fixture('integrations/github/authorize', { redirectUri: 'https://evil.example' });
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: user }));
    expect((await dispatchGitHubIntegration(f.request, f.context))?.status).toBe(400); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('accepts only allowlisted app return origins for server-side OAuth state', async () => {
    const f = fixture('integrations/github/authorize', { returnTo: 'https://outside.example/return', connectionId: 'cloud-a' });
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).includes('/auth/v1/user') ? Response.json({ id: user }) : Response.json([]));
    expect((await dispatchGitHubIntegration(f.request, f.context))?.status).toBe(400);
    expect(fetch.mock.calls.some(call => String(call[0]).includes('/cloud_github_oauth_states'))).toBe(false);
  });
  it('binds the OAuth code to the original authenticated connection', async () => {
    await serviceFixture();
    const start = fixture('integrations/github/authorize', { returnTo: 'https://lattice.example/workspace', connectionId: 'cloud-a' });
    const authorized = await (await dispatchGitHubIntegration(start.request, start.context))!.json();
    const state = new URL(authorized.data.authorizationUrl).searchParams.get('state');
    const wrong = fixture('integrations/github/claim', { state, connectionId: 'other-cloud' });
    expect((await dispatchGitHubIntegration(wrong.request, wrong.context))?.status).toBe(403);
  });
  it('rejects expired or replayed state before exchanging a GitHub code', async () => {
    const f = fixture('integrations/github/exchange', { code: 'code', state: 'x'.repeat(43), redirectUri: 'https://lattice.example/cloud' });
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).includes('/auth/v1/user') ? Response.json({ id: user }) : Response.json([]));
    expect((await dispatchGitHubIntegration(f.request, f.context))?.status).toBe(400);
    expect(fetch.mock.calls.some(call => String(call[0]).startsWith('https://github.com/'))).toBe(false);
  });
});

const libraryId = '22222222-2222-4222-8222-222222222222';
const sha = 'a'.repeat(40);
const connection = { id: '33333333-3333-4333-8333-333333333333', library_id: libraryId, repository_id: 88, installation_id: 77, owner: 'research', name: 'private-notes', branch: 'main', private: true, created_at: '2026-10-27T00:00:00Z', last_synced_at: null };
async function serviceFixture(options: { expired?: boolean; permissions?: Record<string, boolean>; conflict?: boolean; truncated?: boolean } = {}) {
  const key = Buffer.alloc(32, 7).toString('base64');
  const tokens = { access_cipher: await encryptGitHubSecret('server-token', key, `${user}:access`), refresh_cipher: await encryptGitHubSecret('server-refresh', key, `${user}:refresh`), expires_at: new Date(Date.now() + (options.expired ? -1000 : 3600000)).toISOString(), refresh_expires_at: new Date(Date.now() + 7200000).toISOString() };
  let stateRow: Record<string, unknown> | undefined;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input)); const value = init?.body ? JSON.parse(String(init.body)) : {}; const path = url.pathname;
    if (path === '/auth/v1/user') return Response.json({ id: user });
    if (path === '/rest/v1/cloud_github_tokens') { if (init?.method === 'PATCH') Object.assign(tokens, value); return Response.json([tokens]); }
    if (path === '/rest/v1/cloud_github_oauth_states') {
      if (init?.method === 'POST') { stateRow = value; return Response.json([value]); }
      const saved = stateRow;
      if (!saved || url.searchParams.get('state_hash') !== `eq.${saved.state_hash}`) return Response.json([]);
      if (init?.method === 'PATCH') { stateRow = { ...saved, ...value }; return Response.json([stateRow]); }
      if (init?.method === 'DELETE') stateRow = undefined;
      return Response.json([saved]);
    }
    if (path === '/rest/v1/cloud_github_identities') return Response.json([{ github_user_id: 42, login: 'renamed-user' }]);
    if (path === '/rest/v1/cloud_github_connections') return Response.json([connection]);
    if (path === '/rest/v1/rpc/cloud_github_claim_refresh') return Response.json([tokens]);
    if (path === '/rest/v1/rpc/cloud_github_connect') return Response.json(connection);
    if (path === '/rest/v1/rpc/cloud_github_sync_members') return Response.json({ matched: 2, granted: 1, revoked: 1, unbound: 1 });
    if (path === '/rest/v1/rpc/cloud_github_join_connections') return Response.json(1);
    if (path === '/rest/v1/rpc/cloud_github_bind_identity') return new Response(null, { status: 204 });
    if (path === '/rest/v1/rpc/cloud_github_unbind_identity') return new Response(null, { status: 204 });
    if (path === '/applications/Iv1.app/grant') return new Response(null, { status: 204 });
    if (url.origin === 'https://github.com') return Response.json({ access_token: 'new-server-token', refresh_token: 'new-server-refresh', expires_in: 28800, refresh_token_expires_in: 15897600 });
    if (path === '/user') return Response.json({ id: 42, login: 'renamed-user' });
    if (path === '/user/installations') return Response.json({ total_count: 1, installations: [{ id: 77 }] });
    if (path === '/user/installations/77/repositories') return Response.json({ total_count: 1, repositories: [{ id: 88, owner: { login: 'research' }, name: 'private-notes', full_name: 'research/private-notes', private: true, default_branch: 'main', permissions: options.permissions ?? { push: true } }] });
    if (path.endsWith('/collaborators')) return Response.json([
      { id: 42, login: 'renamed-user', permissions: { push: true } },
      { id: 43, login: 'maintainer', permissions: { maintain: true } },
      { id: 44, login: 'read-only', permissions: { pull: true } },
      { id: 45, login: 'commit-author-name', permissions: {} },
      { id: 46, login: 'admin', permissions: { admin: true } },
    ]);
    if (path.includes('/git/trees/')) return Response.json({ sha, truncated: options.truncated ?? false, tree: [{ path: 'notes.md', sha, type: 'blob', size: 5 }] });
    if (path.includes('/contents/')) {
      if (init?.method === 'PUT') return options.conflict ? Response.json({ message: 'sha does not match' }, { status: 409 }) : Response.json({ content: { sha: 'b'.repeat(40) }, commit: { sha: 'c'.repeat(40) } });
      return Response.json({ type: 'file', encoding: 'base64', content: 'aGVsbG8=', sha, size: 5 });
    }
    throw new Error(`Unexpected fetch ${init?.method ?? 'GET'} ${url}`);
  });
  return { fetch, tokens };
}
describe('GitHub identity, repository and file lifecycle', () => {
  it('uses the operator callback and returns to the original page after same-account claim', async () => {
    const { fetch } = await serviceFixture();
    const start = fixture('integrations/github/authorize', { returnTo: 'https://lattice.example/workspace?keep=1', connectionId: 'cloud-a', libraryId });
    const authorized = await (await dispatchGitHubIntegration(start.request, start.context))!.json();
    expect(authorized.data.redirectUri).toBe('https://lattice.example/cloud');
    const authorization = new URL(authorized.data.authorizationUrl); const state = authorization.searchParams.get('state')!;
    const callback = await handleGitHubOAuthCallback(new Request(`https://lattice.example/cloud?state=${state}&code=one-time-code`), start.context.env);
    expect(callback!.status).toBe(303);
    expect(callback!.headers.get('location')).toBe(`https://lattice.example/workspace?keep=1&github_state=${state}`);
    const claim = fixture('integrations/github/claim', { state, connectionId: 'cloud-a' });
    const completed = await (await dispatchGitHubIntegration(claim.request, claim.context))!.json();
    expect(completed.data).toMatchObject({ connected: true, githubUserId: 42 });
    expect(JSON.stringify(completed)).not.toContain('one-time-code');
    const retry = fixture('integrations/github/claim', { state, connectionId: 'cloud-a' });
    const receipt = await (await dispatchGitHubIntegration(retry.request, retry.context))!.json();
    expect(receipt.data).toEqual(completed.data);
    expect(fetch.mock.calls.filter(call => String(call[0]) === 'https://github.com/login/oauth/access_token')).toHaveLength(1);
  });
  it('keeps desktop authorization pending until its external-browser callback arrives', async () => {
    await serviceFixture();
    const start = fixture('integrations/github/authorize', { desktop: true, connectionId: 'desktop-a' });
    const authorized = await (await dispatchGitHubIntegration(start.request, start.context))!.json();
    const state = new URL(authorized.data.authorizationUrl).searchParams.get('state')!;
    const claim = fixture('integrations/github/claim', { state, connectionId: 'desktop-a' });
    expect((await (await dispatchGitHubIntegration(claim.request.clone(), claim.context))!.json()).data).toMatchObject({ pending: true });
    const callback = await handleGitHubOAuthCallback(new Request(`https://lattice.example/cloud?state=${state}&code=desktop-code`), start.context.env);
    expect(callback!.status).toBe(200); expect(await callback!.text()).toContain('返回 Lattice');
    expect((await (await dispatchGitHubIntegration(claim.request, claim.context))!.json()).data.connected).toBe(true);
  });
  it('provides the operator installation entry and removes a personal GitHub authorization', async () => {
    const { fetch } = await serviceFixture(); const status = fixture('integrations/github/status');
    Object.assign(status.context.env, { GITHUB_APP_SLUG: 'lattice-cloud' });
    expect((await (await dispatchGitHubIntegration(status.request, status.context))!.json()).data.installationUrl).toBe('https://github.com/apps/lattice-cloud/installations/new');
    const unlink = fixture('integrations/github/identity', undefined, 'DELETE');
    expect((await dispatchGitHubIntegration(unlink.request, unlink.context))!.status).toBe(200);
    expect(fetch.mock.calls.some(call => String(call[0]).endsWith('/applications/Iv1.app/grant') && call[1]?.method === 'DELETE')).toBe(true);
    expect(fetch.mock.calls.some(call => String(call[0]).endsWith('/rpc/cloud_github_unbind_identity'))).toBe(true);
  });
  it('binds the verified numeric GitHub user and sends only ciphertext to the database', async () => {
    const { fetch } = await serviceFixture(); const start = fixture('integrations/github/authorize', { redirectUri: 'https://lattice.example/cloud' });
    const authorized = await (await dispatchGitHubIntegration(start.request, start.context))!.json(); const state = new URL(authorized.data.authorizationUrl).searchParams.get('state');
    const callback = fixture('integrations/github/exchange', { state, code: 'one-time-code', redirectUri: 'https://lattice.example/cloud' });
    const response = await dispatchGitHubIntegration(callback.request, callback.context); const result = await response!.json();
    expect(response!.status).toBe(200); expect(result.data.githubUserId).toBe(42); expect(result.data.joinedLibraries).toBe(1);
    expect(JSON.stringify(result)).not.toContain('server-token');
    const binding = fetch.mock.calls.find(call => String(call[0]).endsWith('/rpc/cloud_github_bind_identity'))!; const value = JSON.parse(String(binding[1]?.body));
    expect(value.p_github_user_id).toBe(42); expect(value.p_tokens.access_cipher).toMatch(/^v1[.]/); expect(JSON.stringify(value)).not.toContain('new-server-token');
    const tokenRequest = fetch.mock.calls.find(call => String(call[0]) === 'https://github.com/login/oauth/access_token')!; expect(JSON.parse(String(tokenRequest[1]?.body)).code_verifier).toHaveLength(43);
    const replay = fixture('integrations/github/exchange', { state, code: 'same-code', redirectUri: 'https://lattice.example/cloud' });
    expect((await dispatchGitHubIntegration(replay.request, replay.context))!.status).toBe(400);
  });
  it('refreshes expiring tokens under a server-side lease before querying installations', async () => {
    const { fetch } = await serviceFixture({ expired: true }); const f = fixture('integrations/github/repositories');
    const response = await dispatchGitHubIntegration(f.request, f.context); expect(response!.status).toBe(200);
    const refresh = fetch.mock.calls.find(call => String(call[0]) === 'https://github.com/login/oauth/access_token')!;
    expect(JSON.parse(String(refresh[1]?.body))).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'server-refresh' });
    const installation = fetch.mock.calls.find(call => String(call[0]).startsWith('https://api.github.com/user/installations?'))!;
    expect(new Headers(installation[1]?.headers).get('authorization')).toBe('Bearer new-server-token');
    expect(fetch.mock.calls.some(call => String(call[0]).includes('/user/repos'))).toBe(false);
  });
  it('connects a private installed repository and synchronizes only push/maintain/admin numeric identities', async () => {
    const { fetch } = await serviceFixture(); const f = fixture(`libraries/${libraryId}/github`, { repositoryId: 88, installationId: 77 });
    const response = await dispatchGitHubIntegration(f.request, f.context); expect(response!.status).toBe(200);
    const sync = fetch.mock.calls.find(call => String(call[0]).endsWith('/rpc/cloud_github_sync_members'))!;
    expect(JSON.parse(String(sync[1]?.body)).p_github_user_ids).toEqual([42, 43, 46]);
    expect(JSON.stringify(await response!.json())).not.toContain('server-token');
  });
  it('does not let a library admin connect a GitHub read-only repository', async () => {
    const { fetch } = await serviceFixture({ permissions: { pull: true } }); const f = fixture(`libraries/${libraryId}/github`, { repositoryId: 88, installationId: 77 });
    expect((await dispatchGitHubIntegration(f.request, f.context))!.status).toBe(403);
    expect(fetch.mock.calls.some(call => String(call[0]).includes('/rpc/cloud_github_connect'))).toBe(false);
  });
  it('exposes a stale timestamp and verifies current repository access', async () => {
    await serviceFixture(); const f = fixture(`libraries/${libraryId}/github`); const response = await dispatchGitHubIntegration(f.request, f.context);
    expect((await response!.json()).data).toMatchObject({ stale: true, lastSyncedAt: null, repositoryId: 88, private: true });
  });
  it('reads file bytes and lists a complete repository tree', async () => {
    await serviceFixture(); const file = fixture(`libraries/${libraryId}/github/file?path=notes.md`); file.context.segments = ['libraries', libraryId, 'github', 'file'];
    expect((await (await dispatchGitHubIntegration(file.request, file.context))!.json()).data).toMatchObject({ path: 'notes.md', content: 'aGVsbG8=', sha, encoding: 'base64' });
    const tree = fixture(`libraries/${libraryId}/github/tree`); expect((await (await dispatchGitHubIntegration(tree.request, tree.context))!.json()).data.entries).toHaveLength(1);
  });
  it('rejects a truncated tree instead of presenting an incomplete import', async () => {
    await serviceFixture({ truncated: true }); const f = fixture(`libraries/${libraryId}/github/tree`); expect((await dispatchGitHubIntegration(f.request, f.context))!.status).toBe(422);
  });
  it('refuses a stale expectedSha before sending a mutation to GitHub', async () => {
    const { fetch } = await serviceFixture(); const f = fixture(`libraries/${libraryId}/github/file`, { path: 'notes.md', content: 'aGVsbG8=', expectedSha: 'd'.repeat(40) }, 'PUT');
    expect((await dispatchGitHubIntegration(f.request, f.context))!.status).toBe(409); expect(fetch.mock.calls.some(call => call[1]?.method === 'PUT')).toBe(false);
  });
  it('publishes with GitHub atomic SHA comparison and surfaces concurrent remote conflicts', async () => {
    const { fetch } = await serviceFixture({ conflict: true }); const f = fixture(`libraries/${libraryId}/github/file`, { path: 'notes.md', content: 'aGVsbG8=', expectedSha: sha }, 'PUT');
    expect((await dispatchGitHubIntegration(f.request, f.context))!.status).toBe(409);
    const publish = fetch.mock.calls.find(call => call[1]?.method === 'PUT')!; expect(JSON.parse(String(publish[1]?.body))).toMatchObject({ sha, branch: 'main' });
  });
  it('requires Lattice editor permission before repository publication', async () => {
    const { fetch } = await serviceFixture(); const f = fixture(`libraries/${libraryId}/github/file`, { path: 'notes.md', content: 'aGVsbG8=', expectedSha: sha }, 'PUT');
    f.context.db = vi.fn(async () => ({ response: Response.json([]), body: [{ role: 'viewer' }] }));
    expect((await dispatchGitHubIntegration(f.request, f.context))!.status).toBe(403); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects a concurrently replaced repository even if the fork has the same blob SHA', async () => {
    const { fetch } = await serviceFixture(); const f = fixture(`libraries/${libraryId}/github/file`, { path: 'notes.md', content: 'aGVsbG8=', expectedSha: sha, expectedRepositoryId: 999, expectedBranch: 'main' }, 'PUT');
    expect((await dispatchGitHubIntegration(f.request, f.context))!.status).toBe(409); expect(fetch.mock.calls.some(call => call[1]?.method === 'PUT')).toBe(false);
  });
});
