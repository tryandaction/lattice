import { describe, expect, it } from "vitest";
import {
  AI_PROVIDER_PRESETS,
  classifyAiConnectionError,
  createDefaultAiProviderProfile,
  getAiProviderPreset,
} from "../provider-profiles";

describe("AI provider profiles", () => {
  it("ships broad cloud, local, compatible and protocol-specific presets", () => {
    const ids = AI_PROVIDER_PRESETS.map((preset) => preset.id);

    expect(ids).toEqual(expect.arrayContaining([
      "openai-chat",
      "openai-responses",
      "anthropic",
      "gemini",
      "ollama-native",
      "openrouter",
      "groq",
      "together",
      "fireworks",
      "siliconflow",
      "azure-openai",
      "custom-openai-compatible",
      "custom-anthropic-messages",
      "custom-anthropic-messages",
    ]));
    expect(getAiProviderPreset("openai-responses")?.protocol).toBe("openai-responses");
    expect(getAiProviderPreset("ollama-native")?.authMode).toBe("none");
    expect(getAiProviderPreset("anthropic")?.defaultModels).toHaveLength(0);
    expect(getAiProviderPreset("custom-anthropic-messages")?.defaultModels).toHaveLength(0);
    expect(createDefaultAiProviderProfile("custom-anthropic-messages", { id: "custom-anthropic" })).toMatchObject({
      protocol: "anthropic-messages",
      model: null,
      models: [],
    });
    expect(getAiProviderPreset("azure-openai")).toMatchObject({
      defaultBaseUrl: "https://YOUR_RESOURCE.openai.azure.com/openai/v1",
      defaultModel: null,
      authMode: "api-key",
    });
  });

  it("creates independent profile metadata without secret material", () => {
    const profile = createDefaultAiProviderProfile("openrouter", {
      name: "Team gateway",
      model: "openai/gpt-4.1-mini",
    });

    expect(profile).toMatchObject({
      id: "openrouter",
      name: "Team gateway",
      provider: "openrouter",
      protocol: "openai-chat-completions",
      model: "openai/gpt-4.1-mini",
      authMode: "bearer",
      timeoutMs: 30000,
      maxRetries: 2,
    });
    expect(JSON.stringify(profile)).not.toContain("apiKey");
  });


  it("keeps the channel kind independent from protocol and model vendor", () => {
    expect(createDefaultAiProviderProfile("openai-chat").channel).toBe("official");
    expect(createDefaultAiProviderProfile("custom-anthropic-messages")).toMatchObject({
      channel: "custom",
      protocol: "anthropic-messages",
      provider: "custom",
    });
  });

  it("starts every new connection with an empty model catalog until discovery or manual entry", () => {
    for (const preset of AI_PROVIDER_PRESETS) {
      const profile = createDefaultAiProviderProfile(preset.id);
      expect(profile.models, preset.id).toEqual([]);
      expect(profile.model, preset.id).toBeNull();
      expect(profile.defaultModelId, preset.id).toBeNull();
    }
  });

  it("classifies connection failures without echoing credentials", () => {
    expect(classifyAiConnectionError({ status: 401 })).toMatchObject({ code: "unauthorized", httpStatus: 401 });
    expect(classifyAiConnectionError({ status: 429 })).toMatchObject({ code: "rate_limited", httpStatus: 429 });
    expect(classifyAiConnectionError({ error: new TypeError("Failed to fetch") })).toMatchObject({ code: "cors_or_network" });
    expect(classifyAiConnectionError({ status: 200, responseBody: "<html>gateway login</html>" })).toMatchObject({ code: "protocol_mismatch" });
    const result = classifyAiConnectionError({ error: new Error("token=secret-token") });
    expect(result.message).not.toContain("secret-token");
    expect(result.diagnostics?.join(" ")).not.toContain("secret-token");
  });
});
