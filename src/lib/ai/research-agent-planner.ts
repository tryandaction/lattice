import type {
  AgentToolName,
  AgentToolRequest,
  ReadIndexedContextToolArgs,
  ResolveLatticePathIdentityToolArgs,
  ResolveEvidenceToolArgs,
  WorkspaceSearchToolArgs,
} from './agent-tool-broker';

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
  'workspace.search',
  'workspace.readIndexedContext',
  'lattice.resolvePathIdentity',
  'evidence.resolve',
  'workbench.createDraft',
  'workbench.createProposal',
  'runner.runCode',
  'memory.write',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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
    case 'runner.runCode':
    case 'memory.write':
      return {
        warning: `${toolName} toolArgs are not accepted from planner output; use approved product actions instead.`,
      };
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

function validateCustomPlanSteps(planSteps: unknown): {
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

    seenIds.add(id);
    steps.push({
      id,
      title,
      description,
      status,
      ...(toolName ? { toolName } : {}),
      ...(normalizedToolArgs.args ? { toolArgs: normalizedToolArgs.args } : {}),
    });
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

  const validated = validateCustomPlanSteps(input.planSteps);
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
