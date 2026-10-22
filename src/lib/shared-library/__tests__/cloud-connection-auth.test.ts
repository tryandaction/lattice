import { describe, expect, it, vi } from "vitest";
import { createCloudInviteUrl, resolveCloudConnection, parseCloudConnectionInput, validateCloudConnection, validateCloudPath, cloudScope } from "../connection";
import { CloudAuthSession } from "../supabase-auth";
import type { AuthSession, AuthRepository } from "../auth";
import { cloudNavigationTarget } from "../cloud-navigation";
import type { CloudLibraryResource } from "../source-provider";

const connection = { id: "c", name: "Lab", apiUrl: "http://127.0.0.1:3539", supabaseUrl: "http://localhost:3540", publicKey: "sb_publishable_test", maxFileBytes: 1000 };
describe("cloud connection and identity", () => {
  it("roundtrips invitation identity with only public service configuration", () => {
    const url = createCloudInviteUrl("https://lattice.example/library", connection, "lib-123", "invite-secret");
    expect(new URL(url).search).toBe("");
    expect(parseCloudConnectionInput(url)).toMatchObject({ libraryId: "lib-123", inviteToken: "invite-secret", apiUrl: connection.apiUrl });
    expect(url).not.toContain("maxFileBytes");
  });
  it("reuses endpoint identity without overwriting a selected unrelated connection", () => {
    const parsed = parseCloudConnectionInput(createCloudInviteUrl("https://lattice.example/library", connection, "lib", "token"))!;
    const other = { ...connection, id: "other", apiUrl: "https://other.example" };
    expect(resolveCloudConnection(parsed, [other]).id).not.toBe(other.id);
    expect(resolveCloudConnection(parsed, [other, connection]).id).toBe(connection.id);
  });
  it("parses a public invite URL without requiring separate endpoint fields", () => {
    const input = new URL("https://lattice.example/invite");
    input.searchParams.set("name", "量子小组");
    input.searchParams.set("api", connection.apiUrl);
    input.searchParams.set("supabase", connection.supabaseUrl);
    input.searchParams.set("key", connection.publicKey);
    expect(parseCloudConnectionInput(input.toString())).toEqual({
      name: "量子小组",
      apiUrl: connection.apiUrl,
      supabaseUrl: connection.supabaseUrl,
      publicKey: connection.publicKey,
    });
  });
  it("parses copied JSON configuration and ignores unknown fields", () => {
    expect(parseCloudConnectionInput(JSON.stringify({ ...connection, id: "ignored", maxFileBytes: 42, extra: "ignored" }))).toEqual({
      name: connection.name,
      apiUrl: connection.apiUrl,
      supabaseUrl: connection.supabaseUrl,
      publicKey: connection.publicKey,
    });
  });
  it("returns null for malformed or incomplete pasted input", () => {
    expect(parseCloudConnectionInput("this is not a connection")).toBeNull();
    expect(parseCloudConnectionInput("https://lattice.example/invite?name=missing-key")).toBeNull();
  });
  it("rejects a pasted service-role key before saving it", () => {
    const input = new URL("https://lattice.example/invite");
    input.searchParams.set("name", "Lab");
    input.searchParams.set("api", connection.apiUrl);
    input.searchParams.set("supabase", connection.supabaseUrl);
    input.searchParams.set("key", "sb_secret_private");
    expect(() => parseCloudConnectionInput(input.toString())).toThrow();
  });
  it("rejects secret keys, credentials and traversal without rejecting Chinese/space names", () => {
    expect(() => validateCloudConnection({ ...connection, publicKey: "sb_secret_private" })).toThrow();
    expect(() => validateCloudConnection({ ...connection, apiUrl: "https://user:pass@example.com" })).toThrow();
    expect(() => validateCloudPath("dir/../private")).toThrow();
    expect(validateCloudPath("课题 空间/论文.pdf")).toBe("课题 空间/论文.pdf");
    expect(cloudScope(connection, "A")).not.toBe(cloudScope(connection, "B"));
    expect(cloudScope(connection, "A")).not.toBe(cloudScope({ ...connection, apiUrl: "https://other.example" }, "A"));
  });
  it("routes cloud locators to existing viewers using the scoped source path", () => {
    const pdf = { path: "cloud://opaque-identity", kind: "pdf" } as CloudLibraryResource;
    expect(cloudNavigationTarget(pdf, { page: 2, snippet: "quote" })).toEqual({ type: "pdf_page", path: pdf.path, page: 2, snippet: "quote" });
    expect(() => cloudNavigationTarget(pdf, { page: 0 })).toThrow();
    expect(cloudNavigationTarget({ ...pdf, kind: "code" }, { line: 12 })).toEqual({ type: "code_line", path: pdf.path, line: 12 });
  });
  it("retains session on offline refresh and shares one refresh across callers", async () => {
    let stored: AuthSession | null = { accessToken: "expired", refreshToken: "durable", userId: "A", deviceId: "d", issuedAt: "2020-01-01", expiresAt: "2020-01-01" };
    const refresh = vi.fn().mockRejectedValue(new TypeError("offline"));
    const repository = { refresh } as unknown as AuthRepository;
    const auth = new CloudAuthSession({ getSession: async () => stored, saveSession: async s => { stored = s; }, clearSession: async () => { stored = null; } }, repository, "d");
    await Promise.allSettled([auth.load(), auth.load(), auth.load()]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(stored?.refreshToken).toBe("durable");
  });
  it("pins a session to its account and does not overwrite a later login with a delayed refresh", async () => {
    let stored: AuthSession | null = { accessToken: "A-expired", refreshToken: "A-refresh", userId: "A", deviceId: "d", issuedAt: "2020-01-01", expiresAt: "2020-01-01" };
    let resolveRefresh!: (value: AuthSession) => void;
    const auth = new CloudAuthSession({ getSession: async () => stored, saveSession: async value => { stored = value; }, clearSession: async () => { stored = null; } }, { refresh: () => new Promise<AuthSession>(resolve => { resolveRefresh = resolve; }) } as unknown as AuthRepository, "d");
    const pending = auth.load();
    await vi.waitFor(() => expect(resolveRefresh).toBeTypeOf("function"));
    stored = { ...stored!, userId: "B", accessToken: "B-access", refreshToken: "B-refresh", expiresAt: "2099-01-01" };
    resolveRefresh({ ...stored, userId: "A", accessToken: "A-new", refreshToken: "A-new-refresh" });
    expect(await pending).toBeNull();
    expect(stored.userId).toBe("B");
    await expect(auth.load()).rejects.toThrow("账号已在另一窗口切换");
  });
  it("does not return a stored session captured before logout", async () => {
    const session: AuthSession = { accessToken: "old-access", refreshToken: "old-refresh", userId: "A", deviceId: "d", issuedAt: "2020-01-01", expiresAt: "2099-01-01" };
    let stored: AuthSession | null = session;
    let finishRead!: (session: AuthSession | null) => void;
    let reads = 0;
    const auth = new CloudAuthSession({
      getSession: async () => ++reads === 1 ? new Promise(resolve => { finishRead = resolve; }) : stored,
      saveSession: async next => { stored = next; }, clearSession: async () => { stored = null; },
    }, { signIn: async () => session, refresh: async () => session, signOut: async () => {} }, "d");
    const pending = auth.load();
    await auth.signOut();
    finishRead(session);
    expect(await pending).toBeNull();
    expect(stored).toBeNull();
  });
  it("does not restore a refreshed session when logout happens during its storage recheck", async () => {
    const session: AuthSession = { accessToken: "expired", refreshToken: "old-refresh", userId: "A", deviceId: "d", issuedAt: "2020-01-01", expiresAt: "2020-01-01" };
    let stored: AuthSession | null = session;
    let finishRead!: (session: AuthSession | null) => void;
    let reads = 0;
    const auth = new CloudAuthSession({
      getSession: async () => ++reads === 2 ? new Promise(resolve => { finishRead = resolve; }) : stored,
      saveSession: async next => { stored = next; }, clearSession: async () => { stored = null; },
    }, { signIn: async () => session, refresh: async () => ({ ...session, accessToken: "new-access", refreshToken: "rotated", expiresAt: "2099-01-01" }), signOut: async () => {} }, "d");
    const pending = auth.load();
    await vi.waitFor(() => expect(finishRead).toBeTypeOf("function"));
    const logout = auth.signOut();
    finishRead(session);
    await logout;
    expect(await pending).toBeNull();
    expect(stored).toBeNull();
  });
  it.each(["signIn", "refresh", "confirmEmail"] as const)("keeps logout durable when %s persistence is already in flight", async operation => {
    const session: AuthSession = { accessToken: "old-access", refreshToken: "old-refresh", userId: "A", deviceId: "d", issuedAt: "2020-01-01", expiresAt: operation === "refresh" ? "2020-01-01" : "2099-01-01" };
    let stored: AuthSession | null = operation === "refresh" ? session : null;
    let finishSave!: () => void;
    const saveStarted = new Promise<void>(resolveStarted => {
      finishSave = resolveStarted;
    });
    let releaseWrite!: () => void;
    const auth = new CloudAuthSession({
      getSession: async () => stored,
      saveSession: async next => { finishSave(); await new Promise<void>(resolve => { releaseWrite = resolve; }); stored = next; },
      clearSession: async () => { stored = null; },
    }, { signIn: async () => session, refresh: async () => ({ ...session, accessToken: "rotated-access", expiresAt: "2099-01-01" }), confirmEmail: async () => session, signOut: async () => {} }, "d");
    const pending = (operation === "signIn" ? auth.signIn("member@example.com", "synthetic") : operation === "refresh" ? auth.load() : auth.confirmEmail({ accessToken: "synthetic", refreshToken: "synthetic" })).catch(error => error);
    await saveStarted;
    const logout = auth.signOut();
    // An asynchronous store can finish a save after logout has started.
    await Promise.resolve(); releaseWrite();
    const outcome = await pending; await logout;
    expect(stored).toBeNull();
    if (operation === "refresh") expect(outcome).toBeNull();
    else expect(outcome).toBeInstanceOf(Error);
    expect(await auth.load()).toBeNull();
  });
  it("cancels a pending account switch without mistaking its own delayed save for another window", async () => {
    const session: AuthSession = { accessToken: "A-access", refreshToken: "A-refresh", userId: "A", deviceId: "d", issuedAt: "2020-01-01", expiresAt: "2099-01-01" };
    let stored: AuthSession | null = session;
    let releaseWrite!: () => void, markSaveStarted!: () => void;
    const saveStarted = new Promise<void>(resolve => { markSaveStarted = resolve; });
    const auth = new CloudAuthSession({ getSession: async () => stored,
      saveSession: async next => { markSaveStarted(); await new Promise<void>(resolve => { releaseWrite = resolve; }); stored = next; },
      clearSession: async () => { stored = null; },
    }, { signIn: async () => ({ ...session, userId: "B", accessToken: "B-access", refreshToken: "B-refresh" }), refresh: async () => session, signOut: async () => {} }, "d");
    await auth.load();
    const login = auth.signIn("member@example.com", "synthetic").catch(error => error);
    await saveStarted;
    const logout = auth.signOut().catch(error => error);
    releaseWrite();
    expect(await login).toBeInstanceOf(Error);
    expect(await logout).toBeUndefined();
    expect(stored).toBeNull();
  });
  it.each([400, 401, 403, 429, 503])("clears only rejected refresh credentials and preserves retryable service failures (HTTP %s)", async status => {
    const session: AuthSession = { accessToken: "expired", refreshToken: "durable", userId: "A", deviceId: "d", issuedAt: "2020-01-01", expiresAt: "2020-01-01" };
    let stored: AuthSession | null = session; let unavailable = true;
    const store = { getSession: async () => stored, saveSession: async (next: AuthSession) => { stored = next; }, clearSession: async () => { stored = null; } };
    const repository = { signIn: async () => session, signOut: async () => {}, refresh: async () => {
      if (unavailable) throw Object.assign(new Error("synthetic identity failure"), { status });
      return { ...session, accessToken: "recovered-access", expiresAt: "2099-01-01" };
    } };
    const auth = new CloudAuthSession(store, repository, "d");
    await expect(auth.load()).rejects.toMatchObject({ status });
    if ([400, 401, 403].includes(status)) expect(stored).toBeNull();
    else {
      expect(stored?.refreshToken).toBe("durable"); unavailable = false;
      const reopened = new CloudAuthSession(store, repository, "d");
      expect((await reopened.load())?.accessToken).toBe("recovered-access");
    }
  });
  it("keeps local logout complete when remote revocation is offline, then permits another login", async () => {
    const session: AuthSession = { accessToken: "access", refreshToken: "refresh", userId: "A", deviceId: "d", issuedAt: "2020-01-01", expiresAt: "2099-01-01" };
    let stored: AuthSession | null = session;
    const auth = new CloudAuthSession({ getSession: async () => stored, saveSession: async next => { stored = next; }, clearSession: async () => { stored = null; } },
      { signIn: async () => ({ ...session, userId: "B" }), refresh: async () => session, signOut: async () => { throw new TypeError("offline"); } }, "d");
    await auth.load();
    await expect(auth.signOut()).rejects.toThrow("offline");
    expect(await auth.load()).toBeNull();
    await auth.signIn("member@example.com", "synthetic");
    expect((await auth.load())?.userId).toBe("B");
  });
});
