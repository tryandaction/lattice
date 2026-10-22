import { expect, it } from 'vitest';
import { createAiHarnessStore } from '@/stores/ai-harness-store';
import type { StorageAdapter } from '@/lib/storage-adapter';
import { createAuthorizedSourceIndex } from '@/lib/ai/source-index';
import { SourceTestDirectory, SourceTestFile } from '@/lib/ai/__tests__/fixtures/source-workspace';
import type { HarnessEvent, HarnessToolResultRequest, HarnessTransport } from '../types';

const nativeByteLimit = 1024 * 1024;

async function executeToolResponses(outputs: Array<{ success: boolean; text: string }>) {
  const queue: HarnessEvent[] = [], received: HarnessToolResultRequest[] = [];
  let sequence = 0;
  const event = (kind: HarnessEvent['kind'], extra: Partial<HarnessEvent> = {}): HarnessEvent => ({
    connectionId: 'owned', conversationId: 'conversation', sessionId: 'session', turnId: 'turn',
    sequence: ++sequence, timestamp: Date.now(), kind, ...extra,
  });
  const toolCall = (index: number) => event('tool-call', { toolCall: {
    requestId: `request-${index}`, callId: `call-${index}`, tool: 'lattice_sources_read', arguments: { path: 'long.md', maxChars: 1000 },
  } });
  const transport: HarnessTransport = {
    probe: async engine => ({ engine, executable: 'fixture.exe', version: 'fixture', installed: true, supported: true, reason: null,
      protocol: 'codex-app-server-jsonl', capabilities: { resume: true, interrupt: true, approvals: true, workspaceRead: false, scratchWrite: true } }),
    connect: async request => ({ connectionId: 'owned', conversationId: request.conversationId, engine: request.engine,
      workspace: request.workspace, scratchPath: 'C:/native/scratch/artifacts', permissionProfile: 'fixture', probe: await transport.probe(request.engine) }),
    start: async () => ({ connectionId: 'owned', conversationId: 'conversation', sessionId: 'session' }),
    resume: async request => ({ connectionId: request.connectionId, conversationId: 'conversation', sessionId: request.sessionId }),
    turn: async () => {
      queue.push(event('started'), toolCall(0));
      return { connectionId: 'owned', conversationId: 'conversation', sessionId: 'session', turnId: 'turn' };
    },
    toolResult: async request => {
      // Same constraint as agent_harness.rs: tool_result's MAX_PROMPT byte guard.
      if (new TextEncoder().encode(request.text).byteLength > nativeByteLimit) throw new Error('Native tool result exceeds 1 MiB');
      received.push(request);
      if (received.length < outputs.length) queue.push(toolCall(received.length));
      else queue.push(event('message', { phase: 'final_answer', text: '已完成有限范围读取。' }), event('completed'));
    },
    drainEvents: async () => queue.splice(0),
    interrupt: async () => {}, approval: async () => {}, disconnect: async () => {},
    readScratch: async (_connection, path) => ({ path, fileName: 'fixture.md', content: '', byteLength: 0, revision: 'v1' }),
  };
  const storage: StorageAdapter = { get: async () => null, set: async () => {}, remove: async () => {}, clear: async () => {} };
  const store = createAiHarnessStore({ transport, storage, pollMs: 1 });
  store.getState().setConfig({ engine: 'codex' });
  let index = 0;
  const text = await store.getState().sendTurn({ conversationId: 'conversation', workspace: 'C:/fixture', text: '读取授权来源',
    onToolCall: async () => outputs[index++] });
  return { text, received, session: store.getState().sessions.conversation };
}

it.each([
  { success: true, text: '正常中文正文与来源定位。' },
  { success: false, text: 'Permission denied; original diagnostic.' },
  { success: true, text: 'x'.repeat(nativeByteLimit) },
])('preserves an in-budget native tool response unchanged (success=$success)', async output => {
  const result = await executeToolResponses([output]);
  expect(result.received[0]).toMatchObject(output);
  expect(result.session.status).toBe('completed');
});

it('keeps a real Chinese search bounded and passes its matched excerpt through the same turn', async () => {
  const root = new SourceTestDirectory('workspace');
  root.add(new SourceTestFile('long.md', '检索词' + '中文'.repeat(100000)));
  const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'folder', path: '.' }] });
  try {
    const search = await index.search({ query: '检索词' });
    const original = JSON.stringify(search);
    expect(new TextEncoder().encode(original).byteLength).toBeLessThan(nativeByteLimit);
    expect(search.hits[0].text).toContain('检索词');
    expect(search.hits[0].text.length).toBeLessThanOrEqual(600);
    expect(search.reads[0].readUnits).toEqual([]);
    const read = await index.read({ path: 'long.md', maxChars: 1000, maxUnits: 1 });
    const retry = { success: true, text: JSON.stringify(read) };
    const result = await executeToolResponses([{ success: true, text: original }, retry]);
    expect(result.received[0]).toMatchObject({ success: true, text: original });
    expect(result.received[1]).toMatchObject(retry);
    expect(result.session.status).toBe('completed');
    expect(result.text).toBe('已完成有限范围读取。');
  } finally { index.invalidate(); }
});

it('bounds oversized error responses without leaking a truncated source or claiming completeness', async () => {
  const result = await executeToolResponses([{ success: false, text: 'PRIVATE_TOOL_OUTPUT'.repeat(100000) }]);
  const diagnostic = JSON.parse(result.received[0].text);
  expect(result.received[0].success).toBe(false);
  expect(diagnostic).toMatchObject({ error: { code: 'tool_result_budget_exceeded', recoverable: true } });
  expect(diagnostic.complete).not.toBe(true);
  expect(result.received[0].text).not.toContain('PRIVATE_TOOL_OUTPUT');
  expect(result.session.status).toBe('completed');
});
