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

const runPromptTemplate = vi.fn();

vi.mock("@/lib/storage-adapter", () => ({
  getStorageAdapter: () => storage,
}));

vi.mock("@/lib/prompt/executor", () => ({
  runPromptTemplate: (...args: unknown[]) => runPromptTemplate(...args),
}));

import { executePromptTemplateForSurface } from "@/lib/prompt/surface-actions";
import type { PromptTemplate } from "@/lib/prompt/types";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useAiWorkbenchStore } from "@/stores/ai-workbench-store";
import { usePromptTemplateStore } from "@/stores/prompt-template-store";

const template: PromptTemplate = {
  id: "template-1",
  title: "Prompt",
  description: "",
  category: "reading" as const,
  userPrompt: "Prompt body",
  surfaces: ["selection", "evidence"],
  outputMode: "chat" as const,
  requiredContext: [],
  optionalContext: [],
  version: 1,
  createdAt: 1,
  updatedAt: 1,
};

describe("executePromptTemplateForSurface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAiChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isOpen: false,
      isGenerating: false,
      abortController: null,
    });
    useAiWorkbenchStore.setState({
      drafts: [],
      proposals: [],
      highlightedProposalId: null,
    });
    usePromptTemplateStore.setState({
      isLoaded: true,
      userTemplates: [],
      runs: [],
      workspacePreferences: {},
    });
  });

  it("routes chat output into AI chat and records PromptRun result", async () => {
    runPromptTemplate.mockResolvedValue({
      outputMode: "chat",
      rendered: {
        renderedPrompt: "Rendered prompt",
        contextSummary: "summary",
        missingRequiredContext: [],
        missingOptionalContext: [],
        values: {},
      },
      chatResult: {
        text: "Answer",
        evidenceRefs: [],
        context: { nodes: [], prompt: "", evidenceRefs: [], truncated: false },
        model: {
          providerId: "openai",
          providerName: "OpenAI",
          model: "gpt-test",
          source: "cloud",
        },
        followUpActions: [],
      },
    });

    const result = await executePromptTemplateForSurface({
      template,
      surface: "selection",
      settings: {
        aiEnabled: true,
        providerId: "openai",
        model: "gpt-test",
        temperature: 0.2,
        maxTokens: 1000,
        systemPrompt: "",
      },
      contextValues: {},
      renderedPrompt: "Rendered prompt",
      contextSummary: "summary",
    });

    expect(result.kind).toBe("chat");
    expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.content).toBe("Answer");
    expect(usePromptTemplateStore.getState().runs[0]?.resultMessageId).toBeTruthy();
  });

  it("routes draft output into workbench drafts", async () => {
    runPromptTemplate.mockResolvedValue({
      outputMode: "draft",
      rendered: {
        renderedPrompt: "Rendered prompt",
        contextSummary: "summary",
        missingRequiredContext: [],
        missingOptionalContext: [],
        values: {},
      },
      draft: {
        title: "Draft title",
        content: "Draft body",
      },
      chatResult: {
        text: "Draft body",
        evidenceRefs: [],
        context: { nodes: [], prompt: "", evidenceRefs: [], truncated: false },
        model: {
          providerId: "openai",
          providerName: "OpenAI",
          model: "gpt-test",
          source: "cloud",
        },
        followUpActions: [],
        draftSuggestion: {
          type: "paper_note",
          title: "Draft title",
        },
      },
    });

    const result = await executePromptTemplateForSurface({
      template: { ...template, outputMode: "draft" },
      surface: "evidence",
      settings: {
        aiEnabled: true,
        providerId: "openai",
        model: "gpt-test",
        temperature: 0.2,
        maxTokens: 1000,
        systemPrompt: "",
      },
      contextValues: {},
      renderedPrompt: "Rendered prompt",
      contextSummary: "summary",
    });

    expect(result.kind).toBe("draft");
    expect(useAiWorkbenchStore.getState().drafts[0]?.title).toBe("Draft title");
    expect(usePromptTemplateStore.getState().runs[0]?.resultDraftId).toBeTruthy();
  });

  it("routes proposal output into workbench proposals", async () => {
    runPromptTemplate.mockResolvedValue({
      outputMode: "proposal",
      rendered: {
        renderedPrompt: "Rendered prompt",
        contextSummary: "summary",
        missingRequiredContext: [],
        missingOptionalContext: [],
        values: {},
      },
      proposal: {
        id: "proposal-1",
        summary: "Proposal title",
        steps: [],
        requiredApprovals: [],
        plannedWrites: [],
        sourceRefs: [],
        status: "pending",
        confirmedApprovals: [],
        approvedWrites: [],
        generatedDraftTargets: [],
        createdAt: Date.now(),
      },
    });

    const result = await executePromptTemplateForSurface({
      template: { ...template, outputMode: "proposal" },
      surface: "selection",
      settings: {
        aiEnabled: true,
        providerId: "openai",
        model: "gpt-test",
        temperature: 0.2,
        maxTokens: 1000,
        systemPrompt: "",
      },
      contextValues: {},
      renderedPrompt: "Rendered prompt",
      contextSummary: "summary",
    });

    expect(result.kind).toBe("proposal");
    expect(useAiWorkbenchStore.getState().proposals[0]?.summary).toBe("Proposal title");
    expect(usePromptTemplateStore.getState().runs[0]?.resultProposalId).toBe("proposal-1");
  });
});
