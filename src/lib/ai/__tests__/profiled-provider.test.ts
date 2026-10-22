import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAiProviderProfile } from "../provider-profiles";
import { createProfiledProvider } from "../profiled-provider";

describe("profiled AI provider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses profile endpoint and protocol for generation", async () => {
    const profile = createDefaultAiProviderProfile("openrouter", { id: "router", model: "openai/gpt-4.1-mini" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ model: "openai/gpt-4.1-mini", choices: [{ message: { content: "Answer" } }] }), { status: 200 }));
    const provider = createProfiledProvider(profile, "secret");

    const result = await provider.generate([{ role: "user", content: "Question" }]);

    expect(result.text).toBe("Answer");
    expect(fetchMock).toHaveBeenCalledWith("https://openrouter.ai/api/v1/chat/completions", expect.objectContaining({ method: "POST" }));
  });

  it("retries transient provider failures up to the profile limit", async () => {
    const profile = createDefaultAiProviderProfile("openrouter", { id: "retry-profile", model: "openai/gpt-4.1-mini" });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("temporary outage", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "openai/gpt-4.1-mini", choices: [{ message: { content: "Recovered" } }] }), { status: 200 }));
    const provider = createProfiledProvider(profile, "secret");

    await expect(provider.generate([{ role: "user", content: "Question" }])).resolves.toMatchObject({ text: "Recovered" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels a retryable response before retrying without awaiting server shutdown", async () => {
    const profile = createDefaultAiProviderProfile("openrouter", { id: "retry-stream", model: "openai/gpt-4.1-mini" });
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const firstResponse = new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 503 });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected extra request"))
      .mockResolvedValueOnce(firstResponse)
      .mockImplementationOnce(async () => {
        expect(cancel).toHaveBeenCalledTimes(1);
        return new Response(JSON.stringify({ choices: [{ message: { content: "Recovered" } }] }), { status: 200 });
      });
    const provider = createProfiledProvider(profile, "secret");
    await expect(provider.generate([{ role: "user", content: "Question" }])).resolves.toMatchObject({ text: "Recovered" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not replace the final provider error with a retry cleanup error", async () => {
    const profile = createDefaultAiProviderProfile("openrouter", { id: "retry-cancel-failure", model: "openai/gpt-4.1-mini" });
    const cancel = vi.fn(() => Promise.reject(new Error("cleanup failed")));
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected extra request"))
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 503 }))
      .mockResolvedValueOnce(new Response("denied", { status: 403 }));
    const provider = createProfiledProvider(profile, "secret");
    await expect(provider.generate([{ role: "user", content: "Question" }])).rejects.toThrow(/403|Forbidden/i);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("discovers models and reports structured connection diagnostics", async () => {
    const profile = createDefaultAiProviderProfile("groq", { id: "groq-profile" });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "llama-3.3-70b" }] }), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    const provider = createProfiledProvider(profile, "secret");

    await expect(provider.getAvailableModels()).resolves.toEqual([expect.objectContaining({ id: "llama-3.3-70b", provider: "groq" })]);
    await expect(provider.testConnection()).resolves.toMatchObject({ ok: false, code: "forbidden", httpStatus: 403 });
  });

  it("surfaces model catalog HTTP failures instead of treating them as an empty catalog", async () => {
    const profile = createDefaultAiProviderProfile("openai-chat", { id: "catalog-failure" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("denied", { status: 403, statusText: "Forbidden" }));
    const provider = createProfiledProvider(profile, "secret");

    await expect(provider.getAvailableModels()).rejects.toThrow(/403|Forbidden/i);
  });

  it("surfaces malformed model catalog responses instead of treating them as an empty catalog", async () => {
    const profile = createDefaultAiProviderProfile("openai-chat", { id: "catalog-invalid" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ unexpected: true }), { status: 200 }));
    const provider = createProfiledProvider(profile, "secret");

    await expect(provider.getAvailableModels()).rejects.toThrow(/model catalog|protocol/i);
  });

  it("probes a non-Anthropic model directory with a GET request", async () => {
    const profile = createDefaultAiProviderProfile("openai-chat", { id: "openai-probe" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "vendor-model" }] }), { status: 200 }));
    const provider = createProfiledProvider(profile, "secret");

    await expect(provider.testConnection()).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({ method: "GET", headers: expect.objectContaining({ Authorization: "Bearer secret" }) }),
    );
  });

  it("discovers Gemini models from the native models response", async () => {
    const profile = createDefaultAiProviderProfile("gemini", { id: "gemini-profile" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      models: [{ name: "models/gemini-2.5-flash" }],
    }), { status: 200 }));
    const provider = createProfiledProvider(profile, "secret");

    await expect(provider.getAvailableModels()).resolves.toEqual([
      expect.objectContaining({ id: "gemini-2.5-flash", provider: "google" }),
    ]);
  });

  it("tests Anthropic Messages with a minimal Messages request", async () => {
    const profile = createDefaultAiProviderProfile("anthropic", { id: "anthropic-profile" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      content: [{ type: "text", text: "ok" }],
    }), { status: 200 }));
    const provider = createProfiledProvider(profile, "sk-ant-secret");

    await expect(provider.testConnection()).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("discovers models for custom Anthropic Messages connections through the Models API", async () => {
    const profile = createDefaultAiProviderProfile("custom-anthropic-messages", {
      id: "custom-anthropic-models",
      baseUrl: "https://gateway.example/v1",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "vendor-anthropic-model", display_name: "Vendor model" }],
    }), { status: 200 }));
    const provider = createProfiledProvider(profile, "secret");

    await expect(provider.getAvailableModels()).resolves.toEqual([
      expect.objectContaining({ id: "vendor-anthropic-model", provider: "custom", name: "Vendor model" }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith("https://gateway.example/v1/models", expect.objectContaining({ headers: expect.objectContaining({ "x-api-key": "secret" }) }));
  });

  it("rejects a successful HTTP response that is not valid for the selected protocol", async () => {
    const profile = createDefaultAiProviderProfile("openai-chat", { id: "invalid-probe" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>gateway</html>", { status: 200 }));
    const provider = createProfiledProvider(profile, "secret");

    await expect(provider.testConnection()).resolves.toMatchObject({ ok: false, code: "invalid_response" });
  });

  it("classifies browser fetch failures as CORS or network diagnostics", async () => {
    const profile = createDefaultAiProviderProfile("custom-openai-compatible", { id: "browser-gateway" });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const provider = createProfiledProvider(profile, "secret");

    await expect(provider.testConnection()).resolves.toMatchObject({ code: "cors_or_network" });
  });
});
