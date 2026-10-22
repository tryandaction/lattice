import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/types/settings";
import { buildSystemPromptPreview, resolveSystemPrompt } from "../system-prompt-profile";

describe("system prompt profiles", () => {
  it("resolves Chat and Agent overrides independently with global fallback", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      aiSystemPrompt: "Global prompt",
      aiChatSystemPrompt: "Chat prompt",
      aiAgentSystemPrompt: "Agent prompt",
    };

    expect(resolveSystemPrompt(settings, "chat")).toBe("Chat prompt");
    expect(resolveSystemPrompt(settings, "agent")).toBe("Agent prompt");
    expect(resolveSystemPrompt({ ...settings, aiAgentSystemPrompt: "" }, "agent")).toBe("Global prompt");
  });

  it("restores the default profile and previews provider/model separately", () => {
    const preview = buildSystemPromptPreview({
      settings: { ...DEFAULT_SETTINGS, aiSystemPrompt: "Global" },
      mode: "agent",
      provider: "deepseek",
      model: "deepseek-chat",
    });

    expect(preview.prompt).toBe("Global");
    expect(preview.provider).toBe("deepseek");
    expect(preview.model).toBe("deepseek-chat");
    expect(preview.profile).toBe("agent");
  });
});
