import type { CloudIntegrationContext } from './integration-context';
import { decryptServerSecret, encryptServerSecret } from './server-secret-crypto';

/** Encryption infrastructure is deployment-owned; library admins configure their own providers. */
export interface TeamAiEnv {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  TEAM_AI_PROVIDERS_JSON?: string;
  TEAM_AI_ENCRYPTION_KEY?: string;
  TEAM_AI_ALLOWED_ORIGINS?: string;
}
interface Provider {
  id: string; label: string; baseUrl: string; apiKey: string; models: string[];
  maxOutputTokens: number; requestBudgetUsdMicros: number;
}
type RecordValue = Record<string, unknown>;
const MAX_REQUEST_BYTES = 131072;
const MAX_MESSAGE_CHARS = 65536;

function record(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function safeUpstream(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value), hostname = url.hostname.toLowerCase();
    // Deployment URLs form the allowlist. Forbid IP literals, local names and redirects.
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && (!url.port || url.port === '443') && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(hostname)
      && !/(^|\.)(localhost|local|internal)$/.test(hostname);
  } catch { return false; }
}
const DEFAULT_TEAM_AI_ORIGINS = ['https://api.openai.com', 'https://api.deepseek.com', 'https://api.mistral.ai', 'https://api.groq.com', 'https://openrouter.ai'];
function approvedTeamEndpoint(value: string, env: TeamAiEnv): boolean {
  if (!safeUpstream(value)) return false;
  const allowed = [...DEFAULT_TEAM_AI_ORIGINS, ...(env.TEAM_AI_ALLOWED_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean)];
  return allowed.includes(new URL(value).origin);
}
function loadProviders(env: TeamAiEnv): Provider[] | null {
  if (!env.TEAM_AI_PROVIDERS_JSON || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const values: unknown = JSON.parse(env.TEAM_AI_PROVIDERS_JSON);
    if (!Array.isArray(values) || values.length === 0 || values.length > 32) return null;
    const seen = new Set<string>(), providers: Provider[] = [];
    for (const value of values) {
      if (!record(value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.id)
        || seen.has(value.id) || !safeUpstream(value.baseUrl)
        || typeof value.apiKey !== 'string' || !value.apiKey.trim() || /[\r\n]/.test(value.apiKey)
        || !Array.isArray(value.models) || value.models.length === 0 || value.models.length > 64
        || value.models.some(model => typeof model !== 'string' || !model.trim() || model.length > 200)
        || !integer(value.maxOutputTokens, 1, 8192) || !integer(value.requestBudgetUsdMicros, 1, 1000000000)) return null;
      seen.add(value.id);
      providers.push({ id: value.id, label: typeof value.label === 'string' ? value.label.slice(0, 120) : value.id,
        baseUrl: value.baseUrl.replace(/\/+$/, ''), apiKey: value.apiKey, models: value.models as string[],
        maxOutputTokens: value.maxOutputTokens, requestBudgetUsdMicros: value.requestBudgetUsdMicros });
    }
    return providers;
  } catch { return null; }
}
function serviceHeaders(env: TeamAiEnv): Headers {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Team AI service credentials are not configured');
  const headers = new Headers({ apikey: key, 'content-type': 'application/json' });
  if (!key.startsWith('sb_secret_')) headers.set('authorization', `Bearer ${key}`);
  return headers;
}
async function serviceRequest(context: CloudIntegrationContext, path: string, init: RequestInit = {}): Promise<{ response: Response; body: unknown }> {
  const headers = serviceHeaders(context.env as TeamAiEnv);
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  const response = await fetch(new URL(`/rest/v1/${path}`, context.env.SUPABASE_URL), { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
  const raw = await response.text();
  let body: unknown = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  return { response, body };
}
function configuredKey(env: TeamAiEnv): string {
  if (!env.TEAM_AI_ENCRYPTION_KEY) throw new Error('Team AI encryption is not configured');
  return env.TEAM_AI_ENCRYPTION_KEY;
}
async function configuredProviders(context: CloudIntegrationContext, libraryId: string, allowDeploymentFallback = true): Promise<Provider[]> {
  const deploymentProviders = loadProviders(context.env as TeamAiEnv) ?? [];
  if (!context.env.TEAM_AI_ENCRYPTION_KEY || !context.env.SUPABASE_SERVICE_ROLE_KEY) return allowDeploymentFallback ? deploymentProviders : [];
  const query = new URLSearchParams({ library_id: `eq.${libraryId}`, select: 'provider_id,label,base_url,models,api_key_ciphertext,max_output_tokens,request_budget_usd_micros' });
  const result = await serviceRequest(context, `cloud_ai_library_providers?${query}`);
  if (!result.response.ok || !Array.isArray(result.body)) throw new Error('Team AI provider storage unavailable');
  const providers: Provider[] = [];
  for (const value of result.body as Record<string, unknown>[]) {
    if (typeof value.provider_id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.provider_id) || typeof value.base_url !== 'string' || !approvedTeamEndpoint(value.base_url, context.env) || !Array.isArray(value.models) || !value.models.length || value.models.some(model => typeof model !== 'string' || !model.trim() || model.length > 200) || typeof value.api_key_ciphertext !== 'string' || !integer(value.max_output_tokens, 1, 8192) || !integer(value.request_budget_usd_micros, 1, 1000000000)) continue;
    try {
      const apiKey = await decryptServerSecret(value.api_key_ciphertext, configuredKey(context.env as TeamAiEnv), `${libraryId}:${value.provider_id}`);
      providers.push({ id: value.provider_id, label: typeof value.label === 'string' ? value.label : value.provider_id, baseUrl: value.base_url, apiKey, models: value.models.filter((item): item is string => typeof item === 'string'), maxOutputTokens: Number(value.max_output_tokens), requestBudgetUsdMicros: Number(value.request_budget_usd_micros) });
    } catch { /* A malformed provider is omitted, never surfaced with ciphertext details. */ }
  }
  return result.body.length ? providers : allowDeploymentFallback ? deploymentProviders : [];
}
async function limitedJson(source: Request | Response): Promise<unknown> {
  if (!source.body) return null;
  const declared = source.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) return null;
  const reader = source.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return null; }
  finally { reader.releaseLock(); }
}

/** Paid upstream access requires verified identity, active membership and an atomic budget reservation. */
export async function handleTeamAiRoute(request: Request, context: CloudIntegrationContext): Promise<Response | null> {
  const { segments, actor, env, db, json, error } = context;
  if (segments[0] !== 'v1' || segments[1] !== 'libraries' || !segments[2] || segments[3] !== 'ai') return null;
  if (segments.length !== 5 || !['providers', 'chat', 'config'].includes(segments[4])) return error('NOT_FOUND', 'AI route not found', 404);
  if ((segments[4] === 'providers' && request.method !== 'GET') || (segments[4] === 'chat' && request.method !== 'POST') || (segments[4] === 'config' && !['GET', 'PUT', 'DELETE'].includes(request.method))) return error('METHOD_NOT_ALLOWED', 'Method not allowed', 405);
  try {
    // A decoded JWT subject alone is never sufficient for paid requests.
    const auth = await fetch(new URL('/auth/v1/user', env.SUPABASE_URL), { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: 'Bearer ' + actor.accessToken }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!auth.ok) return error(auth.status >= 500 ? 'AI_UNAVAILABLE' : 'UNAUTHORIZED', auth.status >= 500 ? 'Authentication service unavailable' : 'Authentication required', auth.status >= 500 ? 503 : 401, auth.status >= 500);
    const user: unknown = await auth.json();
    if (!record(user) || user.id !== actor.userId) return error('UNAUTHORIZED', 'Authentication required', 401);
    const libraryId = segments[2];
    const membership = await db('library_members', undefined, { library_id: 'eq.' + libraryId, user_id: 'eq.' + actor.userId, status: 'eq.active', select: 'role' });
    if (!membership.response.ok) return error(membership.response.status >= 500 ? 'AI_UNAVAILABLE' : 'FORBIDDEN', 'Unable to verify library membership', membership.response.status >= 500 ? 503 : 403, membership.response.status >= 500);
    if (!Array.isArray(membership.body) || !membership.body.length) return error('FORBIDDEN', 'Active library membership required', 403);
    const memberRole = String((membership.body[0] as RecordValue).role ?? 'viewer');
    if (segments[4] === 'config') {
      if (!['owner', 'admin'].includes(memberRole)) return error('FORBIDDEN', 'Library administrator required', 403);
      if (!env.SUPABASE_SERVICE_ROLE_KEY) return error('AI_NOT_CONFIGURED', 'Team AI configuration is not available', 503);
      const query = new URLSearchParams({ library_id: `eq.${libraryId}`, select: 'provider_id,label,base_url,models,max_output_tokens,request_budget_usd_micros' });
      const current = await serviceRequest(context, `cloud_ai_library_providers?${query}`);
      if (!current.response.ok || !Array.isArray(current.body)) return error('AI_UNAVAILABLE', 'Team AI configuration unavailable', 503, true);
      const policyResult = await db('cloud_ai_library_policies', undefined, { library_id: 'eq.' + libraryId, select: 'enabled,max_requests_per_day,monthly_budget_usd_micros,max_output_tokens' });
      if (!policyResult.response.ok) return error('AI_UNAVAILABLE', 'Team AI policy unavailable', 503, true);
      const savedPolicy = Array.isArray(policyResult.body) ? policyResult.body[0] as RecordValue | undefined : undefined;
      const metadata = current.body.map(value => { const row = value as RecordValue; return { id: row.provider_id, label: row.label, baseUrl: row.base_url, models: row.models, maxOutputTokens: row.max_output_tokens, requestBudgetUsdMicros: row.request_budget_usd_micros, apiKeyConfigured: true }; });
      if (request.method === 'GET') return json({ enabled: savedPolicy?.enabled === true, maxRequestsPerDay: savedPolicy?.max_requests_per_day ?? 100, monthlyBudgetUsdMicros: savedPolicy?.monthly_budget_usd_micros ?? 1000000, maxOutputTokens: savedPolicy?.max_output_tokens ?? 2048, providers: metadata });
      if (request.method === 'DELETE') {
        const input = await limitedJson(request);
        if (!record(input) || typeof input.providerId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.providerId)) return error('INVALID_INPUT', 'Invalid provider', 400);
        const removed = await serviceRequest(context, 'rpc/cloud_delete_team_ai_provider', { method: 'POST', body: JSON.stringify({ p_library_id: libraryId, p_actor_id: actor.userId, p_provider_id: input.providerId }) });
        if (!removed.response.ok) return error('AI_UNAVAILABLE', 'Team AI provider could not be removed', 503, true);
        return json({ deleted: true });
      }
      if (!env.TEAM_AI_ENCRYPTION_KEY) return error('AI_NOT_CONFIGURED', 'Team AI encryption is not configured', 503);
      const input = await limitedJson(request);
      if (!record(input) || !record(input.provider) || typeof input.provider.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.provider.id) || typeof input.provider.label !== 'string' || !input.provider.label.trim() || typeof input.provider.baseUrl !== 'string' || !safeUpstream(input.provider.baseUrl) || (input.provider.apiKey !== undefined && (typeof input.provider.apiKey !== 'string' || input.provider.apiKey.length > 4096 || /[\r\n]/.test(input.provider.apiKey))) || !Array.isArray(input.provider.models) || input.provider.models.length < 1 || input.provider.models.length > 64 || input.provider.models.some(value => typeof value !== 'string' || !value.trim() || value.length > 200) || new Set(input.provider.models).size !== input.provider.models.length || !integer(input.provider.maxOutputTokens, 1, 8192) || !integer(input.provider.requestBudgetUsdMicros, 1, 1000000000) || typeof input.enabled !== 'boolean' || !integer(input.maxRequestsPerDay, 0, 100000) || !integer(input.monthlyBudgetUsdMicros, 0, 1000000000000) || !integer(input.maxOutputTokens, 1, 8192)) return error('INVALID_INPUT', 'Invalid team AI configuration', 400);
      if (input.provider.maxOutputTokens > input.maxOutputTokens) return error('INVALID_INPUT', 'Provider output limit exceeds the library limit', 400);
      if (!approvedTeamEndpoint(input.provider.baseUrl, env)) return error('INVALID_INPUT', 'This provider origin is not approved for server requests', 400);
      const providerId = input.provider.id;
      const previous = metadata.find(provider => provider.id === providerId);
      const suppliedKey = typeof input.provider.apiKey === 'string' && input.provider.apiKey.trim() ? input.provider.apiKey.trim() : undefined;
      if (!suppliedKey && (!previous || previous.baseUrl !== input.provider.baseUrl.replace(/\/+$/, ''))) return error('INVALID_INPUT', 'A new API key is required for a new endpoint', 400);
      const encrypted = suppliedKey ? await encryptServerSecret(suppliedKey, env.TEAM_AI_ENCRYPTION_KEY, `${libraryId}:${input.provider.id}`) : null;
      const saved = await serviceRequest(context, 'rpc/cloud_configure_team_ai_provider', { method: 'POST', body: JSON.stringify({ p_library_id: libraryId, p_actor_id: actor.userId, p_enabled: input.enabled, p_max_requests_per_day: input.maxRequestsPerDay, p_monthly_budget_usd_micros: input.monthlyBudgetUsdMicros, p_max_output_tokens: input.maxOutputTokens, p_provider_id: input.provider.id, p_label: input.provider.label.trim().slice(0, 120), p_base_url: input.provider.baseUrl.replace(/\/+$/, ''), p_models: input.provider.models, p_max_provider_tokens: input.provider.maxOutputTokens, p_request_budget_usd_micros: input.provider.requestBudgetUsdMicros, p_api_key_ciphertext: encrypted }) });
      if (!saved.response.ok) return error(saved.response.status >= 500 ? 'AI_UNAVAILABLE' : 'FORBIDDEN', saved.response.status >= 500 ? 'Team AI configuration unavailable' : 'Library administrator required', saved.response.status >= 500 ? 503 : 403, saved.response.status >= 500);
      const next = metadata.filter(provider => provider.id !== providerId);
      next.push({ id: input.provider.id, label: input.provider.label.trim().slice(0, 120), baseUrl: input.provider.baseUrl.replace(/\/+$/, ''), models: input.provider.models, maxOutputTokens: input.provider.maxOutputTokens, requestBudgetUsdMicros: input.provider.requestBudgetUsdMicros, apiKeyConfigured: true });
      return json({ enabled: input.enabled, maxRequestsPerDay: input.maxRequestsPerDay, monthlyBudgetUsdMicros: input.monthlyBudgetUsdMicros, maxOutputTokens: input.maxOutputTokens, providers: next });
    }
    const result = await db('cloud_ai_library_policies', undefined, { library_id: 'eq.' + libraryId, select: 'enabled,allowed_provider_ids,max_output_tokens,provider_source' });
    if (!result.response.ok) return error('AI_UNAVAILABLE', 'Team AI policy unavailable', 503, true);
    const policy: unknown = Array.isArray(result.body) ? result.body[0] : undefined;
    if (!record(policy) || policy.enabled !== true || !Array.isArray(policy.allowed_provider_ids) || !integer(policy.max_output_tokens, 1, 8192)) return error('AI_DISABLED', 'Team AI is disabled for this library', 403);
    const allowedIds = policy.allowed_provider_ids, maxLibraryTokens = policy.max_output_tokens;
    const providers = await configuredProviders(context, libraryId, policy.provider_source !== 'library');
    if (!providers.length) return error('AI_NOT_CONFIGURED', 'Team AI is not configured', 503);
    const allowed = providers.filter(provider => allowedIds.includes(provider.id));
    if (segments[4] === 'providers') return json({ enabled: true, providers: allowed.map(provider => ({ id: provider.id, label: provider.label, models: provider.models, maxOutputTokens: Math.min(provider.maxOutputTokens, maxLibraryTokens) })) });
    const input = await limitedJson(request), permittedFields = ['providerId', 'model', 'messages', 'maxTokens', 'temperature'];
    if (!record(input) || Object.keys(input).some(key => !permittedFields.includes(key))) return error('INVALID_INPUT', 'Invalid AI request', 400);
    const provider = allowed.find(value => value.id === input.providerId);
    const maxOutputTokens = provider ? Math.min(provider.maxOutputTokens, maxLibraryTokens) : 0;
    if (!provider || typeof input.model !== 'string' || !provider.models.includes(input.model)
      || (input.maxTokens !== undefined && !integer(input.maxTokens, 1, maxOutputTokens))
      || (input.temperature !== undefined && (typeof input.temperature !== 'number' || !Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2))
      || !Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 64) return error('INVALID_INPUT', 'Unsupported provider, model or request limits', 400);
    let chars = 0;
    const messages: Array<{ role: string; content: string }> = [];
    for (const message of input.messages) {
      if (!record(message) || !['system', 'user', 'assistant'].includes(String(message.role)) || typeof message.content !== 'string' || !message.content.trim()
        || Object.keys(message).some(key => !['role', 'content'].includes(key))) return error('INVALID_INPUT', 'Invalid chat messages', 400);
      chars += message.content.length;
      if (chars > MAX_MESSAGE_CHARS) return error('INVALID_INPUT', 'Chat messages exceed the library request limit', 400);
      messages.push({ role: String(message.role), content: message.content });
    }
    const maxTokens = input.maxTokens ?? maxOutputTokens, serviceKey = (env as TeamAiEnv).SUPABASE_SERVICE_ROLE_KEY!;
    const reservationHeaders: Record<string, string> = { apikey: serviceKey, 'content-type': 'application/json' };
    if (!serviceKey.startsWith('sb_secret_')) reservationHeaders.authorization = 'Bearer ' + serviceKey;
    const reservation = await fetch(new URL('/rest/v1/rpc/cloud_reserve_ai_request', env.SUPABASE_URL), { method: 'POST', headers: reservationHeaders, redirect: 'error', signal: AbortSignal.timeout(10000), body: JSON.stringify({ p_library_id: libraryId, p_user_id: actor.userId, p_provider_id: provider.id, p_request_id: crypto.randomUUID(), p_reserved_usd_micros: provider.requestBudgetUsdMicros, p_max_output_tokens: maxTokens }) });
    if (!reservation.ok) {
      const failure: unknown = await reservation.json().catch(() => null);
      if (record(failure) && failure.code === 'P0001') return error('AI_QUOTA_EXCEEDED', 'Library AI quota or budget exhausted', 429);
      if (reservation.status === 403 || (record(failure) && failure.code === '42501')) return error('FORBIDDEN', 'Library AI permission denied', 403);
      return error('AI_UNAVAILABLE', 'Team AI budget service unavailable', 503, true);
    }
    const reserved: unknown = await reservation.json();
    if (!record(reserved) || typeof reserved.reservationId !== 'string' || !reserved.reservationId) return error('AI_UNAVAILABLE', 'Team AI budget service unavailable', 503, true);
    // Retain the charge on errors/timeouts: the upstream may already have billed this request.
    try {
      const upstream = await fetch(provider.baseUrl + '/chat/completions', { method: 'POST', headers: { authorization: 'Bearer ' + provider.apiKey, 'content-type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(45000), body: JSON.stringify({ model: input.model, messages, max_tokens: maxTokens, stream: false, ...(input.temperature === undefined ? {} : { temperature: input.temperature }) }) });
      if (!upstream.ok) { await upstream.body?.cancel(); return error('AI_UPSTREAM_ERROR', 'Team AI provider request failed', 502, upstream.status === 429 || upstream.status >= 500); }
      const body = await limitedJson(upstream);
      if (!record(body) || !Array.isArray(body.choices) || !record(body.choices[0]) || !record(body.choices[0].message) || typeof body.choices[0].message.content !== 'string') return error('AI_UPSTREAM_ERROR', 'Team AI provider returned an invalid response', 502);
      const usage = record(body.usage) ? body.usage : {}, safeUsage: Record<string, number> = {};
      for (const [source, target] of [['prompt_tokens', 'promptTokens'], ['completion_tokens', 'completionTokens'], ['total_tokens', 'totalTokens']]) {
        if (integer(usage[source], 0, 2000000)) safeUsage[target] = usage[source];
      }
      return json({ providerId: provider.id, model: input.model, content: body.choices[0].message.content, usage: safeUsage, reservationId: reserved.reservationId });
    } catch { return error('AI_UPSTREAM_ERROR', 'Team AI provider request failed', 502, true); }
  } catch { return error('AI_UNAVAILABLE', 'Team AI service unavailable', 503, true); }
}
