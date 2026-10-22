import { describe, expect, it, vi } from "vitest";
import { readCloudEmailCallback, findEmailCallbackConnection } from "../email-confirmation";
import { CloudAuthSession, SupabaseAuthRepository } from "../supabase-auth";
import type { AuthSession } from "../auth";

const connection = { id: "managed", name: "Cloud", apiUrl: "https://api.example.com", supabaseUrl: "https://project.supabase.co", publicKey: "sb_publishable_fixture", maxFileBytes: 5242880 };
const accessToken = `header.${btoa(JSON.stringify({ iss: `${connection.supabaseUrl}/auth/v1` }))}.signature`;
const tokens = { accessToken, refreshToken: "synthetic-refresh" };
const session: AuthSession = { accessToken: "verified-access", refreshToken: "verified-refresh", userId: "confirmed-user", deviceId: "device", issuedAt: "2026-10-15", expiresAt: "2099-01-01" };

describe("cloud email confirmation return", () => {
  it("extracts a signup return and removes credentials while retaining the cloud invitation", () => {
    const input = `https://app.example/?library=lib#access_token=${accessToken}&refresh_token=synthetic-refresh&type=signup&expires_in=3600&invite=invitation&library=lib`;
    const result = readCloudEmailCallback(input);
    expect(result.callback).toEqual({ kind: "session", ...tokens });
    expect(new URL(result.cleanUrl).searchParams.get("library")).toBe("lib");
    expect(new URLSearchParams(new URL(result.cleanUrl).hash.slice(1)).get("invite")).toBe("invitation");
    expect(result.cleanUrl).not.toMatch(/access_token|refresh_token|expires_in|signup/);
  });
  it("leaves ordinary headings and invitation-only URLs untouched", () => {
    for (const url of ["https://app.example/#methods", "https://app.example/#invite=secret&library=lib"]) {
      expect(readCloudEmailCallback(url)).toEqual({ callback: null, cleanUrl: url });
    }
    expect(readCloudEmailCallback("https://app.example/?error_code=otp_expired#methods").cleanUrl).toBe("https://app.example/#methods");
  });
  it("shows a fixed expiry message without reflecting upstream descriptions or tokens", () => {
    const result = readCloudEmailCallback("https://app.example/?source=cloud#error=access_denied&error_code=otp_expired&error_description=private-secret");
    expect(result.callback).toEqual({ kind: "error", message: expect.stringContaining("已过期或已使用"), messageKey: "cloud.email.expired" });
    expect(JSON.stringify(result)).not.toContain("private-secret");
    expect(result.cleanUrl).toBe("https://app.example/?source=cloud");
  });
  it("removes Supabase's empty callback marker from a real expired redirect", () => {
    const result = readCloudEmailCallback("https://app.example/#error=access_denied&error_code=otp_expired&error_description=Link+is+invalid&sb=");
    expect(result.callback).toMatchObject({ kind: "error", message: expect.stringContaining("已过期或已使用") });
    expect(result.cleanUrl).toBe("https://app.example/");
  });
  it("does not treat incomplete or password recovery credentials as signup success", () => {
    expect(readCloudEmailCallback("https://app.example/#access_token=partial&type=signup").callback?.kind).toBe("error");
    expect(readCloudEmailCallback(`https://app.example/#access_token=${accessToken}&refresh_token=r&type=recovery`).callback?.kind).toBe("error");
  });
  it("only selects an already configured service matching the token issuer", () => {
    expect(findEmailCallbackConnection(tokens, [connection])).toBe(connection);
    expect(findEmailCallbackConnection({ ...tokens, accessToken: `header.${btoa(JSON.stringify({ iss: "https://unknown.example/auth/v1" }))}.signature` }, [connection])).toBeNull();
    expect(findEmailCallbackConnection({ ...tokens, accessToken: "invalid" }, [connection])).toBeNull();
  });
  it("validates the access token and rotates the refresh token before persisting a session", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "confirmed-user", email_confirmed_at: "2026-10-15T00:00:00Z" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "verified-access", refresh_token: "verified-refresh", expires_in: 3600, user: { id: "confirmed-user" } })));
    let stored: AuthSession | null = null;
    const auth = new CloudAuthSession({ getSession: async () => stored, saveSession: async value => { stored = value; }, clearSession: async () => { stored = null; } }, new SupabaseAuthRepository(connection, request), "device");
    await auth.confirmEmail(tokens);
    expect(request.mock.calls[0][0]).toBe(`${connection.supabaseUrl}/auth/v1/user`);
    expect(new Headers(request.mock.calls[0][1]?.headers).get("authorization")).toBe(`Bearer ${accessToken}`);
    expect(stored).toMatchObject({ userId: "confirmed-user", accessToken: "verified-access", refreshToken: "verified-refresh", deviceId: "device" });
  });
  it("does not erase a working session when the email return is invalid or belongs to another issuer", async () => {
    let stored: AuthSession | null = session;
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 401 }));
    const auth = new CloudAuthSession({ getSession: async () => stored, saveSession: async value => { stored = value; }, clearSession: async () => { stored = null; } }, new SupabaseAuthRepository(connection, request), "device");
    await expect(auth.confirmEmail(tokens)).rejects.toThrow("确认");
    expect(stored).toEqual(session);
    await expect(new SupabaseAuthRepository(connection, request).confirmEmail({ ...tokens, accessToken: "wrong-issuer" }, "device")).rejects.toThrow("云服务");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not persist an unconfirmed identity or mismatched refresh session", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "confirmed-user" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "confirmed-user", email_confirmed_at: "2026-10-15" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "other-access", refresh_token: "other-refresh", expires_in: 3600, user: { id: "other-user" } })));
    const repository = new SupabaseAuthRepository(connection, request);
    await expect(repository.confirmEmail(tokens, "device")).rejects.toThrow("尚未确认");
    await expect(repository.confirmEmail(tokens, "device")).rejects.toThrow("身份不一致");
  });
  it("ignores a delayed confirmation when the identity has been cancelled", async () => {
    let resolve!: (value: AuthSession) => void;
    const saveSession = vi.fn();
    const auth = new CloudAuthSession({ getSession: async () => null, saveSession, clearSession: vi.fn() }, { signIn: vi.fn(), refresh: vi.fn(), signOut: vi.fn(), confirmEmail: () => new Promise<AuthSession>(done => { resolve = done; }) }, "device");
    const pending = auth.confirmEmail(tokens);
    auth.invalidate(); resolve(session);
    await expect(pending).rejects.toThrow("已取消");
    expect(saveSession).not.toHaveBeenCalled();
  });
});
