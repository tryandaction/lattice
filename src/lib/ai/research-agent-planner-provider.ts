import { routeModel } from './model-router';
import { outputTokenBudget } from './output-budget';
import { withRequestImages } from './request-images';
import type {
  AiModelInfo,
  AiMessage,
  AiRuntimeSettings,
  AiTaskType,
  ModelRouterPolicy,
} from './types';
import type { ResearchAgentPlannerGenerate } from './research-agent-llm-planner';
import type {
  ResearchAgentOmittedModelSummaryGenerate,
  ResearchAgentOmittedModelSummaryGenerateInput,
} from './research-agent';

export interface ResearchAgentPlannerGenerateAdapter {
  generatePlan: ResearchAgentPlannerGenerate;
  generateAnswer: ResearchAgentPlannerGenerate;
  generateOmittedSummary: ResearchAgentOmittedModelSummaryGenerate;
  modelInfo: AiModelInfo;
  policy: ModelRouterPolicy;
  answerTimeoutMs?: number;
  maxOutputTokens?: number;
}

export interface CreateResearchAgentPlannerGenerateOptions {
  taskType?: AiTaskType;
  onProgress?: import('./types').AiGenerateOptions['onProgress'];
  images?: import('./types').AiContentPart[];
}

function buildOmittedSummaryMessages(input: ResearchAgentOmittedModelSummaryGenerateInput): AiMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You summarize omitted Research Agent context for Lattice.',
        'Use only the bounded audit previews provided by the user.',
        'Do not invent facts, citations, files, or results.',
        'Return concise prose, 3-5 bullets or a compact paragraph.',
        'Emphasize what was omitted, why it matters, and what should be recovered first.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Task: ${input.task}`,
        `Query: ${input.query}`,
        `Context pack: ${input.contextPackId}`,
        `Omitted: ${input.omittedContextCount} items, about ${input.omittedContextTokens} tokens.`,
        '',
        `Deterministic auto summary:\n${input.omittedAutoSummary || 'None.'}`,
        '',
        `Semantic preview:\n${input.omittedSemanticPreview || 'None.'}`,
        '',
        `Recovery plan:\n${input.omittedRecoveryPlan || 'None.'}`,
        '',
        `Omitted source preview:\n${input.omittedContextPreview || 'None.'}`,
      ].join('\n'),
    },
  ];
}

export function createResearchAgentPlannerGenerate(
  settings: AiRuntimeSettings,
  options: CreateResearchAgentPlannerGenerateOptions = {},
): ResearchAgentPlannerGenerateAdapter {
  const selection = routeModel(options.taskType ?? 'task_proposal', settings);

  return {
    modelInfo: selection.modelInfo,
    policy: selection.policy,
    answerTimeoutMs: selection.provider.requestTimeouts?.totalMs,
    maxOutputTokens: selection.provider.getMaxOutputTokens?.(selection.modelInfo.model),
    generatePlan: async (messages, generateOptions) => {
      const result = await selection.provider.generate(withRequestImages(messages, options.images), {
        model: generateOptions.model ?? settings.model ?? undefined,
        temperature: generateOptions.temperature ?? Math.min(settings.temperature, 0.2),
        maxTokens: generateOptions.maxTokens ?? outputTokenBudget(settings.maxTokens, 'planning'),
        systemPrompt: generateOptions.systemPrompt,
        signal: generateOptions.signal,
        onProgress: generateOptions.onProgress ?? options.onProgress,
        onResponseDiagnostics: generateOptions.onResponseDiagnostics,
      });

      return result;
    },
    generateAnswer: async (messages, generateOptions) => {
      const result = await selection.provider.generate(withRequestImages(messages, options.images), {
        model: generateOptions.model ?? settings.model ?? undefined,
        temperature: generateOptions.temperature ?? Math.min(settings.temperature, 0.2),
        maxTokens: generateOptions.maxTokens ?? outputTokenBudget(settings.maxTokens, 'detailed'),
        systemPrompt: generateOptions.systemPrompt,
        signal: generateOptions.signal,
        onProgress: generateOptions.onProgress ?? options.onProgress,
        onResponseDiagnostics: generateOptions.onResponseDiagnostics,
      });

      return result;
    },
    generateOmittedSummary: async (summaryInput) => {
      const result = await selection.provider.generate(buildOmittedSummaryMessages(summaryInput), {
        model: settings.model ?? undefined,
        temperature: Math.min(settings.temperature, 0.15),
        maxTokens: outputTokenBudget(settings.maxTokens, 'context-summary'),
        signal: summaryInput.signal,
        onProgress: options.onProgress,
      });

      return result.text;
    },
  };
}
