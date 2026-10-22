import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeAnswer } from '../answer-execution';
import { parseProtocolResponse, parseProtocolStream } from '../protocol-adapters';
import { chatOutputBudget } from '../output-budget';
import { createProfiledProvider } from '../profiled-provider';
import { createDefaultAiProviderProfile } from '../provider-profiles';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

// Protocol-shaped fixtures; text is deliberately synthetic, never a live model trace.
const hidden = 'private fixture reasoning must never appear in diagnostics';
const anthropicEmpty = {
  type: 'message', role: 'assistant', model: 'fixture-model',
  content: [{ type: 'thinking', thinking: hidden, signature: 'private signature' }],
  stop_reason: 'max_tokens', usage: { input_tokens: 120, output_tokens: 1600 },
};

describe('provider output diagnostics and recovery boundaries', () => {
  it('preserves the structure and usage of an empty Anthropic answer without exposing reasoning', async () => {
    const result = await parseProtocolResponse('anthropic-messages', new Response(JSON.stringify(anthropicEmpty)), 'fixture-model');
    expect(result.text).toBe('');
    expect(result.responseDiagnostics).toEqual({
      protocol: 'anthropic-messages', mode: 'response', blockTypes: ['thinking'], visibleCharacters: 0,
      stopReason: 'max_tokens', finishReason: 'length', usage: { promptTokens: 120, completionTokens: 1600, totalTokens: 1720 },
    });
    expect(JSON.stringify(result.responseDiagnostics)).not.toMatch(/private|signature/);
  });

  it('keeps Responses input/output/reasoning token accounting', async () => {
    const result = await parseProtocolResponse('openai-responses', new Response(JSON.stringify({
      status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'reasoning', summary: [] }],
      usage: { input_tokens: 120, output_tokens: 1600, total_tokens: 1720, output_tokens_details: { reasoning_tokens: 1600 } },
    })), 'fixture-model');
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 1600, totalTokens: 1720, reasoningTokens: 1600 });
    expect(result.responseDiagnostics).toMatchObject({ blockTypes: ['reasoning'], visibleCharacters: 0, finishReason: 'length' });
  });

  it('captures Anthropic stream counts at the terminal event and omits hidden deltas', async () => {
    const events = [
      { type: 'message_start', message: { ...anthropicEmpty, content: [], stop_reason: null, usage: { input_tokens: 120, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: hidden } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 1600 } },
    ];
    const diagnostics = vi.fn();
    const chunks = [];
    for await (const chunk of parseProtocolStream('anthropic-messages', new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')), diagnostics)) chunks.push(chunk);
    expect(chunks).toEqual([{ type: 'error', code: 'output_limit', error: expect.any(String) }]);
    expect(diagnostics).toHaveBeenCalledTimes(1);
    expect(diagnostics.mock.calls[0][0]).toMatchObject({ mode: 'stream', blockTypes: ['thinking'], visibleCharacters: 0, stopReason: 'max_tokens', usage: { promptTokens: 120, completionTokens: 1600, totalTokens: 1720 } });
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain(hidden);
  });

  it('keeps both diagnostic snapshots when empty-output recovery also fails', async () => {
    const diagnostics = vi.fn();
    const generate = vi.fn(async () => parseProtocolResponse('anthropic-messages', new Response(JSON.stringify(anthropicEmpty)), 'fixture-model'));
    await expect(executeAnswer({ messages: [], options: { maxTokens: 1600, recoveryMaxTokens: 8192, onResponseDiagnostics: diagnostics }, generate }))
      .rejects.toMatchObject({ reason: 'no_progress', responseDiagnostics: [expect.objectContaining({ visibleCharacters: 0 }), expect.objectContaining({ visibleCharacters: 0 })] });
    expect(diagnostics).toHaveBeenCalledTimes(2);
  });

  it.each([{ requested: 1600, ceiling: 8192, recovered: 8192, finishReason: 'length' }, { requested: 512, ceiling: 512, recovered: 512, finishReason: 'stop' }])('respects an explicit recovery ceiling of $ceiling tokens', async ({ requested, ceiling, recovered, finishReason }) => {
    const generate = vi.fn().mockResolvedValueOnce({ text: '', finishReason }).mockResolvedValueOnce({ text: 'Visible final answer', finishReason: 'stop' });
    await executeAnswer({ messages: [], options: { maxTokens: requested, recoveryMaxTokens: ceiling }, generate });
    expect(generate.mock.calls[1][1].maxTokens).toBe(recovered);
  });

  it('retains diagnostics and stops when invisible output already exhausted the explicit ceiling', async () => {
    const generate = vi.fn(async () => parseProtocolResponse('anthropic-messages', new Response(JSON.stringify(anthropicEmpty)), 'fixture-model'));
    await expect(executeAnswer({ messages: [], options: { maxTokens: 512, recoveryMaxTokens: 512 }, generate }))
      .rejects.toMatchObject({ reason: 'no_progress', partialText: '', responseDiagnostics: [expect.objectContaining({ visibleCharacters: 0, finishReason: 'length' })] });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('never raises the configured ceiling for an explanatory chat request', () => {
    expect(chatOutputBudget(256, 'Explain this formula', true)).toBe(256);
  });

  it('records a profiled provider response once per segment, preserves accounting, and obeys both ceilings', async () => {
    const profile = createDefaultAiProviderProfile('custom-anthropic-messages', { model: 'fixture-model' });
    profile.models = [{ id: 'fixture-model', name: 'Fixture', enabled: true, contextWindow: 32000, maxOutputTokens: 6000 }];
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(anthropicEmpty)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...anthropicEmpty, content: [{ type: 'text', text: 'Grounded answer.' }], stop_reason: 'end_turn', usage: { input_tokens: 200, output_tokens: 12 } })));
    const onResponseDiagnostics = vi.fn();
    const result = await executeAnswer({ messages: [], options: { maxTokens: 1600, recoveryMaxTokens: 8192, onResponseDiagnostics }, generate: createProfiledProvider(profile, 'fixture-key').generate });
    expect(result.text).toBe('Grounded answer.');
    expect(result.usage).toEqual({ promptTokens: 320, completionTokens: 1612, totalTokens: 1932 });
    expect(onResponseDiagnostics).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).max_tokens)).toEqual([1600, 6000]);
  });

  it('keeps diagnostic labels from containing arbitrary provider content', async () => {
    const result = await parseProtocolResponse('anthropic-messages', new Response(JSON.stringify({
      ...anthropicEmpty, stop_reason: hidden, content: [{ type: hidden, text: hidden }],
    })), 'fixture-model');
    expect(result.responseDiagnostics).toMatchObject({ blockTypes: ['unknown'], stopReason: 'unknown', visibleCharacters: 0 });
    expect(JSON.stringify(result.responseDiagnostics)).not.toContain(hidden);
  });

  it('shares an explicit answer deadline across continuation and interrupts a pending provider', async () => {
    vi.useFakeTimers();
    const deadlineAt = Date.now() + 1000;
    const generate = vi.fn()
      .mockImplementationOnce(async () => { await new Promise(resolve => setTimeout(resolve, 700)); return { text: 'Saved first segment.', finishReason: 'length' }; })
      .mockImplementationOnce(async (_messages, options) => { expect(options.signal.aborted).toBe(false); return new Promise(() => {}); });
    const pending = executeAnswer({ messages: [], options: { maxTokens: 1600, deadlineAt }, generate }).catch(error => error);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toMatchObject({ name: 'IncompleteAnswerError', reason: 'provider', partialText: 'Saved first segment.', message: expect.stringMatching(/timed out/i) });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('interrupts a stalled stream at the answer deadline and retains received text', async () => {
    vi.useFakeTimers();
    const stream = async function* () { yield { type: 'text' as const, text: 'Visible draft.' }; await new Promise(() => {}); };
    const pending = executeAnswer({ messages: [], options: { deadlineAt: Date.now() + 1000 }, generate: vi.fn(), stream }).catch(error => error);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toMatchObject({ name: 'IncompleteAnswerError', partialText: 'Visible draft.', message: expect.stringMatching(/timed out/i) });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['deadline', 'user'] as const)('interrupts a stalled stream cleanup on %s without losing the received draft', async kind => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
    let cleanupStarted = false;
    const stream = async function* () {
      try { yield { type: 'text' as const, text: 'Visible draft.' }; yield { type: 'done' as const }; }
      finally { cleanupStarted = true; await cleanup; }
    };
    const onDelta = vi.fn();
    let settled: unknown;
    const pending = executeAnswer({ messages: [], options: { deadlineAt: Date.now() + 1000, signal: controller.signal },
      generate: vi.fn(), stream, onDelta }).catch(error => { settled = error; return error; });
    try {
      await vi.advanceTimersByTimeAsync(1);
      expect(cleanupStarted).toBe(true);
      if (kind === 'user') controller.abort();
      await vi.advanceTimersByTimeAsync(1000);
      expect(settled).toMatchObject({ name: kind === 'user' ? 'AbortError' : 'IncompleteAnswerError', partialText: 'Visible draft.',
        ...(kind === 'deadline' ? { reason: 'provider', message: expect.stringMatching(/timed out/i) } : {}) });
      expect(onDelta.mock.calls).toEqual([['Visible draft.']]);
      expect(vi.getTimerCount()).toBe(0);
    } finally { releaseCleanup(); await pending; }
  });

  it('receives final stream diagnostics before accepting a normally completed answer', async () => {
    const events = [
      { type: 'message_start', message: { content: [], usage: { input_tokens: 12, output_tokens: 0 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Visible answer.' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
      { type: 'message_stop' },
    ];
    const onResponseDiagnostics = vi.fn();
    const result = await executeAnswer({ messages: [], options: { deadlineAt: Date.now() + 1000, onResponseDiagnostics },
      generate: vi.fn(), stream: (_messages, options) => parseProtocolStream('anthropic-messages',
        new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')), options.onResponseDiagnostics),
    });
    expect(result.text).toBe('Visible answer.');
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 4, totalTokens: 16 });
    expect(result.responseDiagnostics).toMatchObject({ visibleCharacters: 15, stopReason: 'end_turn', finishReason: 'stop' });
    expect(onResponseDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('does not reduce the initial budget when no recovery ceiling was supplied', async () => {
    const generate = vi.fn().mockResolvedValue({ text: 'Answer.', finishReason: 'stop' });
    await executeAnswer({ messages: [], options: { maxTokens: 48000 }, generate });
    expect(generate.mock.calls[0][1].maxTokens).toBe(48000);
  });
});
