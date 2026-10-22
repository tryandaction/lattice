import type { AppSettings } from "@/types/settings";

export type SystemPromptMode = "chat" | "agent";

export interface SystemPromptPreview {
  profile: SystemPromptMode;
  prompt: string;
  provider: string | null;
  model: string | null;
}

export function resolveSystemPrompt(
  settings: Pick<AppSettings, "aiSystemPrompt" | "aiChatSystemPrompt" | "aiAgentSystemPrompt">,
  mode: SystemPromptMode,
): string {
  const override = mode === "agent" ? settings.aiAgentSystemPrompt : settings.aiChatSystemPrompt;
  return override?.trim() || settings.aiSystemPrompt?.trim() || "You are a helpful research assistant in Lattice, a scientific workbench.";
}

export function buildSystemPromptPreview(input: {
  settings: Pick<AppSettings, "aiSystemPrompt" | "aiChatSystemPrompt" | "aiAgentSystemPrompt"> & { aiProvider?: string | null; aiModel?: string | null };
  mode: SystemPromptMode;
  provider?: string | null;
  model?: string | null;
}): SystemPromptPreview {
  return {
    profile: input.mode,
    prompt: resolveSystemPrompt(input.settings, input.mode),
    provider: input.provider ?? input.settings.aiProvider ?? null,
    model: input.model ?? input.settings.aiModel ?? null,
  };
}
