import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeModel } from "../model-router";
import { clearProviderOverrides, setProviderOverride } from "../providers";
import { createDefaultAiProviderProfile } from "../provider-profiles";
import { useAiProviderProfileStore } from "@/stores/ai-provider-profile-store";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_SETTINGS } from "@/types/settings";
import type { AiProvider } from "../types";

const legacyProvider: AiProvider = {
  id: "openai",
  name: "Legacy OpenAI",
  isConfigured: () => true,
  testConnection: vi.fn(async () => ({ ok: true })),
  getAvailableModels: vi.fn(async () => []),
  generate: vi.fn(async () => ({ text: "answer", model: "legacy-default" })),
  stream: vi.fn(async function* () { yield { type: "done" as const }; }),
  estimateTokens: (text) => Math.ceil(text.length / 4),
};

describe("AI model router", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, aiEnabled: true, aiProvider: "openai", aiModel: null },
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
    setProviderOverride("openai", legacyProvider);
  });

  afterEach(() => {
    clearProviderOverrides();
  });

  it("does not let a legacy provider inject a default model when none is selected", () => {
    expect(() => routeModel("chat", {
      ...DEFAULT_SETTINGS,
      aiEnabled: true,
      providerId: "openai",
      model: null,
      temperature: 0.7,
      maxTokens: 4096,
      systemPrompt: "system",
      preferLocal: false,
      agentOmittedSummaryEnabled: false,
    })).toThrow(/No AI model configured/i);
  });

  it("does not silently fall back to a different provider when the active profile is unavailable", () => {
    const profile = {
      ...createDefaultAiProviderProfile("custom-openai-compatible", {
        id: "unavailable-profile",
        model: "vendor-model",
      }),
      name: "Unavailable gateway",
    };
    useAiProviderProfileStore.setState({
      profiles: [profile],
      activeProfileId: profile.id,
      isLoading: false,
      isInitialized: true,
      error: null,
    });

    expect(() => routeModel("chat", {
      ...DEFAULT_SETTINGS,
      aiEnabled: true,
      providerId: "custom",
      model: "vendor-model",
      temperature: 0.7,
      maxTokens: 4096,
      systemPrompt: "system",
      preferLocal: false,
      agentOmittedSummaryEnabled: false,
      profileId: profile.id,
    })).toThrow(/Unavailable gateway|credentials|configured/i);
    expect(legacyProvider.generate).not.toHaveBeenCalled();
  });
});
