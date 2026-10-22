import { describe, expect, it } from "vitest";
import {
  AuthSessionManager,
  isSessionExpired,
  isSessionUsable,
  shouldRefreshSession,
  validateSessionForDevice,
  type AuthSession,
  type AuthSessionStore,
} from "../auth";

function makeSession(overrides?: Partial<AuthSession>): AuthSession {
  return {
    accessToken: "at-1",
    refreshToken: "rt-1",
    userId: "user-1",
    deviceId: "device-1",
    issuedAt: "2026-08-20T00:00:00.000Z",
    expiresAt: "2026-08-20T01:00:00.000Z",
    ...overrides,
  };
}

class InMemoryAuthSessionStore implements AuthSessionStore {
  private session: AuthSession | null = null;

  async getSession(): Promise<AuthSession | null> {
    return this.session;
  }

  async saveSession(session: AuthSession): Promise<void> {
    this.session = session;
  }

  async clearSession(): Promise<void> {
    this.session = null;
  }
}

describe("auth session boundary", () => {
  it("flags an expired session", () => {
    const session = makeSession({ expiresAt: "2026-08-20T00:30:00.000Z" });
    expect(isSessionExpired(session, "2026-08-20T01:00:00.000Z")).toBe(true);
    expect(isSessionExpired(session, "2026-08-20T00:00:00.000Z")).toBe(false);
  });

  it("binds a session to its device", () => {
    const session = makeSession({ deviceId: "device-1" });
    expect(validateSessionForDevice(session, "device-1")).toBe(true);
    expect(validateSessionForDevice(session, "device-2")).toBe(false);
  });

  it("considers a session usable only when valid on this device and not expired", () => {
    const session = makeSession();
    expect(isSessionUsable(session, "device-1", "2026-08-20T00:10:00.000Z")).toBe(true);
    expect(isSessionUsable(session, "device-2", "2026-08-20T00:10:00.000Z")).toBe(false);
    expect(isSessionUsable(session, "device-1", "2026-08-20T02:00:00.000Z")).toBe(false);
  });

  it("requests a refresh before the session actually expires", () => {
    const session = makeSession({ expiresAt: "2026-08-20T00:05:00.000Z" });
    expect(
      shouldRefreshSession(session, "2026-08-20T00:00:00.000Z", 10 * 60 * 1000),
    ).toBe(true);
  });

  it("loads and refreshes an expired session through the manager", async () => {
    const store = new InMemoryAuthSessionStore();
    await store.saveSession(makeSession({ expiresAt: "2026-08-20T00:30:00.000Z" }));
    const repository = {
      signIn: async () => makeSession(),
      refresh: async () =>
        makeSession({ accessToken: "at-2", expiresAt: "2026-08-20T02:00:00.000Z" }),
      signOut: async () => {},
    };
    const manager = new AuthSessionManager({ store, repository });

    const session = await manager.loadValidSession("device-1", "2026-08-20T01:00:00.000Z");
    expect(session?.accessToken).toBe("at-2");
    expect((await store.getSession())?.accessToken).toBe("at-2");
  });

  it("clears the session when a refresh fails and never returns a stale session", async () => {
    const store = new InMemoryAuthSessionStore();
    await store.saveSession(makeSession({ expiresAt: "2026-08-20T00:30:00.000Z" }));
    const repository = {
      signIn: async () => makeSession(),
      refresh: async () => {
        throw new Error("refresh token revoked");
      },
      signOut: async () => {},
    };
    const manager = new AuthSessionManager({ store, repository });

    const session = await manager.loadValidSession("device-1", "2026-08-20T01:00:00.000Z");
    expect(session).toBeNull();
    expect(await store.getSession()).toBeNull();
  });

  it("returns null when no session is stored", async () => {
    const store = new InMemoryAuthSessionStore();
    const repository = {
      signIn: async () => makeSession(),
      refresh: async () => makeSession(),
      signOut: async () => {},
    };
    const manager = new AuthSessionManager({ store, repository });
    expect(
      await manager.loadValidSession("device-1", "2026-08-20T01:00:00.000Z"),
    ).toBeNull();
  });

  it("rejects a session bound to another device by clearing it", async () => {
    const store = new InMemoryAuthSessionStore();
    await store.saveSession(makeSession({ deviceId: "device-2" }));
    const repository = {
      signIn: async () => makeSession(),
      refresh: async () => makeSession(),
      signOut: async () => {},
    };
    const manager = new AuthSessionManager({ store, repository });

    expect(
      await manager.loadValidSession("device-1", "2026-08-20T00:10:00.000Z"),
    ).toBeNull();
    expect(await store.getSession()).toBeNull();
  });
});
