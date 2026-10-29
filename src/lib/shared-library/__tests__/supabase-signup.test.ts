import { describe, expect, it, vi } from "vitest";
import { SupabaseAuthRepository } from "../supabase-auth";

const connection = { id: "managed", name: "Cloud", apiUrl: "https://api.example.com", supabaseUrl: "https://project.supabase.co", publicKey: "sb_publishable_fixture", maxFileBytes: 5242880 };
describe("cloud account registration", () => {
  it("accepts the raw GoTrue user response when email confirmation is required", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "new", aud: "authenticated", email: "member@example.com", confirmation_sent_at: "2026-10-13T00:00:00Z" }), { status: 200 }));
    await expect(new SupabaseAuthRepository(connection, request).signUp("member@example.com", "test-password")).resolves.toEqual({ confirmationRequired: true, confirmationSent: true });
  });
  it("uses only the public key and requires email confirmation before sign-in", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ user: { id: "new" }, session: null }), { status: 200 }));
    const result = await new SupabaseAuthRepository(connection, request).signUp("member@example.com", "test-password");
    expect(result).toEqual({ confirmationRequired: true, confirmationSent: false });
    expect(request.mock.calls[0][0]).toBe(`${connection.supabaseUrl}/auth/v1/signup`);
    const init = request.mock.calls[0][1]!;
    expect(new Headers(init.headers).get("apikey")).toBe(connection.publicKey);
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    expect(JSON.parse(String(init.body))).toEqual({ email: "member@example.com", password: "test-password" });
  });
  it("does not show registration success when email delivery fails", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: "email_address_not_authorized", msg: "vendor detail" }), { status: 400 }));
    await expect(new SupabaseAuthRepository(connection, request).signUp("member@example.com", "test-password")).rejects.toThrow("注册邮件");
  });
  it("preserves rate limiting as a useful retry message", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(new SupabaseAuthRepository(connection, request).signUp("member@example.com", "test-password")).rejects.toThrow("稍后");
  });
  it("distinguishes an unconfirmed email from an invalid password without reflecting upstream text", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error_code: "email_not_confirmed", msg: "private upstream detail" }), { status: 400 }));
    await expect(new SupabaseAuthRepository(connection, request).signIn({ email: "member@example.com", password: "test-password", deviceId: "device" })).rejects.toMatchObject({ message: expect.stringContaining("邮箱尚未确认"), code: "email_not_confirmed" });
  });
  it("resends a signup confirmation only through an explicit request using the public key", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    await new SupabaseAuthRepository(connection, request).resendConfirmation("member@example.com", "https://lattice-apq.pages.dev/");
    expect(request.mock.calls[0][0]).toBe(`${connection.supabaseUrl}/auth/v1/resend?redirect_to=https%3A%2F%2Flattice-apq.pages.dev%2F`);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ type: "signup", email: "member@example.com" });
    expect(new Headers(request.mock.calls[0][1]?.headers).get("apikey")).toBe(connection.publicKey);
  });

  it("sends registration confirmation back to the official web app", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "new", confirmation_sent_at: "2026-10-29T00:00:00Z" }), { status: 200 }));
    await new SupabaseAuthRepository(connection, request).signUp("member@example.com", "test-password", "https://lattice-apq.pages.dev/");
    expect(request.mock.calls[0][0]).toBe(`${connection.supabaseUrl}/auth/v1/signup?redirect_to=https%3A%2F%2Flattice-apq.pages.dev%2F`);
  });

  it("verifies the configured eight-digit signup code and returns a device-bound session", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ access_token: "email-code-access", refresh_token: "email-code-refresh", expires_in: 3600, user: { id: "verified-user" } }), { status: 200 }));
    const session = await new SupabaseAuthRepository(connection, request).verifyEmailCode({ email: "member@example.com", token: "12345678", deviceId: "device" });
    expect(request.mock.calls[0][0]).toBe(`${connection.supabaseUrl}/auth/v1/verify`);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ email: "member@example.com", token: "12345678", type: "email" });
    expect(new Headers(request.mock.calls[0][1]?.headers).get("apikey")).toBe(connection.publicKey);
    expect(new Headers(request.mock.calls[0][1]?.headers).has("authorization")).toBe(false);
    expect(session).toMatchObject({ userId: "verified-user", accessToken: "email-code-access", refreshToken: "email-code-refresh", deviceId: "device" });
  });

  it("rejects an invalid email code without reflecting upstream details", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error_code: "otp_expired", msg: "private upstream text" }), { status: 403 }));
    await expect(new SupabaseAuthRepository(connection, request).verifyEmailCode({ email: "member@example.com", token: "12345678", deviceId: "device" })).rejects.toMatchObject({ message: expect.stringContaining("验证码"), code: "otp_expired", status: 403 });
  });

  it("rejects a code whose length differs from the configured eight digits before making a request", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(new SupabaseAuthRepository(connection, request).verifyEmailCode({ email: "member@example.com", token: "123456", deviceId: "device" })).rejects.toMatchObject({ code: "otp_invalid" });
    expect(request).not.toHaveBeenCalled();
  });
});
