import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProfiledProvider } from '../profiled-provider';
import { createDefaultAiProviderProfile } from '../provider-profiles';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const profile = () => ({ ...createDefaultAiProviderProfile('custom-anthropic-messages', { baseUrl: 'https://gateway.example/v1', model: 'research-model' }), timeoutMs: 30000, maxRetries: 0 });
const event = (value: unknown) => new TextEncoder().encode('data: ' + JSON.stringify(value) + String.fromCharCode(10, 10));

describe('long generation lifecycle', () => {
  it('keeps a stream alive beyond 30 seconds while response data continues arriving', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      let timer: ReturnType<typeof setInterval>;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          let chunks = 0;
          const abort = () => { clearInterval(timer); controller.error(init?.signal?.reason); };
          init?.signal?.addEventListener('abort', abort, { once: true });
          timer = setInterval(() => {
            chunks++;
            if (chunks <= 6) controller.enqueue(event({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'part' + chunks } }));
            else { clearInterval(timer); init?.signal?.removeEventListener('abort', abort); controller.enqueue(event({ type: 'message_stop' })); controller.close(); }
          }, 10000);
        },
        cancel() { clearInterval(timer); },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    });
    const pending = (async () => { const chunks = []; for await (const chunk of createProfiledProvider(profile(), 'test').stream([{ role: 'user', content: 'Explain this paper in detail' }])) chunks.push(chunk); return chunks; })();
    await vi.advanceTimersByTimeAsync(71000);
    const chunks = await pending;
    expect(chunks.filter(chunk => chunk.type === 'error')).toEqual([]);
    expect(chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.text).join('')).toBe('part1part2part3part4part5part6');
    expect(chunks.at(-1)?.type).toBe('done');
  });

  it('allows a slow first response without confusing it with a stalled connection', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: 'Detailed verified answer' }], stop_reason: 'end_turn' }))), 45000);
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal?.reason); }, { once: true });
    }));
    const pending = createProfiledProvider(profile(), 'test').generate([{ role: 'user', content: 'Detailed reasoning' }]).catch(error => error);
    await vi.advanceTimersByTimeAsync(46000);
    expect(await pending).toMatchObject({ text: 'Detailed verified answer' });
  });
});
