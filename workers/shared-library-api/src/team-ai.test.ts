// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleTeamAiRoute, type TeamAiEnv } from './team-ai';
import type { CloudIntegrationContext } from './integration-context';
import { encryptServerSecret, decryptServerSecret } from './server-secret-crypto';

const provider = { id: 'team', label: 'Team model', baseUrl: 'https://gateway.example.com/v1', apiKey: 'upstream-private-key', models: ['approved-model'], maxOutputTokens: 2048, requestBudgetUsdMicros: 10000 };
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service-private-key', TEAM_AI_PROVIDERS_JSON: JSON.stringify([provider]) };
const policy = { enabled: true, allowed_provider_ids: ['team'], max_output_tokens: 1024 };

function context(options: { config?: Partial<TeamAiEnv>; member?: boolean; policy?: unknown } = {}): CloudIntegrationContext {
  return {
    env: { ...env, ...options.config }, actor: { userId: 'user-1', accessToken: 'verified-user-token' },
    segments: ['v1', 'libraries', 'lib-1', 'ai', 'providers'], url: new URL('https://api.example.com/v1/libraries/lib-1/ai/providers'),
    db: vi.fn(async (table: string) => ({ response: new Response(null, { status: 200 }), body: table === 'library_members' ? options.member === false ? [] : [{ role: 'viewer' }] : [options.policy ?? policy] })),
    json: (body, status = 200) => Response.json(body, { status }),
    error: (code, message, status, retryable = false) => Response.json({ error: { code, message, retryable } }, { status }),
  } as CloudIntegrationContext;
}
function chat(input: Record<string, unknown> = {}): Request {
  return new Request('https://api.example.com/v1/libraries/lib-1/ai/chat', { method: 'POST', body: JSON.stringify({ providerId: 'team', model: 'approved-model', messages: [{ role: 'user', content: 'Explain this paper.' }], ...input }) });
}
function mockUpstream(options: { authStatus?: number; authId?: string; quotaStatus?: number; upstreamStatus?: number; upstreamThrow?: boolean } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: options.authId ?? 'user-1' }, { status: options.authStatus ?? 200 });
    if (url.includes('/rpc/cloud_reserve_ai_request')) return Response.json(options.quotaStatus ? { code: 'P0001', message: 'private db error' } : { reservationId: 'reservation-1' }, { status: options.quotaStatus ?? 200 });
    expect(url).toBe('https://gateway.example.com/v1/chat/completions');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer upstream-private-key');
    expect(init?.redirect).toBe('error');
    if (options.upstreamThrow) throw new Error('upstream-private-key https://internal.example.com');
    return Response.json(options.upstreamStatus ? { error: { message: 'upstream-private-key service-private-key' } } : { choices: [{ message: { content: 'A useful answer.' } }], usage: { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 }, debug_secret: 'upstream-private-key' }, { status: options.upstreamStatus ?? 200 });
  });
}
async function runChat(input: Record<string, unknown> = {}, options: Parameters<typeof context>[0] = {}) {
  const ctx = context(options); ctx.segments[4] = 'chat';
  return (await handleTeamAiRoute(chat(input), ctx))!;
}
afterEach(() => vi.restoreAllMocks());

function adminConfigFixture(existing = true) {
  const ctx = context({ config: { TEAM_AI_ENCRYPTION_KEY: Buffer.alloc(32, 23).toString('base64') } });
  ctx.segments[4] = 'config';
  ctx.db = vi.fn(async (table: string) => ({ response: Response.json([]), body: table === 'library_members' ? [{ role: 'owner' }] : [] }));
  const saved: Record<string, unknown>[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-1' });
    if (url.includes('/cloud_ai_library_providers?')) return Response.json(existing ? [{ provider_id: 'byo', label: 'Own model', base_url: 'https://api.openai.com/v1', models: ['test-model'], max_output_tokens: 1024, request_budget_usd_micros: 10000, api_key_ciphertext: 'CIPHERTEXT_MUST_NOT_RETURN' }] : []);
    if (url.includes('/rpc/cloud_')) { saved.push(JSON.parse(String(init?.body))); return Response.json({ saved: true }); }
    throw new Error('Unexpected request');
  });
  const body = { enabled: true, maxRequestsPerDay: 50, monthlyBudgetUsdMicros: 1000000, maxOutputTokens: 2048, provider: { id: 'byo', label: 'Own model', baseUrl: 'https://api.openai.com/v1', models: ['test-model'], maxOutputTokens: 1024, requestBudgetUsdMicros: 10000 } };
  const run = (input: unknown = body, method = 'PUT') => handleTeamAiRoute(new Request(ctx.url, { method, ...(method === 'GET' ? {} : { body: JSON.stringify(input) }) }), ctx);
  return { ctx, body, saved, run };
}

describe('user-owned team provider configuration', () => {
  it('reads metadata without returning ciphertext', async () => {
    const f = adminConfigFixture(); const response = (await f.run(undefined, 'GET'))!;
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.providers[0]).toMatchObject({ id: 'byo', apiKeyConfigured: true });
    expect(JSON.stringify(data)).not.toContain('CIPHERTEXT');
  });
  it('keeps the saved key when editing the same endpoint without a new key', async () => {
    const f = adminConfigFixture(); const response = (await f.run())!;
    expect(response.status).toBe(200); expect(f.saved[0].p_api_key_ciphertext).toBeNull();
  });
  it('requires a new key for new providers and changed endpoints', async () => {
    const f = adminConfigFixture(false); expect((await f.run())!.status).toBe(400); expect(f.saved).toHaveLength(0);
    vi.restoreAllMocks(); const existing = adminConfigFixture();
    expect((await existing.run({ ...existing.body, provider: { ...existing.body.provider, baseUrl: 'https://api.deepseek.com/v1' } }))!.status).toBe(400);
    expect(existing.saved).toHaveLength(0);
  });
  it('rotates a supplied key into library-bound ciphertext', async () => {
    const f = adminConfigFixture(); const response = (await f.run({ ...f.body, provider: { ...f.body.provider, apiKey: 'NEW_SYNTHETIC_KEY' } }))!;
    expect(response.status).toBe(200);
    const cipher = String(f.saved[0].p_api_key_ciphertext);
    expect(await decryptServerSecret(cipher, f.ctx.env.TEAM_AI_ENCRYPTION_KEY!, 'lib-1:byo')).toBe('NEW_SYNTHETIC_KEY');
    await expect(decryptServerSecret(cipher, f.ctx.env.TEAM_AI_ENCRYPTION_KEY!, 'other-library:byo')).rejects.toThrow();
    expect(await response.text()).not.toContain('NEW_SYNTHETIC_KEY');
  });
  it('deletes only the requested library provider through the protected RPC', async () => {
    const f = adminConfigFixture(); expect((await f.run({ providerId: 'byo' }, 'DELETE'))!.status).toBe(200);
    expect(f.saved).toEqual([{ p_library_id: 'lib-1', p_actor_id: 'user-1', p_provider_id: 'byo' }]);
  });
  it.each(['https://127.0.0.1/v1', 'https://localhost/v1', 'https://unapproved.example.com/v1', 'https://api.openai.com.attacker.example/v1'])('rejects unapproved server endpoints without storing a key: %s', async baseUrl => {
    const f = adminConfigFixture(); expect((await f.run({ ...f.body, provider: { ...f.body.provider, baseUrl, apiKey: 'NEW_SYNTHETIC_KEY' } }))!.status).toBe(400); expect(f.saved).toHaveLength(0);
  });
  it('uses an encrypted library provider without any deployment model API key', async () => {
    const key = Buffer.alloc(32, 23).toString('base64');
    const ciphertext = await encryptServerSecret('LIBRARY_SYNTHETIC_KEY', key, 'lib-1:byo');
    const ctx = context({ config: { TEAM_AI_PROVIDERS_JSON: undefined, TEAM_AI_ENCRYPTION_KEY: key }, policy: { ...policy, allowed_provider_ids: ['byo'] } });
    ctx.segments[4] = 'chat';
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input); calls.push(url);
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-1' });
      if (url.includes('/cloud_ai_library_providers?')) { expect(new URL(url).searchParams.get('library_id')).toBe('eq.lib-1'); return Response.json([{ provider_id: 'byo', label: 'Own model', base_url: 'https://api.openai.com/v1', models: ['test-model'], api_key_ciphertext: ciphertext, max_output_tokens: 1024, request_budget_usd_micros: 10000 }]); }
      if (url.includes('/rpc/cloud_reserve_ai_request')) return Response.json({ reservationId: 'r' });
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer LIBRARY_SYNTHETIC_KEY');
      return Response.json({ choices: [{ message: { content: 'BYOK answer' } }] });
    });
    const response = (await handleTeamAiRoute(chat({ providerId: 'byo', model: 'test-model' }), ctx))!;
    expect(response.status).toBe(200); expect((await response.json()).content).toBe('BYOK answer');
    expect(calls.findIndex(url => url.includes('cloud_reserve'))).toBeLessThan(calls.findIndex(url => url.includes('/chat/completions')));
  });
  it('never falls back to a platform key when private provider storage fails', async () => {
    const ctx = context({ config: { TEAM_AI_ENCRYPTION_KEY: Buffer.alloc(32, 23).toString('base64') } }); ctx.segments[4] = 'chat';
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).endsWith('/auth/v1/user') ? Response.json({ id: 'user-1' }) : Response.json({ code: 'storage unavailable' }, { status: 503 }));
    const response = (await handleTeamAiRoute(chat(), ctx))!;
    expect(response.status).toBe(503);
    expect(request.mock.calls.some(call => String(call[0]).includes('/chat/completions'))).toBe(false);
    expect(request.mock.calls.some(call => String(call[0]).includes('cloud_reserve'))).toBe(false);
  });
  it('refuses a library-owned provider when its encryption key is unavailable, even if a platform provider has the same id', async () => {
    const ctx = context({ policy: { ...policy, provider_source: 'library' } }); ctx.segments[4] = 'chat';
    const request = mockUpstream();
    const response = (await handleTeamAiRoute(chat(), ctx))!;
    expect(response.status).toBe(503);
    expect(request.mock.calls.some(call => String(call[0]).includes('cloud_reserve'))).toBe(false);
    expect(request.mock.calls.some(call => String(call[0]).includes('/chat/completions'))).toBe(false);
  });
  it('does not substitute a platform provider for a deleted library provider', async () => {
    const ctx = context({ config: { TEAM_AI_ENCRYPTION_KEY: Buffer.alloc(32, 23).toString('base64') }, policy: { ...policy, provider_source: 'library' } }); ctx.segments[4] = 'chat';
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).endsWith('/auth/v1/user') ? Response.json({ id: 'user-1' }) : Response.json([]));
    expect((await handleTeamAiRoute(chat(), ctx))!.status).toBe(503);
    expect(request.mock.calls.some(call => String(call[0]).includes('cloud_reserve'))).toBe(false);
  });
});

describe('cloud team AI policy boundary', () => {
  it('lets an active library admin save a team provider while storing and returning no plaintext key', async () => {
    const encryptionKey = Buffer.alloc(32, 23).toString('base64');
    const ctx = context({ config: { TEAM_AI_ENCRYPTION_KEY: encryptionKey, TEAM_AI_ALLOWED_ORIGINS: 'https://gateway.example.com' } });
    ctx.segments[4] = 'config';
    ctx.url.pathname = '/v1/libraries/lib-1/ai/config';
    ctx.db = vi.fn(async (table: string) => ({
      response: Response.json(table === 'library_members' ? [{ role: 'admin', status: 'active' }] : []),
      body: table === 'library_members' ? [{ role: 'admin', status: 'active' }] : [],
    }));
    const rpc = vi.fn(async (_url: string, init?: RequestInit) => Response.json({ provider_id: 'research' }, { status: 200 }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-1' });
      if (url.includes('/rest/v1/cloud_ai_library_providers?')) return Response.json([]);
      if (url.endsWith('/rpc/cloud_configure_team_ai_provider')) return rpc(url, init);
      throw new Error(`Unexpected request: ${url}`);
    });
    const providerInput = { id: 'research', label: 'Research model', baseUrl: 'https://gateway.example.com/v1', apiKey: 'OWNER_API_KEY_MUST_NOT_LEAK', models: ['research-v2'], maxOutputTokens: 2048, requestBudgetUsdMicros: 25000 };
    const response = await handleTeamAiRoute(new Request(ctx.url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: providerInput, enabled: true, maxRequestsPerDay: 30, monthlyBudgetUsdMicros: 5000000, maxOutputTokens: 2048 }) }), ctx);

    expect(response?.status).toBe(200);
    const rpcBody = JSON.parse(String(rpc.mock.calls[0][1]?.body));
    expect(rpcBody).toMatchObject({ p_library_id: 'lib-1', p_actor_id: 'user-1', p_provider_id: 'research', p_enabled: true, p_max_requests_per_day: 30, p_monthly_budget_usd_micros: 5000000, p_max_output_tokens: 2048 });
    expect(rpcBody.p_api_key_ciphertext).not.toContain(providerInput.apiKey);
    expect(rpcBody.p_api_key_ciphertext).toMatch(/^v1\./);
    expect(await response?.text()).not.toContain(providerInput.apiKey);
  });

  it('rejects team AI provider configuration from non-managing library members before writing', async () => {
    const ctx = context({ config: { TEAM_AI_ENCRYPTION_KEY: Buffer.alloc(32, 23).toString('base64') } });
    ctx.segments[4] = 'config';
    ctx.url.pathname = '/v1/libraries/lib-1/ai/config';
    ctx.db = vi.fn(async (table: string) => ({ response: Response.json(table === 'library_members' ? [{ role: 'editor', status: 'active' }] : []), body: table === 'library_members' ? [{ role: 'editor', status: 'active' }] : [] }));
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 'user-1' }));
    const response = await handleTeamAiRoute(new Request(ctx.url, { method: 'PUT', body: JSON.stringify({}) }), ctx);

    expect(response?.status).toBe(403);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(['sb_secret_fixture-server-only', 'e30.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.legacy-signature'])('uses the correct quota reservation headers for Supabase service key %s', async serviceKey => {
    const fetchMock = mockUpstream(); const response = await runChat({}, { config: { SUPABASE_SERVICE_ROLE_KEY: serviceKey } });
    expect(response.status).toBe(200);
    const quota = fetchMock.mock.calls.find(call => String(call[0]).includes('/rpc/cloud_reserve_ai_request'))!; const headers = new Headers(quota[1]?.headers);
    expect(headers.get('apikey')).toBe(serviceKey);
    expect(headers.get('authorization')).toBe(serviceKey.startsWith('sb_secret_') ? null : `Bearer ${serviceKey}`);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer verified-user-token');
  });
  it('does not intercept unrelated routes', async () => {
    const ctx = context(); ctx.segments[3] = 'items';
    expect(await handleTeamAiRoute(chat(), ctx)).toBeNull();
  });
  it('verifies the JWT through Supabase Auth before querying membership', async () => {
    const fetchMock = mockUpstream({ authStatus: 401 }); const ctx = context();
    const response = (await handleTeamAiRoute(new Request(ctx.url), ctx))!;
    expect(response.status).toBe(401); expect(ctx.db).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('rejects a forged decoded subject and inactive membership', async () => {
    mockUpstream({ authId: 'another-user' }); expect((await runChat()).status).toBe(401);
    vi.restoreAllMocks(); const fetchMock = mockUpstream();
    expect((await runChat({}, { member: false })).status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('lists only library-enabled providers and never serializes secrets or upstream URLs', async () => {
    mockUpstream(); const ctx = context();
    const response = (await handleTeamAiRoute(new Request(ctx.url), ctx))!;
    expect(await response.json()).toEqual({ enabled: true, providers: [{ id: 'team', label: 'Team model', models: ['approved-model'], maxOutputTokens: 1024 }] });
  });
  it('fails closed without deployment secrets or an enabled library policy', async () => {
    const fetchMock = mockUpstream();
    expect((await runChat({}, { config: { SUPABASE_SERVICE_ROLE_KEY: undefined } })).status).toBe(503);
    expect((await runChat({}, { policy: { ...policy, enabled: false } })).status).toBe(403);
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('gateway'))).toBe(true);
  });
  it.each(['http://gateway.example.com/v1', 'https://127.0.0.1/v1', 'https://[::1]/v1', 'https://localhost/v1', 'https://x:y@gateway.example.com/v1', 'https://gateway.example.com/v1?key=secret'])('rejects an unsafe configured upstream %s', async baseUrl => {
    const fetchMock = mockUpstream();
    expect((await runChat({}, { config: { TEAM_AI_PROVIDERS_JSON: JSON.stringify([{ ...provider, baseUrl }]) } })).status).toBe(503);
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('chat/completions'))).toBe(true);
  });
  it.each([{ model: 'unapproved' }, { baseUrl: 'https://attacker.example.com' }, { stream: true }, { maxTokens: 1025 }, { maxTokens: -1 }, { messages: [{ role: 'tool', content: 'bad' }] }, { messages: [{ role: 'user', content: 'x'.repeat(65537) }] }])('rejects unapproved or oversized input before reserving quota: %o', async input => {
    const fetchMock = mockUpstream(); expect((await runChat(input)).status).toBe(400);
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('cloud_reserve'))).toBe(true);
  });
  it('reserves a bounded server budget before making a single approved upstream request', async () => {
    const fetchMock = mockUpstream(); const response = await runChat({ maxTokens: 500 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ providerId: 'team', model: 'approved-model', content: 'A useful answer.', usage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 }, reservationId: 'reservation-1' });
    const quotaCall = fetchMock.mock.calls.find(([url]) => String(url).includes('cloud_reserve'))!;
    expect(new Headers(quotaCall[1]?.headers).get('authorization')).toBe('Bearer service-private-key');
    expect(JSON.parse(String(quotaCall[1]?.body))).toMatchObject({ p_library_id: 'lib-1', p_user_id: 'user-1', p_provider_id: 'team', p_reserved_usd_micros: 10000, p_max_output_tokens: 500 });
    const upstream = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
    expect(upstream).toEqual({ model: 'approved-model', messages: [{ role: 'user', content: 'Explain this paper.' }], max_tokens: 500, stream: false });
  });
  it('stops before upstream when the atomic library budget is exhausted', async () => {
    const fetchMock = mockUpstream({ quotaStatus: 400 }); const response = await runChat();
    expect(response.status).toBe(429); expect(await response.text()).not.toContain('private db error'); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('rejects a request body above its byte cap without reserving quota', async () => {
    const fetchMock = mockUpstream(); const ctx = context(); ctx.segments[4] = 'chat';
    const response = (await handleTeamAiRoute(new Request('https://api.example.com/v1/libraries/lib-1/ai/chat', { method: 'POST', body: JSON.stringify({ providerId: 'team', model: 'approved-model', messages: [{ role: 'user', content: '中'.repeat(50000) }] }) }), ctx))!;
    expect(response.status).toBe(400); expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('cloud_reserve'))).toBe(true);
  });
  it('fails closed when the budget migration is unavailable', async () => {
    const fetchMock = mockUpstream();
    fetchMock.mockImplementationOnce(async () => Response.json({ id: 'user-1' }));
    fetchMock.mockImplementationOnce(async () => Response.json({ code: 'PGRST202', message: 'secret database internals' }, { status: 404 }));
    const response = await runChat(); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('database internals'); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([{}, { choices: [{ message: { content: 'x'.repeat(131073) } }] }])('rejects malformed or oversized upstream responses without forwarding metadata', async upstreamBody => {
    const fetchMock = mockUpstream();
    fetchMock.mockImplementationOnce(async () => Response.json({ id: 'user-1' }));
    fetchMock.mockImplementationOnce(async () => Response.json({ reservationId: 'reservation-1' }));
    fetchMock.mockImplementationOnce(async () => Response.json(upstreamBody));
    const response = await runChat(); expect(response.status).toBe(502);
    expect((await response.text()).length).toBeLessThan(200);
  });
  it.each([{ upstreamStatus: 401 }, { upstreamStatus: 429 }, { upstreamThrow: true }])('redacts upstream errors and retains the budget reservation: %o', async options => {
    const fetchMock = mockUpstream(options); const response = await runChat();
    expect(response.status).toBe(502); const text = await response.text();
    expect(text).not.toContain('private-key'); expect(text).not.toContain('internal.example');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('cloud_reserve'))).toHaveLength(1);
  });
});
