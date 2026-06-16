/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const hoisted = vi.hoisted(() => ({
  storage: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/storage-adapter', () => ({
  getStorageAdapter: () => hoisted.storage,
}));

vi.mock('sonner', () => ({
  toast: {
    success: hoisted.toastSuccess,
    error: hoisted.toastError,
  },
}));

vi.mock('@/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const mapping: Record<string, string> = {
        'chat.agentMemory.title': 'Agent Memory',
        'chat.agentMemory.count': '{count} memories',
        'chat.agentMemory.activeCount': '{count} active memories',
        'chat.agentMemory.disabledCount': '{count} disabled',
        'chat.agentMemory.empty': 'No memory entries yet.',
        'chat.agentMemory.noSaved': 'No saved memories yet.',
        'chat.agentMemory.pendingCount': '{count} pending',
        'chat.agentMemory.suggestions': 'Memory suggestions',
        'chat.agentMemory.activeSessionFocus': 'Reviewing {count} from the current run. {otherCount} from other runs remain visible.',
        'chat.agentMemory.currentRun': 'Current run',
        'chat.agentMemory.approveSuggestion': 'Approve memory',
        'chat.agentMemory.rejectSuggestion': 'Reject memory',
        'chat.agentMemory.suggestionApproved': 'Memory saved',
        'chat.agentMemory.suggestionRejected': 'Memory suggestion rejected',
        'chat.agentMemory.suggestionApproveFailed': 'Unable to save memory',
        'chat.agentMemory.suggestionRejectFailed': 'Unable to reject memory suggestion',
        'chat.agentMemory.suggestionReason': 'Reason',
        'chat.agentMemory.pin': 'Pin memory',
        'chat.agentMemory.unpin': 'Unpin memory',
        'chat.agentMemory.cite': 'Copy citation',
        'chat.agentMemory.disable': 'Disable memory',
        'chat.agentMemory.restore': 'Restore memory',
        'chat.agentMemory.delete': 'Delete memory',
        'chat.agentMemory.source': 'Source',
        'chat.agentMemory.sourceFingerprint': 'Source fingerprint',
        'chat.agentMemory.updated': 'Updated',
        'chat.agentMemory.copied': 'Memory citation copied',
        'chat.agentMemory.copyFailed': 'Unable to copy memory citation',
        'chat.agentMemory.reviewApplicability': 'Applicability',
        'chat.agentMemory.reviewKind': 'Kind',
        'chat.agentMemory.reviewEvidence': 'Evidence',
        'chat.agentMemory.reviewRecovery': 'Recovered context',
        'chat.agentMemory.reviewPolicy': 'Policy',
        'chat.agentMemory.reviewPolicyReasons': 'Policy reasons',
        'chat.agentMemory.reviewCaution': 'Caution',
        'chat.agentMemory.reviewRisk': 'Risk',
        'chat.agentMemory.recommendation.approve': 'Recommended',
        'chat.agentMemory.recommendation.review': 'Review',
        'chat.agentMemory.recommendation.reject': 'Skip',
        'chat.agentMemory.lifecycle': 'Lifecycle',
        'chat.agentMemory.lifecycle.healthy': 'Healthy',
        'chat.agentMemory.lifecycle.stale': 'Stale',
        'chat.agentMemory.lifecycle.weak': 'Weak',
        'chat.agentMemory.lifecycle.review': 'Review',
        'chat.agentMemory.lifecycle.disabled': 'Disabled',
        'chat.agentMemory.lifecycle.deleted': 'Deleted',
        'chat.agentMemory.lifecycleAction.keep': 'Keep',
        'chat.agentMemory.lifecycleAction.review': 'Review',
        'chat.agentMemory.lifecycleAction.refresh': 'Refresh',
        'chat.agentMemory.lifecycleAction.disable': 'Disable',
        'chat.agentMemory.lifecycleAction.restore': 'Restore',
        'chat.agentMemory.runWorkflow': 'Workflow',
        'chat.agentMemory.runPlan': 'Plan',
        'chat.agentMemory.runEvidence': 'Evidence',
        'chat.agentMemory.runMemory': 'Memory',
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

import { AgentMemoryPanel } from '../agent-memory-panel';
import { createAgentToolSession, executeAgentTool } from '@/lib/ai/agent-tool-broker';
import { useAgentMemoryStore } from '@/stores/agent-memory-store';
import { useAgentSessionStore } from '@/stores/agent-session-store';

describe('AgentMemoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => undefined),
      },
    });
    useAgentMemoryStore.setState({
      entries: [],
      loaded: true,
    });
    useAgentSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      focusTarget: null,
    });
  });

  it('inspects, pins, cites, disables, restores, and deletes memory entries', async () => {
    useAgentMemoryStore.getState().addMemory({
      id: 'memory-1',
      scope: 'workspace',
      title: 'Citation rule',
      content: 'Prefer source-backed notes.',
      source: {
        label: 'Workspace rule',
        locator: 'workspace://rules',
      },
      candidateKind: 'project_rule',
      now: 100,
    });

    render(<AgentMemoryPanel />);

    expect(screen.getByText('Agent Memory')).toBeTruthy();
    const memoryToggle = screen.getByRole('button', { name: /Agent Memory/ });
    expect(memoryToggle.getAttribute('aria-expanded')).toBe('true');
    expect(memoryToggle.getAttribute('aria-controls')).toBe('agent-memory-panel-body');
    expect(screen.getAllByText('Citation rule').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Citation rule/ }).getAttribute('aria-current')).toBe('true');
    expect(screen.getAllByText('project_rule').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Stale').length).toBeGreaterThan(0);
    expect(screen.getByText(/Lifecycle: Stale \/ Refresh/)).toBeTruthy();
    expect(screen.getAllByText('Prefer source-backed notes.').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Pin memory' }));
    expect(useAgentMemoryStore.getState().getMemory('memory-1')?.pinned).toBe(true);
    expect(screen.getByRole('button', { name: 'Unpin memory' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy citation' }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        '[workspace] Citation rule - Workspace rule (workspace://rules)',
      );
    });
    expect(hoisted.toastSuccess).toHaveBeenCalledWith('Memory citation copied');

    fireEvent.click(screen.getByRole('button', { name: 'Disable memory' }));
    expect(useAgentMemoryStore.getState().getMemory('memory-1')?.status).toBe('disabled');
    expect(screen.getByRole('button', { name: 'Restore memory' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Restore memory' }));
    expect(useAgentMemoryStore.getState().getMemory('memory-1')?.status).toBe('active');

    fireEvent.click(screen.getByRole('button', { name: 'Delete memory' }));
    expect(useAgentMemoryStore.getState().getMemory('memory-1')?.status).toBe('deleted');
    expect(screen.queryByText('Citation rule')).toBeNull();
  });

  it('shows pending memory suggestions and approves them through the broker', async () => {
    const sessionId = createAgentToolSession({
      profile: 'research',
      task: 'Suggest memory',
    });
    await executeAgentTool({
      name: 'memory.write',
      args: {
        memory: {
          id: 'memory-suggestion-1',
          scope: 'workspace',
          title: 'Suggested rule',
          content: 'Remember this evidence-backed preference.',
          source: {
            label: 'Research Agent suggestion',
            locator: `agent-session://${sessionId}`,
            fingerprint: 'mem-src-suggestion-1',
          },
          now: 100,
        },
        reason: 'Reusable across future research runs.',
        review: {
          candidateKind: 'finding',
          applicability: 'Workspace: workspace-alpha / Markdown Research / Query: Alpha',
          evidenceSummary: 'alpha.md (notes/alpha.md) / Context pack research-pack-alpha',
          recoverySummary: '1. workspace.readIndexedContext @ notes/recovered-alpha.md',
          policySummary: 'approve / adjusted=72% / provenance:ok, reuse:ok',
          policyReasons: ['provenance:ok', 'reuse:ok'],
          caution: 'Approve only if this finding should influence future research runs in the shown scope.',
        },
      },
    }, { sessionId });

    render(<AgentMemoryPanel />);

    expect(screen.getByText('1 pending')).toBeTruthy();
    expect(screen.getByText('Memory suggestions')).toBeTruthy();
    expect(screen.getByText('Suggested rule')).toBeTruthy();
    expect(screen.getByText('Recommended 72%')).toBeTruthy();
    expect(screen.getByText('finding')).toBeTruthy();
    expect(screen.getByText('Reason: Reusable across future research runs.')).toBeTruthy();
    expect(screen.getByText('Evidence: alpha.md (notes/alpha.md) / Context pack research-pack-alpha')).toBeTruthy();
    expect(screen.getByText('Recovered context: 1. workspace.readIndexedContext @ notes/recovered-alpha.md')).toBeTruthy();
    expect(screen.getByText('Policy: approve / adjusted=72% / provenance:ok, reuse:ok')).toBeTruthy();
    expect(screen.getByText(`Source: Research Agent suggestion / agent-session://${sessionId}`)).toBeTruthy();
    expect(screen.queryByText('Kind: finding')).toBeNull();
    expect(screen.queryByText('Policy reasons: provenance:ok, reuse:ok')).toBeNull();
    expect(screen.queryByText('Caution: Approve only if this finding should influence future research runs in the shown scope.')).toBeNull();
    expect(screen.getByText('Source fingerprint: ...c-suggestion-1')).toBeTruthy();
    expect(screen.getByText('No saved memories yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve memory' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject memory' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Approve memory' }));

    await waitFor(() => {
      expect(useAgentMemoryStore.getState().getMemory('memory-suggestion-1')).toMatchObject({
        title: 'Suggested rule',
        status: 'active',
      });
    });
    expect(hoisted.toastSuccess).toHaveBeenCalledWith('Memory saved');
    expect(useAgentSessionStore.getState().getSession(sessionId)?.pendingApprovals[0]).toMatchObject({
      status: 'completed',
    });
  });

  it('prioritizes pending suggestions from the active agent session', async () => {
    const olderSessionId = createAgentToolSession({
      profile: 'research',
      task: 'Older memory',
      title: 'Older run',
    });
    await executeAgentTool({
      name: 'memory.write',
      args: {
        memory: {
          id: 'memory-older',
          scope: 'workspace',
          title: 'Older suggestion',
          content: 'Older reusable finding.',
          source: { label: 'Older source', locator: `agent-session://${olderSessionId}` },
          now: 100,
        },
      },
    }, { sessionId: olderSessionId });

    const activeSessionId = createAgentToolSession({
      profile: 'research',
      task: 'Focused memory',
      title: 'Focused run',
    });
    useAgentSessionStore.getState().appendTrace(activeSessionId, {
      kind: 'planning',
      message: 'Research Agent plan created.',
      timestamp: 150,
      metadata: {
        planSource: 'custom',
        planStepCount: 2,
        workflowTitle: 'Markdown Research',
      },
    });
    useAgentSessionStore.getState().appendTrace(activeSessionId, {
      kind: 'planning',
      message: 'Completed plan step: Resolve evidence.',
      timestamp: 151,
      evidenceRefs: [
        { kind: 'file', label: 'alpha.md', locator: 'notes/alpha.md' },
      ],
      metadata: {
        planStepId: 'resolve',
        planStepStatus: 'completed',
      },
    });
    await executeAgentTool({
      name: 'memory.write',
      args: {
        memory: {
          id: 'memory-focused',
          scope: 'workspace',
          title: 'Focused suggestion',
          content: 'Focused reusable finding.',
          source: { label: 'Focused source', locator: `agent-session://${activeSessionId}` },
          now: 101,
        },
      },
    }, { sessionId: activeSessionId });
    useAgentSessionStore.getState().setActiveSession(activeSessionId);

    render(<AgentMemoryPanel />);

    expect(screen.getByText('Reviewing 1 from the current run. 1 from other runs remain visible.')).toBeTruthy();
    expect(screen.getByTestId('agent-memory-active-run-audit').textContent).toContain('Workflow: Markdown Research');
    expect(screen.getByTestId('agent-memory-active-run-audit').textContent).toContain('Plan: 1/1');
    expect(screen.getByTestId('agent-memory-active-run-audit').textContent).toContain('Evidence: 1');
    expect(screen.getByTestId('agent-memory-active-run-audit').textContent).toContain('Memory: 1');
    expect(screen.getByText('Current run')).toBeTruthy();
    expect(screen.getByText('Focused run')).toBeTruthy();
    expect(screen.getByText('Older run')).toBeTruthy();

    const focused = screen.getByText('Focused suggestion');
    const older = screen.getByText('Older suggestion');
    expect(focused.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('expands memory review when a chat action focuses the memory panel', async () => {
    useAgentMemoryStore.getState().addMemory({
      id: 'memory-existing-focus',
      scope: 'workspace',
      title: 'Existing focus memory',
      content: 'Already saved.',
      source: { label: 'Saved source' },
      now: 100,
    });

    render(<AgentMemoryPanel />);

    fireEvent.click(screen.getByText('Agent Memory'));
    expect(screen.queryByText('Existing focus memory')).toBeNull();

    act(() => {
      useAgentSessionStore.getState().focusSession('missing-session', 'memory');
    });

    await waitFor(() => {
      expect(screen.getAllByText('Existing focus memory').length).toBeGreaterThan(0);
    });
    expect(useAgentSessionStore.getState().focusTarget).toBeNull();
  });

  it('rejects pending memory suggestions without saving them', async () => {
    const sessionId = createAgentToolSession({
      profile: 'research',
      task: 'Reject memory',
    });
    await executeAgentTool({
      name: 'memory.write',
      args: {
        memory: {
          id: 'memory-rejected-1',
          scope: 'conversation',
          title: 'Rejected suggestion',
          content: 'Do not save this.',
          source: { label: 'Research Agent suggestion', locator: `agent-session://${sessionId}` },
          now: 100,
        },
      },
    }, { sessionId });

    render(<AgentMemoryPanel />);

    fireEvent.click(screen.getByTitle('Reject memory'));

    await waitFor(() => {
      expect(useAgentSessionStore.getState().getSession(sessionId)?.pendingApprovals[0]).toMatchObject({
        status: 'rejected',
      });
    });
    expect(useAgentMemoryStore.getState().getMemory('memory-rejected-1')).toBeNull();
    expect(hoisted.toastSuccess).toHaveBeenCalledWith('Memory suggestion rejected');
  });
});
