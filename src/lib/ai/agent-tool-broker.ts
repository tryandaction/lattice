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
  AgentCodeExecutionReceipt,
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
import { useScheduledTaskStore } from '@/stores/scheduled-task-store';
import type { ScheduledTaskSchedule } from '@/lib/ai/scheduled-tasks';
import type { LatticeSourcePdfToolName, LatticeSourcePdfToolResult } from './lattice-skills/source-pdf-tool-runtime';
import { LATTICE_HARNESS_TOOLS, validateLatticeHarnessArgs } from './harness/lattice-tool-definitions';
import type { AgentSourceSelection } from './source-index';
export type { LatticeSourcePdfToolName } from './lattice-skills/source-pdf-tool-runtime';
export type LatticeApiToolName = typeof LATTICE_HARNESS_TOOLS[number]['name'];
export interface LatticeApiToolDefinition { name: string; description: string; parameters: unknown }
/** The API agent delegates to the same authorized runtime as Harness. */
export interface LatticeApiToolRuntime {
  execute(name: string, args: unknown, signal?: AbortSignal): Promise<unknown>;
  tools?: readonly LatticeApiToolDefinition[];
  sourceSelections?: readonly AgentSourceSelection[];
  /** Actual request-local read scope, separate from the question's priority sources. */
  authorizedSourceSelections?: readonly AgentSourceSelection[];
  requireSourceDiscovery?: boolean;
}
export function isLatticeApiToolName(name: string): name is LatticeApiToolName {
  return LATTICE_HARNESS_TOOLS.some(tool => tool.name === name);
}

export type AgentToolName =
  | LatticeApiToolName
  | 'workspace.search'
  | 'workspace.readIndexedContext'
  | 'lattice.resolvePathIdentity'
  | 'evidence.resolve'
  | 'workbench.createDraft'
  | 'workbench.createProposal'
  | 'runner.runCode'
  | 'memory.write'
  | 'schedule_task';
export interface LatticeSourcePdfExecutionRuntime { execute(name: string, args: unknown, signal?: AbortSignal): Promise<LatticeSourcePdfToolResult> }

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

// Canonical, lossless signature: approval reuse never relies on a truncated preview.
export function buildRunCodeRequestSignature(args: RunCodeToolArgs): string {
  return `runner.runCode:${JSON.stringify({ language: args.language, code: args.code })}`;
}

const MAX_RUNNER_RECEIPT_CHARACTERS = 32000;

function buildRunCodeExecutionReceipt(
  request: Extract<AgentToolRequest, { name: 'runner.runCode' }>,
  sessionId: string,
  approvalRequestId: string,
  status: AgentCodeExecutionReceipt['status'],
  output: string,
): AgentCodeExecutionReceipt {
  return { sessionId, approvalRequestId, requestSignature: buildRunCodeRequestSignature(request.args), status,
    output: output.slice(0, MAX_RUNNER_RECEIPT_CHARACTERS), outputLength: output.length, truncated: output.length > MAX_RUNNER_RECEIPT_CHARACTERS };
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

export interface ScheduleTaskToolArgs {
  title: string;
  prompt?: string;
  schedule: ScheduledTaskSchedule;
  maxRetries?: number;
}

export type AgentToolRequest =
  | { [T in LatticeApiToolName]: { name: T; args: Record<string, unknown> } }[LatticeApiToolName]
  | { name: 'workspace.search'; args: WorkspaceSearchToolArgs }
  | { name: 'workspace.readIndexedContext'; args: ReadIndexedContextToolArgs }
  | { name: 'lattice.resolvePathIdentity'; args: ResolveLatticePathIdentityToolArgs }
  | { name: 'evidence.resolve'; args: ResolveEvidenceToolArgs }
  | { name: 'workbench.createDraft'; args: CreateDraftToolArgs }
  | { name: 'workbench.createProposal'; args: CreateProposalToolArgs }
  | { name: 'runner.runCode'; args: RunCodeToolArgs }
  | { name: 'memory.write'; args: WriteMemoryToolArgs }
  | { name: 'schedule_task'; args: ScheduleTaskToolArgs };

export type AgentToolResultByName = Record<Exclude<LatticeApiToolName, LatticeSourcePdfToolName>, unknown> & {
  'lattice.sources.list': LatticeSourcePdfToolResult;
  'lattice.sources.search': LatticeSourcePdfToolResult;
  'lattice.sources.read': LatticeSourcePdfToolResult;
  'lattice.pdf.proposeChild': LatticeSourcePdfToolResult;
  'workspace.search': FileIndex[];
  'workspace.readIndexedContext': string;
  'lattice.resolvePathIdentity': LatticePathIdentity;
  'evidence.resolve': AiPromptContext;
  'workbench.createDraft': { draftId: string };
  'workbench.createProposal': { proposalId: string };
  'runner.runCode': { output: string };
  'memory.write': { memoryId: string; memory: AgentMemoryEntry };
  'schedule_task': { taskId: string };
};

export type AgentToolExecutionStatus =
  | 'completed'
  | 'requires_approval'
  | 'denied'
  | 'failed';

export interface AgentToolExecutionOptions {
  /** The research loop owns the terminal decision after its bounded source recovery. */
  deferSourceReadFailure?: boolean;
  apiToolRuntime?: LatticeApiToolRuntime;
  latticeSourcePdfRuntime?: LatticeSourcePdfExecutionRuntime;
  signal?: AbortSignal;
  sessionId: string;
  planStepId?: string;
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
  ...Object.fromEntries(LATTICE_HARNESS_TOOLS.map(tool => [tool.name, {
    name: tool.name,
    // These tools only prepare a draft. Actual persistence remains in Workbench.
    capability: tool.name.includes('.propose') ? 'prepare_pdf_child' : tool.name === 'lattice.sources.search' ? 'search_workspace' : 'read_workspace',
    label: tool.name, description: tool.description,
    argsSummary: JSON.stringify(tool.parameters),
    resultSummary: tool.name.includes('.propose') ? 'Concrete draft pending Workbench user review; no file was applied.' : 'Actual runtime result with bounded evidence and coverage where available.',
  }])) as Record<LatticeApiToolName, AgentToolDescriptor>,
  'lattice.sources.list': { name: 'lattice.sources.list', capability: 'read_workspace', label: '列出授权来源', description: 'List selected source metadata; previews are not evidence.', argsSummary: '{cursor?,limit?}', resultSummary: 'Bounded authorized source entries and next cursor.' },
  'lattice.sources.search': { name: 'lattice.sources.search', capability: 'search_workspace', label: '搜索实际来源', description: 'Search actual extracted units in the selected scope.', argsSummary: '{query,cursor?,maxFiles?,maxChars?,maxUnits?}', resultSummary: 'Read chunks, revisions, coverage and locators.' },
  'lattice.sources.read': { name: 'lattice.sources.read', capability: 'read_workspace', label: '读取实际来源', description: 'Read revision-checked source units within the selected scope.', argsSummary: '{path,expectedVersion?,units?,offsets?,maxChars?,maxUnits?}', resultSummary: 'Actual chunks, revisions and remaining coverage.' },
  'lattice.pdf.proposeChild': { name: 'lattice.pdf.proposeChild', capability: 'prepare_pdf_child', label: '准备 PDF 子文件审查', description: 'Prepare a concrete PDF child proposal; never approve or write files.', argsSummary: '{parentPath,parentItemId?,fileName,content,mode}', resultSummary: 'Manifest-bound child draft waiting for Workbench review.' },
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
  'schedule_task': {
    name: 'schedule_task',
    capability: 'schedule_task',
    label: 'Schedule task',
    description: 'Create a local scheduled task after explicit automation approval.',
    argsSummary: '{ title: string, prompt?: string, schedule: once|interval, maxRetries?: number }',
    resultSummary: 'Created scheduled task id and next run state.',
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
  if (isLatticeApiToolName(toolName)) {
    const value = result && typeof result === 'object' ? result as Record<string, unknown> : {};
    const entries = Array.isArray(value.entries) ? value.entries : [];
    const chunks = Array.isArray(value.chunks) ? value.chunks : Array.isArray(value.reads)
      ? value.reads.flatMap(read => read && typeof read === 'object' && Array.isArray(read.chunks) ? read.chunks : []) : [];
    const evidenceCount = chunks.filter(chunk => chunk && typeof chunk === 'object' && typeof chunk.text === 'string' && chunk.text.trim()).length;
    const status = typeof value.status === 'string' ? value.status : value.complete === false ? 'partial' : 'completed';
    const preview = fallbackResultPreview(result);
    return { preview, metadata: {
      ...buildResultEnvelopeMetadata({ toolName, preview, status: value.complete === false ? 'partial' : 'completed',
        summary: toolName.includes('.propose') ? 'Concrete Workbench draft prepared; user review and persistence remain pending.' : preview }),
      resultStatus: status,
      resultSize: resultSize(result), resultItemCount: entries.length || chunks.length,
      evidenceCount, complete: typeof value.complete === 'boolean' ? value.complete : null,
      nextCursor: typeof value.nextCursor === 'number' ? value.nextCursor : null,
      scannedChars: typeof value.scannedChars === 'number' ? value.scannedChars : null,
      pendingUnitCount: Array.isArray(value.pendingUnits) ? value.pendingUnits.length : null,
      pendingUnitsPreview: Array.isArray(value.pendingUnits) ? JSON.stringify(value.pendingUnits.slice(0, 30)) : null,
    } };
  }
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
    case 'schedule_task': {
      const task = result as { taskId: string };
      const preview = `Scheduled task created: ${task.taskId}.`;
      return {
        preview,
        metadata: {
          ...buildResultEnvelopeMetadata({
            toolName: 'schedule_task',
            preview,
            summary: 'Scheduled task created after approval.',
            artifacts: task.taskId,
          }),
          artifactId: task.taskId,
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
  if (isLatticeApiToolName(request.name)) {
    const runtime = options.apiToolRuntime ?? options.latticeSourcePdfRuntime;
    if (!runtime) throw new Error('当前请求没有绑定授权 Lattice runtime，工具未执行。');
    return runtime.execute(request.name, validateLatticeHarnessArgs(request.name, request.args), options.signal);
  }
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
      await useAgentMemoryStore.getState().loadMemories();
      if (!useAgentMemoryStore.getState().loaded || useAgentMemoryStore.getState().persistenceError) {
        throw new Error('Memory persistence failed; the preference remains only in this session and was not confirmed saved.');
      }
      const memory = useAgentMemoryStore.getState().getMemory(memoryId);
      if (!memory) {
        throw new Error(`Memory write failed: ${memoryId}`);
      }
      return { memoryId, memory };
    }
    case 'schedule_task': {
      const task = useScheduledTaskStore.getState().createTask(request.args);
      return { taskId: task.id };
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

  if (request.name === 'schedule_task' && !useScheduledTaskStore.getState().executorAvailable) {
    const error = 'Scheduled AI execution is unavailable in this version.';
    // The caller owns the run's terminal transition; an unavailable tool is an
    // observation that must remain recordable by the surrounding plan loop.
    appendTrace(session.id, { id: traceId(session.id, request.name, 'unavailable'), kind: 'tool_result', message: error, tool, decision, metadata: { resultStatus: 'failed', resultSummary: error } });
    return { status: 'failed', sessionId: session.id, toolName: request.name, decision, error };
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
      planStepId: options.planStepId,
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
        ...(request.name === 'runner.runCode' ? {
          executionReceipt: buildRunCodeExecutionReceipt(request as Extract<AgentToolRequest, { name: 'runner.runCode' }>, session.id, options.approvalRequestId, 'completed', (result as { output: string }).output),
        } : {}),
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
        ...(request.name === 'runner.runCode' ? {
          executionReceipt: buildRunCodeExecutionReceipt(request as Extract<AgentToolRequest, { name: 'runner.runCode' }>, session.id, options.approvalRequestId, 'failed', message),
        } : {}),
      });
    }
    const sourceFailureObservation = options.deferSourceReadFailure
      && ['lattice.sources.read', 'lattice.sources.search', 'lattice.sources.active'].includes(request.name);
    appendTrace(session.id, {
      id: traceId(session.id, request.name, 'failed'),
      kind: sourceFailureObservation ? 'tool_result' : 'error',
      message: `${label} failed: ${message}`,
      error: message,
      tool,
      decision,
      metadata: { ...agentErrorMetadata(diagnostic), resultStatus: 'failed' },
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
