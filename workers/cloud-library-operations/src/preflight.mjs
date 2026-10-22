/** Pure offline configuration checks and an allowlisted operations-state projection. */
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fields = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
const id = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const present = value => typeof value === "string" && value.trim().length > 0;
const status = value => ["ok", "warning", "critical", "unknown"].includes(value);
const emptyRuntime = state => ({ status: state, lastCheckAt: null, lastSuccessfulCheckAt: null, identity: "unknown", health: "unknown", vendor: "unknown", checkFreshness: "unknown", queue: { count: null, oldestAt: null, oldestAgeMs: null }, lastAcknowledgementAt: null });
function timestamp(value, at) {
  if (value === null) return null;
  if (typeof value !== "string") throw Error("INVALID_TIME");
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time < 0 || time > at || new Date(time).toISOString() !== value) throw Error("INVALID_TIME");
  return time;
}
function secureUrl(value, base = false) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && (!base || url.pathname === "/"); }
  catch { return false; }
}
function summarizeSnapshot(snapshot, at) {
  if (!fields(snapshot, ["version", "lastCheckAt", "lastSuccessfulCheckAt", "identity", "health", "vendor", "queue", "lastAcknowledgementAt"]) || snapshot.version !== 1 || !["unknown", "available", "refresh_required", "unavailable"].includes(snapshot.identity) || !status(snapshot.health) || !status(snapshot.vendor) || !fields(snapshot.queue, ["count", "oldestAt"]) || !Number.isSafeInteger(snapshot.queue.count) || snapshot.queue.count < 0 || snapshot.queue.count > 100) throw Error("INVALID_SNAPSHOT");
  const check = timestamp(snapshot.lastCheckAt, at), success = timestamp(snapshot.lastSuccessfulCheckAt, at), oldest = timestamp(snapshot.queue.oldestAt, at), acknowledgement = timestamp(snapshot.lastAcknowledgementAt, at);
  if ((snapshot.queue.count === 0) !== (oldest === null) || (success !== null && (check === null || success > check))) throw Error("INVALID_SNAPSHOT");
  return {
    status: "available", lastCheckAt: check === null ? null : new Date(check).toISOString(), lastSuccessfulCheckAt: success === null ? null : new Date(success).toISOString(),
    identity: snapshot.identity, health: snapshot.health, vendor: snapshot.vendor,
    checkFreshness: check === null ? "never_checked" : at - check <= 900000 ? "fresh" : "stale",
    queue: { count: snapshot.queue.count, oldestAt: oldest === null ? null : new Date(oldest).toISOString(), oldestAgeMs: oldest === null ? null : at - oldest },
    lastAcknowledgementAt: acknowledgement === null ? null : new Date(acknowledgement).toISOString(),
  };
}

/** Accepts internal state only in trusted server-side code; never copies arbitrary values. */
export function summarizeOperationsState(state, at = Date.now(), operatorUserId) {
  if (state === undefined || state === null) return emptyRuntime("not_provided");
  try {
    if (!Number.isSafeInteger(at) || !record(state) || state.version !== 1 || !Array.isArray(state.outbox) || state.outbox.length > 100) throw Error("INVALID_STATE");
    const health = state.lastRun?.checks?.health, vendor = state.lastRun?.checks?.vendor;
    const authenticationLost = typeof health?.code === "string" && (health.code.startsWith("OPERATOR_") || health.code === "AUTHENTICATION_FAILED");
    let identity = "unknown";
    if (authenticationLost) identity = "unavailable";
    else if (state.session) {
      const session = state.session;
      identity = !id(session.userId) || !present(session.accessToken) || !present(session.refreshToken) || !Number.isSafeInteger(session.expiresAt) || (operatorUserId !== undefined && session.userId !== operatorUserId)
        ? "unavailable" : session.expiresAt > at + 30000 ? "available" : "refresh_required";
    }
    let oldest = null;
    for (const pending of state.outbox) {
      const time = timestamp(pending?.event?.checkedAt, at);
      if (time === null) throw Error("INVALID_STATE");
      oldest = oldest === null ? time : Math.min(oldest, time);
    }
    return summarizeSnapshot({ version: 1, lastCheckAt: state.lastRun?.checkedAt ?? null, lastSuccessfulCheckAt: state.lastSuccessfulCheckAt ?? null, identity,
      health: health?.status ?? "unknown", vendor: vendor?.status ?? "unknown", queue: { count: state.outbox.length, oldestAt: oldest === null ? null : new Date(oldest).toISOString() },
      lastAcknowledgementAt: state.lastReceipt?.acknowledgedAt ?? null }, at);
  } catch { return emptyRuntime("invalid_state"); }
}

const varFields = ["API_URL", "SUPABASE_URL", "SUPABASE_PUBLIC_KEY", "LIBRARY_ID", "OPERATOR_USER_ID", "NOTIFICATION_URL", "EXPECTED_VENDOR_PROVIDERS", "CLEANUP_ENABLED", "CLEANUP_LIBRARY_ID", "OPERATOR_REAUTHORIZATION_VERSION"];
const secretFields = ["OPERATOR_REFRESH_TOKEN", "NOTIFICATION_TOKEN", "OPERATOR_REAUTHORIZATION_REFRESH_TOKEN"];
function configurationCheck(values) {
  return values.includes("invalid") ? "invalid" : values.includes("missing") ? "missing" : "configured";
}
const required = (value, valid) => !present(value) ? "missing" : valid(value) ? "configured" : "invalid";

/** JSON input contains public vars and secret/binding presence booleans, never secret values. */
export function preflightOperations(input, at = Date.now()) {
  const invalid = () => ({ version: 1, scope: "offline-operations-preflight", status: "invalid_input", deploymentVerified: false, networkRequests: 0, code: "PREFLIGHT_INPUT_INVALID", runtime: emptyRuntime("invalid_input") });
  if (!Number.isSafeInteger(at) || at < 0) return invalid();
  if (input !== undefined && (!fields(input, ["version", "vars", "secrets", "bindings", "cron", "snapshot"]) || input.version !== 1)) return invalid();
  if (input && ["vars", "secrets", "bindings"].some(key => input[key] !== undefined && !record(input[key]))) return invalid();
  const config = input ?? {}, vars = config.vars ?? {}, secrets = config.secrets ?? {}, bindings = config.bindings ?? {};
  if (!fields(vars, varFields) || Object.values(vars).some(value => typeof value !== "string") || !fields(secrets, secretFields) || Object.values(secrets).some(value => typeof value !== "boolean") || !fields(bindings, ["OPERATIONS", "VENDOR_USAGE", "NOTIFICATIONS", "NOTIFICATION_CHANNEL"]) || Object.values(bindings).some(value => typeof value !== "boolean") || (config.cron !== undefined && typeof config.cron !== "string")) return invalid();
  let runtime = emptyRuntime("not_provided");
  if (config.snapshot !== undefined) { try { runtime = summarizeSnapshot(config.snapshot, at); } catch { return invalid(); } }
  const providers = present(vars.EXPECTED_VENDOR_PROVIDERS) ? vars.EXPECTED_VENDOR_PROVIDERS.split(",").map(value => value.trim()) : [];
  const reauthorization = vars.OPERATOR_REAUTHORIZATION_VERSION === undefined ? "configured" : /^[1-9]\d*$/.test(vars.OPERATOR_REAUTHORIZATION_VERSION) && Number.isSafeInteger(Number(vars.OPERATOR_REAUTHORIZATION_VERSION)) ? "configured" : "invalid";
  const reauthorizationCandidate = reauthorization === "configured" && vars.OPERATOR_REAUTHORIZATION_VERSION !== undefined && secrets.OPERATOR_REAUTHORIZATION_REFRESH_TOKEN === true;
  const persistedIdentity = runtime.status === "available" && ["available", "refresh_required"].includes(runtime.identity);
  const identityCredential = secrets.OPERATOR_REFRESH_TOKEN === true || persistedIdentity || reauthorizationCandidate;
  const checks = {
    target: { status: configurationCheck([required(vars.API_URL, secureUrl), required(vars.SUPABASE_URL, value => secureUrl(value, true)), required(vars.LIBRARY_ID, id)]) },
    identity: { status: configurationCheck([required(vars.OPERATOR_USER_ID, id), required(vars.SUPABASE_PUBLIC_KEY, present), identityCredential ? "configured" : "missing", reauthorization, runtime.identity === "unavailable" && !reauthorizationCandidate ? "invalid" : "configured"]) },
    notifications: { status: configurationCheck([bindings.NOTIFICATIONS === true ? bindings.NOTIFICATION_CHANNEL === true ? "configured" : "missing" : required(vars.NOTIFICATION_URL, secureUrl), secrets.NOTIFICATION_TOKEN === true ? "configured" : "missing"]) },
    billing: { status: configurationCheck([providers.length === 0 ? "missing" : providers.length <= 10 && new Set(providers).size === providers.length && providers.every(id) ? "configured" : "invalid", bindings.VENDOR_USAGE === true ? "configured" : "missing"]) },
    scheduler: { status: configurationCheck([config.cron === undefined ? "missing" : config.cron === "*/5 * * * *" ? "configured" : "invalid", bindings.OPERATIONS === true ? "configured" : "missing"]) },
    cleanup: { status: vars.CLEANUP_ENABLED === undefined || vars.CLEANUP_ENABLED === "false" ? "configured" : vars.CLEANUP_ENABLED === "true" && id(vars.LIBRARY_ID) && vars.CLEANUP_LIBRARY_ID === vars.LIBRARY_ID ? "configured" : "invalid" },
  };
  return { version: 1, scope: "offline-operations-preflight", status: Object.values(checks).every(check => check.status === "configured") ? "configured-unverified" : "blocked", deploymentVerified: false, networkRequests: 0, checks, runtime };
}
