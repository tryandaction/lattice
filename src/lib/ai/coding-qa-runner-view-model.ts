import type { AgentSession } from './agent-session';
import type {
  AgentPendingApproval,
  AppendAgentTraceInput,
  CreateAgentPendingApprovalInput,
} from './agent-session';
import {
  buildCodingQaCommandPlan,
  formatCodingQaCommandPlan,
  type CodingQaCommandPlan,
  type CodingQaCommandPlanItem,
} from './lattice-skills/coding-qa-command-plan';

export interface CodingQaRunnerContext {
  activeTabPath?: string | null;
  dirtyTabPaths?: string[];
  agentSessions?: AgentSession[];
  requestedCommands?: string[];
}

export interface CodingQaRunnerViewModel {
  targetFiles: string[];
  plan: CodingQaCommandPlan;
  commandCount: number;
  approvalRequiredCount: number;
  rejectedCount: number;
  status: 'empty' | 'ready' | 'blocked';
  summary: string;
  markdown: string;
}

export interface CodingQaRunnerApprovalRequest {
  sessionTitle: string;
  sessionTask: string;
  trace: AppendAgentTraceInput;
  approval: CreateAgentPendingApprovalInput;
}

export interface CodingQaEvidenceCandidate {
  id: string;
  sessionId: string;
  approvalId: string;
  label: string;
  command: string;
  result: string;
  status: 'passed' | 'failed' | 'blocked';
  importedKey: string;
}

const SHARED_CONTRACT_PATTERN = /(?:^|\/)(?:types|schema|schemas|contracts|agent-policy|agent-tool-broker|research-agent-workflows|operation-contract|skill-registry)\b/i;
const DOC_FILE_PATTERN = /\.(?:md|mdx|markdown)$/i;

function normalizePath(path: string | null | undefined): string | null {
  const normalized = (path ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .trim();

  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split('/').some((part) => part === '..')
  ) {
    return null;
  }

  return normalized;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sessionTargetPaths(session: AgentSession): string[] {
  return (session.trace ?? []).flatMap((event) => {
    const targetPath = normalizePath(event.targetPath);
    return targetPath ? [targetPath] : [];
  });
}

function flattenPlanItems(plan: CodingQaCommandPlan): CodingQaCommandPlanItem[] {
  return [...plan.allowed, ...plan.suggested, ...plan.rejected];
}

function approvalArgsCode(approval: AgentPendingApproval): string {
  const args = approval.request.args;
  if (!args || typeof args !== 'object' || !('code' in args)) {
    return '';
  }
  const code = (args as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

function isCodingQaApproval(approval: AgentPendingApproval): boolean {
  if (approval.toolLabel === 'Approval-gated QA Runner') {
    return true;
  }
  return approval.toolName === 'runner.runCode' && approvalArgsCode(approval).includes('Coding QA Runner Plan');
}

function evidenceStatusForApproval(approval: AgentPendingApproval): CodingQaEvidenceCandidate['status'] | null {
  switch (approval.status) {
    case 'completed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'rejected':
      return 'blocked';
    default:
      return null;
  }
}

function statusFor(plan: CodingQaCommandPlan, targetFiles: string[]): CodingQaRunnerViewModel['status'] {
  if (targetFiles.length === 0) {
    return 'empty';
  }
  if (plan.allowed.length === 0 && plan.suggested.length === 0 && plan.rejected.length > 0) {
    return 'blocked';
  }
  return 'ready';
}

function formatRunnerMarkdown(input: {
  targetFiles: string[];
  plan: CodingQaCommandPlan;
  summary: string;
}): string {
  return [
    'Coding QA Runner Plan',
    '',
    `Summary: ${input.summary}`,
    '',
    'Target files:',
    input.targetFiles.length > 0
      ? input.targetFiles.map((path) => `- ${path}`).join('\n')
      : '- No target files inferred.',
    '',
    formatCodingQaCommandPlan(input.plan),
  ].join('\n');
}

export function buildCodingQaRunnerViewModel(context: CodingQaRunnerContext): CodingQaRunnerViewModel {
  const targetFiles = unique([
    normalizePath(context.activeTabPath),
    ...(context.dirtyTabPaths ?? []).map(normalizePath),
    ...(context.agentSessions ?? []).flatMap(sessionTargetPaths),
  ].filter((path): path is string => Boolean(path)));

  const touchedDocs = targetFiles.some((path) => DOC_FILE_PATTERN.test(path));
  const touchedSharedContracts = targetFiles.some((path) => SHARED_CONTRACT_PATTERN.test(path));
  const plan = buildCodingQaCommandPlan({
    targetFiles,
    requestedCommands: context.requestedCommands,
    touchedDocs,
    touchedSharedContracts,
  });
  const items = flattenPlanItems(plan);
  const commandCount = plan.allowed.length + plan.suggested.length;
  const approvalRequiredCount = items.filter((item) => item.approval === 'required').length;
  const rejectedCount = plan.rejected.length;
  const status = statusFor(plan, targetFiles);
  const summary = status === 'empty'
    ? 'No target files inferred; open or dirty a file to build a QA plan.'
    : `${commandCount} approval-gated commands / ${rejectedCount} rejected / ${targetFiles.length} target files`;

  return {
    targetFiles,
    plan,
    commandCount,
    approvalRequiredCount,
    rejectedCount,
    status,
    summary,
    markdown: formatRunnerMarkdown({ targetFiles, plan, summary }),
  };
}

export function buildCodingQaRunnerApprovalRequest(
  view: CodingQaRunnerViewModel,
  options: { now?: number; idPrefix?: string } = {},
): CodingQaRunnerApprovalRequest {
  const now = options.now ?? Date.now();
  const idPrefix = options.idPrefix ?? `coding-qa-${now}`;
  const commandPreview = [...view.plan.allowed, ...view.plan.suggested]
    .map((item) => item.command)
    .join('\n') || 'No approval-gated QA commands inferred.';
  const argumentsPreview = view.markdown.slice(0, 1200);

  return {
    sessionTitle: 'Coding QA approval',
    sessionTask: `Review approval-gated QA plan: ${view.summary}`,
    trace: {
      id: `${idPrefix}:approval-required`,
      kind: 'approval_required',
      timestamp: now,
      message: `Coding QA Runner is requesting approval for ${view.commandCount} planned command${view.commandCount === 1 ? '' : 's'}.`,
      tool: {
        capability: 'run_code',
        toolName: 'runner.runCode',
        argumentsPreview,
      },
      decision: {
        capability: 'run_code',
        permission: 'ask',
        requiresApproval: true,
        allowed: true,
      },
      metadata: {
        approvalRequestId: `${idPrefix}:approval`,
        qaCommandCount: view.commandCount,
        qaRejectedCount: view.rejectedCount,
        qaTargetFileCount: view.targetFiles.length,
      },
    },
    approval: {
      id: `${idPrefix}:approval`,
      capability: 'run_code',
      toolName: 'runner.runCode',
      toolLabel: 'Approval-gated QA Runner',
      toolDescription: 'Review and approve the coding QA plan before any runner action is attempted.',
      toolArgsSummary: `${view.commandCount} planned command${view.commandCount === 1 ? '' : 's'} / ${view.rejectedCount} rejected`,
      toolResultSummary: 'Runner approval result and output summary.',
      argumentsPreview,
      request: {
        name: 'runner.runCode',
        args: {
          language: 'markdown',
          code: [
            view.markdown,
            '',
            'Manual execution commands:',
            commandPreview,
          ].join('\n'),
        },
      },
      decision: {
        capability: 'run_code',
        permission: 'ask',
        requiresApproval: true,
        allowed: true,
      },
      approvalNote: 'Created from Agent Protocol Center QA Runner. Review the plan before approval.',
      now,
    },
  };
}

export function buildCodingQaEvidenceCandidates(sessions: AgentSession[]): CodingQaEvidenceCandidate[] {
  return sessions.flatMap((session) =>
    (session.pendingApprovals ?? []).flatMap((approval): CodingQaEvidenceCandidate[] => {
      const status = evidenceStatusForApproval(approval);
      if (!status || !isCodingQaApproval(approval)) {
        return [];
      }
      const command = approvalArgsCode(approval) || approval.argumentsPreview || approval.toolArgsSummary || approval.toolName;
      const result = approval.resultPreview || approval.error || approval.approvalNote || 'Coding QA approval resolved without output.';
      return [{
        id: `${session.id}:${approval.id}`,
        sessionId: session.id,
        approvalId: approval.id,
        label: `Coding QA Runner ${approval.status}`,
        command,
        result,
        status,
        importedKey: `coding-qa:${session.id}:${approval.id}:${approval.status}`,
      }];
    })
  );
}
