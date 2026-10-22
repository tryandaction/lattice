import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAiProviderProfile } from "../provider-profiles";
import { requestCompletion } from "../completion-provider";
import { useAiProviderProfileStore } from "@/stores/ai-provider-profile-store";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_SETTINGS } from "@/types/settings";

vi.mock("@/lib/ai/key-storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/key-storage")>("@/lib/ai/key-storage");
  return { ...actual, getProfileApiKey: vi.fn(() => "profile-secret") };
});

describe("AI inline completion routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        aiEnabled: true,
        aiInlineCompletionEnabled: true,
        aiProvider: "openai",
        aiModel: "stale-legacy-model",
      },
      isLoading: false,
      isInitialized: true,
      error: null,
    });
    useAiProviderProfileStore.setState({
      profiles: [],
      activeProfileId: null,
      isLoading: false,
      isInitialized: true,
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the active profile endpoint and model instead of legacy completion settings", async () => {
    const profile = createDefaultAiProviderProfile("custom-openai-compatible", {
      id: "completion-gateway",
      name: "Completion gateway",
      baseUrl: "https://gateway.example/v1",
      model: "vendor-completion-model",
    });
    useAiProviderProfileStore.setState({
      profiles: [profile],
      activeProfileId: profile.id,
      isLoading: false,
      isInitialized: true,
      error: null,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      model: "vendor-completion-model",
      choices: [{ message: { content: "42" } }],
    }), { status: 200 }));

    await expect(requestCompletion("const answer = ", "", "demo.md")).resolves.toBe("42");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.example/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"model":"vendor-completion-model"'),
      }),
    );
  });
});
