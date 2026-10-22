// @vitest-environment node
import { describe, expect, it } from "vitest";

class MemoryStorage {
  values = new Map<string, unknown>();
  alarmAt = 0;
  async get(key: string) { return structuredClone(this.values.get(key)); }
  async put(key: string, value: unknown) { this.values.set(key, structuredClone(value)); }
  async setAlarm(at: number) { this.alarmAt = at; }
  async deleteAlarm() { this.alarmAt = 0; }
}
const healthy = { schemaVersion: "202610170001", bucketPrivate: true, bucketMaxFileBytes: 20971520, maxFileBytes: 20971520, expiredUploads: 0, usage: { usedBytes: 10, reservedBytes: 0, maxStorageBytes: 100, supabaseService: { usedBytes: 10, reservedBytes: 0, maxStorageBytes: 100 } } };
function fixture() {
  const storage = new MemoryStorage();
  let time = Date.parse("2026-10-19T00:00:00Z"), fault = false, notificationFailure = false;
  const delivered = new Map<string, unknown>(), attempts: string[] = [], refreshes: string[] = [], probes: string[] = [];
  const env = { API_URL: "https://api.example.test", LIBRARY_ID: "library-1", SUPABASE_URL: "https://auth.example.test", SUPABASE_PUBLIC_KEY: "synthetic-public", OPERATOR_USER_ID: "operator-1", OPERATOR_REFRESH_TOKEN: "bootstrap-refresh", NOTIFICATION_URL: "https://notify.example.test/events", NOTIFICATION_TOKEN: "synthetic-notification-secret", EXPECTED_VENDOR_PROVIDERS: "synthetic", VENDOR_USAGE: { fetch: async () => Response.json({ version: 1, checkedAt: new Date(time).toISOString(), providers: [{ provider: "synthetic", period: "2026-10", checkedAt: new Date(time).toISOString(), requestRatio: 0.1, costRatio: 0.1 }] }) } };
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.host === "auth.example.test") {
      const body = JSON.parse(String(init?.body)); refreshes.push(body.refresh_token);
      if (refreshes.length > 1 && body.refresh_token !== `refresh-${refreshes.length - 1}`) return Response.json({}, { status: 401 });
      return Response.json({ access_token: `access-${refreshes.length}`, refresh_token: `refresh-${refreshes.length}`, expires_in: 120, token_type: "bearer", user: { id: "operator-1" } });
    }
    if (url.host === "api.example.test") {
      probes.push(new Headers(init?.headers).get("authorization") ?? "");
      if (fault) throw new TypeError("synthetic-network-secret");
      return Response.json(healthy, { headers: { "x-request-id": "safe-request-1" } });
    }
    if (url.host === "notify.example.test") {
      const event = JSON.parse(String(init?.body)); attempts.push(event.id);
      if (notificationFailure) return Response.json({}, { status: 503 });
      delivered.set(event.id, event); return Response.json({ accepted: true, eventId: event.id, receiptId: `receipt-${event.id}` });
    }
    throw new Error("Unexpected network target");
  };
  return { storage, env, fetchImpl, delivered, attempts, probes, refreshes, now: () => time, advance: (ms: number) => { time += ms; }, fault: (value: boolean) => { fault = value; }, notificationFailure: (value: boolean) => { notificationFailure = value; } };
}

describe("operator scheduled monitor", () => {
  it('delivers through the internal durable receiver when no public notification URL is configured', async () => {
    const { runOperationsTick } = await import('./monitor.mjs');
    const { NotificationDelivery } = await import('./notification-delivery.mjs');
    const f = fixture(), objects = new Map<string, InstanceType<typeof NotificationDelivery>>();
    const { NOTIFICATION_URL: _unused, ...base } = f.env;
    const accepted = new Map(); let attempts = 0;
    const env = { ...base, NOTIFICATIONS: {
      idFromName: (id: string) => id,
      get: (id: string) => {
        if (!objects.has(id)) objects.set(id, new NotificationDelivery({ storage: new MemoryStorage() }, {
          NOTIFICATION_TOKEN: base.NOTIFICATION_TOKEN,
          NOTIFICATION_CHANNEL: { async fetch(request: Request) {
            const event = await request.json(); attempts++;
            accepted.set(event.id, event);
            return Response.json({ accepted: true, eventId: event.id, receiptId: 'synthetic-receipt' });
          } },
        }));
        return objects.get(id)!;
      },
    } };
    await runOperationsTick({ ...f, env }); f.fault(true); f.advance(300000); await runOperationsTick({ ...f, env });
    f.advance(300000); const result = await runOperationsTick({ ...f, env });
    expect(result.notifications).toMatchObject({ status: 'acknowledged', delivered: 1 });
    expect(result.pendingNotifications).toBe(0); expect(attempts).toBe(1); expect(accepted.size).toBe(1);
    expect(f.attempts).toEqual([]);
  });
  it("summarizes only actual healthy checks as successful and retains the previous success through later failures", async () => {
    const { runOperationsTick } = await import("./monitor.mjs");
    const f = fixture();
    const successfulAt = new Date(f.now()).toISOString();
    const first = await runOperationsTick(f);
    expect(first.summary).toMatchObject({ lastSuccessfulCheckAt: successfulAt, identity: "available", checkFreshness: "fresh" });
    f.fault(true); f.advance(300000);
    expect((await runOperationsTick(f)).summary).toMatchObject({ lastCheckAt: new Date(f.now()).toISOString(), lastSuccessfulCheckAt: successfulAt, health: "critical" });
    f.fault(false); f.advance(300000);
    f.env.VENDOR_USAGE.fetch = async () => Response.json({ version: 1, checkedAt: new Date(f.now()).toISOString(), providers: [{ provider: "synthetic", period: "2026-10", checkedAt: new Date(f.now()).toISOString(), requestRatio: 0.85, costRatio: 0.1 }] });
    expect((await runOperationsTick(f)).summary).toMatchObject({ lastSuccessfulCheckAt: successfulAt, health: "ok", vendor: "warning" });
    const state = await f.storage.get("state") as { lastSuccessfulCheckAt: string };
    expect(state.lastSuccessfulCheckAt).toBe(successfulAt);
  });
  it("retries a transient rotated-session save in the same tick before probing", async () => {
    const { runOperationsTick } = await import("./monitor.mjs");
    const f = fixture(), original = f.storage.put.bind(f.storage);
    let failures = 1, attempts = 0;
    f.storage.put = async (key, value) => {
      attempts++;
      if (failures-- > 0) throw new Error("synthetic transient storage outage");
      await original(key, value);
    };
    expect(await runOperationsTick(f)).toMatchObject({ status: "checked", checks: { health: { status: "ok" } } });
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(f.refreshes).toEqual(["bootstrap-refresh"]);
    expect(f.probes).toEqual(["Bearer access-1"]);
    f.advance(300000); await runOperationsTick(f);
    expect(f.refreshes).toEqual(["bootstrap-refresh", "refresh-1"]);
    expect(f.probes).toEqual(["Bearer access-1", "Bearer access-2"]);
  });

  it("fails closed after bounded rotated-session save attempts without refreshing again or probing", async () => {
    const { runOperationsTick } = await import("./monitor.mjs");
    const f = fixture(); let attempts = 0;
    f.storage.put = async () => { attempts++; throw new Error("synthetic permanent storage outage"); };
    await expect(runOperationsTick(f)).rejects.toThrow("Unable to persist rotated operations identity");
    expect(attempts).toBe(3);
    expect(f.refreshes).toEqual(["bootstrap-refresh"]);
    expect(f.probes).toHaveLength(0);
    expect(f.attempts).toHaveLength(0);
  });

  it("refreshes an expired dedicated session using the persisted rotated refresh token", async () => {
    const { runOperationsTick } = await import("./monitor.mjs");
    const f = fixture();
    const original = f.fetchImpl;
    f.fetchImpl = async (input, init) => { if (init?.redirect !== "manual") throw new Error("Cloudflare rejects redirect error mode"); return original(input, init); };
    await runOperationsTick(f); f.advance(121000); await runOperationsTick(f);
    expect(f.refreshes).toEqual(["bootstrap-refresh", "refresh-1"]);
    expect(f.probes).toEqual(["Bearer access-1", "Bearer access-2"]);
    expect(JSON.stringify(f.delivered)).not.toContain("access-");
  });

  it("persists a failed notification and retries one stable event before sending recovery", async () => {
    const { runOperationsTick } = await import("./monitor.mjs");
    const f = fixture(); await runOperationsTick(f);
    f.fault(true); f.advance(300000); await runOperationsTick(f);
    expect(f.attempts).toHaveLength(0);
    f.notificationFailure(true); f.advance(300000); await runOperationsTick(f);
    expect(f.attempts).toHaveLength(1);
    f.notificationFailure(false); f.advance(300000); await runOperationsTick(f);
    expect(f.attempts).toHaveLength(2); expect(f.attempts[1]).toBe(f.attempts[0]);
    expect(f.delivered.size).toBe(1);
    f.fault(false); f.advance(300000); const recovered = await runOperationsTick(f);
    expect(f.delivered.size).toBe(2);
    expect([...f.delivered.values()]).toMatchObject([{ from: "ok", to: "critical", category: "health" }, { from: "critical", to: "ok", category: "health" }]);
    expect(recovered.pendingNotifications).toBe(0);
    f.advance(300000); await runOperationsTick(f); expect(f.delivered.size).toBe(2);
    expect(JSON.stringify(recovered)).not.toMatch(/access-|refresh-|synthetic-notification-secret|synthetic-network-secret/);
  });

  it("requires matching delivery acknowledgement before removing the outbox event", async () => {
    const { runOperationsTick } = await import("./monitor.mjs");
    const f = fixture(); f.env.VENDOR_USAGE.fetch = async () => Response.json({ version: 1, checkedAt: new Date(f.now()).toISOString(), providers: [{ provider: "synthetic", period: "2026-10", checkedAt: new Date(f.now()).toISOString(), requestRatio: 0.95, costRatio: 0.1 }] });
    const original = f.fetchImpl; f.fetchImpl = async (input, init) => String(input).includes("notify.example.test") ? Response.json({ accepted: true, eventId: "wrong-event", receiptId: "wrong" }) : original(input, init);
    const result = await runOperationsTick(f);
    expect(result.pendingNotifications).toBe(1);
    expect(result.checks.vendor.status).toBe("critical");
    expect(result.checks.health.status).toBe("ok");
  });

  it("reports missing billing adapter separately and never performs cleanup without explicit opt-in", async () => {
    const { runOperationsTick } = await import("./monitor.mjs");
    const f = fixture(); delete (f.env as Partial<typeof f.env>).VENDOR_USAGE;
    const result = await runOperationsTick(f);
    expect(result.checks.vendor).toMatchObject({ status: "critical", code: "VENDOR_USAGE_UNAVAILABLE" });
    expect(result.cleanup).toEqual({ status: "disabled", cleaned: 0 });
  });

  it("rejects misdirected or personal identity responses before any API request", async () => {
    const { runOperationsTick } = await import("./monitor.mjs");
    const f = fixture(); const original = f.fetchImpl;
    f.fetchImpl = async (input, init) => String(input).includes("auth.example.test") ? Response.json({ access_token: "private", refresh_token: "private-r", expires_in: 3600, user: { id: "different-user" } }) : original(input, init);
    const result = await runOperationsTick(f);
    expect(f.probes).toHaveLength(0); expect(result.checks.health).toMatchObject({ status: "critical", code: "OPERATOR_IDENTITY_INVALID" });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("cleans only the exact opted-in target and performs at most one bounded batch", async () => {
    const { runOperationsTick } = await import("./monitor.mjs");
    const f = fixture(); Object.assign(f.env, { CLEANUP_ENABLED: "true", CLEANUP_LIBRARY_ID: "different-library" });
    const refused = await runOperationsTick(f); expect(refused.cleanup.status).toBe("refused");
    let cleanups = 0; const original = f.fetchImpl;
    f.fetchImpl = async (input, init) => String(input).endsWith("/uploads/cleanup") ? (++cleanups, Response.json({ cleaned: 25, batchLimit: 25 })) : original(input, init);
    Object.assign(f.env, { CLEANUP_LIBRARY_ID: "library-1" });
    const accepted = await runOperationsTick(f);
    expect(accepted.cleanup).toEqual({ status: "checked", cleaned: 25, moreMayRemain: true }); expect(cleanups).toBe(1);
  });

  it("keeps the same event after receiver acceptance followed by durable acknowledgement failure", async () => {
    const { runOperationsTick } = await import("./monitor.mjs");
    const f = fixture(); f.fault(true); await runOperationsTick(f); f.advance(300000);
    const put = f.storage.put.bind(f.storage); let failOnce = true;
    f.storage.put = async (key, value) => {
      const state = value as { lastReceipt?: unknown };
      if (state.lastReceipt && failOnce) { failOnce = false; throw new Error("synthetic-storage-failure"); }
      await put(key, value);
    };
    await expect(runOperationsTick(f)).rejects.toThrow("synthetic-storage-failure"); const first = f.attempts[0];
    f.advance(300000); await runOperationsTick(f);
    expect(f.attempts).toEqual([first, first]); expect(f.delivered.size).toBe(1);
  });

  it("does not announce successful delivery when the receiver only accepts a mismatched acknowledgement", async () => {
    const { runOperationsTick, retryOperationsNotifications } = await import("./monitor.mjs");
    const f = fixture(); f.fault(true); await runOperationsTick(f); f.advance(300000); f.notificationFailure(true); await runOperationsTick(f);
    const before = f.probes.length; f.notificationFailure(false); f.advance(30000);
    const result = await retryOperationsNotifications(f);
    expect(result).toMatchObject({ status: "acknowledged", pendingNotifications: 0, delivered: 1 });
    expect(f.probes).toHaveLength(before);
  });

  it("rejects corrupted event sequence state instead of sending untrusted queued payloads", async () => {
    const { runOperationsTick } = await import("./monitor.mjs");
    const f = fixture(); f.fault(true); await runOperationsTick(f); f.advance(300000); f.notificationFailure(true); await runOperationsTick(f);
    const state = await f.storage.get("state") as { sequence: number; outbox: Array<{ event: { id: string } }> };
    state.sequence = 0; await f.storage.put("state", state);
    await expect(runOperationsTick(f)).rejects.toThrow(/outbox|sequence|state/i);
  });

  it("announces authentication loss even when a different critical health fault already exists", async () => {
    const { runOperationsTick } = await import("./monitor.mjs");
    const f = fixture(); f.fault(true); await runOperationsTick(f); f.advance(300000); await runOperationsTick(f);
    expect(f.delivered.size).toBe(1);
    f.fetchImpl = async () => Response.json({}, { status: 401 }); f.advance(300000);
    const result = await runOperationsTick(f);
    expect(result.sequence).toBe(2);
    expect(result.checks.health.code).toBe("OPERATOR_REFRESH_FAILED");
    const state = await f.storage.get("state") as { outbox: Array<{ event: { code: string } }> };
    expect(state.outbox.some(item => item.event.code === "OPERATOR_REFRESH_FAILED")).toBe(true);
  });

  it("reports malformed successful health JSON immediately instead of counting it as a transient network fault", async () => {
    const { runOperationsTick } = await import("./monitor.mjs");
    const f = fixture(); const original = f.fetchImpl;
    f.fetchImpl = async (input, init) => String(input).includes("api.example.test") ? new Response("broken-json", { status: 200 }) : original(input, init);
    const result = await runOperationsTick(f);
    expect(result.checks.health).toMatchObject({ status: "critical", code: "INVALID_HEALTH" });
    expect(f.delivered.size).toBe(1);
  });
});

describe("scheduled Worker entrypoint", () => {
  it("has no public control route and propagates failed scheduled ticks", async () => {
    const { default: worker } = await import("./index.mjs");
    expect(worker.fetch().status).toBe(404);
    const requested: string[] = [];
    const env = { OPERATIONS: { idFromName: (name: string) => name, get: () => ({ fetch: async (url: string) => { requested.push(url); return new Response(null, { status: 503 }); } }) } };
    await expect(worker.scheduled({}, env)).rejects.toThrow("OPERATIONS_TICK_FAILED");
    expect(requested).toEqual(["https://operations.internal/tick"]);
  });
});
