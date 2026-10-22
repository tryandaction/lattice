/** Explicitly invoked, read-only health/capacity probe. Never logs credentials. */
import { pathToFileURL } from "node:url";

export function evaluateCloudHealth(health, { warningRatio = 0.8, criticalRatio = 0.9 } = {}) {
  const issues = [];
  if (!health || typeof health !== "object" || Array.isArray(health)) return { status: "critical", issues: [{ severity: "critical", code: "INVALID_HEALTH" }] };
  if (!(warningRatio > 0 && warningRatio < criticalRatio && criticalRatio <= 1)) throw new Error("Invalid capacity thresholds");
  if (health.schemaVersion !== "202610170001") issues.push({ severity: "critical", code: "SCHEMA_VERSION" });
  if (health.bucketPrivate !== true) issues.push({ severity: "critical", code: "BUCKET_NOT_PRIVATE" });
  if (!Number.isSafeInteger(health.bucketMaxFileBytes) || !Number.isSafeInteger(health.maxFileBytes) || health.bucketMaxFileBytes < health.maxFileBytes || health.maxFileBytes < 20 * 1024 * 1024) issues.push({ severity: "critical", code: "FILE_LIMIT_MISMATCH" });
  if (!Number.isSafeInteger(health.expiredUploads) || health.expiredUploads < 0) issues.push({ severity: "critical", code: "INVALID_UPLOAD_COUNT" });
  else if (health.expiredUploads > 0) issues.push({ severity: "warning", code: "EXPIRED_UPLOADS", count: health.expiredUploads });
  for (const [scope, usage] of [["library", health.usage], ["service", health.usage?.supabaseService]]) {
    if (!usage || ![usage.usedBytes, usage.reservedBytes, usage.maxStorageBytes, usage.usedBytes + usage.reservedBytes].every(Number.isSafeInteger) || usage.usedBytes < 0 || usage.reservedBytes < 0 || usage.maxStorageBytes <= 0) {
      issues.push({ severity: "critical", code: "INVALID_USAGE", scope }); continue;
    }
    const ratio = (usage.usedBytes + usage.reservedBytes) / usage.maxStorageBytes;
    if (ratio >= warningRatio) issues.push({ severity: ratio >= criticalRatio ? "critical" : "warning", code: "CAPACITY", scope, ratio });
  }
  return { status: issues.some(issue => issue.severity === "critical") ? "critical" : issues.length ? "warning" : "ok", issues };
}

/** @param {{apiUrl:string, libraryId:string, accessToken:string, fetchImpl?:typeof fetch, timeoutMs?:number, signal?:AbortSignal}} options */
export async function checkCloudHealth({ apiUrl, libraryId, accessToken, fetchImpl = fetch, timeoutMs = 15000, signal }) {
  const startedAt = Date.now();
  let requestId = null;
  const finish = result => ({ ...result, elapsedMs: Date.now() - startedAt, requestId, checkedAt: new Date().toISOString() });
  const failure = (code, extra = {}) => finish({ status: "critical", issues: [{ severity: "critical", code, ...extra }] });
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return failure("INVALID_PROBE_CONFIG");
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchImpl(`${apiUrl.replace(/\/+$/, "")}/v1/libraries/${encodeURIComponent(libraryId)}/health`, {
      headers: { authorization: `Bearer ${accessToken}` }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: "error",
    });
    const upstreamRequestId = response.headers.get("x-request-id");
    requestId = upstreamRequestId && /^[a-zA-Z0-9_-]{1,128}$/.test(upstreamRequestId) && !upstreamRequestId.includes(accessToken) ? upstreamRequestId : null;
    if (!response.ok) {
      await response.body?.cancel();
      return failure([401, 403].includes(response.status) ? "AUTHENTICATION_FAILED" : "HTTP_HEALTH", { httpStatus: response.status });
    }
    let health;
    try { health = await response.json(); }
    catch (error) { if (timeout.aborted || signal?.aborted) throw error; return failure("INVALID_HEALTH_RESPONSE"); }
    return finish(evaluateCloudHealth(health));
  } catch {
    return failure(signal?.aborted ? "PROBE_CANCELLED" : timeout.aborted ? "PROBE_TIMEOUT" : "PROBE_NETWORK");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const [apiUrl, libraryId] = process.argv.slice(2);
    const accessToken = process.env.LATTICE_CLOUD_USER_JWT;
    if (!apiUrl || !libraryId || !accessToken || !/^https:\/\//.test(apiUrl)) throw new Error("Usage: set LATTICE_CLOUD_USER_JWT in the process environment, then node scripts/cloud-library-health.mjs <https-api-url> <library-uuid>");
    const result = await checkCloudHealth({ apiUrl, libraryId, accessToken });
    console.log(JSON.stringify(result));
    process.exitCode = result.status === "ok" ? 0 : result.status === "warning" ? 1 : 2;
  } catch { console.error(JSON.stringify({ status: "critical", issues: [{ severity: "critical", code: "PROBE_FAILED" }] })); process.exitCode = 2; }
}
