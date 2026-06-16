import {
  buildAgentCapabilityPolicy,
  getAgentCapabilityDecision,
  type AgentCapabilityDecision,
  type AgentSafetyProfile,
  type AgentToolCapability,
} from './agent-policy';
import { aiContextGraph } from './context-graph';
import {
  buildIndexContext,
  searchIndex,
  type FileIndex,
} from './workspace-indexer';
import type {
  CreateAgentMemoryEntryInput,
  AgentMemoryEntry,
} from './agent-memory';
import type {
  AppendAgentTraceInput,
} from './agent-session';
import type {
  AiDraftArtifact,
  EvidenceRef,
  AiPromptContext,
  AiResearchContextInput,
  AiTaskProposal,
} from './types';
import { runCodeWithWorkspaceRunner } from './agent-runner-tool';
import { agentErrorMetadata, classifyAgentError } from './agent-error';
import {
  resolveLatticePathIdentity,
  type LatticePathIdentity,
  type LatticePathIdentityKind,
} from './lattice-skills/path-identity';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { useAgentMemoryStore } from '@/stores/agent-memory-store';
import { useAiWorkbenchStore } from '@/stores/ai-workbench-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

export type AgentToolName =
  | 'workspace.search'
  | 'workspace.readIndexedContext'
  | 'lattice.resolvePathIdentity'
  | 'evidence.resolve'
  | 'workbench.createDraft'
  | 'workbench.createProposal'
  | 'runner.runCode'
  | 'memory.write';

export interface WorkspaceSearchToolArgs {
  query: string;
  limit?: number;
}

export interface ReadIndexedContextToolArgs {
  paths?: string[];
}

export interface ResolveLatticePathIdentityToolArgs {
  filePathOrAbsolutePath: string;
  fileName?: string;
  kind?: LatticePathIdentityKind;
}

export interface ResolveEvidenceToolArgs extends AiResearchContextInput {
  maxContextTokens?: number;
}

export interface CreateDraftToolArgs {
  draft: Omit<AiDraftArtifact, 'id' | 'createdAt' | 'status'>;
}

export interface CreateProposalToolArgs {
  proposal: AiTaskProposal;
}

export interface RunCodeToolArgs {
  language: 'javascript' | 'python' | string;
  code: string;
}

export interface WriteMemoryToolArgs {
  memory: CreateAgentMemoryEntryInput;
  reason?: string;
  review?: {
    candidateKind?: string;
    applicability?: string;
    evidenceSummary?: string;
    recoverySummary?: string;
    policySummary?: string;
    policyReasons?: string[];
    caution?: string;
  };
}

export type AgentToolRequest =
  | { name: 'workspace.search'; args: WorkspaceSearchToolArgs }
  | { name: 'workspace.readIndexedContext'; args: ReadIndexedContextToolArgs }
  | { name: 'lattice.resolvePathIdentity'; args: ResolveLatticePathIdentityToolArgs }
  | { name: 'evidence.resolve'; args: ResolveEvidenceToolArgs }
  | { name: 'workbench.createDraft'; args: CreateDraftToolArgs }
  | { name: 'workbench.createProposal'; args: CreateProposalToolArgs }
  | { name: 'runner.runCode'; args: RunCodeToolArgs }
  | { name: 'memory.write'; args: WriteMemoryToolArgs };

export type AgentToolResultByName = {
  'workspace.search': FileIndex[];
  'workspace.readIndexedContext': string;
  'lattice.resolvePathIdentity': LatticePathIdentity;
  'evidence.resolve': AiPromptContext;
  'workbench.createDraft': { draftId: string };
  'workbench.createProposal': { proposalId: string };
  'runner.runCode': { output: string };
  'memory.write': { memoryId: string; memory: AgentMemoryEntry };
};

export type AgentToolExecutionStatus =
  | 'completed'
  | 'requires_approval'
  | 'denied'
  | 'failed';

export interface AgentToolExecutionOptions {
  sessionId: string;
  approvedByUser?: boolean;
  approvalNote?: string;
  approvalRequestId?: string;
  runCode?: (args: RunCodeToolArgs) => Promise<{ output: string }>;
}

export type AgentToolResultPreviewMetadata = Record<string, string | number | boolean | null>;

export interface AgentToolResultPreview {
  preview: string;
  metadata: AgentToolResultPreviewMetadata;
}

export interface AgentToolExecutionResult<TName extends AgentToolName = AgentToolName> {
  status: AgentToolExecutionStatus;
  sessionId: string;
  toolName: TName;
  decision: AgentCapabilityDecision;
  result?: AgentToolResultByName[TName];
  resultPreview?: string;
  resultMetadata?: AgentToolResultPreviewMetadata;
  approvalRequestId?: string;
  error?: string;
}

export interface AgentToolDescriptor {
  name: AgentToolName;
  capability: AgentToolCapability;
  label: string;
  description: string;
  argsSummary: string;
  resultSummary: string;
}

export const AGENT_TOOL_DESCRIPTORS: Record<AgentToolName, AgentToolDescriptor> = {
  'workspace.search': {
    name: 'workspace.search',
    capability: 'search_workspace',
    label: 'Workspace search',
    description: 'Search the indexed workspace for files and notes relevant to a query.',
    argsSummary: '{ query: string, limit?: number }',
    resultSummary: 'Indexed file matches with paths and summaries.',
  },
  'workspace.readIndexedContext': {
    name: 'workspace.readIndexedContext',
    capability: 'read_workspace',
    label: 'Read indexed context',
    description: 'Read selected indexed workspace paths as bounded text context.',
    argsSummary: '{ paths?: string[] }',
    resultSummary: 'Concatenated indexed context text.',
  },
  'lattice.resolvePathIdentity': {
    name: 'lattice.resolvePathIdentity',
    capability: 'lattice_read_identity',
    label: 'Resolve Lattice path identity',
    description: 'Resolve a workspace path into Lattice file identity, annotation sidecar path, and PDF item candidate paths.',
    argsSummary: '{ filePathOrAbsolutePath: string, fileName?: string, kind?: "generic" | "pdf" }',
    resultSummary: 'Lattice path, file id candidates, annotation sidecar path, and optional PDF item paths.',
  },
  'evidence.resolve': {
    name: 'evidence.resolve',
    capability: 'resolve_evidence',
    label: 'Resolve evidence',
    description: 'Build an evidence-backed prompt context from selected files, snippets, or refs.',
    argsSummary: '{ nodes?, refs?, maxContextTokens?: number }',
    resultSummary: 'Prompt context nodes, evidence refs, and truncation state.',
  },
  'workbench.createDraft': {
    name: 'workbench.createDraft',
    capability: 'create_draft',
    label: 'Create draft',
    description: 'Create a reviewable Workbench draft after approval.',
    argsSummary: '{ draft }',
    resultSummary: 'Created draft id.',
  },
  'workbench.createProposal': {
    name: 'workbench.createProposal',
    capability: 'propose_write',
    label: 'Create proposal',
    description: 'Create a reviewable Workbench proposal after approval.',
    argsSummary: '{ proposal }',
    resultSummary: 'Created proposal id.',
  },
  'runner.runCode': {
    name: 'runner.runCode',
    capability: 'run_code',
    label: 'Run code',
    description: 'Run code through the workspace runner after approval.',
    argsSummary: '{ language: string, code: string }',
    resultSummary: 'Runner output text.',
  },
  'memory.write': {
    name: 'memory.write',
    capability: 'memory_write',
    label: 'Write memory',
    description: 'Persist an approved scoped Agent Memory entry.',
    argsSummary: '{ memory, reason?: string }',
    resultSummary: 'Saved memory id, scope, title, and source fingerprint.',
  },
};

export function getAgentToolDescriptor(name: AgentToolName): AgentToolDescriptor {
  return AGENT_TOOL_DESCRIPTORS[name];
}

export function listAgentToolDescriptors(names?: AgentToolName[]): AgentToolDescriptor[] {
  const orderedNames = names ?? Object.keys(AGENT_TOOL_DESCRIPTORS) as AgentToolName[];
  return orderedNames.map((name) => AGENT_TOOL_DESCRIPTORS[name]);
}

const TOOL_CAPABILITIES: Record<AgentToolName, AgentToolCapability> = Object.fromEntries(
  Object.entries(AGENT_TOOL_DESCRIPTORS).map(([name, descriptor]) => [name, descriptor.capability]),
) as Record<AgentToolName, AgentToolCapability>;

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function previewArguments(args: unknown): string {
  try {
    const normalized = JSON.stringify(args, (_key, value) => {
      if (typeof value === 'string' && value.length > 240) {
        return `${value.slice(0, 240)}...`;
      }
      return value;
    });
    return compactWhitespace(normalized ?? '').slice(0, 320);
  } catch {
    return '[unserializable arguments]';
  }
}

function traceId(sessionId: string, name: string, suffix: string): string {
  return `${sessionId}:${name}:${suffix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function resultSize(result: unknown): number {
  if (typeof result === 'string') {
    return result.length;
  }
  if (Array.isArray(result)) {
    return result.length;
  }
  if (result && typeof result === 'object') {
    return Object.keys(result).length;
  }
  return 0;
}

function fallbackResultPreview(result: unknown): string {
  try {
    if (typeof result === 'string') {
      return result.slice(0, 320);
    }
    return compactWhitespace(JSON.stringify(result) ?? '').slice(0, 320);
  } catch {
    return '[unserializable result]';
  }
}

function previewText(value: string, maxLength = 320): string {
  return compactWhitespace(value).slice(0, maxLength);
}

function buildResultEnvelopeMetadata(input: {
  toolName: AgentToolName;
  preview: string;
  status?: 'completed' | 'empty' | 'partial';
  summary?: string;
  metrics?: string | null;
  artifacts?: string | null;
  diagnostics?: string | null;
}): AgentToolResultPreviewMetadata {
  return {
    resultSchemaVersion: 1,
    resultKind: input.toolName,
    resultStatus: input.status ?? 'completed',
    resultSummary: input.summary ?? input.preview,
    resultPreview: input.preview,
    resultMetricsPreview: input.metrics ?? null,
    resultArtifactsPreview: input.artifacts ?? null,
    resultDiagnosticsPreview: input.diagnostics ?? null,
  };
}

export function buildAgentToolResultPreview<TName extends AgentToolName>(
  toolName: TName,
  result: AgentToolResultByName[TName],
): AgentToolResultPreview {
  switch (toolName) {
    case 'workspace.search': {
      const files = result as FileIndex[];
      const paths = files.slice(0, 5).map((file) => file.path);
      const preview = paths.length > 0
        ? paths.join(', ')
        : 'No matching indexed files.';
      return {
        preview,
        metadata: {
          ...buildResultEnvelopeMetadata({
            toolName: 'workspace.search',
            preview,
            status: files.length > 0 ? 'completed' : 'empty',
            summary: `${files.length} indexed file match${files.length === 1 ? '' : 'es'}.`,
            metrics: `items=${files.length}`,
            artifacts: paths.join(', ') || null,
          }),
          resultItemCount: files.length,
          topPath: files[0]?.path ?? null,
        },
      };
    }
    case 'workspace.readIndexedContext': {
      const text = String(result);
      const preview = previewText(text) || 'No indexed context returned.';
      return {
        preview,
        metadata: {
          ...buildResultEnvelopeMetadata({
            toolName: 'workspace.readIndexedContext',
            preview,
            status: text.trim() ? 'completed' : 'empty',
            summary: text.trim() ? 'Indexed context text returned.' : 'No indexed context returned.',
            metrics: `chars=${text.length}`,
          }),
          resultSize: text.length,
          outputPreview: preview,
        },
      };
    }
    case 'lattice.resolvePathIdentity': {
      const identity = result as LatticePathIdentity;
      const artifacts = [
        identity.annotationPath,
        identity.itemFolderPath,
        identity.annotationIndexPath,
      ].filter((value): value is string => Boolean(value));
      const preview = `${identity.latticePath} -> ${identity.fileId}`;
      return {
        preview,
        metadata: {
          ...buildResultEnvelopeMetadata({
            toolName: 'lattice.resolvePathIdentity',
            preview,
            summary: `${identity.kind} path identity resolved.`,
            metrics: `candidates=${identity.fileIdCandidates.length}`,
            artifacts: artifacts.join(', ') || null,
          }),
          latticePath: identity.latticePath,
          fileId: identity.fileId,
          fileName: identity.fileName,
          identityKind: identity.kind,
          annotationPath: identity.annotationPath,
          itemFolderPath: identity.itemFolderPath,
          annotationIndexPath: identity.annotationIndexPath,
          fileIdCandidateCount: identity.fileIdCandidates.length,
        },
      };
    }
    case 'evidence.resolve': {
      const context = result as AiPromptContext;
      const preview = `${context.nodes.length} context node${context.nodes.length === 1 ? '' : 's'}, ${context.evidenceRefs.length} evidence ref${context.evidenceRefs.length === 1 ? '' : 's'}${context.truncated ? ', truncated' : ''}.`;
      return {
        preview,
        metadata: {
          ...buildResultEnvelopeMetadata({
            toolName: 'evidence.resolve',
            preview,
            status: context.truncated ? 'partial' : 'completed',
            summary: preview,
            metrics: `nodes=${context.nodes.length}, evidence=${context.evidenceRefs.length}, truncated=${context.truncated}`,
            artifacts: context.evidenceRefs.slice(0, 5).map((ref) => ref.locator).join(', ') || null,
          }),
          contextNodeCount: context.nodes.length,
          evidenceCount: context.evidenceRefs.length,
          truncated: context.truncated,
        },
      };
    }
    case 'workbench.createDraft': {
      const draftId = (result as { draftId: string }).draftId;
      const preview = `Draft created: ${draftId}.`;
      return {
        preview,
        metadata: {
          ...buildResultEnvelopeMetadata({
            toolName: 'workbench.createDraft',
            preview,
            summary: 'Workbench draft created.',
            artifacts: draftId,
          }),
          artifactId: draftId,
        },
      };
    }
    case 'workbench.createProposal': {
      const proposalId = (result as { proposalId: string }).proposalId;
      const preview = `Proposal created: ${proposalId}.`;
      return {
        preview,
        metadata: {
          ...buildResultEnvelopeMetadata({
            toolName: 'workbench.createProposal',
            preview,
            summary: 'Workbench proposal created.',
            artifacts: proposalId,
          }),
          artifactId: proposalId,
        },
      };
    }
    case 'runner.runCode': {
      const output = (result as { output: string }).output;
      const preview = previewText(output) || 'Code run completed without output.';
      return {
        preview,
        metadata: {
          ...buildResultEnvelopeMetadata({
            toolName: 'runner.runCode',
            preview,
            status: output.trim() ? 'completed' : 'empty',
            summary: output.trim() ? 'Runner output captured.' : 'Code run completed without output.',
            metrics: `chars=${output.length}`,
          }),
          resultSize: output.length,
          outputPreview: preview,
        },
      };
    }
    case 'memory.write': {
      const memory = (result as { memory: AgentMemoryEntry }).memory;
      const preview = `Memory saved: ${memory.title}.`;
      return {
        preview,
        metadata: {
          ...buildResultEnvelopeMetadata({
            toolName: 'memory.write',
            preview,
            summary: `Memory saved in ${memory.scope} scope.`,
            artifacts: memory.id,
            diagnostics: memory.source.fingerprint ? `fingerprint=${memory.source.fingerprint}` : null,
          }),
          artifactId: memory.id,
          memoryScope: memory.scope,
          memoryTitle: memory.title,
          memorySourceFingerprint: memory.source.fingerprint ?? null,
        },
      };
    }
    default:
      return {
        preview: fallbackResultPreview(result),
        metadata: {
          ...buildResultEnvelopeMetadata({
            toolName,
            preview: fallbackResultPreview(result),
            summary: 'Tool result captured.',
            metrics: `size=${resultSize(result)}`,
          }),
          resultSize: resultSize(result),
        },
      };
  }
}

function toolLabel(name: AgentToolName): string {
  return getAgentToolDescriptor(name).label;
}

async function executeToolBody(
  request: AgentToolRequest,
  options: AgentToolExecutionOptions,
): Promise<AgentToolResultByName[AgentToolName]> {
  switch (request.name) {
    case 'workspace.search':
      return searchIndex(request.args.query, request.args.limit ?? 10);
    case 'workspace.readIndexedContext':
      return buildIndexContext(request.args.paths);
    case 'lattice.resolvePathIdentity': {
      const workspaceState = useWorkspaceStore.getState();
      return resolveLatticePathIdentity({
        filePathOrAbsolutePath: request.args.filePathOrAbsolutePath,
        fileName: request.args.fileName,
        kind: request.args.kind,
        workspaceIdentity: workspaceState.workspaceIdentity,
      });
    }
    case 'evidence.resolve':
      return aiContextGraph.buildPromptContext(
        request.args,
        request.args.maxContextTokens,
      );
    case 'workbench.createDraft': {
      const draftId = useAiWorkbenchStore.getState().createDraft(request.args.draft);
      return { draftId };
    }
    case 'workbench.createProposal':
      useAiWorkbenchStore.getState().addProposal(request.args.proposal);
      return { proposalId: request.args.proposal.id };
    case 'runner.runCode':
      return (options.runCode ?? runCodeWithWorkspaceRunner)(request.args);
    case 'memory.write': {
      const memoryId = useAgentMemoryStore.getState().addMemory(request.args.memory);
      const memory = useAgentMemoryStore.getState().getMemory(memoryId);
      if (!memory) {
        throw new Error(`Memory write failed: ${memoryId}`);
      }
      return { memoryId, memory };
    }
  }
}

function appendTrace(
  sessionId: string,
  event: AppendAgentTraceInput,
) {
  useAgentSessionStore.getState().appendTrace(sessionId, event);
}

function isAgentToolRequest(value: unknown): value is AgentToolRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as { name?: unknown; args?: unknown };
  if (typeof record.name !== 'string' || !record.args || typeof record.args !== 'object') {
    return false;
  }
  return record.name in TOOL_CAPABILITIES;
}

export async function executeAgentTool<TName extends AgentToolName>(
  request: Extract<AgentToolRequest, { name: TName }>,
  options: AgentToolExecutionOptions,
): Promise<AgentToolExecutionResult<TName>> {
  const agentStore = useAgentSessionStore.getState();
  const session = agentStore.getSession(options.sessionId);
  if (!session) {
    throw new Error(`Agent session not found: ${options.sessionId}`);
  }

  if (session.status === 'waiting_approval' && options.approvedByUser) {
    agentStore.resumeSession(session.id);
  }

  const capability = TOOL_CAPABILITIES[request.name];
  const policy = buildAgentCapabilityPolicy(session.profile);
  const decision = getAgentCapabilityDecision(policy, capability);
  const descriptor = getAgentToolDescriptor(request.name);
  const label = descriptor.label;
  const argumentsPreview = previewArguments(request.args);
  const tool = {
    capability,
    toolName: request.name,
    argumentsPreview,
  };

  appendTrace(session.id, {
    id: traceId(session.id, request.name, 'requested'),
    kind: 'tool_requested',
    message: `${label} requested.`,
    tool,
    decision,
    metadata: {
      approvedByUser: options.approvedByUser ?? false,
      toolLabel: descriptor.label,
      toolDescription: descriptor.description,
      toolArgsSummary: descriptor.argsSummary,
      toolResultSummary: descriptor.resultSummary,
    },
  });

  if (!decision.allowed) {
    const error = `${label} denied by ${session.profile} policy.`;
    const diagnostic = classifyAgentError({
      error,
      stage: 'tool.policy',
      toolName: request.name,
      category: 'policy',
    });
    appendTrace(session.id, {
      id: traceId(session.id, request.name, 'denied'),
      kind: 'error',
      message: error,
      error,
      tool,
      decision,
      metadata: agentErrorMetadata(diagnostic),
    });
    return {
      status: 'denied',
      sessionId: session.id,
      toolName: request.name,
      decision,
      error,
    };
  }

  if (decision.requiresApproval && !options.approvedByUser) {
    const approvalRequestId = traceId(session.id, request.name, 'approval');
    appendTrace(session.id, {
      id: approvalRequestId,
      kind: 'approval_required',
      message: `${label} requires user approval before execution.`,
      tool,
      decision,
      metadata: {
        approvalNote: options.approvalNote ?? null,
        toolLabel: descriptor.label,
        toolDescription: descriptor.description,
        toolArgsSummary: descriptor.argsSummary,
        toolResultSummary: descriptor.resultSummary,
      },
    });
    useAgentSessionStore.getState().addPendingApproval(session.id, {
      id: approvalRequestId,
      capability,
      toolName: request.name,
      toolLabel: descriptor.label,
      toolDescription: descriptor.description,
      toolArgsSummary: descriptor.argsSummary,
      toolResultSummary: descriptor.resultSummary,
      argumentsPreview,
      request: {
        name: request.name,
        args: request.args,
      },
      decision,
      approvalNote: options.approvalNote,
    });
    return {
      status: 'requires_approval',
      sessionId: session.id,
      toolName: request.name,
      decision,
      approvalRequestId,
    };
  }

  if (decision.requiresApproval && options.approvedByUser) {
    appendTrace(session.id, {
      id: traceId(session.id, request.name, 'approved'),
      kind: 'approval_granted',
      message: `${label} approved by the user.`,
      tool,
      decision,
      metadata: {
        approvalNote: options.approvalNote ?? null,
      },
    });
  }

  try {
    const result = await executeToolBody(request, options) as AgentToolResultByName[TName];
    const preview = buildAgentToolResultPreview(request.name, result);
    if (options.approvalRequestId) {
      useAgentSessionStore.getState().resolvePendingApproval(session.id, {
        id: options.approvalRequestId,
        status: 'completed',
        approvalNote: options.approvalNote,
        resultPreview: preview.preview,
      });
    }
    appendTrace(session.id, {
      id: traceId(session.id, request.name, 'result'),
      kind: 'tool_result',
      message: `${label} completed.`,
      tool,
      decision,
      evidenceRefs: request.name === 'evidence.resolve'
        ? (result as AiPromptContext).evidenceRefs
        : undefined,
      metadata: {
        resultSize: resultSize(result),
        ...preview.metadata,
      },
    });

    if (request.name === 'evidence.resolve') {
      appendTrace(session.id, {
        id: traceId(session.id, request.name, 'context'),
        kind: 'context_resolved',
        message: 'Evidence context resolved through Tool Broker.',
        evidenceRefs: (result as AiPromptContext).evidenceRefs,
        tool,
        decision,
        metadata: {
          contextNodes: (result as AiPromptContext).nodes.length,
          truncated: (result as AiPromptContext).truncated,
        },
      });
    }

    if (request.name === 'workbench.createDraft') {
      const draftRequest = request as Extract<AgentToolRequest, { name: 'workbench.createDraft' }>;
      const draftId = (result as { draftId: string }).draftId;
      appendTrace(session.id, {
        id: traceId(session.id, request.name, 'draft'),
        kind: 'draft_created',
        message: 'Workbench draft created through Tool Broker.',
        artifactId: draftId,
        targetPath: draftRequest.args.draft.targetPath,
        evidenceRefs: draftRequest.args.draft.sourceRefs,
        tool,
        decision,
      });
    }

    if (request.name === 'workbench.createProposal') {
      const proposalRequest = request as Extract<AgentToolRequest, { name: 'workbench.createProposal' }>;
      appendTrace(session.id, {
        id: traceId(session.id, request.name, 'proposal'),
        kind: 'proposal_created',
        message: 'Workbench proposal created through Tool Broker.',
        artifactId: proposalRequest.args.proposal.id,
        evidenceRefs: proposalRequest.args.proposal.sourceRefs,
        tool,
        decision,
      });
    }

    if (request.name === 'memory.write') {
      const memoryResult = result as { memoryId: string; memory: AgentMemoryEntry };
      useAgentSessionStore.getState().addMemorySnapshotIds(session.id, [memoryResult.memoryId]);
      const updatedSession = useAgentSessionStore.getState().getSession(session.id);
      const memorySnapshotIdsPreview = (updatedSession?.memorySnapshotIds ?? []).slice(-8).join(',');
      appendTrace(session.id, {
        id: traceId(session.id, request.name, 'memory'),
        kind: 'memory_updated',
        message: `Agent memory saved: ${memoryResult.memory.title}.`,
        artifactId: memoryResult.memoryId,
        tool,
        decision,
        metadata: {
          memoryId: memoryResult.memoryId,
          memoryScope: memoryResult.memory.scope,
          memoryTitle: memoryResult.memory.title,
          memorySourceFingerprint: memoryResult.memory.source.fingerprint ?? null,
          memorySnapshotIdsPreview,
        },
      });
    }

    return {
      status: 'completed',
      sessionId: session.id,
      toolName: request.name,
      decision,
      result,
      resultPreview: preview.preview,
      resultMetadata: preview.metadata,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic = classifyAgentError({
      error,
      stage: 'tool.execute',
      toolName: request.name,
    });
    if (options.approvalRequestId) {
      useAgentSessionStore.getState().resolvePendingApproval(session.id, {
        id: options.approvalRequestId,
        status: 'failed',
        approvalNote: options.approvalNote,
        error: message,
      });
    }
    appendTrace(session.id, {
      id: traceId(session.id, request.name, 'failed'),
      kind: 'error',
      message: `${label} failed: ${message}`,
      error: message,
      tool,
      decision,
      metadata: agentErrorMetadata(diagnostic),
    });
    return {
      status: 'failed',
      sessionId: session.id,
      toolName: request.name,
      decision,
      error: message,
    };
  }
}

export async function approveAgentToolRequest(
  approvalRequestId: string,
  options: {
    approvalNote?: string;
    runCode?: AgentToolExecutionOptions['runCode'];
  } = {},
): Promise<AgentToolExecutionResult> {
  const agentStore = useAgentSessionStore.getState();
  const pending = agentStore.getPendingApproval(approvalRequestId);
  if (!pending) {
    throw new Error(`Agent approval request not found: ${approvalRequestId}`);
  }

  if (pending.approval.status !== 'pending') {
    throw new Error(`Agent approval request is already ${pending.approval.status}.`);
  }

  if (!isAgentToolRequest(pending.approval.request)) {
    throw new Error(`Agent approval request cannot be replayed: ${approvalRequestId}`);
  }

  agentStore.resolvePendingApproval(pending.session.id, {
    id: approvalRequestId,
    status: 'executing',
    approvalNote: options.approvalNote ?? pending.approval.approvalNote,
  });

  return executeAgentTool(pending.approval.request, {
    sessionId: pending.session.id,
    approvedByUser: true,
    approvalRequestId,
    approvalNote: options.approvalNote ?? pending.approval.approvalNote,
    runCode: options.runCode,
  });
}

export function rejectAgentToolRequest(
  approvalRequestId: string,
  reason = 'User rejected the tool request.',
): void {
  const agentStore = useAgentSessionStore.getState();
  const pending = agentStore.getPendingApproval(approvalRequestId);
  if (!pending) {
    throw new Error(`Agent approval request not found: ${approvalRequestId}`);
  }

  const tool = {
    capability: pending.approval.capability,
    toolName: pending.approval.toolName,
    argumentsPreview: pending.approval.argumentsPreview,
  };

  appendTrace(pending.session.id, {
    id: traceId(pending.session.id, pending.approval.toolName as AgentToolName, 'rejected'),
    kind: 'cancelled',
    message: reason,
    tool,
    decision: pending.approval.decision,
    metadata: {
      approvalRequestId,
    },
  });

  agentStore.resolvePendingApproval(pending.session.id, {
    id: approvalRequestId,
    status: 'rejected',
    error: reason,
  });
}

export function createAgentToolSession(input: {
  profile: AgentSafetyProfile;
  task: string;
  title?: string;
  evidenceRefs?: EvidenceRef[];
}): string {
  return useAgentSessionStore.getState().createSession({
    profile: input.profile,
    task: input.task,
    title: input.title,
    evidenceRefs: input.evidenceRefs,
  });
}

export async function executeUserApprovedAgentTool<TName extends AgentToolName>(
  request: Extract<AgentToolRequest, { name: TName }>,
  input: {
    profile: AgentSafetyProfile;
    task: string;
    title?: string;
    evidenceRefs?: EvidenceRef[];
    approvalNote?: string;
    runCode?: AgentToolExecutionOptions['runCode'];
  },
): Promise<AgentToolExecutionResult<TName>> {
  const sessionId = createAgentToolSession({
    profile: input.profile,
    task: input.task,
    title: input.title,
    evidenceRefs: input.evidenceRefs,
  });

  const result = await executeAgentTool(request, {
    sessionId,
    approvedByUser: true,
    approvalNote: input.approvalNote,
    runCode: input.runCode,
  });

  if (result.status === 'completed') {
    useAgentSessionStore.getState().completeSession(
      sessionId,
      `${toolLabel(request.name)} completed.`,
    );
    return result;
  }

  if (result.status === 'requires_approval') {
    throw new Error(`${toolLabel(request.name)} still requires approval.`);
  }

  throw new Error(result.error ?? `${toolLabel(request.name)} failed.`);
}
