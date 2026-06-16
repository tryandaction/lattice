import { routeModel } from './model-router';
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
  generateOmittedSummary: ResearchAgentOmittedModelSummaryGenerate;
  modelInfo: AiModelInfo;
  policy: ModelRouterPolicy;
}

export interface CreateResearchAgentPlannerGenerateOptions {
  taskType?: AiTaskType;
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
    generatePlan: async (messages, generateOptions) => {
      const result = await selection.provider.generate(messages, {
        model: generateOptions.model ?? settings.model ?? undefined,
        temperature: generateOptions.temperature ?? Math.min(settings.temperature, 0.2),
        maxTokens: generateOptions.maxTokens ?? Math.min(settings.maxTokens, 1200),
        systemPrompt: generateOptions.systemPrompt,
        signal: generateOptions.signal,
      });

      return { text: result.text };
    },
    generateOmittedSummary: async (summaryInput) => {
      const result = await selection.provider.generate(buildOmittedSummaryMessages(summaryInput), {
        model: settings.model ?? undefined,
        temperature: Math.min(settings.temperature, 0.15),
        maxTokens: Math.min(settings.maxTokens, 700),
        signal: summaryInput.signal,
      });

      return result.text;
    },
  };
}
