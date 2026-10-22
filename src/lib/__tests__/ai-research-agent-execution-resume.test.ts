import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runCodeMock } = vi.hoisted(() => ({ runCodeMock: vi.fn() }));
vi.mock('@/lib/storage-adapter', () => ({ getStorageAdapter: () => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn(), clear: vi.fn() }) }));
vi.mock('../ai/agent-runner-tool', () => ({ runCodeWithWorkspaceRunner: runCodeMock }));

import { approveAgentToolRequest, rejectAgentToolRequest } from '../ai/agent-tool-broker';
import { canRetryResearchAgentSynthesis, reconcileResearchAgentPendingApprovals, runResearchAgent, type ResearchAgentRunInput } from '../ai/research-agent';
import { getMessageText, type AiMessage } from '../ai/types';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { useAgentMemoryStore } from '@/stores/agent-memory-store';

const planSteps = [
  { id: 'context-pack', title: 'Collect context', description: 'Collect the requested input.' },
  { id: 'calculate-mean', title: 'Calculate the mean', description: 'Run Python after approval.', toolName: 'runner.runCode' as const, toolArgs: { language: 'python', code: 'print(sum([2, 4]) / 2)' } },
  { id: 'evidence-resolve', title: 'Resolve context', description: 'Resolve the original request.', toolName: 'evidence.resolve' as const },
  { id: 'synthesize-answer', title: 'Deliver the result', description: 'Explain the measured output.' },
];

describe('research-agent approved execution continuation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentSessionStore.setState({ sessions: [], activeSessionId: null });
    useAgentMemoryStore.setState({ entries: [], loaded: true });
    runCodeMock.mockResolvedValue({ output: 'sample mean = 3.0\ncalculated rows = 2' });
  });

  const start = (artifacts?: ResearchAgentRunInput['artifacts']) => runResearchAgent({ sessionId: 'calculation-session', task: 'Run Python to calculate the mean of 2 and 4', query: 'Run Python to calculate the mean of 2 and 4', workspaceKey: 'workspace-a', filePath: 'data/values.md', content: 'Requested inputs: 2 and 4.', planSteps, artifacts, suggestMemory: false, compact: false });
  const resume = (generateAnswer = vi.fn(async (_messages: AiMessage[]) => ({ text: 'The computed mean is 3.0.' })), workspaceKey = 'workspace-a') => runResearchAgent({
    filePath: 'unrelated/current.md', content: 'Unrelated new active file must not enter synthesis.', references: [{ path: 'unrelated/reference.md', content: 'Foreign referenced context must not enter synthesis.' }],
    task: 'Continue the approved calculation', continuation: { sourceSessionId: 'calculation-session', approvalResume: true }, workspaceKey, generateAnswer, requireAnswer: true, suggestMemory: false, compact: false,
  });

  it('resumes the original plan in the same session and synthesizes the real output exactly once', async () => {
    const blocked = await start();
    expect(blocked.session.status).toBe('waiting_approval');
    expect(blocked.session.executionContinuation?.planSteps).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'calculate-mean' })]));
    expect(runCodeMock).not.toHaveBeenCalled();
    await approveAgentToolRequest(blocked.toolResults[0].approvalRequestId!);
    const reconciliation = reconcileResearchAgentPendingApprovals({ sessionId: blocked.sessionId });
    expect(reconciliation.finalized).toBe(false);
    expect(reconciliation.session.status).toBe('running');
    useAgentSessionStore.setState((state) => ({ sessions: JSON.parse(JSON.stringify(state.sessions)) }));
    const generateAnswer = vi.fn(async (messages: AiMessage[]) => {
      const prompt = messages.map((message) => getMessageText(message.content)).join('\n');
      expect(prompt).toContain(JSON.stringify('sample mean = 3.0\ncalculated rows = 2'));
      expect(prompt).toContain('Requested inputs: 2 and 4.');
      expect(prompt).not.toContain('Unrelated new active file');
      expect(prompt).not.toContain('Foreign referenced context');
      expect(prompt).toContain('Run Python to calculate the mean of 2 and 4');
      return { text: 'The computed mean is 3.0 across 2 rows.' };
    });
    const completed = await resume(generateAnswer);
    expect(completed.sessionId).toBe('calculation-session');
    expect(completed.session.status).toBe('completed');
    expect(completed.answer).toBe('The computed mean is 3.0 across 2 rows.');
    expect(completed.toolObservations).toEqual(expect.arrayContaining([expect.objectContaining({ toolName: 'runner.runCode', output: 'sample mean = 3.0\ncalculated rows = 2' })]));
    expect(runCodeMock).toHaveBeenCalledTimes(1);
    expect(generateAnswer).toHaveBeenCalledTimes(1);
    expect(useAgentSessionStore.getState().sessions).toHaveLength(1);
  });

  it('does not resume or create a replacement session after execution failure', async () => {
    runCodeMock.mockRejectedValue(new Error('RuntimeError: missing input'));
    const blocked = await start();
    await approveAgentToolRequest(blocked.toolResults[0].approvalRequestId!);
    const generateAnswer = vi.fn(async () => ({ text: 'Should not be called' }));
    await expect(resume(generateAnswer)).rejects.toThrow(/missing input|failed/i);
    expect(useAgentSessionStore.getState().getSession('calculation-session')?.status).toBe('failed');
    expect(canRetryResearchAgentSynthesis(useAgentSessionStore.getState().getSession('calculation-session'))).toBe(false);
    expect(useAgentSessionStore.getState().sessions).toHaveLength(1);
    expect(generateAnswer).not.toHaveBeenCalled();
    expect(runCodeMock).toHaveBeenCalledTimes(1);
  });

  it('retries only final synthesis in the same session after a successful approved run times out', async () => {
    const blocked = await start();
    await approveAgentToolRequest(blocked.toolResults[0].approvalRequestId!);
    const generateAnswer = vi.fn().mockRejectedValueOnce(new Error('Model timed out')).mockResolvedValueOnce({ text: 'The computed mean is 3.0 across 2 rows.' });
    await expect(resume(generateAnswer)).rejects.toThrow('Model timed out');
    const failed = useAgentSessionStore.getState().getSession(blocked.sessionId)!;
    const requestedTools = failed.trace.filter((event) => event.kind === 'tool_requested').length;
    expect(failed.status).toBe('failed');
    const generatePlan = vi.fn();
    const retried = await runResearchAgent({ sessionId: blocked.sessionId, continuation: { sourceSessionId: blocked.sessionId, approvalResume: true },
      workspaceKey: 'workspace-a', generatePlan, generateAnswer, requireAnswer: true, compact: false, suggestMemory: false });
    expect(retried.sessionId).toBe(blocked.sessionId);
    expect(retried.session.status).toBe('completed');
    expect(retried.answer).toBe('The computed mean is 3.0 across 2 rows.');
    expect(generatePlan).not.toHaveBeenCalled();
    expect(generateAnswer).toHaveBeenCalledTimes(2);
    expect(runCodeMock).toHaveBeenCalledTimes(1);
    expect(retried.session.trace.filter((event) => event.kind === 'tool_requested')).toHaveLength(requestedTools);
    expect(useAgentSessionStore.getState().sessions).toHaveLength(1);
    expect(canRetryResearchAgentSynthesis(failed)).toBe(true);
    expect(canRetryResearchAgentSynthesis(retried.session)).toBe(false);
  });

  it.each(['cancelled', 'wrong_receipt', 'other_failure', 'missing_context'] as const)('does not allow synthesis retry for %s', async (invalidState) => {
    const blocked = await start();
    await approveAgentToolRequest(blocked.toolResults[0].approvalRequestId!);
    await expect(resume(vi.fn().mockRejectedValue(new Error('Model timed out')))).rejects.toThrow('Model timed out');
    const failed = JSON.parse(JSON.stringify(useAgentSessionStore.getState().getSession(blocked.sessionId))) as NonNullable<ReturnType<typeof useAgentSessionStore.getState>['sessions'][number]>;
    if (invalidState === 'cancelled') failed.status = 'cancelled';
    if (invalidState === 'wrong_receipt') failed.pendingApprovals[0].executionReceipt!.approvalRequestId = 'different-approval';
    if (invalidState === 'other_failure') failed.trace.find((event) => event.metadata?.errorStage === 'synthesis.answer')!.metadata!.errorStage = 'tool.execute';
    if (invalidState === 'missing_context') failed.executionContinuation!.synthesisContext = undefined;
    expect(canRetryResearchAgentSynthesis(failed)).toBe(false);
    expect(runCodeMock).toHaveBeenCalledTimes(1);
  });

  it('preserves requested artifact approval and stops requiring synthesis once the answer is delivered', async () => {
    const blocked = await start({ draft: { type: 'paper_note', title: 'Calculation note', sourceRefs: [], content: 'Computed mean = 3.0.' } });
    await approveAgentToolRequest(blocked.toolResults[0].approvalRequestId!);
    const completedAnswer = await resume();
    expect(completedAnswer.session.status).toBe('waiting_approval');
    expect(completedAnswer.session.executionContinuation).toBeUndefined();
    const draftApproval = completedAnswer.session.pendingApprovals.find((approval) => approval.toolName === 'workbench.createDraft');
    expect(draftApproval?.status).toBe('pending');
    await approveAgentToolRequest(draftApproval!.id);
    const finalized = reconcileResearchAgentPendingApprovals({ sessionId: blocked.sessionId });
    expect(finalized.finalized).toBe(true);
    expect(finalized.session.status).toBe('completed');
    expect(runCodeMock).toHaveBeenCalledTimes(1);
  });

  it('does not resume rejected code or claim an answer completed', async () => {
    const blocked = await start();
    rejectAgentToolRequest(blocked.toolResults[0].approvalRequestId!, 'User rejected this computation');
    await expect(resume()).rejects.toThrow(/rejected|cancelled/i);
    expect(useAgentSessionStore.getState().getSession('calculation-session')?.status).toBe('cancelled');
    expect(canRetryResearchAgentSynthesis(useAgentSessionStore.getState().getSession('calculation-session'))).toBe(false);
    expect(useAgentSessionStore.getState().sessions).toHaveLength(1);
    expect(runCodeMock).not.toHaveBeenCalled();
  });

  it('requires approval completion and the original workspace before continuing', async () => {
    const blocked = await start();
    await expect(resume()).rejects.toThrow(/approval/i);
    await approveAgentToolRequest(blocked.toolResults[0].approvalRequestId!);
    await expect(resume(undefined, 'workspace-b')).rejects.toThrow(/workspace/i);
    await expect(runResearchAgent({ continuation: { sourceSessionId: blocked.sessionId, approvalResume: true } })).rejects.toThrow(/workspace/i);
    expect(useAgentSessionStore.getState().sessions).toHaveLength(1);
    expect(runCodeMock).toHaveBeenCalledTimes(1);
  });
});
