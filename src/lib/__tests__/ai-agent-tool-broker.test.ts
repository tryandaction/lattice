import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  searchIndexMock,
  buildIndexContextMock,
  getRunnerDefinitionForLanguageMock,
  runnerSessionRunMock,
  runnerSessionDisposeMock,
  runnerManagerCreateSessionMock,
  emitRunnerEvent,
  resetRunnerEventListener,
} = vi.hoisted(() => {
  let runnerEventListener: ((event: {
    type: string;
    sessionId: string;
    payload: Record<string, unknown>;
  }) => void) | null = null;

  const runnerSessionRunMock = vi.fn();
  const runnerSessionDisposeMock = vi.fn();
  const runnerManagerCreateSessionMock = vi.fn(() => ({
    onEvent: vi.fn((listener) => {
      runnerEventListener = listener;
      return vi.fn();
    }),
    run: runnerSessionRunMock,
    dispose: runnerSessionDisposeMock,
  }));

  return {
    searchIndexMock: vi.fn(),
    buildIndexContextMock: vi.fn(),
    getRunnerDefinitionForLanguageMock: vi.fn(),
    runnerSessionRunMock,
    runnerSessionDisposeMock,
    runnerManagerCreateSessionMock,
    emitRunnerEvent: (event: {
      type: string;
      sessionId: string;
      payload: Record<string, unknown>;
    }) => runnerEventListener?.(event),
    resetRunnerEventListener: () => {
      runnerEventListener = null;
    },
  };
});

const storage = {
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
};

vi.mock('@/lib/storage-adapter', () => ({
  getStorageAdapter: () => storage,
}));

vi.mock('../ai/workspace-indexer', () => ({
  searchIndex: searchIndexMock,
  buildIndexContext: buildIndexContextMock,
}));

vi.mock('@/lib/runner/preferences', () => ({
  getRunnerDefinitionForLanguage: getRunnerDefinitionForLanguageMock,
}));

vi.mock('@/lib/runner/runner-manager', () => ({
  runnerManager: {
    createSession: runnerManagerCreateSessionMock,
  },
  runnerEventToTextOutputs: (event: {
    type: string;
    payload: { text?: string; channel?: 'stdout' | 'stderr'; message?: string };
  }) => {
    if (event.type === 'stdout' || event.type === 'stderr') {
      return [{ type: 'text', content: event.payload.text ?? '', channel: event.payload.channel }];
    }
    if (event.type === 'error') {
      return [{ type: 'error', content: event.payload.message ?? 'Execution failed' }];
    }
    return [];
  },
}));

import {
  approveAgentToolRequest,
  createAgentToolSession,
  executeAgentTool,
  getAgentToolDescriptor,
  listAgentToolDescriptors,
  rejectAgentToolRequest,
} from '../ai/agent-tool-broker';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { useAgentMemoryStore } from '@/stores/agent-memory-store';
import { useAiWorkbenchStore } from '@/stores/ai-workbench-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { AiTaskProposal } from '../ai/types';

function createProposal(overrides: Partial<AiTaskProposal> = {}): AiTaskProposal {
  return {
    id: 'proposal-broker-1',
    summary: 'Create a broker proposal',
    steps: [
      { id: 'step-1', title: 'Review', description: 'Review the evidence.' },
    ],
    requiredApprovals: ['Confirm write targets'],
    plannedWrites: [
      {
        targetPath: 'AI Drafts/broker.md',
        mode: 'create',
        contentPreview: 'Broker draft preview',
      },
    ],
    sourceRefs: [
      {
        kind: 'file',
        label: 'notes.md',
        locator: 'notes.md',
      },
    ],
    status: 'pending',
    confirmedApprovals: [],
    approvedWrites: ['AI Drafts/broker.md'],
    generatedDraftTargets: [],
    createdAt: 100,
    ...overrides,
  };
}

describe('agent-tool-broker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRunnerEventListener();
    searchIndexMock.mockReturnValue([]);
    buildIndexContextMock.mockReturnValue('');
    getRunnerDefinitionForLanguageMock.mockReturnValue({
      runnerType: 'external-command',
      command: 'node',
      displayName: 'Node.js',
      supportsInlineCode: true,
      buildArgs: ({ code }: { code?: string }) => (code ? ['-e', code] : []),
    });
    runnerSessionRunMock.mockImplementation(async () => {
      emitRunnerEvent({
        type: 'stdout',
        sessionId: 'runner-session-1',
        payload: { text: '4', channel: 'stdout' },
      });
      return {
        sessionId: 'runner-session-1',
        success: true,
        exitCode: 0,
        terminated: false,
      };
    });
    useAgentSessionStore.setState({
      sessions: [],
      activeSessionId: null,
    });
    useAgentMemoryStore.setState({
      entries: [],
      loaded: true,
    });
    useAiWorkbenchStore.setState({
      drafts: [],
      proposals: [],
      highlightedProposalId: null,
    });
    useWorkspaceStore.setState({
      workspaceIdentity: null,
    });
  });

  it('exposes stable tool descriptors for policy, trace, and planner surfaces', () => {
    expect(getAgentToolDescriptor('memory.write')).toMatchObject({
      name: 'memory.write',
      capability: 'memory_write',
      label: 'Write memory',
      argsSummary: '{ memory, reason?: string }',
    });
    expect(listAgentToolDescriptors(['workspace.search', 'evidence.resolve']).map((tool) => tool.name)).toEqual([
      'workspace.search',
      'evidence.resolve',
    ]);
  });

  it('executes readonly workspace search automatically and records trace', async () => {
    searchIndexMock.mockReturnValue([
      {
        path: 'notes/alpha.md',
        name: 'alpha.md',
        extension: '.md',
        size: 42,
        summary: 'alpha summary',
        lastModified: 1,
      },
    ]);
    const sessionId = createAgentToolSession({
      profile: 'research',
      task: 'Search indexed notes',
    });

    const result = await executeAgentTool({
      name: 'workspace.search',
      args: { query: 'alpha', limit: 3 },
    }, { sessionId });

    expect(result.status).toBe('completed');
    expect(result.result).toHaveLength(1);
    expect(result.resultPreview).toBe('notes/alpha.md');
    expect(result.resultMetadata).toMatchObject({
      resultSchemaVersion: 1,
      resultKind: 'workspace.search',
      resultStatus: 'completed',
      resultSummary: '1 indexed file match.',
      resultMetricsPreview: 'items=1',
      resultArtifactsPreview: 'notes/alpha.md',
      resultItemCount: 1,
      topPath: 'notes/alpha.md',
    });
    expect(searchIndexMock).toHaveBeenCalledWith('alpha', 3);

    const session = useAgentSessionStore.getState().getSession(sessionId);
    expect(session?.status).toBe('running');
    expect(session?.trace.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['session_started', 'tool_requested', 'tool_result']),
    );
    expect(session?.trace.find((event) => event.kind === 'tool_requested')?.tool).toMatchObject({
      capability: 'search_workspace',
      toolName: 'workspace.search',
    });
    expect(session?.trace.find((event) => event.kind === 'tool_requested')).toMatchObject({
      metadata: expect.objectContaining({
        toolLabel: 'Workspace search',
        toolArgsSummary: '{ query: string, limit?: number }',
        toolResultSummary: 'Indexed file matches with paths and summaries.',
      }),
    });
    expect(session?.trace.find((event) => event.kind === 'tool_result')).toMatchObject({
      metadata: expect.objectContaining({
        resultSchemaVersion: 1,
        resultKind: 'workspace.search',
        resultStatus: 'completed',
        resultPreview: 'notes/alpha.md',
        resultMetricsPreview: 'items=1',
        resultItemCount: 1,
      }),
    });
  });

  it('resolves Lattice path identity as a read-only broker tool', async () => {
    useWorkspaceStore.setState({
      workspaceIdentity: {
        workspaceKey: 'workspace-alpha',
        displayPath: 'C:/Research/Lattice Workspace',
        rootName: 'Lattice Workspace',
        hostKind: 'desktop',
        handleFingerprint: null,
        lastUsedAt: 100,
      },
    });
    const sessionId = createAgentToolSession({
      profile: 'research',
      task: 'Resolve a Lattice PDF path',
    });

    const result = await executeAgentTool({
      name: 'lattice.resolvePathIdentity',
      args: {
        filePathOrAbsolutePath: 'C:/Research/Lattice Workspace/atom/Categorized Papers/Rydberg paper.pdf',
      },
    }, { sessionId });

    expect(result.status).toBe('completed');
    expect(result.decision).toMatchObject({
      capability: 'lattice_read_identity',
      requiresApproval: false,
    });
    expect(result.result).toMatchObject({
      kind: 'pdf',
      latticePath: 'atom/Categorized Papers/Rydberg paper.pdf',
      fileId: 'atom-Categorized_Papers-Rydberg_paper.pdf',
      annotationPath: '.lattice/annotations/atom-Categorized_Papers-Rydberg_paper.pdf.json',
      itemFolderPath: '.lattice/items/atom-Categorized_Papers-Rydberg_paper.pdf',
      annotationIndexPath: '.lattice/items/atom-Categorized_Papers-Rydberg_paper.pdf/_annotations.md',
    });
    expect(result.resultPreview).toBe('atom/Categorized Papers/Rydberg paper.pdf -> atom-Categorized_Papers-Rydberg_paper.pdf');
    expect(result.resultMetadata).toMatchObject({
      resultSchemaVersion: 1,
      resultKind: 'lattice.resolvePathIdentity',
      resultSummary: 'pdf path identity resolved.',
      resultMetricsPreview: expect.stringContaining('candidates='),
      fileId: 'atom-Categorized_Papers-Rydberg_paper.pdf',
      annotationPath: '.lattice/annotations/atom-Categorized_Papers-Rydberg_paper.pdf.json',
      itemFolderPath: '.lattice/items/atom-Categorized_Papers-Rydberg_paper.pdf',
    });

    const session = useAgentSessionStore.getState().getSession(sessionId);
    expect(session?.status).toBe('running');
    expect(session?.trace.find((event) => event.kind === 'tool_requested')).toMatchObject({
      tool: expect.objectContaining({
        capability: 'lattice_read_identity',
        toolName: 'lattice.resolvePathIdentity',
      }),
      metadata: expect.objectContaining({
        toolLabel: 'Resolve Lattice path identity',
        toolArgsSummary: '{ filePathOrAbsolutePath: string, fileName?: string, kind?: "generic" | "pdf" }',
      }),
    });
    expect(session?.trace.find((event) => event.kind === 'tool_result')).toMatchObject({
      metadata: expect.objectContaining({
        resultKind: 'lattice.resolvePathIdentity',
        latticePath: 'atom/Categorized Papers/Rydberg paper.pdf',
        fileId: 'atom-Categorized_Papers-Rydberg_paper.pdf',
      }),
    });
  });

  it('denies Lattice path identity resolution for chat sessions by policy', async () => {
    const sessionId = createAgentToolSession({
      profile: 'chat',
      task: 'Resolve a path from plain chat',
    });

    const denied = await executeAgentTool({
      name: 'lattice.resolvePathIdentity',
      args: {
        filePathOrAbsolutePath: 'notes/alpha.md',
      },
    }, { sessionId });

    expect(denied.status).toBe('denied');
    expect(denied.decision).toMatchObject({
      capability: 'lattice_read_identity',
      allowed: false,
    });
    expect(useAgentSessionStore.getState().getSession(sessionId)?.trace.find((event) => event.kind === 'error')).toMatchObject({
      metadata: expect.objectContaining({
        errorCategory: 'policy',
        errorToolName: 'lattice.resolvePathIdentity',
      }),
    });
  });

  it('resolves evidence through the broker and merges refs into the session', async () => {
    const sessionId = createAgentToolSession({
      profile: 'research',
      task: 'Resolve selected evidence',
    });

    const result = await executeAgentTool({
      name: 'evidence.resolve',
      args: {
        filePath: 'notes.md',
        content: '# Intro\nBody',
        selection: 'Selected claim',
        maxContextTokens: 2000,
      },
    }, { sessionId });

    expect(result.status).toBe('completed');
    expect(result.result?.evidenceRefs.length).toBeGreaterThan(0);
    expect(result.resultPreview).toContain('context node');
    expect(result.resultMetadata).toMatchObject({
      resultSchemaVersion: 1,
      resultKind: 'evidence.resolve',
      resultStatus: expect.stringMatching(/completed|partial/),
      resultMetricsPreview: expect.stringContaining('evidence='),
      evidenceCount: expect.any(Number),
      contextNodeCount: expect.any(Number),
    });

    const session = useAgentSessionStore.getState().getSession(sessionId);
    expect(session?.trace.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['tool_result', 'context_resolved']),
    );
    expect(session?.evidenceRefs.map((ref) => ref.locator)).toContain('notes.md');
    expect(session?.trace.find((event) => event.kind === 'tool_result')).toMatchObject({
      metadata: expect.objectContaining({
        resultSchemaVersion: 1,
        resultKind: 'evidence.resolve',
        resultSummary: expect.stringContaining('evidence ref'),
        resultPreview: expect.stringContaining('evidence ref'),
      }),
    });
  });

  it('requires approval before research sessions create workbench drafts', async () => {
    const sessionId = createAgentToolSession({
      profile: 'research',
      task: 'Create a draft',
    });
    const draft = {
      type: 'paper_note' as const,
      title: 'Broker Draft',
      sourceRefs: [],
      content: 'Draft body',
    };

    const blocked = await executeAgentTool({
      name: 'workbench.createDraft',
      args: { draft },
    }, { sessionId });

    expect(blocked.status).toBe('requires_approval');
    expect(useAiWorkbenchStore.getState().drafts).toHaveLength(0);
    expect(useAgentSessionStore.getState().getSession(sessionId)?.status).toBe('waiting_approval');
    expect(useAgentSessionStore.getState().getSession(sessionId)?.pendingApprovals).toEqual([
      expect.objectContaining({
        id: blocked.approvalRequestId,
        status: 'pending',
        toolName: 'workbench.createDraft',
      }),
    ]);

    const approved = await approveAgentToolRequest(blocked.approvalRequestId!);

    expect(approved.status).toBe('completed');
    expect(useAiWorkbenchStore.getState().drafts[0]).toMatchObject({
      title: 'Broker Draft',
      status: 'draft',
    });

    const session = useAgentSessionStore.getState().getSession(sessionId);
    expect(session?.status).toBe('running');
    expect(session?.approvalRequestIds).toEqual([]);
    expect(session?.pendingApprovals[0]).toMatchObject({
      status: 'completed',
      resultPreview: expect.stringContaining('Draft created:'),
    });
    expect(session?.trace.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['approval_required', 'approval_granted', 'draft_created']),
    );
    expect(session?.trace.find((event) => event.kind === 'approval_granted')).toMatchObject({
      message: 'Create draft approved by the user.',
      tool: expect.objectContaining({
        capability: 'create_draft',
        toolName: 'workbench.createDraft',
      }),
    });
  });

  it('requires approval before writing agent memory and records memory trace', async () => {
    const sessionId = createAgentToolSession({
      profile: 'research',
      task: 'Remember a research preference',
    });

    const blocked = await executeAgentTool({
      name: 'memory.write',
      args: {
        memory: {
          id: 'memory-tool-1',
          scope: 'workspace',
          title: 'Reading note style',
          content: 'Prefer concise evidence-backed notes.',
          source: {
            label: 'Research Agent suggestion',
            locator: `agent-session://${sessionId}`,
            fingerprint: 'mem-src-tool-1',
          },
          workspaceKey: 'workspace-a',
          now: 100,
        },
        reason: 'Reusable research preference.',
      },
    }, { sessionId });

    expect(blocked.status).toBe('requires_approval');
    expect(useAgentMemoryStore.getState().entries).toHaveLength(0);

    const approved = await approveAgentToolRequest(blocked.approvalRequestId!);

    expect(approved.status).toBe('completed');
    expect(approved.resultPreview).toContain('Memory saved: Reading note style.');
    expect(approved.resultMetadata).toMatchObject({
      resultSchemaVersion: 1,
      resultKind: 'memory.write',
      resultSummary: 'Memory saved in workspace scope.',
      resultArtifactsPreview: 'memory-tool-1',
      resultDiagnosticsPreview: 'fingerprint=mem-src-tool-1',
    });
    expect(useAgentMemoryStore.getState().getMemory('memory-tool-1')).toMatchObject({
      scope: 'workspace',
      title: 'Reading note style',
      status: 'active',
    });

    const session = useAgentSessionStore.getState().getSession(sessionId);
    expect(session?.pendingApprovals[0]).toMatchObject({
      status: 'completed',
      resultPreview: expect.stringContaining('Memory saved:'),
    });
    expect(session?.memorySnapshotIds).toEqual(['memory-tool-1']);
    expect(session?.trace.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['approval_required', 'approval_granted', 'tool_result', 'memory_updated']),
    );
    expect(session?.trace.find((event) => event.kind === 'memory_updated')).toMatchObject({
      metadata: expect.objectContaining({
        memoryId: 'memory-tool-1',
        memoryScope: 'workspace',
        memorySourceFingerprint: 'mem-src-tool-1',
        memorySnapshotIdsPreview: 'memory-tool-1',
      }),
    });
  });

  it('requires approval before adding proposals and denies runner by default for chat sessions', async () => {
    const researchSessionId = createAgentToolSession({
      profile: 'research',
      task: 'Create a proposal',
    });
    const proposal = createProposal();

    const blocked = await executeAgentTool({
      name: 'workbench.createProposal',
      args: { proposal },
    }, { sessionId: researchSessionId });

    expect(blocked.status).toBe('requires_approval');
    expect(useAiWorkbenchStore.getState().proposals).toHaveLength(0);

    const approved = await executeAgentTool({
      name: 'workbench.createProposal',
      args: { proposal },
    }, { sessionId: researchSessionId, approvedByUser: true });

    expect(approved.status).toBe('completed');
    expect(useAiWorkbenchStore.getState().proposals[0]?.id).toBe('proposal-broker-1');
    expect(useAgentSessionStore.getState().getSession(researchSessionId)?.trace.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['approval_required', 'approval_granted', 'proposal_created']),
    );

    const runnerBlocked = await executeAgentTool({
      name: 'runner.runCode',
      args: { language: 'javascript', code: '1 + 1' },
    }, {
      sessionId: researchSessionId,
      runCode: async () => ({ output: '2' }),
    });

    expect(runnerBlocked.status).toBe('requires_approval');

    const runnerApproved = await executeAgentTool({
      name: 'runner.runCode',
      args: { language: 'javascript', code: '1 + 1' },
    }, {
      sessionId: researchSessionId,
      approvedByUser: true,
      runCode: async () => ({ output: '2' }),
    });

    expect(runnerApproved).toMatchObject({
      status: 'completed',
      result: { output: '2' },
    });
    expect(useAgentSessionStore.getState().getSession(researchSessionId)?.trace.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['approval_required', 'approval_granted', 'tool_result']),
    );

    const chatSessionId = createAgentToolSession({
      profile: 'chat',
      task: 'Try code execution',
    });
    const denied = await executeAgentTool({
      name: 'runner.runCode',
      args: { language: 'javascript', code: '1 + 1' },
    }, {
      sessionId: chatSessionId,
      runCode: async () => ({ output: '2' }),
    });

    expect(denied.status).toBe('denied');
    const deniedSession = useAgentSessionStore.getState().getSession(chatSessionId);
    expect(deniedSession?.status).toBe('failed');
    expect(deniedSession?.trace.find((event) => event.kind === 'error')).toMatchObject({
      metadata: expect.objectContaining({
        errorCategory: 'policy',
        errorStage: 'tool.policy',
        errorToolName: 'runner.runCode',
      }),
    });
  });

  it('keeps runner execution blocked until approval, then records success or failure in trace', async () => {
    const sessionId = createAgentToolSession({
      profile: 'research',
      task: 'Run code from agent',
    });
    const runCode = vi.fn(async () => ({ output: '4' }));

    const blocked = await executeAgentTool({
      name: 'runner.runCode',
      args: { language: 'javascript', code: '2 + 2' },
    }, {
      sessionId,
      runCode,
    });

    expect(blocked.status).toBe('requires_approval');
    expect(runCode).not.toHaveBeenCalled();

    const approved = await approveAgentToolRequest(blocked.approvalRequestId!, { runCode });

    expect(approved).toMatchObject({
      status: 'completed',
      result: { output: '4' },
    });
    expect(runCode).toHaveBeenCalledWith({ language: 'javascript', code: '2 + 2' });
    expect(useAgentSessionStore.getState().getSession(sessionId)?.pendingApprovals[0]).toMatchObject({
      status: 'completed',
      resultPreview: expect.stringContaining('4'),
    });

    const failingSessionId = createAgentToolSession({
      profile: 'research',
      task: 'Run failing code',
    });
    const failingRunCode = vi.fn(async () => {
      throw new Error('runner exploded');
    });
    const failingBlocked = await executeAgentTool({
      name: 'runner.runCode',
      args: { language: 'python', code: '1 / 0' },
    }, {
      sessionId: failingSessionId,
      runCode: failingRunCode,
    });

    const failed = await approveAgentToolRequest(failingBlocked.approvalRequestId!, {
      runCode: failingRunCode,
    });

    expect(failed).toMatchObject({
      status: 'failed',
      error: 'runner exploded',
    });
    const failingSession = useAgentSessionStore.getState().getSession(failingSessionId);
    expect(failingSession?.pendingApprovals[0]).toMatchObject({
      status: 'failed',
      error: 'runner exploded',
    });
    expect(failingSession?.trace.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['approval_required', 'approval_granted', 'error']),
    );
    expect(failingSession?.trace.find((event) => event.kind === 'error')).toMatchObject({
      metadata: expect.objectContaining({
        errorCategory: 'tool',
        errorStage: 'tool.execute',
        errorToolName: 'runner.runCode',
        errorRecoveryHint: expect.stringContaining('tool contract'),
      }),
    });
  });

  it('uses the default workspace runner only after approval and writes failure trace', async () => {
    const sessionId = createAgentToolSession({
      profile: 'research',
      task: 'Run code through the default broker runner',
    });

    const blocked = await executeAgentTool({
      name: 'runner.runCode',
      args: { language: 'javascript', code: '2 + 2' },
    }, { sessionId });

    expect(blocked.status).toBe('requires_approval');
    expect(runnerManagerCreateSessionMock).not.toHaveBeenCalled();

    const approved = await approveAgentToolRequest(blocked.approvalRequestId!);

    expect(approved).toMatchObject({
      status: 'completed',
      result: { output: '4' },
    });
    expect(getRunnerDefinitionForLanguageMock).toHaveBeenCalledWith('javascript');
    expect(runnerManagerCreateSessionMock).toHaveBeenCalledTimes(1);
    expect(runnerSessionRunMock).toHaveBeenCalledWith(expect.objectContaining({
      runnerType: 'external-command',
      command: 'node',
      code: '2 + 2',
      args: ['-e', '2 + 2'],
      mode: 'inline',
    }));

    const session = useAgentSessionStore.getState().getSession(sessionId);
    expect(session?.pendingApprovals[0]).toMatchObject({
      status: 'completed',
      resultPreview: expect.stringContaining('4'),
    });
    expect(session?.trace.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['approval_required', 'approval_granted', 'tool_result']),
    );

    const failingSessionId = createAgentToolSession({
      profile: 'research',
      task: 'Run failing code through the default broker runner',
    });
    const failingBlocked = await executeAgentTool({
      name: 'runner.runCode',
      args: { language: 'javascript', code: 'throw new Error("boom")' },
    }, { sessionId: failingSessionId });

    runnerSessionRunMock.mockImplementationOnce(async () => {
      emitRunnerEvent({
        type: 'error',
        sessionId: 'runner-session-2',
        payload: { message: 'boom' },
      });
      return {
        sessionId: 'runner-session-2',
        success: false,
        exitCode: 1,
        terminated: false,
      };
    });

    const failed = await approveAgentToolRequest(failingBlocked.approvalRequestId!);

    expect(failed).toMatchObject({
      status: 'failed',
      error: 'boom',
    });
    const failingSession = useAgentSessionStore.getState().getSession(failingSessionId);
    expect(failingSession?.pendingApprovals[0]).toMatchObject({
      status: 'failed',
      error: 'boom',
    });
    expect(failingSession?.trace.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['approval_required', 'approval_granted', 'error']),
    );
  });

  it('rejects pending approvals without executing the stored request', async () => {
    const sessionId = createAgentToolSession({
      profile: 'research',
      task: 'Reject draft',
    });
    const draft = {
      type: 'paper_note' as const,
      title: 'Rejected Draft',
      sourceRefs: [],
      content: 'Draft body',
    };

    const blocked = await executeAgentTool({
      name: 'workbench.createDraft',
      args: { draft },
    }, { sessionId });

    rejectAgentToolRequest(blocked.approvalRequestId!, 'No write artifacts for this run.');

    expect(useAiWorkbenchStore.getState().drafts).toHaveLength(0);
    const session = useAgentSessionStore.getState().getSession(sessionId);
    expect(session?.status).toBe('cancelled');
    expect(session?.pendingApprovals[0]).toMatchObject({
      status: 'rejected',
      error: 'No write artifacts for this run.',
    });
    expect(session?.trace.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['approval_required', 'cancelled']),
    );
  });
});
