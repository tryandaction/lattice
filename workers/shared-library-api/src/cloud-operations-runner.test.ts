// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createServer, type RequestListener } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runNode = promisify(execFile);
const healthy = { schemaVersion: "202610170001", bucketPrivate: true, bucketMaxFileBytes: 20971520, maxFileBytes: 20971520, expiredUploads: 0, usage: { usedBytes: 10, reservedBytes: 0, maxStorageBytes: 100, supabaseService: { usedBytes: 10, reservedBytes: 0, maxStorageBytes: 100 } } };

interface TickOptions { apiUrl: string; stateFile: string }

async function fixture(handler: RequestListener, run: (options: TickOptions) => Promise<void>) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const stateFile = resolve(await mkdtemp(resolve(".lattice-build/cloud-monitor-fixture-")), "state.json");
  try { await run({ apiUrl: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`, stateFile }); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

describe("single-tick cloud operations runner", () => {
  it("prepares by default without requests, credentials or state writes", async () => {
    let requests = 0;
    await fixture((_request, response) => { requests++; response.end(JSON.stringify(healthy)); }, async ({ apiUrl, stateFile }) => {
      const result = await runNode(process.execPath, ["scripts/cloud-library-operations-runner.mjs", stateFile, apiUrl, "local"]);
      expect(JSON.parse(result.stdout)).toMatchObject({ status: "prepared", networkRequests: 0, stateWrites: 0, notifications: "not_configured" });
      expect(requests).toBe(0);
      await expect(readFile(stateFile)).rejects.toThrow();
    });
  });

  it("waits for two network failures, persists deduplicated local events, and records recovery", async () => {
    const { runCloudMonitorTick } = await import("../../../scripts/cloud-library-operations-runner.mjs");
    let disconnected = true;
    await fixture((request, response) => disconnected ? request.socket.destroy() : response.end(JSON.stringify(healthy)), async options => {
      const tick = () => runCloudMonitorTick({ ...options, libraryId: "local", accessToken: "synthetic" });
      expect(await tick()).toMatchObject({ status: "checked", newEvents: [], consecutiveNetworkFailures: 1 });
      expect(await tick()).toMatchObject({ newEvents: [{ from: "ok", to: "critical" }], consecutiveNetworkFailures: 2 });
      expect(await tick()).toMatchObject({ newEvents: [], pendingEvents: 1 });
      disconnected = false;
      expect(await tick()).toMatchObject({ newEvents: [{ from: "critical", to: "ok", type: "recovered" }], pendingEvents: 2 });
      expect(await tick()).toMatchObject({ newEvents: [], pendingEvents: 2 });
      const state = JSON.parse(await readFile(options.stateFile, "utf8"));
      expect(state.pendingEvents.map((event: { id: string }) => event.id)).toEqual([`${state.monitorId}:1`, `${state.monitorId}:2`]);
      expect(JSON.stringify(state)).not.toContain("synthetic");
    });
  });

  it("announces warning, escalation, partial recovery and full recovery once each", async () => {
    const { runCloudMonitorTick } = await import("../../../scripts/cloud-library-operations-runner.mjs");
    let usedBytes = 80;
    await fixture((_request, response) => response.end(JSON.stringify({ ...healthy, usage: { ...healthy.usage, usedBytes } })), async options => {
      const tick = () => runCloudMonitorTick({ ...options, libraryId: "local", accessToken: "synthetic" });
      expect(await tick()).toMatchObject({ newEvents: [{ from: "ok", to: "warning" }] });
      expect(await tick()).toMatchObject({ newEvents: [] });
      usedBytes = 90;
      expect(await tick()).toMatchObject({ newEvents: [{ from: "warning", to: "critical", type: "escalated" }] });
      usedBytes = 80;
      expect(await tick()).toMatchObject({ newEvents: [{ from: "critical", to: "warning", type: "recovered" }] });
      usedBytes = 10;
      expect(await tick()).toMatchObject({ newEvents: [{ from: "warning", to: "ok", type: "recovered" }] });
    });
  });

  it("records expired credentials immediately and never marks a first network failure as recovery", async () => {
    const { runCloudMonitorTick } = await import("../../../scripts/cloud-library-operations-runner.mjs");
    let expired = true;
    await fixture((request, response) => {
      if (!expired) { request.socket.destroy(); return; }
      response.writeHead(401, { "x-request-id": "local-auth" }); response.end("synthetic expiry");
    }, async options => {
      const tick = () => runCloudMonitorTick({ ...options, libraryId: "local", accessToken: "synthetic" });
      expect(await tick()).toMatchObject({ newEvents: [{ to: "critical", type: "authentication", requestId: "local-auth" }] });
      expect(await tick()).toMatchObject({ newEvents: [], pendingEvents: 1 });
      expired = false;
      expect(await tick()).toMatchObject({ newEvents: [], pendingEvents: 1, consecutiveNetworkFailures: 1 });
      const state = JSON.parse(await readFile(options.stateFile, "utf8"));
      expect(state.announcedStatus).toBe("critical");
    });
  });

  it("rejects corrupt state without probing and skips overlapping ticks", async () => {
    const { runCloudMonitorTick } = await import("../../../scripts/cloud-library-operations-runner.mjs");
    let requests = 0;
    let release = () => {};
    let started = () => {};
    const startedPromise = new Promise<void>(resolve => { started = resolve; });
    await fixture((_request, response) => { requests++; release = () => response.end(JSON.stringify(healthy)); started(); }, async options => {
      const tick = () => runCloudMonitorTick({ ...options, libraryId: "local", accessToken: "synthetic" });
      const first = tick();
      await startedPromise;
      expect(await tick()).toMatchObject({ status: "skipped", reason: "RUN_IN_PROGRESS" });
      release();
      await first;
      await writeFile(options.stateFile, "corrupted");
      await expect(tick()).rejects.toThrow();
      expect(requests).toBe(1);
    });
  });

  it("rejects a rewound event sequence before duplicate event identifiers can be emitted", async () => {
    const { runCloudMonitorTick } = await import("../../../scripts/cloud-library-operations-runner.mjs");
    let requests = 0;
    await fixture((_request, response) => { requests++; response.end(JSON.stringify({ ...healthy, expiredUploads: 1 })); }, async options => {
      const tick = () => runCloudMonitorTick({ ...options, libraryId: "local", accessToken: "synthetic" });
      await tick();
      const state = JSON.parse(await readFile(options.stateFile, "utf8"));
      state.sequence = 0;
      await writeFile(options.stateFile, JSON.stringify(state));
      await expect(tick()).rejects.toThrow(/event|state/i);
      expect(requests).toBe(1);
    });
  });

  it("does not count cancellation as a network failure and flags missing credentials without an HTTP request", async () => {
    const { runCloudMonitorTick } = await import("../../../scripts/cloud-library-operations-runner.mjs");
    let requests = 0;
    await fixture((_request, response) => { requests++; response.end(JSON.stringify(healthy)); }, async options => {
      const controller = new AbortController(); controller.abort();
      expect(await runCloudMonitorTick({ ...options, libraryId: "local", accessToken: "synthetic", signal: controller.signal })).toMatchObject({ status: "skipped", reason: "CANCELLED" });
      await expect(readFile(options.stateFile)).rejects.toThrow();
      expect(await runCloudMonitorTick({ ...options, libraryId: "local" })).toMatchObject({ newEvents: [{ type: "authentication", to: "critical" }], consecutiveNetworkFailures: 0 });
      expect(requests).toBe(0);
    });
  });
});
