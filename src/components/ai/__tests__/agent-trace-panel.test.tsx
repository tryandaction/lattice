/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { defaultRunCodeMock } = vi.hoisted(() => ({
  defaultRunCodeMock: vi.fn(),
}));

const storage = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/lib/storage-adapter', () => ({
  getStorageAdapter: () => storage,
}));

vi.mock('@/lib/ai/agent-runner-tool', () => ({
  runCodeWithWorkspaceRunner: defaultRunCodeMock,
}));

vi.mock('@/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const mapping: Record<string, string> = {
        'chat.agentTrace.title': 'Agent Trace',
        'chat.agentTrace.sessions': '{count} runs',
        'chat.agentTrace.recentRuns': 'Recent runs',
        'chat.agentTrace.timeline': 'Timeline',
        'chat.agentTrace.plan': 'Plan',
        'chat.agentTrace.emptyPlan': 'No plan steps recorded.',
        'chat.agentTrace.planSource': 'source: {source}',
        'chat.agentTrace.planWarnings': '{count} warnings',
        'chat.agentTrace.plannerDetails': 'Planner details',
        'chat.agentTrace.plannerPrompt': 'Planner prompt preview',
        'chat.agentTrace.plannerRawOutput': 'Planner raw output preview',
        'chat.agentTrace.summary.title': 'Run summary',
        'chat.agentTrace.summary.workflow': 'Workflow',
        'chat.agentTrace.summary.plan': 'Plan metric',
        'chat.agentTrace.summary.tools': 'Tools',
        'chat.agentTrace.summary.evidence': 'Evidence',
        'chat.agentTrace.summary.approvals': 'Approvals',
        'chat.agentTrace.summary.pending': '{count} pending',
        'chat.agentTrace.summary.omitted': 'Omitted',
        'chat.agentTrace.summary.tokens': '{count} tokens',
        'chat.agentTrace.summary.memory': 'Memory',
        'chat.agentTrace.details': 'Details',
        'chat.agentTrace.arguments': 'Arguments',
        'chat.agentTrace.toolContract': 'Tool contract',
        'chat.agentTrace.toolArguments': 'Arguments',
        'chat.agentTrace.resultContract': 'Result contract',
        'chat.agentTrace.resultPreview': 'Result',
        'chat.agentTrace.resultSchema': 'Result schema',
        'chat.agentTrace.resultStatus': 'Status',
        'chat.agentTrace.resultSummary': 'Summary',
        'chat.agentTrace.resultMetrics': 'Metrics',
        'chat.agentTrace.resultArtifacts': 'Artifacts',
        'chat.agentTrace.resultDiagnostics': 'Diagnostics',
        'chat.agentTrace.metadata': 'Metadata',
        'chat.agentTrace.omittedContext': 'Omitted context',
        'chat.agentTrace.omittedContextSummary': '{count} items omitted, about {tokens} tokens.',
        'chat.agentTrace.omittedAutoSummary': 'Auto summary',
        'chat.agentTrace.omittedModelSummary': 'Model summary',
        'chat.agentTrace.omittedModelSummaryQuality': 'Model summary quality',
        'chat.agentTrace.omittedRecoveryPriority': 'Recovery priority',
        'chat.agentTrace.omittedRecoveryPlan': 'Recovery plan',
        'chat.agentTrace.observationReplan': 'Observation replan',
        'chat.agentTrace.observationReplanSummary': '{count} tool observations reviewed.',
        'chat.agentTrace.observationReplanIteration': 'Iteration',
        'chat.agentTrace.observationReplanStopReason': 'Stop reason',
        'chat.agentTrace.observationQuality': 'Quality',
        'chat.agentTrace.observationQualityCounts': 'Quality counts',
        'chat.agentTrace.recoveryObservations': 'Recovery observations',
        'chat.agentTrace.observationRecoveryRecommendation': 'Recovery recommendation',
        'chat.agentTrace.recoveryQuality': 'Recovery quality',
        'chat.agentTrace.recoveredContextDigest': 'Recovered context digest',
        'chat.agentTrace.updatedSteps': 'Updated steps',
        'chat.agentTrace.ignoredSteps': 'Ignored steps',
        'chat.agentTrace.observationsPreview': 'Observations',
        'chat.agentTrace.restoreAudit': 'Restored context',
        'chat.agentTrace.restoreAuditSummary': 'Resumed from prior trace state.',
        'chat.agentTrace.approvalResumeSummary': 'Approval resumed with prior synthesis context.',
        'chat.agentTrace.approval': 'Approval',
        'chat.agentTrace.evidenceContext': 'Evidence context',
        'chat.agentTrace.answerPreview': 'Answer',
        'chat.agentTrace.synthesisPreview': 'Synthesis',
        'chat.agentTrace.continuationRecovery': 'Continuation recovery',
        'chat.agentTrace.continuationRecoverySummary': '{count} evidence refs recovered.',
        'chat.agentTrace.continuationRecoveredSummary': 'Summary',
        'chat.agentTrace.continuationRecoveryHints': 'Recovery hints',
        'chat.agentTrace.continuationRecoveryPriority': 'Recovery priority',
        'chat.agentTrace.continuationRecoveryPlan': 'Recovery plan',
        'chat.agentTrace.continuationRecoveryAutoSummary': 'Auto summary',
        'chat.agentTrace.continuationRecoveryModelSummary': 'Model summary',
        'chat.agentTrace.continuationRecoveryReads': 'Recovery reads',
        'chat.agentTrace.continuationRecoverySemantic': 'Semantic preview',
        'chat.agentTrace.memorySuggestion': 'Memory suggestion',
        'chat.agentTrace.memorySuggestionAccepted': 'Ready for approval.',
        'chat.agentTrace.memorySuggestionSkipped': 'Skipped before approval.',
        'chat.agentTrace.memoryConfidence': '{count}% confidence',
        'chat.agentTrace.memoryAnswerPreview': 'Answer',
        'chat.agentTrace.memoryApplicability': 'Applicability',
        'chat.agentTrace.memoryEvidenceSummary': 'Evidence',
        'chat.agentTrace.memoryCaution': 'Caution',
        'chat.agentTrace.memoryContextPack': 'Context pack',
        'chat.agentTrace.memoryOmittedCount': '{count} omitted',
        'chat.agentTrace.memoryOmittedPreview': 'Omitted context',
        'chat.agentTrace.memoryOmittedAutoSummary': 'Omitted auto summary',
        'chat.agentTrace.memoryOmittedModelSummary': 'Omitted model summary',
        'chat.agentTrace.memoryRecoveryObservations': 'Recovery observations',
        'chat.agentTrace.memoryRecoveredContextDigest': 'Recovered context digest',
        'chat.agentTrace.memoryReason': 'Reason',
        'chat.agentTrace.memoryReasonCode': 'Reason code',
        'chat.agentTrace.memoryPolicy': 'Memory policy',
        'chat.agentTrace.memoryDuplicate': 'Duplicate',
        'chat.agentTrace.memorySourceFingerprint': 'Source fingerprint',
        'chat.agentTrace.memoryRead': 'Memory read',
        'chat.agentTrace.memoryReadSummary': '{count} scoped memories loaded.',
        'chat.agentTrace.memoryIds': 'Memory ids',
        'chat.agentTrace.memoryRanking': 'Ranking',
        'chat.agentTrace.memoryLifecycle': 'Lifecycle',
        'chat.agentTrace.memoryLifecycleReview': 'Lifecycle review',
        'chat.agentTrace.memoryRankingQuery': 'Ranking query',
        'chat.agentTrace.memoryScopes': 'Scopes',
        'chat.agentTrace.memoryFilters': 'Filters',
        'chat.agentTrace.memoryLimit': 'Limit',
        'chat.agentTrace.compactions': 'Compactions',
        'chat.agentTrace.compactedEvents': '{count} compacted events',
        'chat.agentTrace.retainedEvents': '{count} retained events',
        'chat.agentTrace.sourceKinds': 'Source kinds',
        'chat.agentTrace.fillContinuationPrompt': 'Continue in chat',
        'chat.agentTrace.continuationFilled': 'Continuation prompt added to chat',
        'chat.agentTrace.copyContinuationPrompt': 'Copy continuation prompt',
        'chat.agentTrace.continuationCopied': 'Continuation prompt copied',
        'chat.agentTrace.continuationCopyFailed': 'Unable to copy continuation prompt',
        'chat.agentTrace.lineage': 'Lineage',
        'chat.agentTrace.continuedFrom': 'Continued from',
        'chat.agentTrace.continuedBy': 'Continued by',
        'chat.agentTrace.emptyTimeline': 'No trace events yet.',
        'chat.agentTrace.eventCount': '{count} events',
        'chat.agentTrace.pendingApprovals': '{count} approvals',
        'chat.agentTrace.resume': 'Resume after approval',
        'chat.agentTrace.pendingApprovalTitle': 'Pending approvals',
        'chat.agentTrace.approvalResultsTitle': 'Approval results',
        'chat.agentTrace.approve': 'Approve and run',
        'chat.agentTrace.reject': 'Reject request',
        'chat.agentTrace.approveFailed': 'Approval failed',
        'chat.agentTrace.rejectFailed': 'Reject failed',
        'chat.agentTrace.copyDebugBundle': 'Copy debug bundle',
        'chat.agentTrace.debugBundleCopied': 'Debug bundle copied',
        'chat.agentTrace.debugBundleCopyFailed': 'Unable to copy debug bundle',
        'chat.agentTrace.cancel': 'Cancel run',
        'chat.agentTrace.delete': 'Delete run',
        'chat.agentTrace.errorCategory': 'Category',
        'chat.agentTrace.errorStage': 'Stage',
        'chat.agentTrace.errorRecovery': 'Recovery',
        'chat.agentTrace.status.running': 'Running',
        'chat.agentTrace.status.waitingApproval': 'Waiting approval',
        'chat.agentTrace.status.completed': 'Completed',
        'chat.agentTrace.status.failed': 'Failed',
        'chat.agentTrace.status.cancelled': 'Cancelled',
        'chat.agentTrace.permission.ask': 'Approval',
        'chat.agentTrace.approvalStatus.pending': 'Pending',
        'chat.agentTrace.approvalStatus.approved': 'Approved',
        'chat.agentTrace.approvalStatus.rejected': 'Rejected',
        'chat.agentTrace.approvalStatus.executing': 'Executing',
        'chat.agentTrace.approvalStatus.completed': 'Completed',
        'chat.agentTrace.approvalStatus.failed': 'Failed',
        'chat.agentTrace.event.sessionStarted': 'Session started',
        'chat.agentTrace.event.approvalRequired': 'Approval required',
        'chat.agentTrace.event.approvalGranted': 'Approval granted',
        'chat.agentTrace.event.cancelled': 'Cancelled',
        'chat.evidenceCount': '{count} evidence',
      };
      let text = mapping[key] ?? key;
      if (params) {
        Object.entries(params).forEach(([param, value]) => {
          text = text.replace(`{${param}}`, String(value));
        });
      }
      return text;
    },
  }),
}));

import { AgentTracePanel } from '../agent-trace-panel';
import { useAiChatStore } from '@/stores/ai-chat-store';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { executeAgentTool } from '@/lib/ai/agent-tool-broker';

describe('AgentTracePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => undefined),
      },
    });
    defaultRunCodeMock.mockResolvedValue({ output: 'default runner output' });
    useAgentSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      focusTarget: null,
    });
    useAiChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isOpen: false,
      isGenerating: false,
      abortController: null,
      selectedResearchWorkflowId: null,
      composerDraft: null,
    });
  });

  it('shows waiting approval state and executes an approved pending tool request', async () => {
    useAgentSessionStore.getState().createSession({
      id: 'session-approval',
      profile: 'research',
      task: 'Create a reading-note draft',
      title: 'Reading-note agent',
      now: 100,
    });
    const blocked = await executeAgentTool({
      name: 'runner.runCode',
      args: { language: 'javascript', code: '2 + 2' },
    }, {
      sessionId: 'session-approval',
      runCode: async () => ({ output: '4' }),
    });
    const runCode = vi.fn(async () => ({ output: '4' }));

    render(<AgentTracePanel runCode={runCode} />);

    expect(screen.getByText('Agent Trace')).toBeTruthy();
    const traceToggle = screen.getByRole('button', { name: /Agent Trace/ });
    expect(traceToggle.getAttribute('aria-expanded')).toBe('true');
    expect(traceToggle.getAttribute('aria-controls')).toBe('agent-trace-panel-body');
    expect(screen.getByRole('button', { name: /Reading-note agent/ }).getAttribute('aria-current')).toBe('true');
    expect(screen.getAllByText('Waiting approval').length).toBeGreaterThan(0);
    expect(screen.getByText('Pending approvals')).toBeTruthy();
    expect(screen.getByText('Approval required')).toBeTruthy();
    expect(screen.getByText('Run code requires user approval before execution.')).toBeTruthy();
    expect(screen.getByText('Run code')).toBeTruthy();
    expect(screen.getByText('Run code through the workspace runner after approval.')).toBeTruthy();
    expect(screen.getByText((content) => content.includes('{ language: string, code: string }'))).toBeTruthy();
    expect(screen.getByText((content) => content.includes('Runner output text.'))).toBeTruthy();

    fireEvent.click(screen.getByTitle('Approve and run'));

    await waitFor(() => {
      expect(useAgentSessionStore.getState().getSession('session-approval')?.status).toBe('running');
      expect(screen.getByText('Approval results')).toBeTruthy();
      expect(screen.getAllByText('Result').length).toBeGreaterThan(0);
      expect(screen.getAllByText('4').length).toBeGreaterThan(0);
    });
    expect(blocked.status).toBe('requires_approval');
    expect(runCode).toHaveBeenCalledWith({ language: 'javascript', code: '2 + 2' });
    expect(useAgentSessionStore.getState().getSession('session-approval')?.pendingApprovals[0]).toMatchObject({
      id: blocked.approvalRequestId,
      status: 'completed',
      resultPreview: expect.stringContaining('4'),
    });
    expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
  });

  it('approves a pending code run through the default workspace runner', async () => {
    useAgentSessionStore.getState().createSession({
      id: 'session-default-runner',
      profile: 'research',
      task: 'Run code through default runner',
      title: 'Default runner agent',
      now: 100,
    });
    const blocked = await executeAgentTool({
      name: 'runner.runCode',
      args: { language: 'javascript', code: 'console.log("ok")' },
    }, {
      sessionId: 'session-default-runner',
    });

    render(<AgentTracePanel />);

    expect(defaultRunCodeMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Approve and run'));

    await waitFor(() => {
      expect(defaultRunCodeMock).toHaveBeenCalledWith({
        language: 'javascript',
        code: 'console.log("ok")',
      });
    });
    expect(blocked.status).toBe('requires_approval');
    expect(useAgentSessionStore.getState().getSession('session-default-runner')?.pendingApprovals[0]).toMatchObject({
      id: blocked.approvalRequestId,
      status: 'completed',
      resultPreview: expect.stringContaining('default runner output'),
    });
  });

  it('auto-reconciles research agent approvals after approved tool execution', async () => {
    const store = useAgentSessionStore.getState();
    store.createSession({
      id: 'session-research-reconcile',
      profile: 'research',
      task: 'Approve code inside a research run',
      title: 'Research reconcile agent',
      now: 100,
    });
    store.appendTrace('session-research-reconcile', {
      id: 'session-research-reconcile:plan-created',
      kind: 'planning',
      timestamp: 101,
      message: 'Created research plan with 4 steps.',
      metadata: {
        agentKind: 'research_agent',
        planStepCount: 4,
        planSource: 'custom',
        planWarningCount: 0,
      },
    });
    const blocked = await executeAgentTool({
      name: 'runner.runCode',
      args: { language: 'javascript', code: '2 + 2' },
    }, {
      sessionId: 'session-research-reconcile',
      runCode: async () => ({ output: '4' }),
    });
    const runCode = vi.fn(async () => ({ output: '4' }));

    render(<AgentTracePanel runCode={runCode} />);

    fireEvent.click(screen.getByTitle('Approve and run'));

    await waitFor(() => {
      expect(useAgentSessionStore.getState().getSession('session-research-reconcile')?.status).toBe('completed');
    });
    expect(blocked.status).toBe('requires_approval');
    expect(runCode).toHaveBeenCalledWith({ language: 'javascript', code: '2 + 2' });
    const session = useAgentSessionStore.getState().getSession('session-research-reconcile');
    expect(session?.result).toContain('Research agent completed after 1 approved tool');
    expect(session?.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'planning',
          metadata: expect.objectContaining({
            planStepId: 'run-code',
            planStepStatus: 'completed',
            toolName: 'runner.runCode',
          }),
        }),
        expect.objectContaining({ kind: 'completed' }),
      ]),
    );
  });

  it('cancels and deletes sessions from the trace panel', async () => {
    useAgentSessionStore.getState().createSession({
      id: 'session-cancel',
      profile: 'research',
      task: 'Inspect notebook outputs',
      title: 'Notebook agent',
      now: 100,
    });

    render(<AgentTracePanel />);

    expect(screen.getAllByText('Notebook agent').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Notebook agent/ }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete run' })).toBeTruthy();

    fireEvent.click(screen.getByTitle('Cancel run'));

    await waitFor(() => {
      expect(useAgentSessionStore.getState().getSession('session-cancel')?.status).toBe('cancelled');
    });
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTitle('Delete run'));

    await waitFor(() => {
      expect(useAgentSessionStore.getState().getSession('session-cancel')).toBeNull();
    });
  });

  it('copies a bounded session debug bundle from the trace panel', async () => {
    const store = useAgentSessionStore.getState();
    store.createSession({
      id: 'session-debug-copy',
      profile: 'research',
      task: 'Copy debug bundle',
      title: 'Debug copy agent',
      contextPackId: 'context-pack-copy',
      now: 100,
    });
    store.appendTrace('session-debug-copy', {
      id: 'session-debug-copy:tool',
      kind: 'tool_result',
      timestamp: 101,
      message: 'Resolved evidence.',
      metadata: {
        resultStatus: 'completed',
        resultSummary: '1 context node.',
      },
    });

    render(<AgentTracePanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy debug bundle' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('"schemaVersion": 1'));
    });
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0] as string;
    expect(copied).toContain('"id": "session-debug-copy"');
    expect(copied).toContain('"contextPackId": "context-pack-copy"');
    expect(copied).toContain('"resultSummary": "1 context node."');
    expect(copied).not.toContain('"request"');
    expect(copied).not.toContain('"args"');
  });

  it('expands when a chat action focuses the trace panel', async () => {
    useAgentSessionStore.getState().createSession({
      id: 'session-focus-trace',
      profile: 'research',
      task: 'Focused trace run',
      title: 'Focused trace',
      now: 100,
    });

    render(<AgentTracePanel />);

    expect(screen.getAllByText('Focused trace run').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Agent Trace'));
    expect(screen.queryByText('Focused trace run')).toBeNull();

    useAgentSessionStore.getState().focusSession('session-focus-trace', 'trace');

    await waitFor(() => {
      expect(screen.getAllByText('Focused trace run').length).toBeGreaterThan(0);
    });
    expect(useAgentSessionStore.getState().focusTarget).toBeNull();
  });

  it('renders research plan steps, planner warnings, details, and compaction summaries', async () => {
    const store = useAgentSessionStore.getState();
    store.createSession({
      id: 'session-plan',
      profile: 'research',
      task: 'Analyze Alpha evidence',
      title: 'Alpha research agent',
      now: 100,
    });
    store.createSession({
      id: 'session-plan-child',
      profile: 'research',
      task: 'Continue Alpha evidence',
      title: 'Alpha continuation agent',
      now: 210,
    });
    store.appendTrace('session-plan-child', {
      id: 'session-plan-child:plan-created',
      kind: 'planning',
      timestamp: 211,
      message: 'Created continuation research plan.',
      metadata: {
        planStepCount: 1,
        planSource: 'custom',
        planWarningCount: 0,
        continuationSourceSessionId: 'session-plan',
        continuationCompactionId: 'session-plan:compaction',
        continuationSourceSummary: 'Research trace compacted for audit.',
        continuationRecoverySummary: 'Recovered compacted Alpha context.',
        continuationRecoveredEvidenceCount: 2,
        continuationRecoveryHintsPreview: 'workspace_chunk: recovered Alpha omitted hint @ notes/alpha.md',
        continuationRecoveryPriorityPreview: 'workspace_chunk: recovered Alpha omitted hint @ notes/alpha.md score=120',
        continuationRecoveryPlanPreview: '1. read_indexed_context | workspace_chunk: recovered Alpha omitted hint @ notes/alpha.md | reason=budget_limited:workspace_chunk | score=120 | preview=recovered Alpha',
        continuationRecoveryAutoSummaryPreview: 'workspace_chunk: 1 omitted item / 420 tokens / labels=recovered Alpha omitted hint / keywords=alpha, recovered',
        continuationRecoveryModelSummaryPreview: 'Model summary: recovered Alpha omitted context matters.',
        continuationRecoveryReadPathCount: 1,
        continuationRecoveryReadPathsPreview: 'notes/alpha.md',
        continuationRecoverySemanticPreview: 'workspace_chunk: recovered Alpha semantic preview',
      },
    });
    store.setActiveSession('session-plan');
    store.appendTrace('session-plan', {
      id: 'session-plan:plan-created',
      kind: 'planning',
      timestamp: 101,
      message: 'Created research plan with 3 steps.',
      metadata: {
        planStepCount: 3,
        planSource: 'fallback',
        planWarningCount: 1,
        workflowId: 'markdown-research',
        workflowTitle: 'Markdown Research',
        plannerPromptPreview: 'Plan this Alpha research task.',
        plannerRawOutputPreview: '{"steps":[{"id":"context-pack"}]}',
      },
    });
    store.appendTrace('session-plan', {
      id: 'session-plan:plan-warnings',
      kind: 'planning',
      timestamp: 102,
      message: 'Research plan fell back to defaults: Planner output did not contain JSON.',
      metadata: {
        planSource: 'fallback',
        planWarningCount: 1,
      },
    });
    store.appendTrace('session-plan', {
      id: 'session-plan:context-step',
      kind: 'planning',
      timestamp: 103,
      message: 'Completed plan step: Build context pack.',
      metadata: {
        planStepId: 'context-pack',
        planStepStatus: 'completed',
        toolName: null,
        omittedContextCount: 2,
        omittedContextTokens: 128,
        omittedContextPreview: 'workspace_chunk: 2 omitted (notes/beta.md; notes/gamma.md)',
        omittedContextAutoSummary: 'workspace_chunk: 2 omitted items / 128 tokens / labels=notes/beta.md; notes/gamma.md / keywords=beta, gamma',
        omittedContextSemanticPreview: 'workspace_chunk: notes/beta.md: Beta method context. / workspace_chunk: notes/gamma.md: Gamma result context.',
        omittedContextRecoveryHints: 'workspace_chunk: notes/beta.md @ notes/beta.md (72 tokens) - Beta method context.',
        omittedContextRecoveryPriority: 'workspace_chunk: notes/beta.md @ notes/beta.md score=120 (priority=80,source=workspace_chunk,tokens=72,locator)',
        omittedContextRecoveryPlan: '1. read_indexed_context | workspace_chunk: notes/beta.md @ notes/beta.md | reason=budget_limited:workspace_chunk | score=120 | preview=Beta method context.',
        omittedContextModelSummary: 'Model summary: Beta and Gamma were omitted from the compact prompt.',
        omittedContextModelSummaryStatus: 'generated',
        omittedContextModelSummaryWarning: null,
        omittedContextModelSummaryQualityStatus: 'partial',
        omittedContextModelSummaryQualityScore: 65,
        omittedContextModelSummaryQualitySummary: 'partial / score=65 / keywords:beta,gamma, recovery:mentioned',
      },
    });
    store.appendTrace('session-plan', {
      id: 'session-plan:context-pack',
      kind: 'planning',
      timestamp: 103.5,
      message: 'Built research context pack research-context-pack-alpha.',
      metadata: {
        contextPackId: 'research-context-pack-alpha',
        memoryCount: 0,
        memoryQueryScopes: 'workspace,conversation,user',
        memoryQueryWorkspaceKey: 'workspace-alpha',
        memoryQueryConversationId: 'conversation-alpha',
        memoryQueryLimit: 8,
      },
    });
    store.appendTrace('session-plan', {
      id: 'session-plan:evidence-step',
      kind: 'planning',
      timestamp: 104,
      message: 'Completed plan step: Resolve evidence.',
      metadata: {
        planStepId: 'evidence-resolve',
        planStepStatus: 'completed',
        toolName: 'evidence.resolve',
        toolLabel: 'Resolve evidence',
        toolDescription: 'Build evidence context from selected sources.',
        toolArgsSummary: '{ query: string; sourceIds?: string[]; maxContextTokens?: number }',
        toolResultSummary: 'Context nodes, evidence refs, and truncation state.',
        resultSchemaVersion: 1,
        resultKind: 'evidence.resolve',
        resultStatus: 'completed',
        resultSummary: '1 context node, 1 evidence ref.',
        resultPreview: '1 context node, 1 evidence ref.',
        resultMetricsPreview: 'nodes=1, evidence=1, truncated=false',
        resultArtifactsPreview: 'notes/alpha.md',
        restored: true,
        resolvedPromptPreview: 'Restored evidence prompt preview.',
      },
      tool: {
        capability: 'resolve_evidence',
        toolName: 'evidence.resolve',
        argumentsPreview: '{"query":"Alpha"}',
      },
      evidenceRefs: [
        {
          kind: 'file',
          label: 'alpha.md',
          locator: 'notes/alpha.md',
        },
      ],
    });
    store.appendTrace('session-plan', {
      id: 'session-plan:observation-replan',
      kind: 'planning',
      timestamp: 104.5,
      message: 'Replanned pending steps from 1 tool observation.',
      metadata: {
        observationCount: 1,
        updatedStepIds: 'evidence-resolve,synthesize-answer',
        ignoredStepIds: 'new-read-step',
        observationReplanIteration: 1,
        observationReplanBudget: 2,
        observationReplanStopReason: 'budget_exhausted',
        observationQualitySummary: 'duplicates=0, lowValue=1, observations=1',
        observationDuplicateCount: 0,
        observationLowValueCount: 1,
        recoveryObservationCount: 1,
        recoveryObservationLocatorsPreview: 'notes/recovered-alpha.md',
        recoveryQualityStatus: 'weak',
        recoveryQualitySummary: 'weak / planned=1 / observed=1 / covered=1 / lowValue=1',
        recoveredContextDigestSummary: 'Recovered omitted context: 1 read / completed=1 / useful=0 / lowValue=1 / locators=notes/recovered-alpha.md',
        recoveredContextDigestAnswerPreview: 'Recovered omitted context: 1 read / completed=1 / useful=0 / lowValue=1 / locators=notes/recovered-alpha.md',
        recoveredContextUsefulCount: 0,
        recoveredContextLowValueCount: 1,
        observationsPreview: '1. workspace-search: workspace.search completed - No matching indexed files.',
        observationRecoveryRecommendation: 'Observation replan budget is exhausted. Continue with the best current plan or start a focused follow-up run.',
        plannerPromptPreview: 'Tool observations: workspace-search',
        plannerRawOutputPreview: '{"steps":[{"id":"evidence-resolve"}]}',
      },
    });
    store.appendTrace('session-plan', {
      id: 'session-plan:synthesis',
      kind: 'planning',
      timestamp: 104.75,
      message: 'Prepared research synthesis from context pack, memory, and resolved evidence.',
      metadata: {
        restored: true,
        answerPreview: 'Restored synthesis answer preview.',
      },
    });
    store.appendTrace('session-plan', {
      id: 'session-plan:approval-resume',
      kind: 'planning',
      timestamp: 104.8,
      message: 'Completed approved plan step: Run code.',
      metadata: {
        approvalId: 'approval-1',
        approvalToolName: 'runner.runCode',
        resultPreview: '4',
        restoredSynthesisPreview: 'Restored synthesis answer preview.',
      },
    });
    store.appendTrace('session-plan', {
      id: 'session-plan:memory-suggestion-evaluated',
      kind: 'planning',
      timestamp: 104.9,
      message: 'Agent memory candidate is ready for approval.',
      metadata: {
        memorySuggestionStatus: 'accepted',
        memorySuggestionReasonCode: 'accepted',
        memorySuggestionReason: 'Reusable evidence-backed finding.',
        memorySuggestionConfidence: 72,
        memorySuggestionPolicyDecision: 'approve',
        memorySuggestionPolicySummary: 'approve / adjusted=72% / provenance:ok, reuse:ok',
        memorySuggestionPolicyReasons: 'provenance:ok,reuse:ok',
        memorySuggestionCandidateKind: 'finding',
        memorySuggestionScope: 'workspace',
        memorySuggestionTitle: 'Alpha finding',
        memorySuggestionSourceFingerprint: 'mem-src-alpha-finding',
        memorySuggestionContextPackId: 'research-context-pack-alpha',
        memorySuggestionOmittedContextCount: 2,
        memorySuggestionOmittedContextPreview: 'workspace_chunk: 2 omitted (notes/beta.md; notes/gamma.md)',
        memorySuggestionOmittedAutoSummary: 'workspace_chunk: 2 omitted items / 128 tokens / labels=notes/beta.md; notes/gamma.md / keywords=beta, gamma',
        memorySuggestionOmittedModelSummary: 'Model summary: Beta and Gamma were omitted from the compact prompt.',
        memorySuggestionRecoveryObservationCount: 1,
        memorySuggestionRecoveryObservationPreview: '1. workspace.readIndexedContext @ notes/recovered-alpha.md (completed) - recovered omitted context',
        memorySuggestionRecoveredContextDigest: 'Recovered omitted context: 1 read / completed=1 / useful=0 / lowValue=1 / locators=notes/recovered-alpha.md',
        memorySuggestionApplicability: 'Workspace: workspace-alpha / Markdown Research / Query: Alpha',
        memorySuggestionEvidenceSummary: 'alpha.md (notes/alpha.md) / Context pack research-context-pack-alpha',
        memorySuggestionCaution: 'Approve only if this finding should influence future research runs in the shown scope.',
        memorySuggestionAnswerPreview: 'Alpha answer should be remembered.',
      },
    });
    store.appendTrace('session-plan', {
      id: 'session-plan:memory-snapshot',
      kind: 'planning',
      timestamp: 104.85,
      message: 'Loaded 2 scoped memory entries for the research run.',
      metadata: {
        memoryCount: 2,
        memoryIdsPreview: 'memory-alpha-1,memory-alpha-2',
        memoryRankedPreview: '1. memory-alpha-1:workspace:score=15:reasons=workspace+kind:finding+title:2:Alpha memory',
        memoryRankingQueryPreview: 'Explain Alpha evidence grounding',
        memoryQueryScopes: 'workspace,user',
        memoryQueryWorkspaceKey: 'workspace-alpha',
        memoryQueryProjectKey: 'project-alpha',
        memoryQueryLimit: 6,
        memoryCandidateCount: 4,
        memoryLifecycleSummary: 'healthy=1, weak=1',
        memoryLifecyclePreview: 'memory-alpha-2:weak:review:weak-provenance',
      },
    });
    store.appendTrace('session-plan', {
      id: 'session-plan:memory-suggestion-skipped',
      kind: 'planning',
      timestamp: 104.95,
      message: 'Skipped Agent memory suggestion: Duplicate source fingerprint.',
      metadata: {
        memorySuggestionStatus: 'skipped',
        memorySuggestionReasonCode: 'duplicate_source',
        memorySuggestionReason: 'A memory with the same source fingerprint already exists.',
        memorySuggestionDuplicateMemoryId: 'memory-existing-1',
        memorySuggestionSourceFingerprint: 'mem-src-alpha-finding',
      },
    });
    useAgentSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => session.id === 'session-plan'
        ? {
            ...session,
            compactions: [
              {
                id: 'session-plan:compaction',
                createdAt: 200,
                summary: 'Research trace compacted for audit.',
                compactedEventCount: 4,
                retainedEventIds: ['session-plan:start', 'session-plan:evidence-step'],
                sourceEventKinds: ['planning'],
                evidenceRefs: [
                  {
                    kind: 'file',
                    label: 'alpha.md',
                    locator: 'notes/alpha.md',
                  },
                ],
              },
            ],
          }
        : session),
    }));

    render(<AgentTracePanel />);

    expect(screen.getAllByText('Plan').length).toBeGreaterThan(0);
    expect(screen.getByText('Run summary')).toBeTruthy();
    expect(screen.getByTestId('agent-run-report')).toBeTruthy();
    expect(screen.getByTestId('agent-run-report').textContent).toContain('Plan');
    expect(screen.getByTestId('agent-run-report-action-inspect-trace')).toBeTruthy();
    expect(screen.getByText('Run report')).toBeTruthy();
    expect(screen.getByText('Markdown Research')).toBeTruthy();
    expect(screen.getByText('Lineage')).toBeTruthy();
    expect(screen.getByText('Continued by')).toBeTruthy();
    expect(screen.getAllByText('Alpha continuation agent').length).toBeGreaterThan(0);
    expect(screen.getByText('Plan metric')).toBeTruthy();
    expect(screen.getByText('2/2')).toBeTruthy();
    expect(screen.getByText('Tools')).toBeTruthy();
    expect(screen.getByText('1/1')).toBeTruthy();
    expect(screen.getByText('Evidence')).toBeTruthy();
    expect(screen.getByText('Omitted')).toBeTruthy();
    expect(screen.getByText('128 tokens')).toBeTruthy();
    const approvalsAction = screen.queryByTestId('agent-run-report-action-review-approvals');
    if (approvalsAction) {
      fireEvent.click(approvalsAction);
      const approvalsRegion = screen.getByTestId('agent-trace-pending-approvals');
      expect(approvalsRegion.getAttribute('data-focused')).toBe('true');
    }
    const memoryAction = screen.queryByTestId('agent-run-report-action-review-memory');
    if (memoryAction) {
      fireEvent.click(memoryAction);
      expect(useAgentSessionStore.getState().focusTarget).toBe('memory');
      expect(useAgentSessionStore.getState().activeSessionId).toBe('session-plan');
      useAgentSessionStore.getState().consumeFocusTarget('memory');
    }
    expect(screen.getByText('source: fallback')).toBeTruthy();
    expect(screen.getByText('1 warnings')).toBeTruthy();
    expect(screen.getByText('Planner output did not contain JSON.')).toBeTruthy();
    expect(screen.getByText('Planner details')).toBeTruthy();
    expect(screen.getByText('Build context pack')).toBeTruthy();
    expect(screen.getByText('Omitted context')).toBeTruthy();
    expect(screen.getByText('2 items omitted, about 128 tokens.')).toBeTruthy();
    expect(screen.getAllByText('workspace_chunk: 2 omitted (notes/beta.md; notes/gamma.md)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/workspace_chunk: 2 omitted items .* keywords=beta, gamma/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('workspace_chunk: notes/beta.md: Beta method context. / workspace_chunk: notes/gamma.md: Gamma result context.')).toBeTruthy();
    expect(screen.getByText('workspace_chunk: notes/beta.md @ notes/beta.md (72 tokens) - Beta method context.')).toBeTruthy();
    expect(screen.getByText(/read_indexed_context.*notes\/beta\.md.*reason=budget_limited:workspace_chunk/)).toBeTruthy();
    expect(screen.getByText(/workspace_chunk: notes\/beta\.md @ notes\/beta\.md score=120/)).toBeTruthy();
    expect(screen.getByText('Observation replan')).toBeTruthy();
    expect(screen.getByText('1 tool observations reviewed.')).toBeTruthy();
    expect(screen.getByText(/Iteration/)).toBeTruthy();
    expect(screen.getByText(/1 \/ 2/)).toBeTruthy();
    expect(screen.getByText(/Stop reason/)).toBeTruthy();
    expect(screen.getByText('budget_exhausted')).toBeTruthy();
    expect(screen.getAllByText(/Quality/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('duplicates=0, lowValue=1, observations=1')).toBeTruthy();
    expect(screen.getByText('duplicates=0 / lowValue=1')).toBeTruthy();
    expect(screen.getByText('1: notes/recovered-alpha.md')).toBeTruthy();
    expect(screen.getAllByText((_, node) =>
      node?.textContent?.includes('Recovery quality: weak') === true &&
      node.textContent.includes('lowValue=1'),
    ).length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, node) =>
      node?.textContent?.includes('Recovered context digest: Recovered omitted context: 1 read') === true &&
      node.textContent.includes('useful=0') &&
      node.textContent.includes('lowValue=1'),
    ).length).toBeGreaterThan(0);
    expect(screen.getByText('evidence-resolve,synthesize-answer')).toBeTruthy();
    expect(screen.getByText('new-read-step')).toBeTruthy();
    expect(screen.getByText(/workspace-search: workspace.search completed/)).toBeTruthy();
    expect(screen.getAllByText((_, node) =>
      node?.textContent?.includes('Recovery recommendation: Observation replan budget is exhausted. Continue with the best current plan or start a focused follow-up run.') === true,
    ).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Restored context').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Resumed from prior trace state.').length).toBeGreaterThan(0);
    expect(screen.getByText('Restored evidence prompt preview.')).toBeTruthy();
    expect(screen.getByText('Result schema')).toBeTruthy();
    expect(screen.getByText(/Status: completed/)).toBeTruthy();
    expect(screen.getByText('v1')).toBeTruthy();
    expect(screen.getAllByText('Summary').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Result').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 context node, 1 evidence ref.').length).toBeGreaterThan(0);
    expect(screen.getByText(/nodes=1, evidence=1, truncated=false/)).toBeTruthy();
    expect(screen.getAllByText('notes/alpha.md').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Restored synthesis answer preview.').length).toBeGreaterThan(0);
    expect(screen.getByText('Approval resumed with prior synthesis context.')).toBeTruthy();
    expect(screen.getByText(/runner.runCode/)).toBeTruthy();
    expect(screen.getAllByText('Memory suggestion').length).toBeGreaterThan(0);
    expect(screen.getByText('Ready for approval.')).toBeTruthy();
    expect(screen.getByText('Skipped before approval.')).toBeTruthy();
    expect(screen.getByText('Alpha finding')).toBeTruthy();
    expect(screen.getAllByText(/finding/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/workspace/).length).toBeGreaterThan(0);
    expect(screen.getByText(/72% confidence/)).toBeTruthy();
    expect(screen.getByText('Reusable evidence-backed finding.')).toBeTruthy();
    expect(screen.getAllByText((_, node) =>
      node?.textContent?.includes('Memory policy: approve / approve / adjusted=72% / provenance:ok, reuse:ok') === true,
    ).length).toBeGreaterThan(0);
    expect(screen.getByText('Alpha answer should be remembered.')).toBeTruthy();
    expect(screen.getByText('Workspace: workspace-alpha / Markdown Research / Query: Alpha')).toBeTruthy();
    expect(screen.getByText('alpha.md (notes/alpha.md) / Context pack research-context-pack-alpha')).toBeTruthy();
    expect(screen.getByText('Approve only if this finding should influence future research runs in the shown scope.')).toBeTruthy();
    expect(screen.getByText('research-context-pack-alpha / 2 omitted')).toBeTruthy();
    expect(screen.getAllByText(/workspace_chunk: 2 omitted items .* labels=notes\/beta\.md; notes\/gamma\.md/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText((_, node) =>
      node?.textContent?.includes('Model summary: generated / Model summary: Beta and Gamma were omitted') === true,
    ).length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, node) =>
      node?.textContent?.includes('Model summary quality: partial / 65 / partial / score=65') === true,
    ).length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, node) =>
      node?.textContent?.includes('Omitted model summary: Model summary: Beta and Gamma were omitted from the compact prompt.') === true,
    ).length).toBeGreaterThan(0);
    expect(screen.getByText((content) =>
      content.includes('1: 1. workspace.readIndexedContext @ notes/recovered-alpha.md'),
    )).toBeTruthy();
    expect(screen.getAllByText((_, node) =>
      node?.textContent?.includes('Recovered context digest: Recovered omitted context: 1 read') === true,
    ).length).toBeGreaterThan(0);
    expect(screen.getByText('duplicate_source')).toBeTruthy();
    expect(screen.getByText('memory-existing-1')).toBeTruthy();
    expect(screen.getAllByText(/mem-src-alpha-finding/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Memory read').length).toBeGreaterThan(0);
    expect(screen.getByText('0 scoped memories loaded.')).toBeTruthy();
    expect(screen.getByText('2 scoped memories loaded.')).toBeTruthy();
    expect(screen.getByText('memory-alpha-1,memory-alpha-2')).toBeTruthy();
    expect(screen.getByText(/memory-alpha-1:workspace:score=15/)).toBeTruthy();
    expect(screen.getByText(/kind:finding/)).toBeTruthy();
    expect(screen.getAllByText((_, node) =>
      node?.textContent?.includes('Lifecycle: healthy=1, weak=1') === true,
    ).length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, node) =>
      node?.textContent?.includes('Lifecycle review: memory-alpha-2:weak:review:weak-provenance') === true,
    ).length).toBeGreaterThan(0);
    expect(screen.getByText('Explain Alpha evidence grounding')).toBeTruthy();
    expect(screen.getByText('workspace,conversation,user')).toBeTruthy();
    expect(screen.getByText('workspace,user')).toBeTruthy();
    expect(screen.getAllByText(/workspace=workspace-alpha/).length).toBeGreaterThan(0);
    expect(screen.getByText(/project=project-alpha/)).toBeTruthy();
    expect(screen.getByText(/conversation=conversation-alpha/)).toBeTruthy();
    expect(screen.getByText('Resolve evidence')).toBeTruthy();
    expect(screen.getAllByText('1 context node, 1 evidence ref.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('evidence.resolve').length).toBeGreaterThan(0);
    expect(screen.getByText('Compactions')).toBeTruthy();
    expect(screen.getByText('Research trace compacted for audit.')).toBeTruthy();
    expect(screen.getByText('4 compacted events')).toBeTruthy();
    expect(screen.getByText('2 retained events')).toBeTruthy();
    expect(screen.getByText('Source kinds: planning')).toBeTruthy();

    fireEvent.click(screen.getByTitle('Continue in chat'));

    expect(useAiChatStore.getState().isOpen).toBe(true);
    expect(useAiChatStore.getState().composerDraft).toMatchObject({
      mode: 'agent',
      continuation: {
        sourceSessionId: 'session-plan',
        compactionId: 'session-plan:compaction',
        sourceSummary: 'Research trace compacted for audit.',
      },
    });
    expect(useAiChatStore.getState().composerDraft?.text).toContain('Continue the Research Agent session "Alpha research agent".');

    fireEvent.click(screen.getAllByText('Alpha continuation agent')[0]);

    await waitFor(() => {
      expect(useAgentSessionStore.getState().activeSessionId).toBe('session-plan-child');
    });
    expect(screen.getByText('Continued from')).toBeTruthy();
    expect(screen.getAllByText('Alpha research agent').length).toBeGreaterThan(0);
    expect(screen.getByText('session-plan:compaction')).toBeTruthy();
    expect(screen.getByText('Continuation recovery')).toBeTruthy();
    expect(screen.getByText('2 evidence refs recovered.')).toBeTruthy();
    expect(screen.getByText('Recovered compacted Alpha context.')).toBeTruthy();
    expect(screen.getByText('workspace_chunk: recovered Alpha omitted hint @ notes/alpha.md')).toBeTruthy();
    expect(screen.getByText(/workspace_chunk: recovered Alpha omitted hint @ notes\/alpha\.md score=120/)).toBeTruthy();
    expect(screen.getByText(/read_indexed_context.*reason=budget_limited:workspace_chunk/)).toBeTruthy();
    expect(screen.getByText(/workspace_chunk: 1 omitted item .* keywords=alpha, recovered/)).toBeTruthy();
    expect(screen.getByText('Model summary: recovered Alpha omitted context matters.')).toBeTruthy();
    expect(screen.getByText('1: notes/alpha.md')).toBeTruthy();
    expect(screen.getByText('workspace_chunk: recovered Alpha semantic preview')).toBeTruthy();

    fireEvent.click(screen.getAllByText('Alpha research agent')[0]);

    await waitFor(() => {
      expect(useAgentSessionStore.getState().activeSessionId).toBe('session-plan');
    });

    fireEvent.click(screen.getByTitle('Copy continuation prompt'));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('Continue the Research Agent session "Alpha research agent".'),
      );
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Original task: Analyze Alpha evidence'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Compaction summary: Research trace compacted for audit.'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('- alpha.md (notes/alpha.md)'));

    fireEvent.click(screen.getByText('Planner details'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Planner details/ }).getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText('Planner prompt preview')).toBeTruthy();
      expect(screen.getByText('Plan this Alpha research task.')).toBeTruthy();
      expect(screen.getByText('Planner raw output preview')).toBeTruthy();
      expect(screen.getByText('{"steps":[{"id":"context-pack"}]}')).toBeTruthy();
    });

    const evidenceRow = document.querySelector('[data-event-id="session-plan:evidence-step"]');
    expect(evidenceRow).toBeTruthy();
    const evidenceDetails = Array.from(evidenceRow!.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Details'));
    expect(evidenceDetails).toBeTruthy();
    expect(evidenceDetails!.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(evidenceDetails!);

    await waitFor(() => {
      expect(evidenceDetails!.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText('Tool contract')).toBeTruthy();
      expect(screen.getByText((content) => content.includes('Build evidence context from selected sources.'))).toBeTruthy();
      expect(screen.getByText((content) => content.includes('{ query: string; sourceIds?: string[]; maxContextTokens?: number }'))).toBeTruthy();
      expect(screen.getByText((content) => content.includes('Context nodes, evidence refs, and truncation state.'))).toBeTruthy();
      expect(screen.getByText('Metadata')).toBeTruthy();
    });
  });

  it('renders classified error diagnostics without opening raw metadata', () => {
    const store = useAgentSessionStore.getState();
    store.createSession({
      id: 'session-error-diagnostic',
      profile: 'research',
      task: 'Classify error',
      title: 'Classify error',
      now: 100,
    });
    store.appendTrace('session-error-diagnostic', {
      id: 'session-error-diagnostic:error',
      kind: 'error',
      timestamp: 101,
      message: 'Evidence resolution failed.',
      error: 'Evidence resolution failed.',
      metadata: {
        errorCategory: 'context',
        errorStage: 'context.evidence_resolve',
        errorRecoveryHint: 'Check context pack sources, evidence refs, workspace index, and omitted-context recovery hints.',
      },
    });

    render(<AgentTracePanel />);

    expect(screen.getAllByText('Evidence resolution failed.').length).toBeGreaterThan(0);
    expect(screen.getByText(/Category: context \/ Stage: context\.evidence_resolve \/ Recovery: Check context pack sources/)).toBeTruthy();
  });
});
