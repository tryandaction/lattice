import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAiProviderProfile } from "@/lib/ai/provider-profiles";
import { useAiProviderProfileStore } from "@/stores/ai-provider-profile-store";
import { routeModel } from "@/lib/ai/model-router";

vi.mock("@/lib/ai/key-storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/key-storage")>("@/lib/ai/key-storage");
  return { ...actual, getProfileApiKey: vi.fn(() => "profile-secret") };
});

describe("profile-aware model router", () => {
  beforeEach(() => {
    useAiProviderProfileStore.setState({ profiles: [], activeProfileId: null, isLoading: false, isInitialized: true, error: null });
  });

  it("routes through a configured profile before legacy provider settings", () => {
    const profile = createDefaultAiProviderProfile("openrouter", { id: "team-router", name: "Team router", model: "openai/gpt-4.1-mini" });
    useAiProviderProfileStore.getState().addProfile(profile);

    const selection = routeModel("chat", {
      aiEnabled: true,
      providerId: "anthropic",
      model: null,
      temperature: 0.2,
      maxTokens: 256,
      systemPrompt: "system",
      profileId: "team-router",
    });

    expect(selection.provider.name).toBe("Team router");
    expect(selection.modelInfo.providerId).toBe("openrouter");
    expect(selection.modelInfo.model).toBe("openai/gpt-4.1-mini");
  });

  it("routes the profile default model instead of the legacy model field", () => {
    const profile = createDefaultAiProviderProfile("anthropic", { id: "anthropic-channel", model: "claude-sonnet-4-5-20250929" });
    profile.models = [
      ...profile.models,
      { id: "claude-haiku", name: "Claude Haiku", contextWindow: 200000, maxOutputTokens: 8192, enabled: true },
    ];
    profile.defaultModelId = "claude-haiku";
    profile.model = "claude-haiku";
    useAiProviderProfileStore.getState().addProfile(profile);

    const selection = routeModel("chat", {
      aiEnabled: true,
      providerId: "anthropic",
      model: null,
      temperature: 0.2,
      maxTokens: 256,
      systemPrompt: "system",
      profileId: "anthropic-channel",
    });

    expect(selection.modelInfo.model).toBe("claude-haiku");
  });
});
