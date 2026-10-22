import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAiProviderProfile } from "../provider-profiles";
import { createProfiledProvider } from "../profiled-provider";

const { requestAiHttp } = vi.hoisted(() => ({
  requestAiHttp: vi.fn(),
}));

vi.mock("../native-http", () => ({ requestAiHttp }));

describe("profiled provider desktop transport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    requestAiHttp.mockReset();
  });

  it("routes Custom Anthropic Messages through native HTTP instead of browser fetch", async () => {
    // This test verifies routing and configured budgets, not elapsed wall time.
    // The asynchronous shared-cooldown check may otherwise consume one millisecond.
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const profile = createDefaultAiProviderProfile("custom-anthropic-messages", {
      id: "desktop-anthropic",
      baseUrl: "https://gateway.example/v1",
      model: "vendor-anthropic-model",
    });
    const browserFetch = vi.spyOn(globalThis, "fetch");
    requestAiHttp.mockResolvedValue(new Response(JSON.stringify({
      model: "vendor-anthropic-model",
      content: [{ type: "text", text: "native answer" }],
    }), { status: 200 }));
    const provider = createProfiledProvider(profile, "profile-secret");

    await expect(provider.generate([{ role: "user", content: "hi" }])).resolves.toMatchObject({ text: "native answer" });

    expect(requestAiHttp).toHaveBeenCalledWith(
      "https://gateway.example/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "profile-secret" }),
      }),
      120000,
      expect.objectContaining({ idleTimeoutMs: 120000, totalTimeoutMs: 600000, onActivity: expect.any(Function) }),
    );
    expect(browserFetch).not.toHaveBeenCalled();
  });
});
