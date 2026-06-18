import { describe, expect, it } from 'vitest';
import {
  addAgentPendingApproval,
  appendAgentTraceEvent,
  createAgentSession,
  resolveAgentPendingApproval,
} from '@/lib/ai/agent-session';
import {
  buildCodingQaRunnerApprovalRequest,
  buildCodingQaEvidenceCandidates,
  buildCodingQaRunnerViewModel,
} from '@/lib/ai/coding-qa-runner-view-model';

describe('coding QA runner view model', () => {
  it('builds an approval-gated QA plan from active, dirty, and agent target files', () => {
    const session = appendAgentTraceEvent(createAgentSession({
      id: 'session-code-review',
      profile: 'research',
      task: 'Review coding change',
      title: 'Coding review',
      now: 100,
    }), {
      kind: 'proposal_created',
      message: 'Created code proposal.',
      timestamp: 120,
      targetPath: 'src/lib/ai/research-agent-workflows.ts',
    });

    const view = buildCodingQaRunnerViewModel({
      activeTabPath: 'src/lib/__tests__/ai-coding-qa-runner-view-model.test.ts',
      dirtyTabPaths: [
        'docs/AI_CODING_AGENT_ROADMAP.md',
        'src/lib/__tests__/ai-coding-qa-runner-view-model.test.ts',
      ],
      agentSessions: [session],
      requestedCommands: [
        'npm run typecheck',
        'git reset --hard',
      ],
    });

    expect(view.status).toBe('ready');
    expect(view.targetFiles).toEqual([
      'src/lib/__tests__/ai-coding-qa-runner-view-model.test.ts',
      'docs/AI_CODING_AGENT_ROADMAP.md',
      'src/lib/ai/research-agent-workflows.ts',
    ]);
    expect(view.plan.allowed.map((item) => item.command)).toEqual(['npm run typecheck']);
    expect(view.plan.suggested.map((item) => item.command)).toEqual([
      'npx vitest run "src/lib/__tests__/ai-coding-qa-runner-view-model.test.ts" --maxWorkers=1',
      'npm run test:docs',
      'npm run qa:agent-smoke -- --unit-only',
    ]);
    expect(view.plan.rejected.map((item) => item.command)).toEqual(['git reset --hard']);
    expect(view.summary).toBe('4 approval-gated commands / 1 rejected / 3 target files');
    expect(view.markdown).toContain('Coding QA Runner Plan');
    expect(view.markdown).toContain('Execution boundary:');
  });

  it('builds a replayable pending approval request for the QA plan', () => {
    const view = buildCodingQaRunnerViewModel({
      activeTabPath: 'src/lib/__tests__/ai-coding-qa-runner-view-model.test.ts',
    });

    const request = buildCodingQaRunnerApprovalRequest(view, {
      now: 123,
      idPrefix: 'qa-request',
    });

    expect(request.sessionTitle).toBe('Coding QA approval');
    expect(request.trace).toMatchObject({
      id: 'qa-request:approval-required',
      kind: 'approval_required',
      metadata: {
        approvalRequestId: 'qa-request:approval',
        qaCommandCount: 3,
        qaRejectedCount: 0,
        qaTargetFileCount: 1,
      },
    });
    expect(request.approval).toMatchObject({
      id: 'qa-request:approval',
      capability: 'run_code',
      toolName: 'runner.runCode',
      request: {
        name: 'runner.runCode',
        args: {
          language: 'markdown',
        },
      },
    });
    expect((request.approval.request.args as { code: string }).code).toContain('Coding QA Runner Plan');
    expect((request.approval.request.args as { code: string }).code).toContain('Manual execution commands:');
  });

  it('maps resolved QA approvals into evidence candidates', () => {
    const view = buildCodingQaRunnerViewModel({
      activeTabPath: 'src/lib/__tests__/ai-coding-qa-runner-view-model.test.ts',
    });
    const request = buildCodingQaRunnerApprovalRequest(view, {
      now: 123,
      idPrefix: 'qa-request',
    });
    const session = resolveAgentPendingApproval(addAgentPendingApproval(createAgentSession({
      id: 'session-qa',
      profile: 'research',
      task: 'QA approval',
      title: 'QA approval',
      now: 100,
    }), request.approval), {
      id: request.approval.id,
      status: 'completed',
      resultPreview: 'Runner output captured.',
      now: 140,
    });

    const candidates = buildCodingQaEvidenceCandidates([session]);

    expect(candidates).toEqual([
      expect.objectContaining({
        sessionId: 'session-qa',
        approvalId: 'qa-request:approval',
        label: 'Coding QA Runner completed',
        result: 'Runner output captured.',
        status: 'passed',
        importedKey: 'coding-qa:session-qa:qa-request:approval:completed',
      }),
    ]);
    expect(candidates[0]?.command).toContain('Coding QA Runner Plan');
  });

  it('stays empty when no target files are inferred', () => {
    const view = buildCodingQaRunnerViewModel({});

    expect(view.status).toBe('empty');
    expect(view.targetFiles).toEqual([]);
    expect(view.summary).toContain('No target files inferred');
    expect(view.plan.suggested.map((item) => item.command)).toEqual(['npm run typecheck']);
  });
});
