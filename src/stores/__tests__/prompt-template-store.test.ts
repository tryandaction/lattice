/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/lib/storage-adapter", () => ({
  getStorageAdapter: () => storage,
}));

import { usePromptTemplateStore } from "../prompt-template-store";

describe("prompt-template-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTemplateStore.setState({
      isLoaded: true,
      userTemplates: [],
      runs: [],
      workspacePreferences: {},
    });
  });

  it("creates and persists a user template", async () => {
    const template = usePromptTemplateStore.getState().upsertTemplate({
      title: "My Prompt",
      description: "Custom chat template",
      category: "writing",
      userPrompt: "Rewrite this text",
      surfaces: ["chat"],
      outputMode: "chat",
    });

    expect(template.id).toContain("prompt-template");
    expect(usePromptTemplateStore.getState().userTemplates[0]?.title).toBe("My Prompt");
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(storage.set).toHaveBeenCalled();
  });

  it("records recent template usage per workspace key", () => {
    const template = usePromptTemplateStore.getState().upsertTemplate({
      title: "Workspace Prompt",
      category: "planning",
      userPrompt: "Plan this work",
      surfaces: ["chat"],
      outputMode: "proposal",
    });

    usePromptTemplateStore.getState().rememberTemplateUsage(template.id, "chat", {
      workspaceKey: "web:vault",
      workspaceRootPath: "C:/vault",
    });

    expect(usePromptTemplateStore.getState().getRecentTemplates("chat", {
      workspaceKey: "web:vault",
      workspaceRootPath: "C:/vault",
    }).map((item) => item.id)).toEqual([template.id]);
  });

  it("falls back to legacy path preferences for recent templates", () => {
    const template = usePromptTemplateStore.getState().upsertTemplate({
      title: "Legacy Workspace Prompt",
      category: "planning",
      userPrompt: "Plan this work",
      surfaces: ["chat"],
      outputMode: "proposal",
    });

    usePromptTemplateStore.setState({
      workspacePreferences: {
        "C:/vault": {
          recentTemplateIds: [template.id],
          defaultTemplatesBySurface: {
            chat: template.id,
          },
        },
      },
    });

    expect(usePromptTemplateStore.getState().getRecentTemplates("chat", {
      workspaceKey: "web:vault",
      workspaceRootPath: "C:/vault",
    }).map((item) => item.id)).toEqual([template.id]);
  });

  it("records prompt runs and updates result targets", () => {
    const runId = usePromptTemplateStore.getState().addRun({
      templateId: "template-1",
      surface: "chat",
      renderedPrompt: "Prompt",
      renderedSystemPrompt: "System",
      contextSummary: "Current File: ready",
      outputMode: "chat",
    });

    usePromptTemplateStore.getState().updateRunResult(runId, {
      resultMessageId: "message-1",
    });

    expect(usePromptTemplateStore.getState().runs[0]).toEqual(
      expect.objectContaining({
        id: runId,
        resultMessageId: "message-1",
      }),
    );
  });
});
