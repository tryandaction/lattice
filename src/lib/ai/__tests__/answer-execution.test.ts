import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/lib/i18n';
import { executeAnswer } from '../answer-execution';
import type { AiMessage, AiStreamChunk } from '../types';

const messages: AiMessage[] = [{ role: 'user', content: 'Explain the measured result using source A.' }];
const reply = (text: string, finishReason: 'stop' | 'length' = 'stop') => ({ text, finishReason, model: 'test-model' });
afterEach(() => setLocale('zh-CN'));

describe('bounded answer delivery', () => {
  it('renders the configured-ceiling failure in English when English is selected', async () => {
    setLocale('en-US');
    const failure=await executeAnswer({messages,options:{maxTokens:8192,recoveryMaxTokens:8192},
      generate:vi.fn().mockResolvedValue(reply('','length'))}).catch(error=>error);
    expect(failure.message).toMatch(/8192.*tokens/u);
    expect(failure.message).toMatch(/output limit|output ceiling/iu);
    expect(failure.message).not.toMatch(/\p{Script=Han}/u);
  });
  it('explains the configured output ceiling when thinking consumes it without visible text', async () => {
    const generate = vi.fn().mockResolvedValue({ ...reply('', 'length'), responseDiagnostics: {
      protocol:'anthropic-messages',mode:'response',blockTypes:['thinking'],visibleCharacters:0,stopReason:'max_tokens',
    } });
    const failure = await executeAnswer({messages,options:{maxTokens:8192,recoveryMaxTokens:8192},generate}).catch(error=>error);
    expect(failure.message).toContain('8192');
    expect(failure.message).toContain('上限');
    expect(failure.message).toContain('推理');
    expect(failure.partialText).toBe('');
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('does not repeat an invisible length response when the configured recovery ceiling cannot grow', async () => {
    const generate = vi.fn().mockResolvedValue(reply('', 'length'));
    await expect(executeAnswer({ messages, options: { maxTokens: 4096, recoveryMaxTokens: 4096 }, generate })).rejects.toMatchObject({ reason: 'no_progress', partialText: '' });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('recovers an empty first length response within the total call budget', async () => {
    const generate = vi.fn().mockResolvedValueOnce(reply('', 'length')).mockResolvedValueOnce(reply('Useful answer.'));
    const result = await executeAnswer({ messages, options: { maxTokens: 4096 }, generate });
    expect(result.text).toBe('Useful answer.');
    expect(generate.mock.calls[1][1].maxTokens).toBe(8192);
    expect(result.generationSegments).toBe(2);
  });

  it('rejects an empty successful response instead of reporting completion', async () => {
    await expect(executeAnswer({ messages, options: {}, generate: vi.fn().mockResolvedValue(reply('')) }))
      .rejects.toMatchObject({ reason: 'no_progress', partialText: '' });
  });

  it('never exceeds the total call budget while recovering', async () => {
    const generate = vi.fn().mockResolvedValue(reply('', 'length'));
    await expect(executeAnswer({ messages, options: { maxTokens: 4096 }, maxSegments: 2, generate }))
      .rejects.toMatchObject({ reason: 'no_progress' });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('does not publish a recovery result delivered after cancellation', async () => {
    const controller = new AbortController();
    const generate = vi.fn().mockResolvedValueOnce(reply('', 'length')).mockImplementationOnce(async () => {
      controller.abort(); return reply('Late bytes');
    });
    const onDelta = vi.fn();
    await expect(executeAnswer({ messages, options: { maxTokens: 4096, signal: controller.signal }, generate, onDelta }))
      .rejects.toMatchObject({ name: 'AbortError', partialText: '' });
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('rejects a refusal during recovery and accounts for both calls on success', async () => {
    const failed = vi.fn().mockResolvedValueOnce(reply('', 'length')).mockResolvedValueOnce({ text: '', finishReason: 'refusal' });
    await expect(executeAnswer({ messages, options: { maxTokens: 4096 }, generate: failed })).rejects.toThrow();
    const usage = { promptTokens: 2, completionTokens: 3, totalTokens: 5 };
    const generate = vi.fn().mockResolvedValueOnce({ ...reply('', 'length'), usage }).mockResolvedValueOnce({ ...reply('Answer'), usage });
    expect((await executeAnswer({ messages, options: { maxTokens: 4096 }, generate })).usage?.totalTokens).toBe(10);
  });
  it('keeps original evidence and unfinished mathematical/code text through continuation', async () => {
    const generate = vi.fn().mockResolvedValueOnce(reply('## Calculation\n```python\nvalue = ', 'length'))
      .mockResolvedValueOnce(reply('2 + 3\n```\nThe result is 5.'));
    const deltas: string[] = [];
    const result = await executeAnswer({ messages, options: {}, generate, onDelta: delta => deltas.push(delta) });
    expect(result.text).toContain('value = 2 + 3');
    expect(result.generationSegments).toBe(2);
    expect(deltas.join('')).toBe(result.text);
    expect(generate.mock.calls[1][0][0]).toEqual(messages[0]);
    expect(generate.mock.calls[1][0].at(-2)).toEqual({ role: 'assistant', content: '## Calculation\n```python\nvalue = ' });
  });

  it('deduplicates only a substantial exact suffix when a gateway repeats it', async () => {
    const suffix = 'This complete sentence is a repeated boundary between segments.';
    const generate = vi.fn().mockResolvedValueOnce(reply('First section. ' + suffix, 'length'))
      .mockResolvedValueOnce(reply(suffix + '\nSecond section.'));
    const result = await executeAnswer({ messages, options: {}, generate });
    expect(result.text).toBe('First section. ' + suffix + '\nSecond section.');
  });

  it('retains a failed continuation draft and does not silently retry a provider error', async () => {
    const generate = vi.fn().mockResolvedValueOnce(reply('Verified prefix. ', 'length')).mockRejectedValueOnce(new Error('Provider offline'));
    await expect(executeAnswer({ messages, options: {}, generate })).rejects.toMatchObject({ name: 'IncompleteAnswerError', partialText: 'Verified prefix. ', reason: 'provider' });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('stops at the segment budget and exposes every retained segment', async () => {
    const generate = vi.fn().mockResolvedValueOnce(reply('Part one. ', 'length')).mockResolvedValueOnce(reply('Part two. ', 'length'));
    await expect(executeAnswer({ messages, options: {}, generate, maxSegments: 2 })).rejects.toMatchObject({ partialText: 'Part one. Part two. ', reason: 'output_limit' });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('rejects a repeated complete answer as no progress instead of declaring success', async () => {
    const generate = vi.fn().mockResolvedValueOnce(reply('Repeated unfinished answer.', 'length')).mockResolvedValueOnce(reply('Repeated unfinished answer.'));
    await expect(executeAnswer({ messages, options: {}, generate })).rejects.toMatchObject({ partialText: 'Repeated unfinished answer.', reason: 'no_progress' });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('recovers from one invisible reasoning-only continuation with a larger visible budget', async () => {
    const generate = vi.fn().mockResolvedValueOnce(reply('Visible prefix.', 'length'))
      .mockResolvedValueOnce(reply('', 'length'))
      .mockResolvedValueOnce(reply('Remaining answer.', 'stop'));
    const result = await executeAnswer({ messages, options: { maxTokens: 4096 }, generate });
    expect(result.text).toBe('Visible prefix.Remaining answer.');
    expect(generate.mock.calls[2][1].maxTokens).toBe(8192);
  });

  it('cancels before a second provider call even after first-call output', async () => {
    const controller = new AbortController();
    const generate = vi.fn().mockResolvedValue(reply('First part', 'length'));
    await expect(executeAnswer({ messages, options: { signal: controller.signal }, generate, onDelta: () => controller.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('never upgrades an EOF without completion into successful output or auto-continuation', async () => {
    const generate = vi.fn();
    const stream = vi.fn(async function* (): AsyncIterable<AiStreamChunk> { yield { type: 'text', text: 'Visible partial answer' }; });
    const deltas: string[] = [];
    await expect(executeAnswer({ messages, options: {}, generate, stream, onDelta: delta => deltas.push(delta) })).rejects.toMatchObject({ partialText: 'Visible partial answer', reason: 'provider' });
    expect(deltas).toEqual(['Visible partial answer']);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it('keeps stream continuation overlap out of the visible answer', async () => {
    const repeated = 'A meaningful sentence that should appear only once in the final answer.';
    let count = 0;
    const stream = async function* (): AsyncIterable<AiStreamChunk> {
      count++;
      if (count === 1) { yield { type: 'text', text: repeated }; yield { type: 'error', code: 'output_limit', error: 'length limit' }; }
      else { yield { type: 'text', text: repeated }; yield { type: 'text', text: '\nNew findings.' }; yield { type: 'done' }; }
    };
    const deltas: string[] = [];
    const result = await executeAnswer({ messages, options: {}, generate: vi.fn(), stream, onDelta: delta => deltas.push(delta) });
    expect(result.text).toBe(repeated + '\nNew findings.');
    expect(deltas.join('')).toBe(result.text);
  });
  it('returns already received continuation bytes on cancellation without publishing late deltas', async () => {
    const controller = new AbortController();
    let count = 0;
    const stream = async function* (): AsyncIterable<AiStreamChunk> {
      if (++count === 1) { yield { type: 'text', text: 'First segment. ' }; yield { type: 'error', code: 'output_limit', error: 'limit' }; }
      else { yield { type: 'text', text: 'Received second segment.' }; controller.abort(); throw new DOMException('Stopped', 'AbortError'); }
    };
    const deltas: string[] = [];
    await expect(executeAnswer({ messages, options: { signal: controller.signal }, generate: vi.fn(), stream, onDelta: delta => deltas.push(delta) })).rejects.toMatchObject({ name: 'AbortError', partialText: 'First segment. Received second segment.' });
    expect(deltas).toEqual(['First segment. ']);
    expect(count).toBe(2);
  });
});
