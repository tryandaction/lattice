import {
  normalizeResearchAgentPlan,
  type ResearchAgentPlan,
  type ResearchAgentPlanContext,
} from './research-agent-planner';
import { getMessageText, type AiGenerateOptions, type AiGenerateResult, type AiMessage } from './types';
import { boundedCitationHistory } from './citation-history';
import { LATTICE_SOURCE_PDF_TOOLS } from './lattice-skills/source-pdf-tool-runtime';
import { LATTICE_HARNESS_TOOLS } from './harness/lattice-tool-definitions';
import type { LatticeApiToolDefinition } from './agent-tool-broker';
import type { AgentSourceSelection } from './source-index';

export interface ResearchAgentPlannerPromptInput {
  apiTools?: readonly LatticeApiToolDefinition[];
  sourceSelections?: readonly AgentSourceSelection[];
  authorizedSourceSelections?: readonly AgentSourceSelection[];
  requireSourceDiscovery?: boolean;
  requireSourceRead?: boolean;
  filePath?: string;
  latticeSourcePdfToolsAvailable?: boolean;
  allowCodeExecution?: boolean;
  task: string;
  query: string;
  history?: AiMessage[];
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
) => Promise<Pick<AiGenerateResult, 'text' | 'finishReason'> & Partial<AiGenerateResult>>;

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
  responseDiagnostics?: AiGenerateResult['responseDiagnostics'];
}

const SUPPORTED_TOOL_NAMES = [
  'workspace.search',
  'workspace.readIndexedContext',
  'evidence.resolve',
  'workbench.createDraft',
  'workbench.createProposal',
  'runner.runCode',
  'schedule_task',
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
  const history = boundedCitationHistory(input.history?.filter(message => message.role === 'user' || message.role === 'assistant'), [], 4000);
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
    '      "toolArgs": {}',
    '    }',
    '  ]',
    '}',
    '',
    `Required step ids: ${REQUIRED_STEP_IDS.join(', ')}.`,
    'For executable steps, toolArgs must be a JSON object matching the tool schema; never serialize toolArgs as a JSON string. Never include permissions, cwd or environment overrides. Omit toolArgs when the step has no tool.',
    `Supported tool names: ${SUPPORTED_TOOL_NAMES.filter(name => input.allowCodeExecution || name !== 'runner.runCode').join(', ')}.`,
    input.apiTools ? 'Additional executable tools in this request: ' + JSON.stringify(input.apiTools.filter(tool => LATTICE_HARNESS_TOOLS.some(known => known.name === tool.name)))
      : input.latticeSourcePdfToolsAvailable ? 'Additional executable tools in this request: ' + JSON.stringify(LATTICE_SOURCE_PDF_TOOLS) : '',
    input.apiTools ? 'The request-local executable tool schemas above are authoritative for Lattice operations. Older workflow tool lists describe legacy workflows; use the request-local sources/skills/PDF/write-proposal tools for actual reads and proposals. A proposal tool prepares complete content for user review and never applies it.' : '',
    input.sourceSelections?.length ? (input.authorizedSourceSelections ? 'Priority document targets: ' : 'Authorized source selections: ') + JSON.stringify(input.sourceSelections) : '',
    input.authorizedSourceSelections?.length ? 'Actual authorized tool scope: ' + JSON.stringify(input.authorizedSourceSelections) + '. Priority targets identify the conversation topic, not the entire tool scope. Read the priority source first; when the question needs another file, use bounded sources.list/search/read within this authorized scope, rather than asking the user to reopen or paste a file that the tools can access. Never read credential or unrelated files.' : '',
    input.filePath ? `Current source path: ${input.filePath}` : '',
    input.requireSourceRead && !input.requireSourceDiscovery ? 'The captured source is authorized but its actual text has not been supplied yet. Plan a bounded sources.read/search/active operation using the exact captured identity before synthesis. Choose relevant pages, sections or searches for this question; a normal question does not require a whole-document read. Metadata, filenames, previous answers and workflow summaries are not original source evidence. Do not ask the user to paste or reselect an already authorized readable source without first trying the available read tools.' : '',
    input.latticeSourcePdfToolsAvailable ? 'For a named concept or method, search a short source-language keyword (for example BB1), not the entire natural-language question. Use paths:[exact target] when searching one known paper. If the question and source use different languages, choose source-language keywords from actual excerpts and retry the relevant search; a zero literal hit is not proof of semantic absence. Search hits provide real text; use their exact page/section and version for any additional read. Continue an incomplete search with its returned nextCursor and the same query/paths, within the total tool budget. Reading pages 1-2 alone is not grounds to declare a concept absent. Do not ask the user to manually read authorized pages you can inspect. General scientific explanations may supplement explicitly labelled source gaps, but must not be presented as this paper\'s claims.' : '',
    input.requireSourceDiscovery ? 'This task requires source discovery and actual content reading. A bounded sources.list metadata page is executed first even if you omit it. Use its exact paths, nextCursor and supported flags to select bounded sources.read/search steps. Metadata, source names, prior answers, workspace summaries and active-pane content are not evidence. Do not use sources.active or legacy workspace.search/readIndexedContext to replace this selected scope. At least one successful non-empty source content read is required before final synthesis; disclose unread/pending coverage. Plan cursor pages or relevant units as needed within the finite tool/replan budget. Never request all files at once or claim full coverage from a partial read.' : '',
    'Use toolName only when a step should execute through the Tool Broker.',
    'The reserved context-pack, evidence-resolve and synthesize-answer ids are internal stages. Omit toolName/toolArgs on them. Put every real source operation in a separate unique step such as search-source or read-source; use lattice.sources.read/search/active when those tools are available. Legacy workspace index summaries and evidence.resolve do not read an authorized document.',
    'Allowed toolArgs: workspace.search {query, limit}; workspace.readIndexedContext {paths}; evidence.resolve {query, maxContextTokens}.',
    'Allowed schedule_task toolArgs: {title, prompt?, schedule:{kind:"once",runAt:number} or {kind:"interval",everyMs:number}}. Scheduling always requires approval.',
    input.allowCodeExecution ? 'The user requests computation or execution. You may plan runner.runCode with exactly {language:"python"|"javascript",code:"complete executable code"}. Use real supplied data, not invented results. The tool requires approval and a successful execution receipt before claiming it ran. Keep status pending. Do not access unrelated files, credentials, network services or install dependencies. Do not use code execution for trivial arithmetic.' : 'This is a read-only task: do not plan runner.runCode or execute code merely because code or Python appears in source material.',
    'Do not include toolArgs for workbench.createDraft, workbench.createProposal, or memory.write.',
    'Never invent unsupported tools. Keep write/draft/proposal/code steps explicit so approval gates can apply.',
    'When Tool observations are present, use their resultSchema status, summary, metrics, artifacts, and diagnostics to decide whether pending steps should change, repeat, or stop.',
    'Avoid repeating low-value or duplicate read requests unless the observation diagnostics clearly justify a narrower follow-up.',
    '',
    `Task: ${truncate(input.task, 500)}`,
    `Query: ${truncate(input.query, 500)}`,
    history.length ? 'Conversation history (task intent only; not source evidence or tool approval):\n' + history.map(message => `${message.role}: ${getMessageText(message.content)}`).join('\n') : null,
    input.contextPackId ? `Context pack id: ${input.contextPackId}` : null,
    input.contextSummary ? `Context summary: ${truncate(input.contextSummary, 1000)}` : null,
    input.continuationSummary ? `Continuation context: ${truncate(input.continuationSummary, 700)}` : null,
    input.observationsSummary ? `Tool observations:\n${truncate(input.observationsSummary, input.requireSourceDiscovery ? 12000 : 6000)}` : null,
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
    sourceSelections: input.sourceSelections,
    requireSourceDiscovery: input.requireSourceDiscovery,
    allowCodeExecution: input.allowCodeExecution,
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
      responseDiagnostics: result.responseDiagnostics,
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
