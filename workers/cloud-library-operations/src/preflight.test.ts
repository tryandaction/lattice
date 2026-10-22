// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { preflightOperations, summarizeOperationsState } from "./preflight.mjs";

const at = Date.parse("2026-10-21T10:00:00Z");
const iso = (offset = 0) => new Date(at + offset).toISOString();
function config() {
  return { version: 1, vars: { API_URL: "https://api.example.test/base", SUPABASE_URL: "https://auth.example.test", SUPABASE_PUBLIC_KEY: "synthetic-public-key", LIBRARY_ID: "synthetic-library", OPERATOR_USER_ID: "synthetic-operator", NOTIFICATION_URL: "https://notify.example.test/events", EXPECTED_VENDOR_PROVIDERS: "supabase,cloudflare", CLEANUP_ENABLED: "false" }, secrets: { OPERATOR_REFRESH_TOKEN: true, NOTIFICATION_TOKEN: true }, bindings: { OPERATIONS: true, VENDOR_USAGE: true }, cron: "*/5 * * * *" };
}
const snapshot = () => ({ version: 1, lastCheckAt: iso(-60000), lastSuccessfulCheckAt: iso(-300000), identity: "available", health: "ok", vendor: "ok", queue: { count: 2, oldestAt: iso(-900000) }, lastAcknowledgementAt: iso(-120000) });
describe("offline deployment preflight", () => {
  it('requires both the internal durable receiver and its delivery channel when no URL is used', () => {
    const base = config(); const { NOTIFICATION_URL: _unused, ...vars } = base.vars;
    const input = { ...base, vars, bindings: { ...base.bindings, NOTIFICATIONS: true, NOTIFICATION_CHANNEL: true } };
    expect(preflightOperations(input, at)).toMatchObject({ status: 'configured-unverified', checks: { notifications: { status: 'configured' } } });
    input.bindings.NOTIFICATION_CHANNEL = false;
    expect(preflightOperations(input, at)).toMatchObject({ status: 'blocked', checks: { notifications: { status: 'missing' } } });
  });
  it("reports missing inputs without reading process configuration or using the network", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("network forbidden"));
    try {
      const result = preflightOperations(undefined, at);
      expect(result.status).toBe("blocked"); expect(result.deploymentVerified).toBe(false);
      if (!("checks" in result)) throw Error("Missing preflight checks");
      expect(result.checks.identity.status).toBe("missing"); expect(result.checks.notifications.status).toBe("missing"); expect(result.checks.billing.status).toBe("missing");
      expect(result.networkRequests).toBe(0); expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it("calls complete configuration configured-unverified, never online or deployed", () => {
    expect(preflightOperations(config(), at)).toMatchObject({ status: "configured-unverified", deploymentVerified: false, runtime: { status: "not_provided" } });
  });
  it("does not confuse a healthy snapshot with missing notification and billing configuration", () => {
    const value = { ...config(), snapshot: snapshot() }; value.secrets.NOTIFICATION_TOKEN = false; value.bindings.VENDOR_USAGE = false;
    const result = preflightOperations(value, at);
    expect(result.status).toBe("blocked"); expect(result.runtime.status).toBe("available"); expect(result.deploymentVerified).toBe(false);
  });
  it("does not echo public URLs, IDs, keys, input errors or unexpected secrets", () => {
    const input = { ...config(), snapshot: snapshot() }; input.vars.API_URL = "https://private-user@example.test/path?token=synthetic-secret";
    const result = JSON.stringify(preflightOperations(input, at));
    expect(result).not.toMatch(/example\.test|synthetic-|private-user|path\?token/);
    expect(preflightOperations({ ...config(), secrets: { OPERATOR_REFRESH_TOKEN: "private-token" } }, at).status).toBe("invalid_input");
    expect(JSON.stringify(preflightOperations({ ...config(), unexpected: "private@example.test" }, at))).not.toContain("private@example.test");
  });
  it.each(["token", "session", "outbox", "email"])("rejects unknown snapshot field %s without reflecting its value", field => {
    const result = preflightOperations({ ...config(), snapshot: { ...snapshot(), [field]: "sensitive-fixture" } }, at);
    expect(result.status).toBe("invalid_input"); expect(JSON.stringify(result)).not.toContain("sensitive-fixture");
  });
  it("validates queue chronology and rejects future or malformed timestamps", () => {
    for (const queue of [{ count: 1, oldestAt: "invalid" }, { count: 1, oldestAt: iso(1000) }, { count: 0, oldestAt: iso(-1000) }]) {
      expect(preflightOperations({ ...config(), snapshot: { ...snapshot(), queue } }, at).status).toBe("invalid_input");
    }
    expect(preflightOperations({ ...config(), snapshot: { ...snapshot(), lastSuccessfulCheckAt: iso(1000) } }, at).status).toBe("invalid_input");
  });
  it("computes queue age and marks stale checks without claiming live verification", () => {
    const result = preflightOperations({ ...config(), snapshot: snapshot() }, at);
    expect(result.runtime.queue).toMatchObject({ count: 2, oldestAgeMs: 900000 }); expect(result.runtime.checkFreshness).toBe("fresh");
    const stale = { ...snapshot(), lastCheckAt: iso(-900001), lastSuccessfulCheckAt: iso(-1000000) };
    expect(preflightOperations({ ...config(), snapshot: stale }, at).runtime.checkFreshness).toBe("stale");
  });
  it("does not treat an old bootstrap as usable after the supplied snapshot reports authentication loss", () => {
    const input = { ...config(), snapshot: { ...snapshot(), identity: "unavailable" } };
    expect(preflightOperations(input, at)).toMatchObject({ status: "blocked", checks: { identity: { status: "invalid" } } });
  });
  it("rejects unknown nested fields, invalid cleanup targets and altered schedules", () => {
    expect(preflightOperations({ ...config(), snapshot: { ...snapshot(), queue: { ...snapshot().queue, jwt: "secret-fixture" } } }, at).status).toBe("invalid_input");
    const input = config(); input.vars.CLEANUP_ENABLED = "true";
    expect(preflightOperations(input, at)).toMatchObject({ status: "blocked", checks: { cleanup: { status: "invalid" } } });
    input.cron = "0 * * * *";
    expect(preflightOperations(input, at)).toMatchObject({ status: "blocked", checks: { scheduler: { status: "invalid" } } });
  });
  it.each(["vars", "secrets", "bindings"])("rejects explicit null %s instead of treating a malformed structure as absent", field => {
    expect(preflightOperations({ ...config(), [field]: null }, at).status).toBe("invalid_input");
  });
  it("CLI default ignores secrets in the environment and needs no files", () => {
    const result = spawnSync(process.execPath, ["scripts/cloud-library-operations-preflight.mjs"], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, OPERATOR_REFRESH_TOKEN: "never-read-fixture" } });
    expect(result.status).toBe(2); expect(JSON.parse(result.stdout).status).toBe("blocked"); expect(result.stdout + result.stderr).not.toContain("never-read-fixture");
  });
  it("CLI accepts only explicit stdin JSON and sanitizes parse or argument errors", () => {
    const good = spawnSync(process.execPath, ["scripts/cloud-library-operations-preflight.mjs", "--stdin-json"], { encoding: "utf8", input: JSON.stringify(config()) });
    expect(good.status).toBe(0); expect(JSON.parse(good.stdout).deploymentVerified).toBe(false);
    const bad = spawnSync(process.execPath, ["scripts/cloud-library-operations-preflight.mjs", "--stdin-json"], { encoding: "utf8", input: "invalid-sensitive-text" });
    expect(bad.status).toBe(2); expect(bad.stdout + bad.stderr).not.toContain("invalid-sensitive-text");
  });
});

describe("internal state redaction", () => {
  it("projects a safe summary and never serializes session, target, receipt ID or unknown payloads", () => {
    const state = { version: 1, targetId: "sensitive-target", session: { userId: "operator", accessToken: "private-jwt", refreshToken: "private-refresh", expiresAt: at + 3600000 }, statuses: { health: "ok", vendor: "ok" }, lastRun: { checkedAt: iso(-60000), checks: { health: { status: "ok", code: "HEALTHY" }, vendor: { status: "ok", code: "VENDOR_USAGE_OK" } } }, lastSuccessfulCheckAt: iso(-60000), outbox: [{ event: { checkedAt: iso(-900000), payload: "sensitive-body" } }], lastReceipt: { eventId: "secret-id", receiptId: "private-receipt", acknowledgedAt: iso(-120000) }, arbitrary: "private@example.test" };
    const result = summarizeOperationsState(state, at);
    expect(result).toMatchObject({ status: "available", identity: "available", lastCheckAt: iso(-60000), lastSuccessfulCheckAt: iso(-60000), lastAcknowledgementAt: iso(-120000), queue: { count: 1, oldestAgeMs: 900000 } });
    expect(JSON.stringify(result)).not.toMatch(/sensitive|private|secret-id|operator/);
    expect(summarizeOperationsState(undefined, at).status).toBe("not_provided");
  });
  it("cannot show an available identity after authentication loss and keeps invalid queue dates invalid", () => {
    const state = { version: 1, session: { expiresAt: at + 3600000 }, lastRun: { checkedAt: iso(-1000), checks: { health: { status: "critical", code: "OPERATOR_REFRESH_FAILED" }, vendor: { status: "ok" } } }, outbox: [] };
    expect(summarizeOperationsState(state, at).identity).toBe("unavailable");
    expect(summarizeOperationsState({ ...state, outbox: [{ event: { checkedAt: iso(1000) } }] }, at).status).toBe("invalid_state");
  });
});
