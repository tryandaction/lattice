import { useAiChatStore } from "@/stores/ai-chat-store";
import { useAiWorkbenchStore } from "@/stores/ai-workbench-store";
import { usePromptTemplateStore } from "@/stores/prompt-template-store";
import { runPromptTemplate } from "@/lib/prompt/executor";
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
}

export async function executePromptTemplateForSurface(
  input: PromptSurfaceExecutionInput,
): Promise<{ kind: "chat" | "draft" | "proposal"; title: string; runId: string }> {
  const promptStore = usePromptTemplateStore.getState();
  const chatStore = useAiChatStore.getState();
  const workbenchStore = useAiWorkbenchStore.getState();

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
      const draftId = workbenchStore.createDraft({
        type: result.chatResult.draftSuggestion?.type ?? "paper_note",
        templateId: result.chatResult.draftSuggestion?.templateId,
        promptRunId: runId,
        title: result.draft.title,
        sourceRefs: result.chatResult.evidenceRefs,
        content: result.draft.content,
      });
      promptStore.updateRunResult(runId, { resultDraftId: draftId });
      return {
        kind: "draft",
        title: result.draft.title,
        runId,
      };
    }

    if (result.outputMode === "proposal") {
      workbenchStore.addProposal({
        ...result.proposal,
        promptRunId: runId,
        ...(input.origin ? { origin: input.origin } : {}),
      });
      promptStore.updateRunResult(runId, { resultProposalId: result.proposal.id });
      return {
        kind: "proposal",
        title: result.proposal.summary,
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
