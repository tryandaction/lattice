import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runCodeMock } = vi.hoisted(() => ({ runCodeMock: vi.fn() }));
vi.mock('@/lib/storage-adapter', () => ({ getStorageAdapter: () => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn(), clear: vi.fn() }) }));
vi.mock('../ai/agent-runner-tool', () => ({ runCodeWithWorkspaceRunner: runCodeMock }));

import { approveAgentToolRequest, createAgentToolSession, rejectAgentToolRequest } from '../ai/agent-tool-broker';
import { runResearchAgentReadToolLoop } from '../ai/research-agent-tool-loop';
import type { ResearchAgentPlanStep } from '../ai/research-agent-planner';
import { useAgentSessionStore } from '@/stores/agent-session-store';

function computationStep(overrides: Partial<ResearchAgentPlanStep> = {}): ResearchAgentPlanStep {
  return {
    id: 'calculate-mean', title: 'Compute the sample mean', description: 'Execute the explicitly requested calculation after approval.',
    status: 'pending', toolName: 'runner.runCode', toolArgs: { language: 'python', code: 'print(sum([2, 4]) / 2)' }, ...overrides,
  };
}

describe('research-agent computation tool loop', () => {
  let sessionId: string;
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentSessionStore.setState({ sessions: [], activeSessionId: null });
    runCodeMock.mockResolvedValue({ output: 'sample mean = 3.0' });
    sessionId = createAgentToolSession({ profile: 'research', task: 'Run Python to calculate the sample mean' });
  });

  const run = (planSteps = [computationStep()]) => runResearchAgentReadToolLoop({ sessionId, query: 'Run Python to calculate the sample mean', planSteps, now: 100, allowCodeExecution: true });

  it('blocks an unapproved planned computation without calling the runner', async () => {
    const result = await run();
    expect(result.blocked).toBe(true);
    expect(result.planSteps[0].status).toBe('blocked');
    expect(result.observations[0]).toMatchObject({ toolName: 'runner.runCode', purpose: 'action', status: 'requires_approval' });
    expect(runCodeMock).not.toHaveBeenCalled();
    expect(useAgentSessionStore.getState().getSession(sessionId)?.pendingApprovals).toHaveLength(1);
  });

  it('preserves a profile policy denial even when execution intent is explicit', async () => {
    sessionId = createAgentToolSession({ profile: 'chat', task: 'Compute the mean' });
    const result = await run();
    expect(result.planSteps[0].status).toBe('failed');
    expect(result.toolResults[0]).toMatchObject({ status: 'denied', decision: { capability: 'run_code', allowed: false } });
    expect(runCodeMock).not.toHaveBeenCalled();
    expect(useAgentSessionStore.getState().getSession(sessionId)?.pendingApprovals).toHaveLength(0);
  });

  it('reuses the same pending approval when a blocked plan is resumed', async () => {
    const blocked = await run();
    const resumed = await run(blocked.planSteps);
    expect(resumed.blocked).toBe(true);
    expect(resumed.toolResults[0].approvalRequestId).toBe(blocked.toolResults[0].approvalRequestId);
    expect(useAgentSessionStore.getState().getSession(sessionId)?.pendingApprovals).toHaveLength(1);
    expect(runCodeMock).not.toHaveBeenCalled();
  });

  it('restores the approved real output once without rerunning the computation', async () => {
    const blocked = await run();
    const approvalId = blocked.toolResults[0].approvalRequestId!;
    await approveAgentToolRequest(approvalId);
    const resumed = await run(blocked.planSteps);
    expect(resumed.blocked).toBe(false);
    expect(resumed.planSteps[0].status).toBe('completed');
    expect(resumed.observations[0]).toMatchObject({ purpose: 'action', status: 'completed', preview: 'sample mean = 3.0', resultStatus: 'completed' });
    const repeated = await run();
    expect(repeated.observations[0].preview).toBe('sample mean = 3.0');
    expect(runCodeMock).toHaveBeenCalledTimes(1);
    expect(runCodeMock).toHaveBeenCalledWith({ language: 'python', code: 'print(sum([2, 4]) / 2)' });
  });

  it('keeps runner failure and its diagnostic when resuming after approval', async () => {
    runCodeMock.mockRejectedValue(new Error('ZeroDivisionError: division by zero'));
    const blocked = await run();
    const approved = await approveAgentToolRequest(blocked.toolResults[0].approvalRequestId!);
    expect(approved.status).toBe('failed');
    const resumed = await run(blocked.planSteps);
    expect(resumed.planSteps[0].status).toBe('failed');
    expect(resumed.observations[0]).toMatchObject({ status: 'failed', resultStatus: 'failed', resultDiagnosticsPreview: 'ZeroDivisionError: division by zero' });
    expect(useAgentSessionStore.getState().getSession(sessionId)?.status).toBe('failed');
    expect(runCodeMock).toHaveBeenCalledTimes(1);
  });

  it('retains bounded raw output and tells synthesis when the result was truncated', async () => {
    const output = 'row,value\n' + '1,2\n'.repeat(9000);
    runCodeMock.mockResolvedValue({ output });
    const blocked = await run();
    const approvalId = blocked.toolResults[0].approvalRequestId!;
    expect(approvalId).toBeTypeOf('string');
    await approveAgentToolRequest(approvalId);
    const receipt = useAgentSessionStore.getState().getSession(sessionId)?.pendingApprovals[0].executionReceipt;
    expect(receipt).toMatchObject({ sessionId, approvalRequestId: approvalId, status: 'completed', output: output.slice(0, 32000), outputLength: 36010, truncated: true });
    const resumed = await run(blocked.planSteps);
    expect(resumed.toolResults[0].result).toEqual({ output: output.slice(0, 32000) });
    expect(resumed.observations[0]).toMatchObject({ output: output.slice(0, 32000), outputTruncated: true, resultStatus: 'partial' });
    expect(runCodeMock).toHaveBeenCalledTimes(1);
  });

  it('does not substitute a completed trace preview when no execution receipt exists', async () => {
    const blocked = await run();
    expect(blocked.toolResults[0]?.approvalRequestId).toBeTypeOf('string');
    useAgentSessionStore.getState().resolvePendingApproval(sessionId, { id: blocked.toolResults[0].approvalRequestId!, status: 'completed', resultPreview: 'An unverified result preview' });
    const resumed = await run(blocked.planSteps);
    expect(resumed.toolResults[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('execution receipt') });
    expect(resumed.observations[0].output).toBeUndefined();
    expect(runCodeMock).not.toHaveBeenCalled();
  });

  it('restores an approved calculation after its planning trace has been compacted away', async () => {
    const blocked = await run();
    await approveAgentToolRequest(blocked.toolResults[0].approvalRequestId!);
    useAgentSessionStore.setState((state) => ({ sessions: state.sessions.map((session) => ({ ...session, trace: session.trace.filter((event) => event.kind !== 'planning') })) }));
    const resumed = await run();
    expect(resumed.observations[0]).toMatchObject({ status: 'completed', output: 'sample mean = 3.0' });
    expect(runCodeMock).toHaveBeenCalledTimes(1);
  });

  it.each(['sessionId', 'approvalRequestId', 'requestSignature'] as const)('rejects an execution receipt bound to a different %s', async (field) => {
    const blocked = await run();
    await approveAgentToolRequest(blocked.toolResults[0].approvalRequestId!);
    const approval = useAgentSessionStore.getState().getSession(sessionId)!.pendingApprovals[0];
    useAgentSessionStore.getState().resolvePendingApproval(sessionId, { id: approval.id, status: 'completed', executionReceipt: { ...approval.executionReceipt!, [field]: 'another-request' } });
    const resumed = await run(blocked.planSteps);
    expect(resumed.toolResults[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('execution receipt') });
    expect(resumed.observations[0].output).toBeUndefined();
    expect(runCodeMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a rejected approval denied instead of requesting or executing it again', async () => {
    const blocked = await run();
    rejectAgentToolRequest(blocked.toolResults[0].approvalRequestId!, 'Do not run this calculation');
    const resumed = await run(blocked.planSteps);
    expect(resumed.planSteps[0].status).toBe('failed');
    expect(resumed.toolResults[0]).toMatchObject({ status: 'denied', error: 'Do not run this calculation' });
    expect(runCodeMock).not.toHaveBeenCalled();
  });

  it('does not transfer an approval to changed code under the same step id', async () => {
    const blocked = await run();
    await approveAgentToolRequest(blocked.toolResults[0].approvalRequestId!);
    const changed = await run([computationStep({ toolArgs: { language: 'python', code: 'print(42)' } })]);
    expect(changed.blocked).toBe(true);
    expect(changed.toolResults[0].approvalRequestId).not.toBe(blocked.toolResults[0].approvalRequestId);
    expect(runCodeMock).toHaveBeenCalledTimes(1);
  });

  it('does not interpret prose or code fences as an executable tool call', async () => {
    const result = await runResearchAgentReadToolLoop({ sessionId, query: 'Explain this code', now: 100, planSteps: [{ id: 'explain', title: 'Explain', description: '```python\nprint(4)\n```', status: 'pending' }] });
    expect(result.observations).toEqual([]);
    expect(runCodeMock).not.toHaveBeenCalled();
  });

  it('rejects a runner step without explicit execution intent', async () => {
    await expect(runResearchAgentReadToolLoop({ sessionId, query: 'Read and summarize this script', now: 100, planSteps: [computationStep()] })).rejects.toThrow(/execution intent/i);
    expect(runCodeMock).not.toHaveBeenCalled();
    expect(useAgentSessionStore.getState().getSession(sessionId)?.pendingApprovals).toHaveLength(0);
  });

  it('rejects invalid runner args before requesting approval', async () => {
    await expect(run([computationStep({ toolArgs: { language: 'python', code: '' } })])).rejects.toThrow(/runner.runCode/);
    expect(useAgentSessionStore.getState().getSession(sessionId)?.pendingApprovals).toHaveLength(0);
    expect(runCodeMock).not.toHaveBeenCalled();
  });

  it('enforces the tool step budget before a computation requests approval', async () => {
    await expect(runResearchAgentReadToolLoop({ sessionId, query: 'Compute', now: 100, allowCodeExecution: true, maxReadToolSteps: 0, planSteps: [computationStep()] })).rejects.toThrow(/step limit exceeded/);
    expect(useAgentSessionStore.getState().getSession(sessionId)?.pendingApprovals).toHaveLength(0);
    expect(runCodeMock).not.toHaveBeenCalled();
  });

  it('honors cancellation before a computation requests approval', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runResearchAgentReadToolLoop({ sessionId, query: 'Compute', now: 100, allowCodeExecution: true, signal: controller.signal, planSteps: [computationStep()] })).rejects.toMatchObject({ name: 'AbortError' });
    expect(runCodeMock).not.toHaveBeenCalled();
  });
});
