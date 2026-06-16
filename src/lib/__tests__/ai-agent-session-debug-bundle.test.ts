import { describe, expect, it } from 'vitest';

import { buildAgentSessionDebugBundle, serializeAgentSessionDebugBundle } from '../ai/agent-session-debug-bundle';
import { createAgentSession, appendAgentTraceEvent, addAgentPendingApproval } from '../ai/agent-session';

describe('agent-session-debug-bundle', () => {
  it('exports a bounded, structured debug bundle for an agent session', () => {
    let session = createAgentSession({
      id: 'session-debug',
      profile: 'research',
      title: 'Debug session',
      task: 'Inspect a research run',
      contextPackId: 'context-pack-alpha',
      memorySnapshotIds: ['memory-1'],
      now: 100,
    });
    session = appendAgentTraceEvent(session, {
      id: 'session-debug:context-pack',
      kind: 'planning',
      timestamp: 101,
      message: 'Built context pack.',
      metadata: {
        omittedContextCount: 2,
        omittedContextTokens: 320,
      },
    });
    session = appendAgentTraceEvent(session, {
      id: 'session-debug:tool',
      kind: 'tool_result',
      timestamp: 102,
      message: 'Evidence resolved.',
      tool: {
        capability: 'resolve_evidence',
        toolName: 'evidence.resolve',
        argumentsPreview: '{"query":"alpha"}',
      },
      metadata: {
        resultStatus: 'completed',
        resultSummary: '1 context node, 1 evidence ref.',
        resultMetricsPreview: 'nodes=1,evidence=1',
        resultArtifactsPreview: 'notes/alpha.md',
      },
    });
    session = addAgentPendingApproval(session, {
      id: 'approval-1',
      capability: 'create_draft',
      toolName: 'workbench.createDraft',
      argumentsPreview: '{"draft":"redacted preview"}',
      request: {
        name: 'workbench.createDraft',
        args: { draft: { content: 'full draft should not appear in bundle' } },
      },
      decision: {
        capability: 'create_draft',
        permission: 'ask',
        allowed: true,
        requiresApproval: true,
      },
      now: 103,
    });
    session = appendAgentTraceEvent(session, {
      id: 'session-debug:error',
      kind: 'error',
      timestamp: 104,
      message: 'Evidence resolution failed.',
      error: 'Evidence resolution failed.',
      metadata: {
        errorCategory: 'context',
        errorStage: 'context.evidence_resolve',
        errorToolName: 'evidence.resolve',
        errorRecoveryHint: 'Check context pack sources.',
      },
    });

    const bundle = buildAgentSessionDebugBundle(session, { exportedAt: 200 });
    const serialized = serializeAgentSessionDebugBundle(bundle);

    expect(bundle).toMatchObject({
      schemaVersion: 1,
      exportedAt: 200,
      session: {
        id: 'session-debug',
        status: 'failed',
        contextPackId: 'context-pack-alpha',
        memorySnapshotCount: 1,
        error: 'Evidence resolution failed.',
      },
      summary: {
        traceEventCount: 4,
        toolResultCount: 1,
        errorCount: 1,
        approvalCount: 1,
        pendingApprovalCount: 1,
        omittedContextCount: 2,
        omittedContextTokens: 320,
      },
      diagnostics: [
        expect.objectContaining({
          category: 'context',
          stage: 'context.evidence_resolve',
          toolName: 'evidence.resolve',
          recoveryHint: 'Check context pack sources.',
        }),
      ],
    });
    expect(serialized).toContain('"schemaVersion": 1');
    expect(serialized).not.toContain('full draft should not appear in bundle');
  });
});
