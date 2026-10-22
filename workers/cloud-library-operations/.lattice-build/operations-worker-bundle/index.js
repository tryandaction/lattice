var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/monitor.mjs
var ranks = { ok: 0, warning: 1, critical: 2 };
var deadline = 5e3;
var validId = /* @__PURE__ */ __name((value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value), "validId");
var issue = /* @__PURE__ */ __name((code, status = "critical") => ({ status, code }), "issue");
var capacityStatus = /* @__PURE__ */ __name((ratio) => ratio >= 0.9 ? "critical" : ratio >= 0.8 ? "warning" : "ok", "capacityStatus");
function secureUrl(value, base = false) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || base && url.pathname !== "/") throw new Error("Unsafe operations URL");
  return url;
}
__name(secureUrl, "secureUrl");
async function requestJson(fetchImpl, url, init = {}) {
  const response = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(deadline) });
  if (!response.ok) {
    await response.body?.cancel();
    return { status: response.status };
  }
  return { status: response.status, body: await response.json() };
}
__name(requestJson, "requestJson");
function evaluateHealth(body) {
  if (!body || body.schemaVersion !== "202610170001" || body.bucketPrivate !== true || !Number.isSafeInteger(body.maxFileBytes) || body.maxFileBytes < 20971520 || !Number.isSafeInteger(body.bucketMaxFileBytes) || body.bucketMaxFileBytes < body.maxFileBytes || !Number.isSafeInteger(body.expiredUploads) || body.expiredUploads < 0) return issue("INVALID_HEALTH");
  let rank = body.expiredUploads > 0 ? 1 : 0;
  for (const usage of [body.usage, body.usage?.supabaseService]) {
    if (!usage || ![usage.usedBytes, usage.reservedBytes, usage.maxStorageBytes, usage.usedBytes + usage.reservedBytes].every(Number.isSafeInteger) || usage.usedBytes < 0 || usage.reservedBytes < 0 || usage.maxStorageBytes <= 0) return issue("INVALID_USAGE");
    rank = Math.max(rank, ranks[capacityStatus((usage.usedBytes + usage.reservedBytes) / usage.maxStorageBytes)]);
  }
  return { status: ["ok", "warning", "critical"][rank], code: rank ? "LIBRARY_HEALTH_THRESHOLD" : "HEALTHY" };
}
__name(evaluateHealth, "evaluateHealth");
async function targetId(env) {
  const bytes = new TextEncoder().encode([env.API_URL, env.LIBRARY_ID, env.SUPABASE_URL, env.OPERATOR_USER_ID].join("|"));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
}
__name(targetId, "targetId");
function validateState(state, id) {
  if (state.version !== 1 || state.targetId !== id || !Number.isSafeInteger(state.sequence) || state.sequence < 0 || !Number.isSafeInteger(state.networkFailures) || state.networkFailures < 0 || !Array.isArray(state.outbox) || state.outbox.length > 100 || !state.statuses || Object.values(state.statuses).some((status) => !Object.hasOwn(ranks, status))) throw new Error("Invalid operations durable state");
  const seen = /* @__PURE__ */ new Set();
  let previousSequence = 0;
  for (const pending of state.outbox) {
    if (!pending?.event || typeof pending.event.id !== "string" || !pending.event.id.startsWith(id + ":") || seen.has(pending.event.id) || !Number.isSafeInteger(pending.attempts) || pending.attempts < 0 || !Number.isSafeInteger(pending.nextAttemptAt)) throw new Error("Invalid operations outbox");
    const sequence = Number(pending.event.id.slice(id.length + 1));
    if (!Number.isSafeInteger(sequence) || sequence <= previousSequence || sequence > state.sequence || pending.event.id !== id + ":" + sequence || !["health", "vendor", "cleanup"].includes(pending.event.category) || !Object.hasOwn(ranks, pending.event.from) || !Object.hasOwn(ranks, pending.event.to) || !validId(pending.event.code)) throw new Error("Invalid operations outbox sequence or payload");
    previousSequence = sequence;
    seen.add(pending.event.id);
  }
}
__name(validateState, "validateState");
async function operatorToken({ env, state, storage, fetchImpl, at }) {
  const saved = state.session;
  if (saved && saved.userId === env.OPERATOR_USER_ID && typeof saved.accessToken === "string" && saved.expiresAt > at + 3e4) return { token: saved.accessToken };
  const refreshToken = saved?.refreshToken ?? env.OPERATOR_REFRESH_TOKEN;
  if (typeof refreshToken !== "string" || !refreshToken || !env.SUPABASE_PUBLIC_KEY) return issue("OPERATOR_CREDENTIAL_UNAVAILABLE");
  try {
    const result = await requestJson(fetchImpl, env.SUPABASE_URL.replace(/\/+$/, "") + "/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: { apikey: env.SUPABASE_PUBLIC_KEY, "content-type": "application/json" }, body: JSON.stringify({ refresh_token: refreshToken }) });
    if (result.status !== 200) return issue("OPERATOR_REFRESH_FAILED");
    const session = result.body;
    if (session?.user?.id !== env.OPERATOR_USER_ID || typeof session.access_token !== "string" || !session.access_token || typeof session.refresh_token !== "string" || !session.refresh_token || !Number.isSafeInteger(session.expires_in) || session.expires_in < 60 || session.expires_in > 604800) return issue("OPERATOR_IDENTITY_INVALID");
    state.session = { userId: env.OPERATOR_USER_ID, accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: at + session.expires_in * 1e3 };
    try {
      await storage.put("state", state);
    } catch {
      state.persistenceFailed = true;
      return issue("OPERATOR_STATE_PERSISTENCE_FAILED");
    }
    return { token: session.access_token };
  } catch {
    return issue("OPERATOR_REFRESH_UNAVAILABLE");
  }
}
__name(operatorToken, "operatorToken");
async function checkVendor(env, at) {
  if (!env.VENDOR_USAGE) return issue("VENDOR_USAGE_UNAVAILABLE");
  try {
    const result = await requestJson((...args) => env.VENDOR_USAGE.fetch(...args), "https://vendor-usage.internal/v1/usage");
    const body = result.body;
    if (result.status !== 200 || body?.version !== 1 || !Array.isArray(body.providers) || body.providers.length === 0 || body.providers.length > 10 || !Number.isFinite(Date.parse(body.checkedAt)) || Date.parse(body.checkedAt) > at + 6e4 || at - Date.parse(body.checkedAt) > 36e5) return issue("VENDOR_USAGE_STALE_OR_INVALID");
    let rank = 0;
    const names = /* @__PURE__ */ new Set();
    for (const provider of body.providers) {
      if (!validId(provider?.provider) || names.has(provider.provider) || !/^\d{4}-\d{2}$/.test(provider.period) || ![provider.requestRatio, provider.costRatio].every((value) => Number.isFinite(value) && value >= 0)) return issue("VENDOR_USAGE_STALE_OR_INVALID");
      names.add(provider.provider);
      rank = Math.max(rank, ranks[capacityStatus(provider.requestRatio)], ranks[capacityStatus(provider.costRatio)]);
    }
    return { status: ["ok", "warning", "critical"][rank], code: rank ? "VENDOR_USAGE_THRESHOLD" : "VENDOR_USAGE_OK" };
  } catch {
    return issue("VENDOR_USAGE_UNAVAILABLE");
  }
}
__name(checkVendor, "checkVendor");
async function cleanup(env, token, fetchImpl) {
  if (env.CLEANUP_ENABLED !== "true") return { status: "disabled", cleaned: 0 };
  if (env.CLEANUP_LIBRARY_ID !== env.LIBRARY_ID) return { status: "refused", cleaned: 0 };
  if (!token) return { status: "identity_unavailable", cleaned: 0 };
  try {
    const result = await requestJson(fetchImpl, env.API_URL.replace(/\/+$/, "") + "/v1/libraries/" + encodeURIComponent(env.LIBRARY_ID) + "/uploads/cleanup", { method: "POST", headers: { authorization: "Bearer " + token } });
    if (result.status !== 200 || result.body?.batchLimit !== 25 || !Number.isSafeInteger(result.body.cleaned) || result.body.cleaned < 0 || result.body.cleaned > 25) return { status: "failed", cleaned: 0 };
    return { status: "checked", cleaned: result.body.cleaned, moreMayRemain: result.body.cleaned === 25 };
  } catch {
    return { status: "failed", cleaned: 0 };
  }
}
__name(cleanup, "cleanup");
function transition(state, category, check, at) {
  const from = state.statuses[category] ?? "ok";
  if (check.status === from) return;
  if (state.outbox.length >= 100 || !Number.isSafeInteger(state.sequence + 1)) throw new Error("Operations outbox requires attention");
  const event = { id: state.targetId + ":" + ++state.sequence, category, type: ranks[check.status] < ranks[from] ? "recovered" : "degraded", from, to: check.status, code: check.code, checkedAt: new Date(at).toISOString() };
  state.outbox.push({ event, attempts: 0, nextAttemptAt: at });
  state.statuses[category] = check.status;
}
__name(transition, "transition");
async function deliver({ env, state, storage, fetchImpl, at }) {
  if (!env.NOTIFICATION_URL || !env.NOTIFICATION_TOKEN) return { status: "not_configured", delivered: 0 };
  let delivered = 0;
  for (let index = 0; index < 3 && state.outbox.length; index++) {
    const pending = state.outbox[0];
    if (pending.nextAttemptAt > at) break;
    pending.attempts++;
    pending.nextAttemptAt = at + Math.min(36e5, 3e4 * 2 ** Math.min(7, pending.attempts - 1));
    await storage.put("state", state);
    let response;
    try {
      response = await requestJson(fetchImpl, env.NOTIFICATION_URL, { method: "POST", headers: { authorization: "Bearer " + env.NOTIFICATION_TOKEN, "content-type": "application/json", "idempotency-key": pending.event.id }, body: JSON.stringify(pending.event) });
    } catch {
      break;
    }
    if (response.status !== 200 || response.body?.accepted !== true || response.body.eventId !== pending.event.id || typeof response.body.receiptId !== "string" || response.body.receiptId.length < 1 || response.body.receiptId.length > 200) break;
    state.outbox.shift();
    state.lastReceipt = { eventId: pending.event.id, acknowledgedAt: new Date(at).toISOString() };
    await storage.put("state", state);
    delivered++;
  }
  return { status: state.outbox.length ? "pending" : "acknowledged", delivered };
}
__name(deliver, "deliver");
async function runOperationsTick({ env, storage, fetchImpl = fetch, now = Date.now }) {
  secureUrl(env.API_URL);
  secureUrl(env.SUPABASE_URL, true);
  if (env.NOTIFICATION_URL) secureUrl(env.NOTIFICATION_URL);
  if (!validId(env.LIBRARY_ID) || !validId(env.OPERATOR_USER_ID)) throw new Error("Invalid operations identity");
  const at = now(), id = await targetId(env);
  const state = await storage.get("state") ?? { version: 1, targetId: id, sequence: 0, networkFailures: 0, statuses: {}, outbox: [] };
  validateState(state, id);
  const identity = await operatorToken({ env, state, storage, fetchImpl, at });
  if (state.persistenceFailed) throw new Error("Unable to persist rotated operations identity");
  let health = identity.token ? issue("PROBE_NETWORK") : { status: identity.status, code: identity.code };
  if (identity.token) {
    try {
      const result = await requestJson(fetchImpl, env.API_URL.replace(/\/+$/, "") + "/v1/libraries/" + encodeURIComponent(env.LIBRARY_ID) + "/health", { headers: { authorization: "Bearer " + identity.token } });
      health = result.status === 200 ? evaluateHealth(result.body) : issue([401, 403].includes(result.status) ? "AUTHENTICATION_FAILED" : "HEALTH_HTTP_FAILED");
      if ([401, 403].includes(result.status) && state.session) state.session.expiresAt = 0;
    } catch {
      health = issue("PROBE_NETWORK");
    }
  }
  state.networkFailures = health.code === "PROBE_NETWORK" ? Math.min(state.networkFailures + 1, Number.MAX_SAFE_INTEGER) : 0;
  const vendor = await checkVendor(env, at);
  if (!(health.code === "PROBE_NETWORK" && state.networkFailures < 2)) transition(state, "health", health, at);
  transition(state, "vendor", vendor, at);
  const cleanupResult = await cleanup(env, identity.token, fetchImpl);
  if (env.CLEANUP_ENABLED === "true") transition(state, "cleanup", { status: cleanupResult.status === "checked" ? "ok" : "critical", code: cleanupResult.status === "checked" ? "CLEANUP_OK" : "CLEANUP_FAILED" }, at);
  state.lastRun = { checkedAt: new Date(at).toISOString(), checks: { health, vendor }, cleanup: cleanupResult };
  await storage.put("state", state);
  const notifications = await deliver({ env, state, storage, fetchImpl, at });
  if (state.outbox.length && env.NOTIFICATION_URL && env.NOTIFICATION_TOKEN) await storage.setAlarm(Math.max(at + 1e3, state.outbox[0].nextAttemptAt));
  return { status: "checked", ...state.lastRun, pendingNotifications: state.outbox.length, notifications, sequence: state.sequence };
}
__name(runOperationsTick, "runOperationsTick");
async function retryOperationsNotifications({ env, storage, fetchImpl = fetch, now = Date.now }) {
  if (env.NOTIFICATION_URL) secureUrl(env.NOTIFICATION_URL);
  const state = await storage.get("state");
  if (!state) return { status: "empty" };
  validateState(state, await targetId(env));
  const at = now();
  const result = await deliver({ env, state, storage, fetchImpl, at });
  if (state.outbox.length && env.NOTIFICATION_URL && env.NOTIFICATION_TOKEN) await storage.setAlarm(Math.max(at + 1e3, state.outbox[0].nextAttemptAt));
  return { ...result, pendingNotifications: state.outbox.length };
}
__name(retryOperationsNotifications, "retryOperationsNotifications");

// src/index.mjs
var LibraryOperations = class {
  static {
    __name(this, "LibraryOperations");
  }
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.pending = Promise.resolve();
  }
  serialize(operation) {
    const job = this.pending.then(operation);
    this.pending = job.catch(() => {
    });
    return job;
  }
  async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/tick") return new Response(null, { status: 404 });
    try {
      const result = await this.serialize(() => runOperationsTick({ env: this.env, storage: this.ctx.storage }));
      return Response.json(result);
    } catch {
      return Response.json({ status: "failed", code: "OPERATIONS_STATE_OR_CONFIG_INVALID" }, { status: 503 });
    }
  }
  async alarm() {
    await this.serialize(() => retryOperationsNotifications({ env: this.env, storage: this.ctx.storage }));
  }
};
var index_default = {
  fetch() {
    return new Response(null, { status: 404 });
  },
  async scheduled(_controller, env) {
    const id = env.OPERATIONS.idFromName("configured-library-monitor-v1");
    const response = await env.OPERATIONS.get(id).fetch("https://operations.internal/tick", { method: "POST" });
    if (!response.ok) throw new Error("OPERATIONS_TICK_FAILED");
  }
};
export {
  LibraryOperations,
  index_default as default
};
//# sourceMappingURL=index.js.map
