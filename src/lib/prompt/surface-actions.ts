import { useAiChatStore } from "@/stores/ai-chat-store";
import { usePromptTemplateStore } from "@/stores/prompt-template-store";
import { runPromptTemplate } from "@/lib/prompt/executor";
import { executeUserApprovedAgentTool } from "@/lib/ai/agent-tool-broker";
import type {
  AiChatRequest,
  AiReferenceInput,
  AiRuntimeSettings,
  SelectionAiOrigin,
} from "@/lib/ai/types";
import type {
  PromptContextValues,
  PromptSurface,
  PromptTemplate,
} from "@/lib/prompt/types";
import type { Locale } from "@/types/settings";

export interface PromptSurfaceExecutionInput {
  template: PromptTemplate;
  surface: PromptSurface;
  settings: AiRuntimeSettings;
  contextValues: PromptContextValues;
  workspaceKey?: string | null;
  workspaceRootPath?: string | null;
  renderedPrompt: string;
  renderedSystemPrompt?: string;
  contextSummary: string;
  history?: AiChatRequest["history"];
  filePath?: string;
  content?: string;
  selection?: string;
  references?: AiReferenceInput[];
  annotations?: AiChatRequest["annotations"];
  query?: string;
  explicitEvidenceRefs?: AiChatRequest["explicitEvidenceRefs"];
  origin?: SelectionAiOrigin;
  locale?: Locale;
}

function promptTaskText(locale: Locale, kind: "draft" | "proposal", surface: PromptSurface, title: string): string {
  if (locale === "zh-CN") {
    return `创建 ${surface} 提示词${kind === "draft" ? "草稿" : "计划"}：${title}`;
  }
  return `Create ${surface} prompt ${kind}: ${title}`;
}

function promptApprovalNote(locale: Locale, kind: "draft" | "proposal"): string {
  if (locale === "zh-CN") {
    return kind === "draft"
      ? "用户确认了一个输出草稿的提示词模板。"
      : "用户确认了一个输出计划的提示词模板。";
  }
  return kind === "draft"
    ? "User confirmed a prompt template that outputs a draft."
    : "User confirmed a prompt template that outputs a proposal.";
}

export async function executePromptTemplateForSurface(
  input: PromptSurfaceExecutionInput,
): Promise<{ kind: "chat" | "draft" | "proposal"; title: string; runId: string }> {
  const promptStore = usePromptTemplateStore.getState();
  const chatStore = useAiChatStore.getState();
  const locale = input.locale ?? "en-US";

  const runId = promptStore.addRun({
    templateId: input.template.id,
    surface: input.surface,
    renderedPrompt: input.renderedPrompt,
    renderedSystemPrompt: input.renderedSystemPrompt,
    contextSummary: input.contextSummary,
    outputMode: input.template.outputMode,
  });

  promptStore.rememberTemplateUsage(input.template.id, input.surface, {
    workspaceKey: input.workspaceKey,
    workspaceRootPath: input.workspaceRootPath,
  });

  const shouldSendToChat = input.template.outputMode === "chat" || input.template.outputMode === "structured-chat";
  let assistantMessageId: string | null = null;

  if (shouldSendToChat) {
    chatStore.setOpen(true);
    chatStore.addUserMessage(input.renderedPrompt, {
      origin: input.origin,
      templateId: input.template.id,
      promptRunId: runId,
    });
    assistantMessageId = chatStore.startAssistantMessage({
      templateId: input.template.id,
      promptRunId: runId,
    });
    chatStore.setGenerating(true, new AbortController());
  }

  try {
    const result = await runPromptTemplate({
      template: input.template,
      surface: input.surface,
      contextValues: input.contextValues,
      settings: input.settings,
      history: input.history,
      filePath: input.filePath,
      content: input.content,
      selection: input.selection,
      references: input.references,
      annotations: input.annotations,
      query: input.query,
      explicitEvidenceRefs: input.explicitEvidenceRefs,
      renderedOverride: {
        renderedPrompt: input.renderedPrompt,
        renderedSystemPrompt: input.renderedSystemPrompt,
        contextSummary: input.contextSummary,
      },
    });

    if ((result.outputMode === "chat" || result.outputMode === "structured-chat") && assistantMessageId) {
      chatStore.appendToAssistantMessage(assistantMessageId, result.chatResult.text);
      chatStore.finishAssistantMessage(assistantMessageId);
      chatStore.setAssistantMetadata(assistantMessageId, {
        model: result.chatResult.model,
        evidenceRefs: result.chatResult.evidenceRefs,
        promptContext: result.chatResult.context,
        followUpActions: result.chatResult.followUpActions,
        draftSuggestion: result.chatResult.draftSuggestion,
        origin: input.origin,
        templateId: input.template.id,
        promptRunId: runId,
      });
      promptStore.updateRunResult(runId, { resultMessageId: assistantMessageId });
      return {
        kind: "chat",
        title: input.renderedPrompt,
        runId,
      };
    }

    if (result.outputMode === "draft") {
      const brokerResult = await executeUserApprovedAgentTool({
        name: "workbench.createDraft",
        args: {
          draft: {
            type: result.chatResult.draftSuggestion?.type ?? "paper_note",
            templateId: result.chatResult.draftSuggestion?.templateId,
            promptRunId: runId,
            title: result.draft.title,
            sourceRefs: result.chatResult.evidenceRefs,
            content: result.draft.content,
          },
        },
      }, {
        profile: "research",
        task: promptTaskText(locale, "draft", input.surface, input.template.title),
        title: result.draft.title,
        evidenceRefs: result.chatResult.evidenceRefs,
        approvalNote: promptApprovalNote(locale, "draft"),
      });
      const draftId = brokerResult.result?.draftId;
      if (!draftId) {
        throw new Error("Draft creation did not return an artifact id.");
      }
      promptStore.updateRunResult(runId, { resultDraftId: draftId });
      return {
        kind: "draft",
        title: result.draft.title,
        runId,
      };
    }

    if (result.outputMode === "proposal") {
      const proposal = {
        ...result.proposal,
        promptRunId: runId,
        ...(input.origin ? { origin: input.origin } : {}),
      };
      const brokerResult = await executeUserApprovedAgentTool({
        name: "workbench.createProposal",
        args: { proposal },
      }, {
        profile: "research",
        task: promptTaskText(locale, "proposal", input.surface, input.template.title),
        title: proposal.summary,
        evidenceRefs: proposal.sourceRefs,
        approvalNote: promptApprovalNote(locale, "proposal"),
      });
      const proposalId = brokerResult.result?.proposalId;
      if (!proposalId) {
        throw new Error("Proposal creation did not return an artifact id.");
      }
      promptStore.updateRunResult(runId, { resultProposalId: proposalId });
      return {
        kind: "proposal",
        title: proposal.summary,
        runId,
      };
    }

    throw new Error(`Unsupported prompt output mode: ${result.outputMode}`);
  } catch (error) {
    if (assistantMessageId) {
      chatStore.setAssistantError(assistantMessageId, error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}
