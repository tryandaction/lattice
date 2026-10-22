import type {
  AgentToolName,
  AgentToolRequest,
  ReadIndexedContextToolArgs,
  ResolveLatticePathIdentityToolArgs,
  ResolveEvidenceToolArgs,
  WorkspaceSearchToolArgs,
  ScheduleTaskToolArgs,
  RunCodeToolArgs,
} from './agent-tool-broker';
import { isLatticeApiToolName } from './agent-tool-broker';
import { LATTICE_HARNESS_TOOLS, validateLatticeHarnessArgs } from './harness/lattice-tool-definitions';
import type { AgentSourceSelection } from './source-index';

export type ResearchAgentPlanStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'failed';

export interface ResearchAgentPlanStep {
  id: string;
  title: string;
  description: string;
  status: ResearchAgentPlanStepStatus;
  toolName?: AgentToolName;
  toolArgs?: AgentToolRequest['args'];
}

export type ResearchAgentPlanStepInput =
  Omit<ResearchAgentPlanStep, 'status'> &
  Partial<Pick<ResearchAgentPlanStep, 'status'>>;

export interface ResearchAgentPlanContext {
  requireSourceDiscovery?: boolean;
  sourceSelections?: readonly AgentSourceSelection[];
  allowCodeExecution?: boolean;
  includeDraftStep?: boolean;
  includeProposalStep?: boolean;
  includeCompactionStep?: boolean;
  pathIdentity?: ResolveLatticePathIdentityToolArgs;
}

export interface ResearchAgentPlan {
  steps: ResearchAgentPlanStep[];
  source: 'default' | 'custom' | 'fallback';
  warnings: string[];
}

const CORE_STEP_IDS = [
  'context-pack',
  'evidence-resolve',
  'synthesize-answer',
] as const;

const VALID_STATUSES = new Set<ResearchAgentPlanStepStatus>([
  'pending',
  'running',
  'completed',
  'blocked',
  'failed',
]);

const VALID_TOOL_NAMES = new Set<AgentToolName>([
  ...LATTICE_HARNESS_TOOLS.map(tool => tool.name),
  'workspace.search',
  'workspace.readIndexedContext',
  'lattice.resolvePathIdentity',
  'evidence.resolve',
  'workbench.createDraft',
  'workbench.createProposal',
  'runner.runCode',
  'memory.write',
  'schedule_task',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

// Planner output may request a calculation, never supply approval or runner permissions.
export function normalizeResearchAgentRunCodeArgs(value: unknown): RunCodeToolArgs | null {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'language' && key !== 'code')) {
    return null;
  }
  if ((value.language !== 'python' && value.language !== 'javascript') || !asNonEmptyString(value.code)) {
    return null;
  }
  return { language: value.language, code: value.code as string };
}

function normalizeStatus(value: unknown): ResearchAgentPlanStepStatus | null {
  if (value === undefined) {
    return 'pending';
  }
  return typeof value === 'string' && VALID_STATUSES.has(value as ResearchAgentPlanStepStatus)
    ? value as ResearchAgentPlanStepStatus
    : null;
}

function normalizeToolName(value: unknown): AgentToolName | undefined | null {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return typeof value === 'string' && VALID_TOOL_NAMES.has(value as AgentToolName)
    ? value as AgentToolName
    : null;
}

function normalizePositiveInteger(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const integer = Math.floor(value);
  if (integer <= 0) {
    return null;
  }
  return Math.min(integer, max);
}

function normalizeToolArgs(
  toolName: AgentToolName | undefined,
  value: unknown,
): {
  args?: AgentToolRequest['args'];
  warning?: string;
} {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!isRecord(parsed)) return { warning: 'Serialized toolArgs must contain one JSON object.' };
      value = parsed;
    } catch {
      return { warning: 'Serialized toolArgs must be valid JSON containing one object.' };
    }
  }
  if (toolName === 'runner.runCode') {
    const args = normalizeResearchAgentRunCodeArgs(value);
    return args ? { args } : { warning: 'runner.runCode requires only language (python or javascript) and non-empty code.' };
  }
  if (toolName && isLatticeApiToolName(toolName)) {
    try { return { args: validateLatticeHarnessArgs(toolName, value ?? {}) }; }
    catch (error) { return { warning: error instanceof Error ? error.message : String(error) }; }
  }
  if (value === undefined) {
    return {};
  }

  if (!toolName) {
    return {
      warning: 'toolArgs can only be used when toolName is set.',
    };
  }

  if (!isRecord(value)) {
    return {
      warning: `toolArgs for ${toolName} must be an object.`,
    };
  }

  switch (toolName) {
    case 'workspace.search': {
      const args: Partial<WorkspaceSearchToolArgs> = {};
      const query = asNonEmptyString(value.query);
      if (value.query !== undefined && !query) {
        return { warning: 'workspace.search toolArgs.query must be a non-empty string.' };
      }
      if (query) {
        args.query = query;
      }
      if (value.limit !== undefined) {
        const limit = normalizePositiveInteger(value.limit, 20);
        if (!limit) {
          return { warning: 'workspace.search toolArgs.limit must be a positive number.' };
        }
        args.limit = limit;
      }
      return { args: args as WorkspaceSearchToolArgs };
    }
    case 'workspace.readIndexedContext': {
      if (value.paths === undefined) {
        return { args: {} as ReadIndexedContextToolArgs };
      }
      if (!Array.isArray(value.paths) || !value.paths.every((path) => typeof path === 'string' && path.trim())) {
        return { warning: 'workspace.readIndexedContext toolArgs.paths must be an array of non-empty strings.' };
      }
      return {
        args: {
          paths: value.paths.map((path) => path.trim()),
        },
      };
    }
    case 'lattice.resolvePathIdentity': {
      const filePathOrAbsolutePath = asNonEmptyString(value.filePathOrAbsolutePath);
      if (!filePathOrAbsolutePath) {
        return { warning: 'lattice.resolvePathIdentity toolArgs.filePathOrAbsolutePath must be a non-empty string.' };
      }
      const args: ResolveLatticePathIdentityToolArgs = {
        filePathOrAbsolutePath,
      };
      const fileName = asNonEmptyString(value.fileName);
      if (value.fileName !== undefined && !fileName) {
        return { warning: 'lattice.resolvePathIdentity toolArgs.fileName must be a non-empty string.' };
      }
      if (fileName) {
        args.fileName = fileName;
      }
      if (value.kind !== undefined) {
        if (value.kind !== 'generic' && value.kind !== 'pdf') {
          return { warning: 'lattice.resolvePathIdentity toolArgs.kind must be "generic" or "pdf".' };
        }
        args.kind = value.kind;
      }
      return { args };
    }
    case 'evidence.resolve': {
      const args: Pick<ResolveEvidenceToolArgs, 'query' | 'maxContextTokens'> = {};
      const query = asNonEmptyString(value.query);
      if (value.query !== undefined && !query) {
        return { warning: 'evidence.resolve toolArgs.query must be a non-empty string.' };
      }
      if (query) {
        args.query = query;
      }
      if (value.maxContextTokens !== undefined) {
        const maxContextTokens = normalizePositiveInteger(value.maxContextTokens, 8000);
        if (!maxContextTokens) {
          return { warning: 'evidence.resolve toolArgs.maxContextTokens must be a positive number.' };
        }
        args.maxContextTokens = maxContextTokens;
      }
      return { args: args as ResolveEvidenceToolArgs };
    }
    case 'workbench.createDraft':
    case 'workbench.createProposal':
    case 'memory.write':
      return {
        warning: `${toolName} toolArgs are not accepted from planner output; use approved product actions instead.`,
      };
    case 'schedule_task': {
      const title = asNonEmptyString(value.title);
      if (!title) return { warning: 'schedule_task toolArgs.title must be a non-empty string.' };
      const prompt = value.prompt === undefined ? undefined : asNonEmptyString(value.prompt);
      if (value.prompt !== undefined && !prompt) return { warning: 'schedule_task toolArgs.prompt must be a non-empty string.' };
      const schedule = value.schedule;
      if (!isRecord(schedule) || (schedule.kind !== 'once' && schedule.kind !== 'interval')) {
        return { warning: 'schedule_task toolArgs.schedule must be a once or interval schedule.' };
      }
      if (schedule.kind === 'once' && (typeof schedule.runAt !== 'number' || !Number.isFinite(schedule.runAt))) {
        return { warning: 'schedule_task once schedules require a finite runAt.' };
      }
      if (schedule.kind === 'interval' && (!Number.isFinite(schedule.everyMs) || Number(schedule.everyMs) < 1000)) {
        return { warning: 'schedule_task interval schedules require everyMs >= 1000.' };
      }
      return { args: { title, ...(prompt ? { prompt } : {}), schedule: schedule as ScheduleTaskToolArgs['schedule'] } };
    }
  }
}

export function buildDefaultResearchAgentPlanSteps(
  context: ResearchAgentPlanContext = {},
): ResearchAgentPlanStep[] {
  const steps: ResearchAgentPlanStep[] = [
    {
      id: 'context-pack',
      title: 'Build context pack',
      description: 'Collect explicit evidence, current selection, active file context, scoped memory, and optional workspace summary.',
      status: 'pending',
    },
    ...(context.pathIdentity?.filePathOrAbsolutePath ? [{
      id: 'resolve-lattice-path-identity',
      title: 'Resolve Lattice path identity',
      description: `Resolve Lattice file identity and sidecar paths for ${context.pathIdentity.filePathOrAbsolutePath}.`,
      status: 'pending' as const,
      toolName: 'lattice.resolvePathIdentity' as const,
      toolArgs: context.pathIdentity,
    }] : []),
    {
      id: 'evidence-resolve',
      title: 'Resolve evidence',
      description: 'Route evidence resolution through Tool Broker so policy, trace, and provenance stay consistent.',
      status: 'pending',
      toolName: 'evidence.resolve',
    },
    {
      id: 'synthesize-answer',
      title: 'Synthesize evidence-backed answer',
      description: 'Prepare an auditable answer from the context pack, memory snapshot, and resolved evidence.',
      status: 'pending',
    },
  ];

  if (context.includeDraftStep) {
    steps.push({
      id: 'create-draft',
      title: 'Create workbench draft',
      description: 'Request draft creation through Tool Broker and preserve approval gating.',
      status: 'pending',
      toolName: 'workbench.createDraft',
    });
  }

  if (context.includeProposalStep) {
    steps.push({
      id: 'create-proposal',
      title: 'Create workbench proposal',
      description: 'Request proposal creation through Tool Broker and preserve approval gating.',
      status: 'pending',
      toolName: 'workbench.createProposal',
    });
  }

  if (context.includeCompactionStep ?? true) {
    steps.push({
      id: 'compact-session',
      title: 'Compact session trace',
      description: 'Retain the start event and recent trace while summarizing older context for resumability.',
      status: 'pending',
    });
  }

  return steps;
}

function validateCustomPlanSteps(planSteps: unknown, context: ResearchAgentPlanContext = {}): {
  steps: ResearchAgentPlanStep[];
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!Array.isArray(planSteps) || planSteps.length === 0) {
    return {
      steps: [],
      warnings: ['Custom research plan must be a non-empty array.'],
    };
  }

  const seenIds = new Set<string>();
  const occupiedIds = new Set(planSteps.flatMap(candidate => isRecord(candidate) && typeof candidate.id === 'string' ? [candidate.id] : []));
  const movableReadTools = new Set<AgentToolName>(['lattice.sources.list', 'lattice.sources.search', 'lattice.sources.read', 'lattice.sources.active', 'workspace.search', 'workspace.readIndexedContext', 'lattice.resolvePathIdentity']);
  const steps: ResearchAgentPlanStep[] = [];

  planSteps.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      warnings.push(`Plan step ${index + 1} must be an object.`);
      return;
    }

    const id = asNonEmptyString(candidate.id);
    const title = asNonEmptyString(candidate.title);
    const description = asNonEmptyString(candidate.description);
    const status = normalizeStatus(candidate.status);
    const toolName = normalizeToolName(candidate.toolName);
    const normalizedToolArgs = normalizeToolArgs(toolName ?? undefined, candidate.toolArgs);

    if (!id || !title || !description) {
      warnings.push(`Plan step ${index + 1} is missing id, title, or description.`);
      return;
    }
    if (seenIds.has(id)) {
      warnings.push(`Plan step id must be unique: ${id}.`);
      return;
    }
    if (!status) {
      warnings.push(`Plan step ${id} has an invalid status.`);
      return;
    }
    if (toolName === null) {
      warnings.push(`Plan step ${id} references an unsupported tool.`);
      return;
    }
    if (normalizedToolArgs.warning) {
      warnings.push(`Plan step ${id} has invalid toolArgs: ${normalizedToolArgs.warning}`);
      return;
    }
    if (toolName === 'runner.runCode' && (!context.allowCodeExecution || status !== 'pending')) {
      warnings.push(`Plan step ${id}: runner.runCode requires explicit execution intent and a pending status; planner output cannot claim execution.`);
      return;
    }
    if (context.requireSourceDiscovery && (toolName === 'lattice.sources.active' || toolName === 'workspace.search' || toolName === 'workspace.readIndexedContext')) {
      warnings.push(`Plan step ${id}: selected-source discovery must use sources.list/read/search, not active or unscoped workspace context.`);
      return;
    }
    const coreId = CORE_STEP_IDS.some(core => core === id);
    if (coreId && toolName && toolName !== 'evidence.resolve' && !movableReadTools.has(toolName)) {
      warnings.push('Plan step ' + id + ': action tools require a separate explicit step; core steps cannot execute or approve actions.');
      return;
    }

    seenIds.add(id);
    const step: ResearchAgentPlanStep = {
      id,
      title,
      description,
      status: toolName && isLatticeApiToolName(toolName) ? 'pending' : status,
      ...(toolName ? { toolName } : {}),
      ...(normalizedToolArgs.args ? { toolArgs: normalizedToolArgs.args } : {}),
    };
    if (coreId && toolName && movableReadTools.has(toolName)) {
      const core = buildDefaultResearchAgentPlanSteps({ includeCompactionStep: false }).find(item => item.id === id)!;
      const baseId = id + '-source-tool';
      let toolId = baseId, suffix = 2;
      while (occupiedIds.has(toolId)) toolId = baseId + '-' + suffix++;
      occupiedIds.add(toolId);
      const readStep = { ...step, id: toolId, status: 'pending' as const };
      steps.push(...(id === 'context-pack' ? [core, readStep] : [readStep, core]));
    } else if (coreId && id !== 'evidence-resolve' && toolName === 'evidence.resolve') {
      // The dedicated evidence core owns evidence.resolve; other core labels never run it.
      steps.push({ id, title, description, status });
    } else steps.push(step);
  });

  for (const id of CORE_STEP_IDS) {
    if (!seenIds.has(id)) {
      warnings.push(`Custom research plan is missing required step: ${id}.`);
    }
  }

  return { steps, warnings };
}

export function normalizeResearchAgentPlan(input: {
  planSteps?: unknown;
  context?: ResearchAgentPlanContext;
} = {}): ResearchAgentPlan {
  if (input.planSteps === undefined) {
    return {
      steps: buildDefaultResearchAgentPlanSteps(input.context),
      source: 'default',
      warnings: [],
    };
  }

  const validated = validateCustomPlanSteps(input.planSteps, input.context);
  if (validated.warnings.length > 0) {
    return {
      steps: buildDefaultResearchAgentPlanSteps(input.context),
      source: 'fallback',
      warnings: validated.warnings,
    };
  }

  return {
    steps: validated.steps,
    source: 'custom',
    warnings: [],
  };
}

export function updateResearchAgentPlanStepStatus(
  steps: ResearchAgentPlanStep[],
  stepId: string,
  status: ResearchAgentPlanStepStatus,
): ResearchAgentPlanStep[] {
  return steps.map((step) => step.id === stepId ? { ...step, status } : step);
}
