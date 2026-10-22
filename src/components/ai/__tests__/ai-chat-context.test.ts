import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/types/settings";
import { createDefaultAiProviderProfile } from "@/lib/ai/provider-profiles";
import { getRequestedPdfPages, toRuntimeSettings } from "../ai-chat-context";
import { useAiProviderProfileStore } from "@/stores/ai-provider-profile-store";

describe("AI chat runtime selection", () => {
  it("recognizes requested pages without mistaking scientific measurements for page numbers", () => {
    expect(getRequestedPdfPages("比较第32页与 page 24，以及 pages 3-5 的 58 G 磁场")).toEqual([32, 24, 3, 4, 5]);
    expect(getRequestedPdfPages("58 G and 770.2 nm")).toEqual([]);
    expect(getRequestedPdfPages("pages 1-999999")).toHaveLength(16);
  });
  beforeEach(() => {
    useAiProviderProfileStore.setState({
      profiles: [],
      activeProfileId: null,
      isLoading: false,
      isInitialized: true,
      error: null,
    });
  });

  it("uses the active profile and its default model instead of stale legacy settings", () => {
    const profile = createDefaultAiProviderProfile("openrouter", {
      id: "active-profile",
      model: "vendor-model-b",
    });
    profile.models.push({
      id: "vendor-model-a",
      name: "Vendor model A",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      enabled: true,
      supportsStreaming: true,
    });
    profile.defaultModelId = "vendor-model-b";
    profile.model = "vendor-model-b";

    useAiProviderProfileStore.setState({
      profiles: [profile],
      activeProfileId: profile.id,
    });

    const runtime = toRuntimeSettings({
      ...DEFAULT_SETTINGS,
      aiEnabled: true,
      aiProvider: "ollama",
      aiModel: "stale-model-a",
    });

    expect(runtime).toMatchObject({
      profileId: "active-profile",
      providerId: "openrouter",
      model: "vendor-model-b",
    });
  });
});
