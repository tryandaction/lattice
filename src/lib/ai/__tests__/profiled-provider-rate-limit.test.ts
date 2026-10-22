import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProfiledProvider } from '../profiled-provider';
import { createDefaultAiProviderProfile } from '../provider-profiles';
import type { AiStreamChunk } from '../types';

const messages = [{ role: 'user' as const, content: 'Question' }];
const profile = (id: string) => ({ ...createDefaultAiProviderProfile('openai-chat', { id, model: 'model' }), maxRetries: 2 });
const success = () => new Response(JSON.stringify({ choices: [{ message: { content: 'Recovered' } }] }));
const collect = async (stream: AsyncIterable<AiStreamChunk>) => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks; };

describe('profiled provider rate-limit recovery', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T00:00:00Z')); vi.spyOn(Math, 'random').mockReturnValue(0); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it.each([
    ['anthropic-spend', { error: { type: 'rate_limit_error', details: { error_code: 'enforced_spend_limit_reached' } } }, 'enforced_spend_limit_reached'],
    ['openai-code', { error: { type: 'rate_limit_error', code: 'insufficient_quota' } }, 'insufficient_quota'],
    ['openai-type', { error: { type: 'insufficient_quota' } }, 'insufficient_quota'],
  ])('does not retry explicit %s quota failures or invent a retry time', async (id, body, providerCode) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(body), { status: 429 }));
    const pending = createProfiledProvider(profile('quota-' + id), 'secret').generate(messages).catch(error => error);
    await vi.advanceTimersByTimeAsync(10000);
    const error = await pending;
    expect(error).toMatchObject({ code: 'quota_exceeded', providerCode, recoverable: false, httpStatus: 429 });
    expect(error.retryAt).toBeUndefined();
    expect(error.message).not.toMatch(/retry after|saved checkpoint/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves the quota category in streaming and connection diagnostics', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ error: { details: { error_code: 'enforced_spend_limit_reached' } } }), { status: 429 }));
    const stream = collect(createProfiledProvider(profile('quota-stream'), 'secret').stream(messages));
    await vi.advanceTimersByTimeAsync(10000);
    const chunks = await stream;
    expect(chunks).toEqual([expect.objectContaining({ type: 'error', code: 'quota_exceeded' })]);
    expect(chunks[0].retryAt).toBeUndefined();
    const probe = createProfiledProvider(profile('quota-probe'), 'secret').testConnection();
    await vi.advanceTimersByTimeAsync(10000);
    await expect(probe).resolves.toMatchObject({ ok: false, code: 'quota_exceeded', httpStatus: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps ambiguous quota wording retryable instead of inferring a terminal code', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'quota limit exceeded', type: 'rate_limit_error' } }), { status: 429 })).mockImplementation(async () => success());
    const pending = createProfiledProvider(profile('ambiguous-quota'), 'secret').generate(messages);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toMatchObject({ text: 'Recovered' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bounds inspection when an unhinted error body never finishes', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 429 }));
    const pending = createProfiledProvider({ ...profile('unhinted-hung'), maxRetries: 0 }, 'secret').generate(messages).catch(error => error);
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toMatchObject({ code: 'rate_limited', recoverable: true });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels during inspection without scheduling a retry', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 429 }));
    const controller = new AbortController();
    const pending = createProfiledProvider(profile('cancel-inspection'), 'secret').generate(messages, { signal: controller.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(50);
    const reason = new DOMException('Cancelled', 'AbortError');
    controller.abort(reason);
    expect(await pending).toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['seconds', { 'retry-after': '2' }],
    ['HTTP date', { 'retry-after': 'Tue, 29 Sep 2026 00:00:02 GMT' }],
    ['duration reset', { 'x-ratelimit-reset-requests': '2s' }],
    ['epoch reset', { 'x-ratelimit-reset': '1790640002' }],
  ])('honors %s before resending generation', async (kind, headers) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('busy', { status: 429, headers })).mockImplementation(async () => success());
    const pending = createProfiledProvider(profile('header-' + kind), 'secret').generate(messages);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ text: 'Recovered' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses exponential backoff for absent or malformed reset hints', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('busy', { status: 429, headers: { 'retry-after': 'invalid' } }))
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockImplementation(async () => success());
    const pending = createProfiledProvider(profile('backoff'), 'secret').generate(messages);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1001);
    await expect(pending).resolves.toMatchObject({ text: 'Recovered' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shares the final 429 cooldown across instances of the same profile', async () => {
    const settings = { ...profile('shared-cooldown'), maxRetries: 0 };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('busy', { status: 429, headers: { 'retry-after': '2' } })).mockImplementation(async () => success());
    await expect(createProfiledProvider(settings, 'secret').generate(messages)).rejects.toMatchObject({ code: 'rate_limited', retryAt: Date.now() + 2000 });
    const pending = createProfiledProvider(settings, 'secret').generate(messages);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ text: 'Recovered' });
  });

  it('adds jitter and stops at the configured retry limit', async () => {
    vi.mocked(Math.random).mockReturnValue(0.5);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('busy', { status: 429 }));
    const pending = createProfiledProvider({ ...profile('retry-limit'), maxRetries: 1 }, 'secret').generate(messages).catch(error => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(125);
    expect(await pending).toMatchObject({ code: 'rate_limited', recoverable: true, retryAt: Date.now() + 2250 });
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps different profiles and models independent of an active cooldown', async () => {
    const settings = { ...profile('isolated-cooldown'), maxRetries: 0 };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('busy', { status: 429, headers: { 'retry-after': '30' } })).mockImplementation(async () => success());
    await expect(createProfiledProvider(settings, 'secret').generate(messages)).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(createProfiledProvider(settings, 'secret').generate(messages, { model: 'another-model' })).resolves.toMatchObject({ text: 'Recovered' });
    await expect(createProfiledProvider({ ...settings, id: 'another-profile' }, 'secret').generate(messages)).resolves.toMatchObject({ text: 'Recovered' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('preserves a terminal 429 even when its error body never finishes', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 429, headers: { 'retry-after': '2' } }));
    const pending = collect(createProfiledProvider({ ...profile('terminal-stream'), maxRetries: 0 }, 'secret').stream(messages));
    await vi.advanceTimersByTimeAsync(0);
    expect(await pending).toEqual([expect.objectContaining({ type: 'error', code: 'rate_limited', retryAt: Date.now() + 2000 })]);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('applies the cooldown to model discovery and connection diagnostics', async () => {
    const settings = { ...profile('catalog-cooldown'), maxRetries: 0 };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('busy', { status: 429, headers: { 'retry-after': '2' } })).mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'model' }] })));
    const provider = createProfiledProvider(settings, 'secret');
    await expect(provider.testConnection()).resolves.toMatchObject({ code: 'rate_limited', httpStatus: 429 });
    const pending = provider.getAvailableModels();
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual([expect.objectContaining({ id: 'model' })]);
  });

  it('cancels while waiting without issuing a retry', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('busy', { status: 429, headers: { 'retry-after': '30' } }));
    const controller = new AbortController();
    const reason = new DOMException('User cancelled', 'AbortError');
    const pending = createProfiledProvider(profile('cancel-cooldown'), 'secret').generate(messages, { signal: controller.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(500);
    controller.abort(reason);
    expect(await pending).toBe(reason);
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops waiting at the overall budget and preserves a recoverable rate-limit error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('busy', { status: 429, headers: { 'retry-after': '60' } }));
    const pending = createProfiledProvider({ ...profile('budget-cooldown'), maxRequestDurationMs: 1000 }, 'secret').generate(messages).catch(error => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ code: 'rate_limited', retryAt: Date.now() + 59000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits before reopening a stream after an HTTP 429', async () => {
    const payload = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Recovered' } }] }) + '\n\ndata: [DONE]\n\n';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('busy', { status: 429, headers: { 'retry-after': '2' } })).mockResolvedValueOnce(new Response(payload));
    const pending = collect(createProfiledProvider(profile('stream-cooldown'), 'secret').stream(messages));
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual([{ type: 'text', text: 'Recovered' }, { type: 'done' }]);
  });

  it('does not replay a stream after text has been delivered', async () => {
    const payload = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Partial' } }] }) + '\n\ndata: ' + JSON.stringify({ error: { message: 'rate limit exceeded' } }) + '\n\n';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(payload));
    const pending = collect(createProfiledProvider(profile('partial-stream'), 'secret').stream(messages));
    await vi.advanceTimersByTimeAsync(10000);
    const chunks = await pending;
    expect(chunks[0]).toMatchObject({ type: 'text', text: 'Partial' });
    expect(chunks.at(-1)).toMatchObject({ type: 'error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
