import { aiOrchestrator } from "@/lib/ai/orchestrator";
import type {
  AiChatRequest,
  AiRuntimeSettings,
  AiTaskProposal,
  AiRunResult,
} from "@/lib/ai/types";
import { renderPromptTemplate } from "@/lib/prompt/render";
import type {
  PromptContextValues,
  PromptExecutionDraftResult,
  PromptOutputMode,
  PromptSurface,
  PromptTemplate,
  RenderedPromptTemplate,
} from "@/lib/prompt/types";

export interface RunPromptTemplateInput {
  template: PromptTemplate;
  surface: PromptSurface;
  contextValues: PromptContextValues;
  settings: AiRuntimeSettings;
  history?: AiChatRequest["history"];
  filePath?: string;
  content?: string;
  selection?: string;
  references?: AiChatRequest["references"];
  annotations?: AiChatRequest["annotations"];
  query?: string;
  explicitEvidenceRefs?: AiChatRequest["explicitEvidenceRefs"];
  renderedOverride?: Pick<RenderedPromptTemplate, "renderedPrompt" | "renderedSystemPrompt" | "contextSummary">;
}

export type PromptExecutionResult =
  | {
      outputMode: "chat" | "structured-chat";
      rendered: RenderedPromptTemplate;
      chatResult: AiRunResult;
    }
  | {
      outputMode: "proposal";
      rendered: RenderedPromptTemplate;
      proposal: AiTaskProposal;
    }
  | {
      outputMode: "draft";
      rendered: RenderedPromptTemplate;
      draft: PromptExecutionDraftResult;
      chatResult: AiRunResult;
    };

function mergeRuntimeSettings(
  settings: AiRuntimeSettings,
  template: PromptTemplate,
  rendered: Pick<RenderedPromptTemplate, "renderedSystemPrompt">,
): AiRuntimeSettings {
  return {
    ...settings,
    providerId: (template.preferredProvider as AiRuntimeSettings["providerId"]) ?? settings.providerId,
    model: template.preferredModel ?? settings.model,
    systemPrompt: rendered.renderedSystemPrompt?.trim() || settings.systemPrompt,
  };
}

function assertSupportedOutputMode(outputMode: PromptOutputMode): asserts outputMode is PromptExecutionResult["outputMode"] {
  if (outputMode === "target-draft-set") {
    throw new Error("Target draft set execution is not supported in this phase.");
  }
}

export async function runPromptTemplate(
  input: RunPromptTemplateInput,
): Promise<PromptExecutionResult> {
  const rendered = {
    ...renderPromptTemplate(input.template, input.contextValues),
    ...(input.renderedOverride ?? {}),
  };

  if (rendered.missingRequiredContext.length > 0) {
    throw new Error(`Missing required context: ${rendered.missingRequiredContext.join(", ")}`);
  }

  assertSupportedOutputMode(input.template.outputMode);
  const runtimeSettings = mergeRuntimeSettings(input.settings, input.template, rendered);

  if (input.template.outputMode === "proposal") {
    const proposal = await aiOrchestrator.proposeTask({
      prompt: rendered.renderedPrompt,
      settings: runtimeSettings,
      filePath: input.filePath,
      content: input.content,
      selection: input.selection,
      references: input.references,
      annotations: input.annotations,
      query: input.query,
      explicitEvidenceRefs: input.explicitEvidenceRefs,
    });

    return {
      outputMode: "proposal",
      rendered,
      proposal,
    };
  }

  const chatResult = await aiOrchestrator.runChat({
    prompt: rendered.renderedPrompt,
    history: input.history,
    settings: runtimeSettings,
    filePath: input.filePath,
    content: input.content,
    selection: input.selection,
    references: input.references,
    annotations: input.annotations,
    query: input.query,
    explicitEvidenceRefs: input.explicitEvidenceRefs,
  });

  if (input.template.outputMode === "draft") {
    return {
      outputMode: "draft",
      rendered,
      chatResult,
      draft: {
        title: input.template.title,
        content: chatResult.text,
      },
    };
  }

  return {
    outputMode: input.template.outputMode,
    rendered,
    chatResult,
  };
}
