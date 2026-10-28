// @vitest-environment node
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptGitHubSecret, handleGitHubWebhook, processGitHubWebhookDeliveries } from './github';

const user = '11111111-1111-4111-8111-111111111111';
const deliveryId = '22222222-2222-4222-8222-222222222222';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', GITHUB_APP_CLIENT_ID: 'app-id', GITHUB_APP_CLIENT_SECRET: 'app-secret', GITHUB_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), GITHUB_OAUTH_REDIRECT_URI: 'https://lattice.example/cloud', GITHUB_WEBHOOK_SECRET: 'signed-webhook-secret' };
function request(event = 'member', signature?: string) {
  const body = JSON.stringify({ action: 'removed', repository: { id: 88 }, installation: { id: 77 } });
  return new Request('https://api.example/v1/integrations/github/webhook', { method: 'POST', headers: { 'x-hub-signature-256': signature ?? `sha256=${createHmac('sha256', env.GITHUB_WEBHOOK_SECRET).update(body).digest('hex')}`, 'x-github-event': event, 'x-github-delivery': deliveryId }, body });
}
async function fixture(options: { removed?: boolean; failure?: boolean } = {}) {
  let saved: Record<string, unknown> | undefined;
  const token = { access_cipher: await encryptGitHubSecret('server-token', env.GITHUB_TOKEN_ENCRYPTION_KEY, `${user}:access`), refresh_cipher: await encryptGitHubSecret('refresh-token', env.GITHUB_TOKEN_ENCRYPTION_KEY, `${user}:refresh`), expires_at: new Date(Date.now() + 3600000).toISOString(), refresh_expires_at: new Date(Date.now() + 7200000).toISOString() };
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input)); const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === '/rest/v1/cloud_github_webhook_deliveries') {
      if (init?.method === 'POST') { if (saved) return Response.json([]); saved = { ...body, attempts: 1 }; return Response.json([saved]); }
      if (init?.method === 'PATCH') { Object.assign(saved!, body); return Response.json([saved]); }
    }
    if (url.pathname === '/rest/v1/rpc/cloud_github_claim_webhooks') return Response.json(saved ? [saved] : []);
    if (url.pathname === '/rest/v1/cloud_github_connections') return Response.json([{ id: 'connection', library_id: 'library', repository_id: 88, installation_id: 77, owner: 'research', name: 'notes', connected_by: user }]);
    if (url.pathname === '/rest/v1/cloud_github_tokens') return Response.json([token]);
    if (url.pathname === '/user/installations') return Response.json({ total_count: 1, installations: [{ id: 77 }] });
    if (url.pathname === '/user/installations/77/repositories') return options.failure ? Response.json({ message: 'outage' }, { status: 503 }) : Response.json({ total_count: options.removed ? 0 : 1, repositories: options.removed ? [] : [{ id: 88, owner: { login: 'research' }, name: 'notes', full_name: 'research/notes', default_branch: 'main', private: true, permissions: { push: true } }] });
    if (url.pathname.endsWith('/collaborators')) return Response.json([{ id: 42, permissions: { push: true } }, { id: 43, permissions: { pull: true } }]);
    if (url.pathname === '/rest/v1/rpc/cloud_github_sync_members') return Response.json({ matched: 1, granted: 0, revoked: 1, unbound: 0 });
    throw new Error(`Unexpected ${url}`);
  });
  return { fetch, saved: () => saved };
}
afterEach(() => vi.restoreAllMocks());
describe('GitHub automatic membership webhooks', () => {
  it('rejects an invalid HMAC before reading or writing service-role data', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch'); const response = await handleGitHubWebhook(request('member', `sha256=${'0'.repeat(64)}`), env);
    expect(response.status).toBe(401); expect(fetch).not.toHaveBeenCalled();
  });
  it('ignores signed unrelated events without interpreting commit authors as members', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch'); expect(await (await handleGitHubWebhook(request('push'), env)).json()).toMatchObject({ ignored: true }); expect(fetch).not.toHaveBeenCalled();
  });
  it('persists delivery before querying trusted current collaborators and de-duplicates replay', async () => {
    const { fetch, saved } = await fixture(); expect((await handleGitHubWebhook(request(), env)).status).toBe(202);
    expect(saved()!.status).toBe('complete');
    expect(String(fetch.mock.calls[0][0])).toContain('/cloud_github_webhook_deliveries');
    const sync = fetch.mock.calls.find(call => String(call[0]).endsWith('/rpc/cloud_github_sync_members'))!;
    expect(JSON.parse(String(sync[1]?.body))).toMatchObject({ p_connection_id: 'connection', p_actor_id: null, p_github_user_ids: [42] });
    expect(await (await handleGitHubWebhook(request(), env)).json()).toMatchObject({ duplicate: true });
    expect(fetch.mock.calls.filter(call => String(call[0]).endsWith('/rpc/cloud_github_sync_members'))).toHaveLength(1);
  });
  it('revokes only provider-owned grants when an installation loses the repository', async () => {
    const { fetch } = await fixture({ removed: true }); await handleGitHubWebhook(request(), env);
    const sync = fetch.mock.calls.find(call => String(call[0]).endsWith('/rpc/cloud_github_sync_members'))!;
    expect(JSON.parse(String(sync[1]?.body)).p_github_user_ids).toEqual([]);
  });
  it('persists retryable upstream failures without granting any membership', async () => {
    const { fetch, saved } = await fixture({ failure: true }); const response = await handleGitHubWebhook(request(), env);
    expect(response.status).toBe(202); expect(saved()!.status).toBe('failed'); expect(saved()!.last_error).toBe('GITHUB_UPSTREAM_ERROR'); expect(Date.parse(String(saved()!.available_at))).toBeGreaterThan(Date.now());
    expect(fetch.mock.calls.some(call => String(call[0]).endsWith('/rpc/cloud_github_sync_members'))).toBe(false);
  });
  it('provides a scheduler entry point backed by durable claimed jobs', async () => {
    const { fetch } = await fixture(); await processGitHubWebhookDeliveries(env);
    const claim = fetch.mock.calls.find(call => String(call[0]).endsWith('/rpc/cloud_github_claim_webhooks'))!; expect(JSON.parse(String(claim[1]?.body))).toEqual({ p_delivery_id: null });
  });
});
