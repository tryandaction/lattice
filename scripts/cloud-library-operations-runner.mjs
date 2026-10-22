/** One monitor tick for an operator-owned scheduler. Default CLI is network-free preparation. */
import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkCloudHealth } from "./cloud-library-health.mjs";

const ranks = { ok: 0, warning: 1, critical: 2 };
const networkCodes = new Set(["PROBE_NETWORK", "PROBE_TIMEOUT"]);
const authenticationCodes = new Set(["AUTHENTICATION_FAILED", "CREDENTIAL_UNAVAILABLE"]);

function monitorIdentity(apiUrl, libraryId) {
  const url = new URL(apiUrl);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) || !/^[a-zA-Z0-9_-]+$/.test(libraryId)) throw new Error("Invalid monitor target");
  return createHash("sha256").update(`${url.toString().replace(/\/+$/, "")}\n${libraryId}`).digest("hex");
}

function emptyState(monitorId) {
  return { version: 1, monitorId, sequence: 0, announcedStatus: "ok", announcedCategory: "health", consecutiveNetworkFailures: 0, pendingEvents: [] };
}

async function loadState(stateFile, monitorId) {
  try {
    const stats = await lstat(stateFile);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("Unsafe monitor state path");
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    if (state.version !== 1 || state.monitorId !== monitorId || !Object.hasOwn(ranks, state.announcedStatus) || !["health", "authentication"].includes(state.announcedCategory) || !Number.isSafeInteger(state.sequence) || state.sequence < 0 || !Number.isSafeInteger(state.consecutiveNetworkFailures) || state.consecutiveNetworkFailures < 0 || !Array.isArray(state.pendingEvents)) throw new Error("Invalid or mismatched monitor state");
    let priorSequence = 0;
    for (const event of state.pendingEvents) {
      const sequence = typeof event?.id === "string" && event.id.startsWith(`${monitorId}:`) ? Number(event.id.slice(monitorId.length + 1)) : NaN;
      if (!Number.isSafeInteger(sequence) || sequence <= priorSequence || sequence > state.sequence || event.id !== `${monitorId}:${sequence}` || !Object.hasOwn(ranks, event.from) || !Object.hasOwn(ranks, event.to)) throw new Error("Invalid monitor pending event sequence");
      priorSequence = sequence;
    }
    return state;
  } catch (error) { if (error.code === "ENOENT") return emptyState(monitorId); throw error; }
}

/**
 * No notification is sent. Durable pending events require an idempotent delivery adapter.
 * @param {{apiUrl:string, libraryId:string, stateFile:string, accessToken?:string, timeoutMs?:number, signal?:AbortSignal}} options
 */
export async function runCloudMonitorTick({ apiUrl, libraryId, stateFile, accessToken, timeoutMs = 15000, signal }) {
  const monitorId = monitorIdentity(apiUrl, libraryId);
  const target = resolve(stateFile);
  const lockPath = `${target}.lock`;
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); }
  catch (error) { if (error.code === "EEXIST") return { status: "skipped", reason: "RUN_IN_PROGRESS" }; throw error; }
  let temporary;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), monitorId }));
    const state = await loadState(target, monitorId);
    const result = accessToken ? await checkCloudHealth({ apiUrl, libraryId, accessToken, timeoutMs, signal }) : {
      status: "critical", issues: [{ severity: "critical", code: "CREDENTIAL_UNAVAILABLE" }], checkedAt: new Date().toISOString(), elapsedMs: 0, requestId: null,
    };
    if (signal?.aborted || result.issues.some(issue => issue.code === "PROBE_CANCELLED")) return { status: "skipped", reason: "CANCELLED" };
    const networkFailure = result.issues.some(issue => networkCodes.has(issue.code));
    state.consecutiveNetworkFailures = networkFailure ? Math.min(state.consecutiveNetworkFailures + 1, Number.MAX_SAFE_INTEGER) : 0;
    const authentication = result.issues.some(issue => authenticationCodes.has(issue.code));
    const category = authentication ? "authentication" : "health";
    const newEvents = [];
    // A single transient failure cannot announce recovery from an earlier real fault.
    if (!(networkFailure && state.consecutiveNetworkFailures < 2) && (result.status !== state.announcedStatus || (authentication && state.announcedCategory !== category))) {
      if (!Number.isSafeInteger(state.sequence + 1)) throw new Error("Monitor event sequence exhausted");
      const type = authentication ? "authentication" : ranks[result.status] < ranks[state.announcedStatus] ? "recovered" : state.announcedStatus === "ok" ? "degraded" : "escalated";
      const event = { id: `${monitorId}:${++state.sequence}`, type, from: state.announcedStatus, to: result.status, checkedAt: result.checkedAt, issues: result.issues, requestId: result.requestId };
      state.pendingEvents.push(event); newEvents.push(event);
      state.announcedStatus = result.status; state.announcedCategory = category;
    }
    state.lastCheck = result;
    temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), { flag: "wx", mode: 0o600 });
    await rename(temporary, target);
    temporary = undefined;
    return { status: "checked", health: result, newEvents, pendingEvents: state.pendingEvents.length, consecutiveNetworkFailures: state.consecutiveNetworkFailures, notifications: "not_configured" };
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const [stateFile, apiUrl, libraryId, mode] = process.argv.slice(2);
    if (!stateFile || !apiUrl || !libraryId || (mode && mode !== "--run")) throw new Error("Invalid arguments");
    const monitorId = monitorIdentity(apiUrl, libraryId);
    // Deliberately do not read credentials, inspect state, install tasks or probe in prepare mode.
    if (mode !== "--run") console.log(JSON.stringify({ status: "prepared", monitorId, networkRequests: 0, stateWrites: 0, suggestedIntervalMinutes: 5, automaticCleanup: false, notifications: "not_configured" }));
    else {
      const result = await runCloudMonitorTick({ stateFile, apiUrl, libraryId, accessToken: process.env.LATTICE_CLOUD_USER_JWT });
      console.log(JSON.stringify(result));
      process.exitCode = result.status === "checked" ? ranks[result.health.status] : 0;
    }
  } catch {
    console.error(JSON.stringify({ status: "failed", code: "MONITOR_STATE_OR_CONFIG_INVALID", usage: "node scripts/cloud-library-operations-runner.mjs <state-file> <https-api-url> <library-id> [--run]" }));
    process.exitCode = 2;
  }
}
