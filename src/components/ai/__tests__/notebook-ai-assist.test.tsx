/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotebookAiAssist } from "../notebook-ai-assist";
import { useSettingsStore } from "@/stores/settings-store";
import { useAiProviderProfileStore } from "@/stores/ai-provider-profile-store";
import { createDefaultAiProviderProfile } from "@/lib/ai/provider-profiles";
import { DEFAULT_SETTINGS } from "@/types/settings";

const { runResearchAction, executeAgentTool, createAgentToolSession, agentStore } = vi.hoisted(() => ({
  runResearchAction: vi.fn(),
  executeAgentTool: vi.fn(),
  createAgentToolSession: vi.fn(() => "notebook-session"),
  agentStore: {
    getSession: vi.fn(() => ({ status: "running" })),
    failSession: vi.fn(),
    appendTrace: vi.fn(),
  },
}));

vi.mock("@/lib/ai/orchestrator", () => ({
  aiOrchestrator: { runResearchAction },
}));

vi.mock("@/lib/ai/agent-tool-broker", () => ({
  createAgentToolSession,
  executeAgentTool,
}));

vi.mock("@/stores/agent-session-store", () => ({
  useAgentSessionStore: { getState: () => agentStore },
}));

describe("NotebookAiAssist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        aiEnabled: true,
        aiProvider: "openai",
        aiModel: "legacy-model",
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
    executeAgentTool.mockResolvedValue({ status: "completed", result: { evidenceRefs: [] } });
    runResearchAction.mockResolvedValue({ text: "Generated code", model: "vendor-notebook-model", evidenceRefs: [] });
  });

  it("uses the active connection and model for notebook assistance", async () => {
    const profile = createDefaultAiProviderProfile("custom-openai-compatible", {
      id: "notebook-gateway",
      model: "vendor-notebook-model",
    });
    useAiProviderProfileStore.setState({
      profiles: [profile],
      activeProfileId: profile.id,
      isLoading: false,
      isInitialized: true,
      error: null,
    });

    render(<NotebookAiAssist cellSource="print(1)" onInsertCode={() => {}} />);
    fireEvent.click(screen.getByTitle("Generate code"));

    await waitFor(() => {
      expect(runResearchAction).toHaveBeenCalledWith(expect.objectContaining({
        settings: expect.objectContaining({
          providerId: "custom",
          model: "vendor-notebook-model",
          profileId: "notebook-gateway",
        }),
      }));
    });
  });
});
