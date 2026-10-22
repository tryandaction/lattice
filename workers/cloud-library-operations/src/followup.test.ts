// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { runOperationsTick } from "./monitor.mjs";

const now = Date.parse("2026-10-21T00:00:00Z");
const healthy = { schemaVersion: "202610170001", bucketPrivate: true, maxFileBytes: 20971520, bucketMaxFileBytes: 20971520, expiredUploads: 0, usage: { usedBytes: 1, reservedBytes: 0, maxStorageBytes: 100, supabaseService: { usedBytes: 1, reservedBytes: 0, maxStorageBytes: 100 } } };
interface BillingProvider { provider: string; period: string; checkedAt?: string; requestRatio: number; costRatio: number }
interface MonitorEnvironment {
  API_URL: string; LIBRARY_ID: string; SUPABASE_URL: string; SUPABASE_PUBLIC_KEY: string;
  OPERATOR_USER_ID: string; OPERATOR_REFRESH_TOKEN: string; EXPECTED_VENDOR_PROVIDERS?: string;
  OPERATOR_REAUTHORIZATION_VERSION?: string; OPERATOR_REAUTHORIZATION_REFRESH_TOKEN?: string;
  VENDOR_USAGE: { fetch: () => Promise<Response> };
}
const vendor = (provider: string, overrides: Partial<BillingProvider> = {}): BillingProvider => ({ provider, period: "2026-10", checkedAt: new Date(now).toISOString(), requestRatio: 0.1, costRatio: 0.1, ...overrides });
async function fixture() {
  const env: MonitorEnvironment = { API_URL: "https://api.example.test", LIBRARY_ID: "synthetic", SUPABASE_URL: "https://auth.example.test", SUPABASE_PUBLIC_KEY: "synthetic-public", OPERATOR_USER_ID: "operator", OPERATOR_REFRESH_TOKEN: "old-bootstrap", EXPECTED_VENDOR_PROVIDERS: "cloudflare,supabase", VENDOR_USAGE: { fetch: async () => Response.json({ version: 1, checkedAt: new Date(now).toISOString(), providers: [vendor("cloudflare"), vendor("supabase")] }) } };
  const targetId = createHash("sha256").update([env.API_URL, env.LIBRARY_ID, env.SUPABASE_URL, env.OPERATOR_USER_ID].join("|")).digest("hex");
  const initial = { version: 1, targetId, sequence: 7, networkFailures: 0, statuses: { health: "critical", vendor: "ok" }, codes: { health: "OPERATOR_REFRESH_FAILED", vendor: "VENDOR_USAGE_OK" }, outbox: [{ event: { id: targetId + ":7", category: "health", type: "degraded", from: "ok", to: "critical", code: "OPERATOR_REFRESH_FAILED", checkedAt: new Date(now - 60000).toISOString() }, attempts: 3, nextAttemptAt: now + 600000 }], session: { userId: "operator", accessToken: "expired-access", refreshToken: "revoked-persisted", expiresAt: now - 1 } };
  type State = typeof initial & { reauthorization?: { version: number; refreshTokenHash: string } };
  let state: State | undefined = structuredClone(initial);
  const puts: State[] = [], refreshes: string[] = [], probes: string[] = [];
  const storage = { get: async () => structuredClone(state), put: async (_key: string, next: State) => { puts.push(structuredClone(next)); state = structuredClone(next); }, setAlarm: async () => {} };
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes("auth.example.test")) {
      const token = JSON.parse(String(init?.body)).refresh_token; refreshes.push(token);
      if (token !== "new-authorization" && token !== "rotated-new") return Response.json({}, { status: 401 });
      return Response.json({ access_token: "new-access", refresh_token: "rotated-new", expires_in: 120, user: { id: "operator" } });
    }
    probes.push(String(input));
    expect(puts.some(value => value.session.refreshToken === "rotated-new")).toBe(true);
    return Response.json(healthy);
  };
  return { env, storage, fetchImpl, now: () => now, initial, puts, refreshes, probes, state: () => { if (!state) throw Error("Fixture state missing"); return state; }, setState: (next: State | undefined) => { state = next; } };
}
function reauthorize(f: Awaited<ReturnType<typeof fixture>>, version = "1", token = "new-authorization") {
  Object.assign(f.env, { OPERATOR_REAUTHORIZATION_VERSION: version, OPERATOR_REAUTHORIZATION_REFRESH_TOKEN: token });
}

describe("versioned operator reauthorization", () => {
  it("replaces a revoked persisted session once after saving the new identity, preserving queued retries", async () => {
    const f = await fixture(); reauthorize(f);
    const result = await runOperationsTick(f);
    expect(result.checks.health.code).toBe("HEALTHY"); expect(f.refreshes).toEqual(["new-authorization"]);
    expect(f.puts[0]).toMatchObject({ sequence: 7, outbox: f.initial.outbox, reauthorization: { version: 1 } });
    expect(f.state().outbox[0]).toEqual(f.initial.outbox[0]); expect(f.state().sequence).toBe(8);
    expect(f.state().reauthorization?.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toMatch(/new-access|new-authorization|rotated-new/);
    f.state().session.expiresAt = now - 1; await runOperationsTick(f);
    expect(f.refreshes).toEqual(["new-authorization", "rotated-new"]);
    expect(f.state().sequence).toBe(8);
  });
  it.each(["revoked-persisted", "old-bootstrap"])("refuses reused credential %s before any refresh", async token => {
    const f = await fixture(); reauthorize(f, "1", token);
    expect((await runOperationsTick(f)).checks.health.code).toBe("OPERATOR_REAUTHORIZATION_REUSED_TOKEN");
    expect(f.refreshes).toEqual([]); expect(f.probes).toEqual([]); expect(f.state().session).toEqual(f.initial.session);
  });
  it("rejects a reauthorization when durable state was lost", async () => {
    const f = await fixture(); f.setState(undefined); reauthorize(f);
    await expect(runOperationsTick(f)).rejects.toThrow("OPERATOR_REAUTHORIZATION_STATE_REQUIRED");
    expect(f.refreshes).toEqual([]); expect(f.probes).toEqual([]);
    expect(f.puts).toEqual([]);
  });
  it("rejects a wrong account without changing the saved session or consuming the version", async () => {
    const f = await fixture(); reauthorize(f);
    f.fetchImpl = async () => { f.refreshes.push("new-authorization"); return Response.json({ access_token: "wrong-access", refresh_token: "wrong-refresh", expires_in: 120, user: { id: "wrong-user" } }); };
    const result = await runOperationsTick(f);
    expect(result.checks.health.code).toBe("OPERATOR_IDENTITY_INVALID"); expect(f.probes).toEqual([]);
    expect(f.state().session).toEqual(f.initial.session); expect(f.state().reauthorization).toBeUndefined();
  });
  it.each(["0", "2", "-1", "1.5", "01"])("rejects invalid or skipped reauthorization version %s", async version => {
    const f = await fixture(); reauthorize(f, version);
    expect((await runOperationsTick(f)).checks.health.code).toBe("OPERATOR_REAUTHORIZATION_VERSION_INVALID");
    expect(f.refreshes).toEqual([]); expect(f.probes).toEqual([]);
  });
  it("does not reset queue state when the configured target changes", async () => {
    const f = await fixture(); reauthorize(f); f.env.LIBRARY_ID = "different-target";
    await expect(runOperationsTick(f)).rejects.toThrow("Invalid operations durable state");
    expect(f.refreshes).toEqual([]); expect(f.puts).toEqual([]);
  });
  it("fails closed after three saves without a second remote refresh or a consumed durable version", async () => {
    const f = await fixture(); reauthorize(f); let attempts = 0;
    f.storage.put = async () => { attempts++; throw Error("synthetic persistence failure"); };
    await expect(runOperationsTick(f)).rejects.toThrow("Unable to persist rotated operations identity");
    expect(attempts).toBe(3); expect(f.refreshes).toEqual(["new-authorization"]); expect(f.probes).toEqual([]);
    expect(f.state()).toEqual(f.initial);
  });
  it("retries the same validated session snapshot before consuming its authorization version", async () => {
    const f = await fixture(); reauthorize(f); const put = f.storage.put; let attempts = 0;
    f.storage.put = async (key, value) => { if (++attempts === 1) throw Error("synthetic transient"); await put(key, value); };
    expect((await runOperationsTick(f)).checks.health.code).toBe("HEALTHY");
    expect(f.refreshes).toEqual(["new-authorization"]); expect(attempts).toBe(3);
    expect(f.puts[0]).toMatchObject({ sequence: 7, outbox: f.initial.outbox, reauthorization: { version: 1 } });
  });
  it("refuses a version rollback or missing version after a successful migration", async () => {
    const f = await fixture(); reauthorize(f); await runOperationsTick(f); f.refreshes.length = 0; f.probes.length = 0;
    f.env.OPERATOR_REAUTHORIZATION_VERSION = "0";
    expect((await runOperationsTick(f)).checks.health.code).toBe("OPERATOR_REAUTHORIZATION_VERSION_INVALID");
    delete f.env.OPERATOR_REAUTHORIZATION_VERSION;
    expect((await runOperationsTick(f)).checks.health.code).toBe("OPERATOR_REAUTHORIZATION_VERSION_INVALID");
    expect(f.refreshes).toEqual([]); expect(f.probes).toEqual([]);
  });
  it("refuses the previous authorization credential in a later version", async () => {
    const f = await fixture(); reauthorize(f); await runOperationsTick(f); f.refreshes.length = 0; f.probes.length = 0;
    f.env.OPERATOR_REAUTHORIZATION_VERSION = "2";
    expect((await runOperationsTick(f)).checks.health.code).toBe("OPERATOR_REAUTHORIZATION_REUSED_TOKEN");
    expect(f.refreshes).toEqual([]); expect(f.probes).toEqual([]); expect(f.state().reauthorization?.version).toBe(1);
  });
  it("uses the saved rotated session after the consumed input secret is removed", async () => {
    const f = await fixture(); reauthorize(f); await runOperationsTick(f); f.refreshes.length = 0;
    delete f.env.OPERATOR_REAUTHORIZATION_REFRESH_TOKEN; f.state().session.expiresAt = now - 1;
    expect((await runOperationsTick(f)).checks.health.code).toBe("HEALTHY");
    expect(f.refreshes).toEqual(["rotated-new"]); expect(f.state().reauthorization?.version).toBe(1);
  });
  it("accepts the next explicit authorization without resetting old notification attempts", async () => {
    const f = await fixture(); reauthorize(f); await runOperationsTick(f); f.refreshes.length = 0;
    reauthorize(f, "2", "second-authorization");
    const original = f.fetchImpl;
    f.fetchImpl = async (input, init) => String(input).includes("auth.example.test")
      ? (f.refreshes.push(JSON.parse(String(init?.body)).refresh_token), Response.json({ access_token: "second-access", refresh_token: "second-rotated", expires_in: 120, user: { id: "operator" } }))
      : original(input, init);
    expect((await runOperationsTick(f)).checks.health.code).toBe("HEALTHY");
    expect(f.refreshes).toEqual(["second-authorization"]); expect(f.state().reauthorization?.version).toBe(2);
    expect(f.state().outbox[0]).toEqual(f.initial.outbox[0]); expect(f.state().sequence).toBe(8);
  });
});

describe("complete current vendor billing", () => {
  async function check(providers: BillingProvider[], expected: string | null = "cloudflare,supabase") {
    const f = await fixture(); reauthorize(f);
    if (expected === null) delete f.env.EXPECTED_VENDOR_PROVIDERS; else f.env.EXPECTED_VENDOR_PROVIDERS = expected;
    f.env.VENDOR_USAGE.fetch = async () => Response.json({ version: 1, checkedAt: new Date(now).toISOString(), providers });
    return (await runOperationsTick(f)).checks.vendor;
  }
  it("refuses last month's data under a fresh envelope", async () => {
    expect(await check([vendor("cloudflare", { period: "2026-09" }), vendor("supabase")])).toMatchObject({ status: "critical", code: "VENDOR_USAGE_STALE_OR_INVALID" });
  });
  it("requires a fresh timestamp on every provider", async () => {
    expect(await check([vendor("cloudflare", { checkedAt: "2026-10-20T22:59:59Z" }), vendor("supabase")])).toMatchObject({ status: "critical", code: "VENDOR_USAGE_STALE_OR_INVALID" });
    const missing = vendor("cloudflare"); delete missing.checkedAt;
    expect((await check([missing, vendor("supabase")])).status).toBe("critical");
  });
  it("refuses incomplete or unexpected provider sets", async () => {
    expect(await check([vendor("cloudflare")])).toMatchObject({ status: "critical", code: "VENDOR_USAGE_COVERAGE_INVALID" });
    expect(await check([vendor("cloudflare"), vendor("supabase"), vendor("unexpected")])).toMatchObject({ status: "critical", code: "VENDOR_USAGE_COVERAGE_INVALID" });
  });
  it("cannot return normal without an explicit expected provider set", async () => {
    expect(await check([vendor("cloudflare")], null)).toMatchObject({ status: "critical", code: "VENDOR_USAGE_CONFIG_INVALID" });
  });
  it("keeps complete fresh billing thresholds separate from healthy storage", async () => {
    expect(await check([vendor("cloudflare"), vendor("supabase")])).toMatchObject({ status: "ok", code: "VENDOR_USAGE_OK" });
    expect(await check([vendor("supabase", { costRatio: 0.85 }), vendor("cloudflare")])).toMatchObject({ status: "warning", code: "VENDOR_USAGE_THRESHOLD" });
    expect(await check([vendor("supabase"), vendor("cloudflare", { requestRatio: 0.95 })])).toMatchObject({ status: "critical", code: "VENDOR_USAGE_THRESHOLD" });
  });
  it.each(["", "supabase,supabase", "supabase,", "supabase,bad name"])("rejects invalid expected provider configuration %s", async expected => {
    expect(await check([vendor("supabase")], expected)).toMatchObject({ status: "critical", code: "VENDOR_USAGE_CONFIG_INVALID" });
  });
  it("rejects duplicate providers and future source timestamps", async () => {
    expect(await check([vendor("cloudflare"), vendor("cloudflare")])).toMatchObject({ status: "critical", code: "VENDOR_USAGE_STALE_OR_INVALID" });
    expect(await check([vendor("cloudflare", { checkedAt: new Date(now + 61000).toISOString() }), vendor("supabase")])).toMatchObject({ status: "critical", code: "VENDOR_USAGE_STALE_OR_INVALID" });
  });
  it("uses the current UTC billing month at a local-time month boundary", async () => {
    const f = await fixture(); reauthorize(f);
    const boundary = Date.parse("2026-10-31T23:30:00-07:00");
    const provider = (period: string) => vendor("cloudflare", { period, checkedAt: new Date(boundary).toISOString() });
    f.env.EXPECTED_VENDOR_PROVIDERS = "cloudflare";
    f.env.VENDOR_USAGE.fetch = async () => Response.json({ version: 1, checkedAt: new Date(boundary).toISOString(), providers: [provider("2026-10")] });
    expect((await runOperationsTick({ ...f, now: () => boundary })).checks.vendor.code).toBe("VENDOR_USAGE_STALE_OR_INVALID");
    f.env.VENDOR_USAGE.fetch = async () => Response.json({ version: 1, checkedAt: new Date(boundary).toISOString(), providers: [provider("2026-11")] });
    expect((await runOperationsTick({ ...f, now: () => boundary })).checks.vendor.code).toBe("VENDOR_USAGE_OK");
  });
});
