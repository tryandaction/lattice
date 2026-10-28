import { describe, expect, it, vi } from "vitest";
import { getCloudAuthRedirectUrl, readCloudEmailCallback } from "../email-confirmation";
import { SupabaseAuthRepository } from "../supabase-auth";
import { LATTICE_WEB_URL } from "@/lib/product-links";

const connection = { id: "managed", name: "Cloud", apiUrl: "https://api.example.com", supabaseUrl: "https://project.supabase.co", publicKey: "sb_publishable_fixture", maxFileBytes: 5242880 };
const tokens = { accessToken: `header.${btoa(JSON.stringify({ iss: `${connection.supabaseUrl}/auth/v1` }))}.signature`, refreshToken: "recovery-refresh" };

describe("cloud account password recovery", () => {
  it("keeps recovery distinct from sign-in and immediately removes recovery credentials", () => {
    const result = readCloudEmailCallback(`https://app.example/#access_token=${tokens.accessToken}&refresh_token=recovery-refresh&type=recovery`);
    expect(result.callback).toEqual({ kind: "recovery", ...tokens });
    expect(result.cleanUrl).toBe("https://app.example/");
  });

  it("uses a clean app return URL without forwarding private invitation or auth fields", () => {
    expect(getCloudAuthRedirectUrl("https://app.example/workspace?invite=private&redirect_to=https://other.example/#access_token=private")).toBe("https://app.example/workspace");
    expect(getCloudAuthRedirectUrl("http://tauri.localhost/")).toBe(LATTICE_WEB_URL);
    expect(getCloudAuthRedirectUrl("tauri://localhost/")).toBe(LATTICE_WEB_URL);
    expect(getCloudAuthRedirectUrl("https://user:private@app.example/")).toBeUndefined();
    expect(getCloudAuthRedirectUrl("javascript:alert(1)")).toBeUndefined();
  });

  it("sends recovery mail with the public key and a clean trusted app URL", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    await new SupabaseAuthRepository(connection, request).requestPasswordReset("member@example.com", "https://app.example/?invite=private#secret");
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://project.supabase.co/auth/v1/recover?redirect_to=https%3A%2F%2Fapp.example%2F");
    expect(JSON.parse(String(init?.body))).toEqual({ email: "member@example.com" });
    expect(new Headers(init?.headers).get("apikey")).toBe(connection.publicKey);
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  });

  it("returns signup and resent confirmation to the clean app URL", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ id: "new-user" })));
    const repository = new SupabaseAuthRepository(connection, request);
    await repository.signUp("member@example.com", "synthetic-password", "https://app.example/workspace?private=value");
    await repository.resendConfirmation("member@example.com", "https://app.example/workspace#private");
    expect(request.mock.calls.map(([url]) => String(url))).toEqual([
      "https://project.supabase.co/auth/v1/signup?redirect_to=https%3A%2F%2Fapp.example%2Fworkspace",
      "https://project.supabase.co/auth/v1/resend?redirect_to=https%3A%2F%2Fapp.example%2Fworkspace",
    ]);
  });

  it("validates the recovery identity and updates only that session without changing another account", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "recovery-user" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "recovery-user" })));
    const result = await new SupabaseAuthRepository(connection, request).resetPassword(tokens, "updated-password");
    expect(result).toBeUndefined();
    expect(request.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
      ["https://project.supabase.co/auth/v1/user", "GET"],
      ["https://project.supabase.co/auth/v1/user", "PUT"],
    ]);
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ password: "updated-password" });
    expect(new Headers(request.mock.calls[1][1]?.headers).get("authorization")).toBe(`Bearer ${tokens.accessToken}`);
  });

  it("rejects untrusted issuers, expired recovery and short passwords before updating any account", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 401 }));
    const repository = new SupabaseAuthRepository(connection, request);
    await expect(repository.resetPassword({ ...tokens, accessToken: "unknown" }, "updated-password")).rejects.toThrow("云服务");
    await expect(repository.resetPassword(tokens, "short")).rejects.toThrow("8");
    expect(request).not.toHaveBeenCalled();
    await expect(repository.resetPassword(tokens, "updated-password")).rejects.toThrow("链接");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps delivery failures retryable without disclosing account existence or upstream details", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ msg: "private-upstream-account-detail" }), { status: 429 }));
    await expect(new SupabaseAuthRepository(connection, request).requestPasswordReset("member@example.com")).rejects.toThrow("稍后");
  });
});
