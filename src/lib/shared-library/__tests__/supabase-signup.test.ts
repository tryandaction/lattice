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


describe("cloud account error recovery", () => {
  it("keeps a temporary verification service failure distinct from an invalid or expired code", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: "unexpected_failure", message: "private upstream detail" }), { status: 503 }));
    const failure = await new SupabaseAuthRepository(connection, request).verifyEmailCode({ email: "member@example.com", token: "12345678", deviceId: "device" }).catch(error => error);
    expect(failure).toMatchObject({ status: 503, code: "unexpected_failure", message: expect.stringContaining("服务暂不可用") });
    expect(failure.message).not.toMatch(/无效|过期|重新发送|private upstream/u);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(["signIn", "signUp", "verify", "resend", "recover"] as const)("provides a safe network recovery message for %s without retrying or reflecting private upstream text", async operation => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("private upstream transport detail"));
    const repository = new SupabaseAuthRepository(connection, request);
    const result = operation === "signIn" ? repository.signIn({ email: "member@example.com", password: "synthetic-password", deviceId: "device" })
      : operation === "signUp" ? repository.signUp("member@example.com", "synthetic-password")
      : operation === "verify" ? repository.verifyEmailCode({ email: "member@example.com", token: "12345678", deviceId: "device" })
      : operation === "resend" ? repository.resendConfirmation("member@example.com")
      : repository.requestPasswordReset("member@example.com");
    const failure = await result.catch(error => error);
    expect(failure).toMatchObject({ code: "network_error", message: expect.stringContaining("网络") });
    expect(failure.message).not.toMatch(/private upstream|无效|过期|重新发送/u);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("distinguishes request timeout from invalid credentials", async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("private timeout detail", "TimeoutError"));
    await expect(new SupabaseAuthRepository(connection, request).verifyEmailCode({ email: "member@example.com", token: "12345678", deviceId: "device" })).rejects.toMatchObject({ code: "request_timeout", message: expect.stringContaining("超时") });
  });

  it.each(["email_exists", "user_already_exists"])("gives an existing account a sign-in recovery path for %s and preserves the error code", async code => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code, message: "private upstream account detail" }), { status: 422 }));
    await expect(new SupabaseAuthRepository(connection, request).signUp("member@example.com", "synthetic-password")).rejects.toMatchObject({ status: 422, code, message: expect.stringMatching(/已注册.*登录.*忘记密码/u) });
  });

  it("keeps the stable error code from legacy Supabase envelopes", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: 400, error_code: "email_not_confirmed", msg: "private upstream account detail" }), { status: 400 }));
    await expect(new SupabaseAuthRepository(connection, request).signIn({ email: "member@example.com", password: "synthetic-password", deviceId: "device" })).rejects.toMatchObject({ code: "email_not_confirmed", message: expect.stringContaining("邮箱尚未确认") });
  });

  it("preserves signup and resend rate-limit codes without reflecting upstream messages", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ error_code: "over_email_send_rate_limit", msg: "private upstream detail" }), { status: 429 }));
    const repository = new SupabaseAuthRepository(connection, request);
    await expect(repository.signUp("member@example.com", "synthetic-password")).rejects.toMatchObject({ status: 429, code: "over_email_send_rate_limit", message: expect.stringContaining("稍后") });
    await expect(repository.resendConfirmation("member@example.com")).rejects.toMatchObject({ status: 429, code: "over_email_send_rate_limit", message: expect.stringContaining("稍后") });
  });

  it("reads a stable auth error code from the response header when the body is not JSON", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("private upstream gateway page", { status: 502, headers: { "x-sb-error-code": "unexpected_failure" } }));
    await expect(new SupabaseAuthRepository(connection, request).verifyEmailCode({ email: "member@example.com", token: "12345678", deviceId: "device" })).rejects.toMatchObject({ status: 502, code: "unexpected_failure", message: expect.stringContaining("服务暂不可用") });
  });
});


describe("verified email session persistence", () => {
  it.each(["{}", "not-json"])("recovers with password login after a successful verify response has an unusable session: %s", async body => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    await expect(new SupabaseAuthRepository(connection, request).verifyEmailCode({ email: "member@example.com", token: "12345678", deviceId: "device" })).rejects.toMatchObject({ code: "email_verified_connection_failed", message: expect.stringContaining("邮箱已验证") });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("marks the code consumed if session persistence fails after successful verification", async () => {
    const { CloudAuthSession } = await import("../supabase-auth");
    const session = { userId: "verified-user", deviceId: "device", accessToken: "fixture-access", refreshToken: "fixture-refresh", issuedAt: "2026-11-02T00:00:00Z", expiresAt: "2026-11-02T01:00:00Z" };
    const verifyEmailCode = vi.fn().mockResolvedValue(session);
    const auth = new CloudAuthSession({ getSession: async () => null, saveSession: async () => { throw new Error("private storage detail"); }, clearSession: async () => {} }, { verifyEmailCode, signIn: vi.fn(), refresh: vi.fn(), signOut: vi.fn() }, "device");
    const failure = await auth.verifyEmailCode("member@example.com", "12345678").catch(error => error);
    expect(failure).toMatchObject({ code: "email_verified_connection_failed", message: expect.stringContaining("邮箱已验证") });
    expect(failure.message).toMatch(/密码登录/u);
    expect(failure.message).not.toMatch(/private storage|重新发送/u);
    expect(verifyEmailCode).toHaveBeenCalledTimes(1);
  });

  it("preserves a rejected verification code without treating it as consumed", async () => {
    const { CloudAuthSession } = await import("../supabase-auth");
    const failure = Object.assign(new Error("验证码无效或已过期。"), { code: "otp_expired", status: 403 });
    const saveSession = vi.fn();
    const auth = new CloudAuthSession({ getSession: async () => null, saveSession, clearSession: async () => {} }, { verifyEmailCode: vi.fn().mockRejectedValue(failure), signIn: vi.fn(), refresh: vi.fn(), signOut: vi.fn() }, "device");
    await expect(auth.verifyEmailCode("member@example.com", "12345678")).rejects.toBe(failure);
    expect(saveSession).not.toHaveBeenCalled();
  });

  it("marks a verified code consumed after identity cancellation without saving the stale identity", async () => {
    const { CloudAuthSession } = await import("../supabase-auth");
    let completeVerification!: (session: import("../auth").AuthSession) => void;
    const saveSession = vi.fn();
    const auth = new CloudAuthSession({ getSession: async () => null, saveSession, clearSession: async () => {} }, { verifyEmailCode: vi.fn().mockReturnValue(new Promise(resolve => { completeVerification = resolve; })), signIn: vi.fn(), refresh: vi.fn(), signOut: vi.fn() }, "device");
    const pending = auth.verifyEmailCode("member@example.com", "12345678").catch(error => error);
    auth.invalidate();
    completeVerification({ userId: "verified-user", deviceId: "device", accessToken: "fixture-access", refreshToken: "fixture-refresh", issuedAt: "2026-11-02T00:00:00Z", expiresAt: "2026-11-02T01:00:00Z" });
    const failure = await pending;
    expect(failure.message).toContain("邮箱已验证");
    expect(failure.code).toBe("email_verified_connection_failed");
    expect(saveSession).not.toHaveBeenCalled();
  });
});
