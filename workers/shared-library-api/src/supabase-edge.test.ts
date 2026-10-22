import { afterEach, describe, expect, it, vi } from "vitest";
import { handleSupabaseEdgeRequest } from "./supabase-edge";

const base = "https://project.supabase.co/functions/v1/shared-library-api";
const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_ANON_KEY: "sb_publishable_fixture", ALLOWED_ORIGINS: "http://tauri.localhost", BLOB_BACKEND: "supabase" as const };
const token = `e30.${Buffer.from(JSON.stringify({ sub: "actor" })).toString("base64url")}.signature`;
afterEach(() => vi.restoreAllMocks());

describe("Supabase gateway for the shared cloud API", () => {
  it("preserves unauthenticated rejection and desktop preflight", async () => {
    const backend = vi.spyOn(globalThis, "fetch");
    expect((await handleSupabaseEdgeRequest(new Request(`${base}/v1/libraries`), env)).status).toBe(401);
    const response = await handleSupabaseEdgeRequest(new Request(`${base}/v1/libraries`, { method: "OPTIONS", headers: { Origin: "http://tauri.localhost" } }), env);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
    expect(backend).not.toHaveBeenCalled();
  });

  it("routes through the existing handler with the caller JWT intact", async () => {
    const backend = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    const response = await handleSupabaseEdgeRequest(new Request(`${base}/v1/libraries`, { headers: { authorization: `Bearer ${token}` } }), env);
    expect(response.status).toBe(200);
    expect(String(backend.mock.calls[0][0])).toContain("/rest/v1/libraries?");
    expect(new Headers(backend.mock.calls[0][1]?.headers).get("authorization")).toBe(`Bearer ${token}`);
  });

  it("retains the gateway prefix on protected download URLs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([{ id: "blob", storage_key: "libraries/lib/blobs/key", storage_backend: "supabase", mime_type: "text/plain" }]), { status: 200 }));
    const response = await handleSupabaseEdgeRequest(new Request(`${base}/v1/libraries/lib/blobs/blob/download-url`, { headers: { authorization: `Bearer ${token}` } }), env);
    expect((await response.json()).url).toBe(`${base}/v1/libraries/lib/blobs/blob/content`);
  });

  it("does not rewrite lookalike function routes", async () => {
    const response = await handleSupabaseEdgeRequest(new Request(`${base}-other/v1/libraries`, { headers: { authorization: `Bearer ${token}` } }), env);
    expect(response.status).toBe(404);
  });
  it("accepts the function-relative path forwarded by the hosted gateway", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    const response = await handleSupabaseEdgeRequest(new Request("https://project.supabase.co/shared-library-api/v1/libraries", { headers: { authorization: `Bearer ${token}` } }), env);
    expect(response.status).toBe(200);
  });
});
