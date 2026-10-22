/** Server-only monitor. No service-role key, client UI or public HTTP trigger. */
import { summarizeOperationsState } from "./preflight.mjs";
const ranks = { ok: 0, warning: 1, critical: 2 };
const deadline = 5000;
const validId = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const issue = (code, status = "critical") => ({ status, code });
const capacityStatus = ratio => ratio >= 0.9 ? "critical" : ratio >= 0.8 ? "warning" : "ok";
function secureUrl(value, base = false) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (base && url.pathname !== "/")) throw new Error("Unsafe operations URL");
  return url;
}
async function requestJson(fetchImpl, url, init = {}) {
  const signal = AbortSignal.timeout(deadline);
  const response = await fetchImpl(url, { ...init, redirect: "manual", signal });
  if (!response.ok) { await response.body?.cancel(); return { status: response.status }; }
  try { return { status: response.status, body: await response.json() }; }
  catch (error) { if (signal.aborted) throw error; return { status: response.status, invalidJson: true }; }
}
function evaluateHealth(body) {
  if (!body || body.schemaVersion !== "202610170001" || body.bucketPrivate !== true || !Number.isSafeInteger(body.maxFileBytes) || body.maxFileBytes < 20971520 || !Number.isSafeInteger(body.bucketMaxFileBytes) || body.bucketMaxFileBytes < body.maxFileBytes || !Number.isSafeInteger(body.expiredUploads) || body.expiredUploads < 0) return issue("INVALID_HEALTH");
  let rank = body.expiredUploads > 0 ? 1 : 0;
  for (const usage of [body.usage, body.usage?.supabaseService]) {
    if (!usage || ![usage.usedBytes, usage.reservedBytes, usage.maxStorageBytes, usage.usedBytes + usage.reservedBytes].every(Number.isSafeInteger) || usage.usedBytes < 0 || usage.reservedBytes < 0 || usage.maxStorageBytes <= 0) return issue("INVALID_USAGE");
    rank = Math.max(rank, ranks[capacityStatus((usage.usedBytes + usage.reservedBytes) / usage.maxStorageBytes)]);
  }
  return { status: ["ok", "warning", "critical"][rank], code: rank ? "LIBRARY_HEALTH_THRESHOLD" : "HEALTHY" };
}
async function targetId(env) {
  const bytes = new TextEncoder().encode([env.API_URL, env.LIBRARY_ID, env.SUPABASE_URL, env.OPERATOR_USER_ID].join("|"));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
}
async function tokenHash(value) {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function validateState(state, id) {
  if (state.version !== 1 || state.targetId !== id || !Number.isSafeInteger(state.sequence) || state.sequence < 0 || !Number.isSafeInteger(state.networkFailures) || state.networkFailures < 0 || !Array.isArray(state.outbox) || state.outbox.length > 100 || !state.statuses || Object.values(state.statuses).some(status => !Object.hasOwn(ranks, status))) throw new Error("Invalid operations durable state");
  if (state.session && (!validId(state.session.userId) || typeof state.session.accessToken !== "string" || !state.session.accessToken || typeof state.session.refreshToken !== "string" || !state.session.refreshToken || !Number.isSafeInteger(state.session.expiresAt) || state.session.expiresAt < 0)) throw new Error("Invalid operations durable session");
  if (state.reauthorization && (!Number.isSafeInteger(state.reauthorization.version) || state.reauthorization.version < 1 || !/^[a-f0-9]{64}$/.test(state.reauthorization.refreshTokenHash))) throw new Error("Invalid operations reauthorization state");
  const seen = new Set(); let previousSequence = 0;
  for (const pending of state.outbox) {
    if (!pending?.event || typeof pending.event.id !== "string" || !pending.event.id.startsWith(id + ":") || seen.has(pending.event.id) || !Number.isSafeInteger(pending.attempts) || pending.attempts < 0 || !Number.isSafeInteger(pending.nextAttemptAt)) throw new Error("Invalid operations outbox");
    const sequence = Number(pending.event.id.slice(id.length + 1));
    if (!Number.isSafeInteger(sequence) || sequence <= previousSequence || sequence > state.sequence || pending.event.id !== id + ":" + sequence || !["health", "vendor", "cleanup"].includes(pending.event.category) || !Object.hasOwn(ranks, pending.event.from) || !Object.hasOwn(ranks, pending.event.to) || !validId(pending.event.code)) throw new Error("Invalid operations outbox sequence or payload");
    previousSequence = sequence;
    seen.add(pending.event.id);
  }
}
async function operatorToken({ env, state, storage, fetchImpl, at }) {
  const saved = state.session;
  const currentVersion = state.reauthorization?.version ?? 0;
  const configuredVersion = env.OPERATOR_REAUTHORIZATION_VERSION;
  const version = configuredVersion === undefined && currentVersion === 0 ? 0 : typeof configuredVersion === "string" && /^[1-9]\d*$/.test(configuredVersion) ? Number(configuredVersion) : NaN;
  if (!Number.isSafeInteger(version) || version < currentVersion || version > currentVersion + 1 || (!version && env.OPERATOR_REAUTHORIZATION_REFRESH_TOKEN !== undefined)) return issue("OPERATOR_REAUTHORIZATION_VERSION_INVALID");
  const reauthorizing = version > currentVersion;
  let reauthorization;
  if (reauthorizing) {
    if (!saved || saved.userId !== env.OPERATOR_USER_ID) return issue("OPERATOR_REAUTHORIZATION_STATE_REQUIRED");
    const candidate = env.OPERATOR_REAUTHORIZATION_REFRESH_TOKEN;
    if (typeof candidate !== "string" || !candidate.trim()) return issue("OPERATOR_CREDENTIAL_UNAVAILABLE");
    const refreshTokenHash = await tokenHash(candidate);
    if (candidate === saved.refreshToken || candidate === env.OPERATOR_REFRESH_TOKEN || refreshTokenHash === state.reauthorization?.refreshTokenHash) return issue("OPERATOR_REAUTHORIZATION_REUSED_TOKEN");
    reauthorization = { version, refreshTokenHash };
  }
  if (!reauthorizing && saved && saved.userId !== env.OPERATOR_USER_ID) return issue("OPERATOR_IDENTITY_INVALID");
  if (!reauthorizing && saved && saved.expiresAt > at + 30000) return { token: saved.accessToken };
  const refreshToken = reauthorizing ? env.OPERATOR_REAUTHORIZATION_REFRESH_TOKEN : saved?.refreshToken ?? env.OPERATOR_REFRESH_TOKEN;
  if (typeof refreshToken !== "string" || !refreshToken || !env.SUPABASE_PUBLIC_KEY) return issue("OPERATOR_CREDENTIAL_UNAVAILABLE");
  try {
    const result = await requestJson(fetchImpl, env.SUPABASE_URL.replace(/\/+$/, "") + "/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: { apikey: env.SUPABASE_PUBLIC_KEY, "content-type": "application/json" }, body: JSON.stringify({ refresh_token: refreshToken }) });
    if (result.status !== 200) return issue("OPERATOR_REFRESH_FAILED");
    const session = result.body;
    if (session?.user?.id !== env.OPERATOR_USER_ID || typeof session.access_token !== "string" || !session.access_token || typeof session.refresh_token !== "string" || !session.refresh_token || !Number.isSafeInteger(session.expires_in) || session.expires_in < 60 || session.expires_in > 604800) return issue("OPERATOR_IDENTITY_INVALID");
    state.session = { userId: env.OPERATOR_USER_ID, accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: at + session.expires_in * 1000 };
    if (reauthorization) state.reauthorization = reauthorization;
    // Retry only the same validated rotated session while it remains in this response.
    // A repeat remote refresh could invalidate the only newly issued credential.
    let persisted = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await storage.put("state", state); persisted = true; break; }
      catch { /* Bounded idempotent save retry; no probe before durable success. */ }
    }
    if (!persisted) { state.persistenceFailed = true; return issue("OPERATOR_STATE_PERSISTENCE_FAILED"); }
    return { token: session.access_token };
  } catch { return issue("OPERATOR_REFRESH_UNAVAILABLE"); }
}
async function checkVendor(env, at) {
  if (!env.VENDOR_USAGE) return issue("VENDOR_USAGE_UNAVAILABLE");
  const expected = typeof env.EXPECTED_VENDOR_PROVIDERS === "string" ? env.EXPECTED_VENDOR_PROVIDERS.split(",").map(value => value.trim()) : [];
  const expectedNames = new Set(expected);
  if (!expected.length || expected.length > 10 || expectedNames.size !== expected.length || expected.some(value => !validId(value))) return issue("VENDOR_USAGE_CONFIG_INVALID");
  const fresh = value => typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) <= at + 60000 && at - Date.parse(value) <= 3600000;
  const period = new Date(at).toISOString().slice(0, 7);
  try {
    const result = await requestJson((...args) => env.VENDOR_USAGE.fetch(...args), "https://vendor-usage.internal/v1/usage");
    const body = result.body;
    if (result.status !== 200 || body?.version !== 1 || !Array.isArray(body.providers) || body.providers.length === 0 || body.providers.length > 10 || !fresh(body.checkedAt)) return issue("VENDOR_USAGE_STALE_OR_INVALID");
    let rank = 0; const names = new Set();
    for (const provider of body.providers) {
      if (!validId(provider?.provider) || names.has(provider.provider) || provider.period !== period || !fresh(provider.checkedAt) || ![provider.requestRatio, provider.costRatio].every(value => Number.isFinite(value) && value >= 0)) return issue("VENDOR_USAGE_STALE_OR_INVALID");
      if (!expectedNames.has(provider.provider)) return issue("VENDOR_USAGE_COVERAGE_INVALID");
      names.add(provider.provider);
      rank = Math.max(rank, ranks[capacityStatus(provider.requestRatio)], ranks[capacityStatus(provider.costRatio)]);
    }
    if (names.size !== expectedNames.size) return issue("VENDOR_USAGE_COVERAGE_INVALID");
    return { status: ["ok", "warning", "critical"][rank], code: rank ? "VENDOR_USAGE_THRESHOLD" : "VENDOR_USAGE_OK" };
  } catch { return issue("VENDOR_USAGE_UNAVAILABLE"); }
}
async function cleanup(env, token, fetchImpl) {
  if (env.CLEANUP_ENABLED !== "true") return { status: "disabled", cleaned: 0 };
  if (env.CLEANUP_LIBRARY_ID !== env.LIBRARY_ID) return { status: "refused", cleaned: 0 };
  if (!token) return { status: "identity_unavailable", cleaned: 0 };
  try {
    const result = await requestJson(fetchImpl, env.API_URL.replace(/\/+$/, "") + "/v1/libraries/" + encodeURIComponent(env.LIBRARY_ID) + "/uploads/cleanup", { method: "POST", headers: { authorization: "Bearer " + token } });
    if (result.status !== 200 || result.body?.batchLimit !== 25 || !Number.isSafeInteger(result.body.cleaned) || result.body.cleaned < 0 || result.body.cleaned > 25) return { status: "failed", cleaned: 0 };
    return { status: "checked", cleaned: result.body.cleaned, moreMayRemain: result.body.cleaned === 25 };
  } catch { return { status: "failed", cleaned: 0 }; }
}
function transition(state, category, check, at) {
  const from = state.statuses[category] ?? "ok";
  const authentication = code => typeof code === "string" && (code.startsWith("OPERATOR_") || code === "AUTHENTICATION_FAILED");
  state.codes ??= {};
  const identityChanged = category === "health" && authentication(check.code) !== authentication(state.codes[category]);
  if (check.status === from && !identityChanged) { state.codes[category] = check.code; return; }
  if (state.outbox.length >= 100 || !Number.isSafeInteger(state.sequence + 1)) throw new Error("Operations outbox requires attention");
  const event = { id: state.targetId + ":" + (++state.sequence), category, type: ranks[check.status] < ranks[from] ? "recovered" : "degraded", from, to: check.status, code: check.code, checkedAt: new Date(at).toISOString() };
  state.outbox.push({ event, attempts: 0, nextAttemptAt: at });
  state.statuses[category] = check.status;
  state.codes[category] = check.code;
}
async function deliver({ env, state, storage, fetchImpl, at }) {
  if ((!env.NOTIFICATIONS && !env.NOTIFICATION_URL) || !env.NOTIFICATION_TOKEN) return { status: "not_configured", delivered: 0 };
  let delivered = 0;
  // Preserve order and retry the same id if a receiver accepted before a crash.
  for (let index = 0; index < 3 && state.outbox.length; index++) {
    const pending = state.outbox[0];
    if (pending.nextAttemptAt > at) break;
    pending.attempts++;
    pending.nextAttemptAt = at + Math.min(3600000, 30000 * 2 ** Math.min(7, pending.attempts - 1));
    await storage.put("state", state);
    let response;
    try {
      const internal = env.NOTIFICATIONS?.get(env.NOTIFICATIONS.idFromName(pending.event.id));
      response = await requestJson(internal ? (url, init) => internal.fetch(new Request(url, init)) : fetchImpl, internal ? 'https://notifications.internal/events' : env.NOTIFICATION_URL,
        { method: "POST", headers: { authorization: "Bearer " + env.NOTIFICATION_TOKEN, "content-type": "application/json", "idempotency-key": pending.event.id }, body: JSON.stringify(pending.event) });
    }
    catch { break; }
    if (response.status !== 200 || response.body?.accepted !== true || response.body.eventId !== pending.event.id || typeof response.body.receiptId !== "string" || response.body.receiptId.length < 1 || response.body.receiptId.length > 200) break;
    state.outbox.shift(); state.lastReceipt = { eventId: pending.event.id, acknowledgedAt: new Date(at).toISOString() };
    await storage.put("state", state); delivered++;
  }
  return { status: state.outbox.length ? "pending" : "acknowledged", delivered };
}

/** Must be serialized by one Durable Object instance per configured target. */
export async function runOperationsTick({ env, storage, fetchImpl = fetch, now = Date.now }) {
  secureUrl(env.API_URL); secureUrl(env.SUPABASE_URL, true);
  if (env.NOTIFICATION_URL) secureUrl(env.NOTIFICATION_URL);
  if (!validId(env.LIBRARY_ID) || !validId(env.OPERATOR_USER_ID)) throw new Error("Invalid operations identity");
  const at = now(), id = await targetId(env);
  const stored = await storage.get("state");
  if ((!stored || !stored.session) && (env.OPERATOR_REAUTHORIZATION_VERSION !== undefined || env.OPERATOR_REAUTHORIZATION_REFRESH_TOKEN !== undefined)) throw new Error("OPERATOR_REAUTHORIZATION_STATE_REQUIRED");
  const state = stored ?? { version: 1, targetId: id, sequence: 0, networkFailures: 0, statuses: {}, outbox: [] };
  validateState(state, id);
  const identity = await operatorToken({ env, state, storage, fetchImpl, at });
  if (state.persistenceFailed) throw new Error("Unable to persist rotated operations identity");
  let health = identity.token ? issue("PROBE_NETWORK") : { status: identity.status, code: identity.code };
  if (identity.token) {
    try {
      const result = await requestJson(fetchImpl, env.API_URL.replace(/\/+$/, "") + "/v1/libraries/" + encodeURIComponent(env.LIBRARY_ID) + "/health", { headers: { authorization: "Bearer " + identity.token } });
      health = result.status === 200 ? evaluateHealth(result.body) : issue([401, 403].includes(result.status) ? "AUTHENTICATION_FAILED" : "HEALTH_HTTP_FAILED");
      if ([401, 403].includes(result.status) && state.session) state.session.expiresAt = 0;
    } catch { health = issue("PROBE_NETWORK"); }
  }
  state.networkFailures = health.code === "PROBE_NETWORK" ? Math.min(state.networkFailures + 1, Number.MAX_SAFE_INTEGER) : 0;
  const vendor = await checkVendor(env, at);
  if (!(health.code === "PROBE_NETWORK" && state.networkFailures < 2)) transition(state, "health", health, at);
  transition(state, "vendor", vendor, at);
  const cleanupResult = await cleanup(env, identity.token, fetchImpl);
  if (env.CLEANUP_ENABLED === "true") transition(state, "cleanup", { status: cleanupResult.status === "checked" ? "ok" : "critical", code: cleanupResult.status === "checked" ? "CLEANUP_OK" : "CLEANUP_FAILED" }, at);
  state.lastRun = { checkedAt: new Date(at).toISOString(), checks: { health, vendor }, cleanup: cleanupResult };
  if (health.status === "ok" && vendor.status === "ok") state.lastSuccessfulCheckAt = state.lastRun.checkedAt;
  await storage.put("state", state);
  const notifications = await deliver({ env, state, storage, fetchImpl, at });
  if (state.outbox.length && (env.NOTIFICATIONS || env.NOTIFICATION_URL) && env.NOTIFICATION_TOKEN) await storage.setAlarm(Math.max(at + 1000, state.outbox[0].nextAttemptAt));
  return { status: "checked", ...state.lastRun, pendingNotifications: state.outbox.length, notifications, sequence: state.sequence, summary: summarizeOperationsState(state, at, env.OPERATOR_USER_ID) };
}

export async function retryOperationsNotifications({ env, storage, fetchImpl = fetch, now = Date.now }) {
  if (env.NOTIFICATION_URL) secureUrl(env.NOTIFICATION_URL);
  const state = await storage.get("state");
  if (!state) return { status: "empty" };
  validateState(state, await targetId(env));
  const at = now(); const result = await deliver({ env, state, storage, fetchImpl, at });
  if (state.outbox.length && (env.NOTIFICATIONS || env.NOTIFICATION_URL) && env.NOTIFICATION_TOKEN) await storage.setAlarm(Math.max(at + 1000, state.outbox[0].nextAttemptAt));
  return { ...result, pendingNotifications: state.outbox.length };
}
