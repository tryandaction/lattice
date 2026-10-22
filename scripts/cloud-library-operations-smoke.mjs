/** Local workerd rehearsal. All outbound HTTP is intercepted by synthetic adapters. */
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import assert from "node:assert/strict";

export async function rehearseOperationsWorker({ miniflareModule, output }) {
  const { Miniflare, Response } = await import(pathToFileURL(resolve(miniflareModule)).href);
  const root = resolve(output); await mkdir(root, { recursive: true });
  const wrapperPath = resolve(root, "worker-wrapper.mjs");
  // Relative module paths are computed for Miniflare, which loads local ESM files.
  const entryPath = relative(root, resolve("workers/cloud-library-operations/src/index.mjs")).replaceAll("\\", "/");
  const monitorPath = relative(root, resolve("workers/cloud-library-operations/src/monitor.mjs")).replaceAll("\\", "/");
  const wrapper = `import worker, { LibraryOperations as Base } from ${JSON.stringify(entryPath)}; import { retryOperationsNotifications } from ${JSON.stringify(monitorPath)}; export class LibraryOperations extends Base { async fetch(request) { if (new URL(request.url).pathname === "/synthetic-retry") return Response.json(await this.serialize(() => retryOperationsNotifications({env:this.env, storage:this.ctx.storage, now:()=>Date.now()+60000}))); return super.fetch(request); } }; export default worker;`;
  await writeFile(wrapperPath, wrapper);
  const bindings = { API_URL: "https://synthetic-api.invalid", LIBRARY_ID: "synthetic-library", SUPABASE_URL: "https://synthetic-auth.invalid", SUPABASE_PUBLIC_KEY: "synthetic-key", OPERATOR_USER_ID: "synthetic-operator", OPERATOR_REFRESH_TOKEN: "synthetic-bootstrap", NOTIFICATION_URL: "https://synthetic-notify.invalid/events", NOTIFICATION_TOKEN: "synthetic-channel-token", CLEANUP_ENABLED: "false", EXPECTED_VENDOR_PROVIDERS: "synthetic" };
  const delivered = new Map(), attempts = [], history = [];
  let fault = false, rejectNotifications = false, refreshes = 0;
  const health = { schemaVersion: "202610170001", bucketPrivate: true, bucketMaxFileBytes: 20971520, maxFileBytes: 20971520, expiredUploads: 0, usage: { usedBytes: 1, reservedBytes: 0, maxStorageBytes: 100, supabaseService: { usedBytes: 1, reservedBytes: 0, maxStorageBytes: 100 } } };
  const outboundService = async request => {
    const url = new URL(request.url);
    if (url.host === "synthetic-auth.invalid") {
      const input = await request.json();
      assert.equal(input.refresh_token, refreshes ? "synthetic-rotated-" + refreshes : "synthetic-bootstrap");
      refreshes++;
      return Response.json({ access_token: "synthetic-access-" + refreshes, refresh_token: "synthetic-rotated-" + refreshes, expires_in: 3600, token_type: "bearer", user: { id: "synthetic-operator" } });
    }
    if (url.host === "synthetic-api.invalid") {
      assert.equal(url.pathname, "/v1/libraries/synthetic-library/health");
      assert.equal(request.headers.get("authorization"), "Bearer synthetic-access-" + refreshes);
      return fault ? new Response(null, { status: 503 }) : Response.json(health);
    }
    if (url.host === "synthetic-notify.invalid") {
      const event = await request.json(); attempts.push(event.id);
      assert.equal(request.headers.get("idempotency-key"), event.id);
      if (rejectNotifications) return Response.json({}, { status: 503 });
      delivered.set(event.id, event);
      return Response.json({ accepted: true, eventId: event.id, receiptId: "synthetic-receipt" });
    }
    throw new Error("Unexpected outbound request; real network is forbidden");
  };
  const vendorUsage = async () => {
    const checkedAt = new Date().toISOString();
    return Response.json({ version: 1, checkedAt, providers: [{ provider: "synthetic", period: checkedAt.slice(0, 7), checkedAt, requestRatio: 0.1, costRatio: 0.1 }] });
  };
  const options = { name: "operations-smoke", modules: true, scriptPath: wrapperPath, modulesRoot: resolve("."), compatibilityDate: "2026-07-21", bindings, durableObjects: { OPERATIONS: { className: "LibraryOperations", useSQLite: true } }, durableObjectsPersist: resolve(root, "durable-state"), serviceBindings: { VENDOR_USAGE: vendorUsage }, outboundService: async request => { try { return await outboundService(request); } catch (error) { history.push({ stage: "synthetic-outbound-error", message: error.message, url: request.url }); await writeFile(resolve(root, "adapter-errors.json"), JSON.stringify(history)); throw error; } } };
  let mf = new Miniflare(options);
  async function tick(stage) {
    const service = await mf.getWorker();
    await service.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() });
    const namespace = await mf.getDurableObjectNamespace("OPERATIONS");
    const response = await namespace.get(namespace.idFromName("configured-library-monitor-v1")).fetch("https://operations.internal/tick", { method: "POST" });
    assert.equal(response.status, 200);
    const result = await response.json(); history.push({ stage, result }); await writeFile(resolve(root, "runtime-progress.json"), JSON.stringify(history, null, 2));
    assert.equal(result.checks.vendor.status, "ok");
    return result;
  }
  try {
    assert.equal((await mf.dispatchFetch("https://example.invalid/")).status, 404);
    assert.equal((await tick("normal")).checks.health.status, "ok");
    fault = true; rejectNotifications = true;
    const failed = await tick("failed-notification"); assert.equal(failed.pendingNotifications, 1);
    assert.equal(delivered.size, 0); assert.equal(attempts.length, 1);
    // Restart the actual runtime to prove durable state survives object/process disposal.
    await mf.dispose(); mf = new Miniflare(options);
    const resumed = await tick("restarted-pending"); assert.equal(resumed.pendingNotifications, 1);
    assert.equal(refreshes, 1);
    rejectNotifications = false;
    const namespace = await mf.getDurableObjectNamespace("OPERATIONS");
    const retry = await namespace.get(namespace.idFromName("configured-library-monitor-v1")).fetch("https://operations.internal/synthetic-retry", { method: "POST" });
    assert.equal(retry.status, 200); const retried = await retry.json();
    history.push({ stage: "retry-after-restart", result: retried }); assert.equal(retried.pendingNotifications, 0);
    assert.equal(delivered.size, 1); assert.equal(attempts[0], attempts[1]);
    fault = false;
    const recovered = await tick("recovered"); assert.equal(recovered.pendingNotifications, 0); assert.equal(delivered.size, 2);
    await tick("unchanged-healthy"); assert.equal(delivered.size, 2);
    const result = { status: "passed", actualWorkerScheduled: true, restartedDurableState: true, realNetworkRequests: 0, realNotifications: 0, localDeliveryAttempts: attempts.length, acceptedLocalNotifications: delivered.size, history };
    await writeFile(resolve(root, "runtime-report.json"), JSON.stringify(result, null, 2));
    return result;
  } finally { await mf.dispose(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [miniflareModule, output] = process.argv.slice(2);
  if (!miniflareModule || !output) throw new Error("Usage: node scripts/cloud-library-operations-smoke.mjs <installed-miniflare-entry> <new-local-output-directory>");
  console.log(JSON.stringify(await rehearseOperationsWorker({ miniflareModule, output })));
}
