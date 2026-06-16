import {
  normalizeResearchAgentPlan,
  type ResearchAgentPlan,
  type ResearchAgentPlanContext,
} from './research-agent-planner';
import type { AiGenerateOptions, AiMessage } from './types';

export interface ResearchAgentPlannerPromptInput {
  task: string;
  query: string;
  contextPackId?: string;
  contextSummary?: string;
  memoryCount?: number;
  evidenceCount?: number;
  includeDraftStep?: boolean;
  includeProposalStep?: boolean;
  includeCompactionStep?: boolean;
  continuationSummary?: string;
  observationsSummary?: string;
  workflowHints?: string;
}

export interface ParseResearchAgentPlannerOutputInput {
  output: string;
  context?: ResearchAgentPlanContext;
}

export type ResearchAgentPlannerGenerate = (
  messages: AiMessage[],
  options: AiGenerateOptions,
) => Promise<{ text: string }>;

export interface RunResearchAgentPlannerInput extends ResearchAgentPlannerPromptInput {
  generatePlan: ResearchAgentPlannerGenerate;
  context?: ResearchAgentPlanContext;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ResearchAgentPlannerRunResult {
  prompt: string;
  rawOutput: string | null;
  plan: ResearchAgentPlan;
}

const SUPPORTED_TOOL_NAMES = [
  'workspace.search',
  'workspace.readIndexedContext',
  'evidence.resolve',
  'workbench.createDraft',
  'workbench.createProposal',
  'runner.runCode',
];

const REQUIRED_STEP_IDS = [
  'context-pack',
  'evidence-resolve',
  'synthesize-answer',
];

function truncate(value: string | undefined, maxLength: number): string {
  if (!value) {
    return '';
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

export function buildResearchAgentPlannerPrompt(input: ResearchAgentPlannerPromptInput): string {
  return [
    'You are planning a Lattice Research Agent run.',
    'Return only JSON. Do not include markdown or prose outside the JSON.',
    '',
    'Schema:',
    '{',
    '  "steps": [',
    '    {',
    '      "id": "context-pack | evidence-resolve | synthesize-answer | optional-custom-id",',
    '      "title": "short user-visible title",',
    '      "description": "one sentence explaining the step",',
    '      "toolName": "optional supported tool name",',
    '      "toolArgs": "optional object; only for workspace.search, workspace.readIndexedContext, or evidence.resolve"',
    '    }',
    '  ]',
    '}',
    '',
    `Required step ids: ${REQUIRED_STEP_IDS.join(', ')}.`,
    `Supported tool names: ${SUPPORTED_TOOL_NAMES.join(', ')}.`,
    'Use toolName only when a step should execute through the Tool Broker.',
    'Allowed toolArgs: workspace.search {query, limit}; workspace.readIndexedContext {paths}; evidence.resolve {query, maxContextTokens}.',
    'Do not include toolArgs for workbench.createDraft, workbench.createProposal, or runner.runCode.',
    'Never invent unsupported tools. Keep write/draft/proposal/code steps explicit so approval gates can apply.',
    'When Tool observations are present, use their resultSchema status, summary, metrics, artifacts, and diagnostics to decide whether pending steps should change, repeat, or stop.',
    'Avoid repeating low-value or duplicate read requests unless the observation diagnostics clearly justify a narrower follow-up.',
    '',
    `Task: ${truncate(input.task, 500)}`,
    `Query: ${truncate(input.query, 500)}`,
    input.contextPackId ? `Context pack id: ${input.contextPackId}` : null,
    input.contextSummary ? `Context summary: ${truncate(input.contextSummary, 1000)}` : null,
    input.continuationSummary ? `Continuation context: ${truncate(input.continuationSummary, 700)}` : null,
    input.observationsSummary ? `Tool observations:\n${truncate(input.observationsSummary, 1000)}` : null,
    input.workflowHints ? `Workflow hints:\n${truncate(input.workflowHints, 1400)}` : null,
    `Memory entries: ${input.memoryCount ?? 0}`,
    `Evidence refs: ${input.evidenceCount ?? 0}`,
    `Draft step requested: ${input.includeDraftStep ? 'yes' : 'no'}`,
    `Proposal step requested: ${input.includeProposalStep ? 'yes' : 'no'}`,
    `Compaction step requested: ${input.includeCompactionStep ?? true ? 'yes' : 'no'}`,
  ].filter((line): line is string => line !== null).join('\n');
}

function stripJsonFence(output: string): string {
  const trimmed = output.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function extractJsonObject(output: string): string | null {
  const stripped = stripJsonFence(output);
  if (stripped.startsWith('{') && stripped.endsWith('}')) {
    return stripped;
  }

  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  return stripped.slice(start, end + 1);
}

export function parseResearchAgentPlannerOutput(
  input: ParseResearchAgentPlannerOutputInput,
): ResearchAgentPlan {
  const json = extractJsonObject(input.output);
  if (!json) {
    const fallback = normalizeResearchAgentPlan({ context: input.context });
    return {
      ...fallback,
      source: 'fallback',
      warnings: ['Planner output did not contain a JSON object.'],
    };
  }

  try {
    const parsed = JSON.parse(json) as { steps?: unknown };
    const plan = normalizeResearchAgentPlan({
      planSteps: parsed.steps,
      context: input.context,
    });
    if (plan.source === 'fallback') {
      return {
        ...plan,
        warnings: ['Planner output failed schema validation.', ...plan.warnings],
      };
    }
    return plan;
  } catch (error) {
    const fallback = normalizeResearchAgentPlan({ context: input.context });
    return {
      ...fallback,
      source: 'fallback',
      warnings: [
        `Planner output JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

function planContextFromPromptInput(input: ResearchAgentPlannerPromptInput): ResearchAgentPlanContext {
  return {
    includeDraftStep: input.includeDraftStep,
    includeProposalStep: input.includeProposalStep,
    includeCompactionStep: input.includeCompactionStep,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export async function runResearchAgentPlanner(
  input: RunResearchAgentPlannerInput,
): Promise<ResearchAgentPlannerRunResult> {
  const prompt = buildResearchAgentPlannerPrompt(input);
  const context = input.context ?? planContextFromPromptInput(input);

  try {
    const result = await input.generatePlan([
      {
        role: 'system',
        content: 'You are a planning module. Return only valid JSON matching the requested schema.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ], {
      model: input.model,
      temperature: input.temperature ?? 0.2,
      maxTokens: input.maxTokens ?? 1200,
      signal: input.signal,
    });

    return {
      prompt,
      rawOutput: result.text,
      plan: parseResearchAgentPlannerOutput({
        output: result.text,
        context,
      }),
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    const fallback = normalizeResearchAgentPlan({ context });
    return {
      prompt,
      rawOutput: null,
      plan: {
        ...fallback,
        source: 'fallback',
        warnings: [
          `Planner generation failed: ${error instanceof Error ? error.message : String(error)}`,
        ],
      },
    };
  }
}
