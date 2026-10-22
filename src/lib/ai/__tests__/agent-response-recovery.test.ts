import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAiProviderProfile } from '../provider-profiles';
import { createProfiledProvider } from '../profiled-provider';
import { parseProtocolResponse, parseProtocolStream } from '../protocol-adapters';
import { runDocumentResearch, type DocumentResearchCheckpoint } from '../document-research';
import type { AiMessage, AiProtocol } from '../types';
import type { AgentDocumentSource } from '../document-source';
import { executeAnswer } from '../answer-execution';
import { effectiveOutputTokenCeiling } from '../output-budget';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const finalResponse = () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Recovered answer' }], stop_reason: 'end_turn' }));
const profile = () => ({ ...createDefaultAiProviderProfile('custom-anthropic-messages', { baseUrl: 'https://gateway.example/v1', model: 'vendor-model' }), timeoutMs: 1000, maxRetries: 1 });

describe('Agent provider recovery', () => {
  it('sends only one native-compatible request when the configured model ceiling prevents useful empty-output recovery', async () => {
    const configured = { ...profile(), authMode:'none' as const, maxRetries:0 };
    configured.models[0].maxOutputTokens=8192;
    const provider=createProfiledProvider(configured,'');
    const transport=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(JSON.stringify({
      content:[{type:'thinking',thinking:'Private synthetic reasoning must not become a visible answer.'}],
      stop_reason:'max_tokens',usage:{input_tokens:57,output_tokens:8192},
    })));
    const ceiling=effectiveOutputTokenCeiling(128000,provider.getMaxOutputTokens?.('vendor-model'));
    await expect(executeAnswer({messages:[{role:'user',content:'Explain the synthetic pulse.'}],
      options:{model:'vendor-model',maxTokens:ceiling,recoveryMaxTokens:ceiling},generate:provider.generate.bind(provider)}))
      .rejects.toMatchObject({reason:'no_progress',partialText:''});
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body)).max_tokens).toBe(8192);
  });
  it('exposes the same per-model ceiling used by the wire adapter', () => {
    const configured = profile();
    configured.models[0].maxOutputTokens = 8192;
    const provider = createProfiledProvider(configured, 'test-key');
    expect(provider.getMaxOutputTokens?.('vendor-model')).toBe(8192);
    expect(provider.getMaxOutputTokens?.('unknown-model')).toBeUndefined();
  });
  it('retries a timed-out generation with a fresh deadline and live signal', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })))
      .mockResolvedValueOnce(finalResponse());
    const pending = createProfiledProvider(profile(), 'test-key').generate([{ role: 'user', content: 'Read' }]).catch(error => error);
    await vi.advanceTimersByTimeAsync(120200);
    expect(await pending).toMatchObject({ text: 'Recovered answer' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.signal?.aborted).toBe(false);
  });

  it('does not start or retry an already cancelled generation', async () => {
    const controller = new AbortController(); controller.abort();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(finalResponse());
    await expect(createProfiledProvider(profile(), 'test-key').generate([], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('turns native timeouts into actionable errors without exposing a request URL (Error=%s)', async (asError) => {
    const message = 'error sending request for url (https://gateway.example/v1/messages?token=secret): operation timed out';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(asError ? new Error(message) : message);
    const pending = createProfiledProvider({ ...profile(), maxRetries: 0 }, 'test-key').generate([]);
    await expect(pending).rejects.toBeInstanceOf(Error);
    await expect(pending).rejects.toThrow(/timeout|timed out/i);
    await expect(pending).rejects.not.toThrow(/https:|secret/);
  });

  it.each([
    { protocol: 'anthropic-messages', data: { content: [{ type: 'text', text: '{}' }], stop_reason: 'max_tokens' } },
    { protocol: 'openai-chat-completions', data: { choices: [{ message: { content: '{}' }, finish_reason: 'length' }] } },
    { protocol: 'openai-responses', data: { output_text: '{}', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } },
    { protocol: 'gemini-generate-content', data: { candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'MAX_TOKENS' }] } },
  ])('preserves truncation from $protocol', async ({ protocol, data }) => {
    const result = await parseProtocolResponse(protocol as AiProtocol, new Response(JSON.stringify(data)), 'test');
    expect(result.finishReason).toBe('length');
  });

  it('reads Responses output_text blocks while excluding reasoning blocks', async () => {
    const data = { output: [{ type: 'reasoning', content: [{ type: 'text', text: 'Internal reasoning' }] }, { type: 'message', content: [{ type: 'output_text', text: 'Final answer' }] }] };
    expect((await parseProtocolResponse('openai-responses', new Response(JSON.stringify(data)), 'test')).text).toBe('Final answer');
  });

  it('reads Gemini text parts while excluding thought parts', async () => {
    const data = { candidates: [{ content: { parts: [{ text: 'Internal reasoning', thought: true }, { text: 'Final answer' }] } }] };
    expect((await parseProtocolResponse('gemini-generate-content', new Response(JSON.stringify(data)), 'test')).text).toBe('Final answer');
  });

  it.each([
    { protocol: 'anthropic-messages', event: { type: 'message_delta', delta: { stop_reason: 'max_tokens' } } },
    { protocol: 'openai-chat-completions', event: { choices: [{ delta: {}, finish_reason: 'length' }] } },
    { protocol: 'openai-responses', event: { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } } },
    { protocol: 'gemini-generate-content', event: { candidates: [{ finishReason: 'MAX_TOKENS' }] } },
  ])('does not label a truncated $protocol stream as complete', async ({ protocol, event }) => {
    const events = [];
    for await (const chunk of parseProtocolStream(protocol as AiProtocol, new Response('data: ' + JSON.stringify(event) + String.fromCharCode(10, 10)))) events.push(chunk);
    expect(events).toEqual([{ type: 'error', code: 'output_limit', error: expect.stringMatching(/truncat|token/i) }]);
  });
});

function documentSource(): AgentDocumentSource {
  return { path: 'paper.pdf', version: 'v1', kind: 'pdf', unitLabel: 'page', totalUnits: 1,
    readUnit: async () => ({ status: 'text', text: 'The pulse is robust against amplitude errors.' }), close: async () => {} };
}
function batchReply(messages: AiMessage[]) {
  const { units } = JSON.parse(String(messages.at(-1)!.content));
  return JSON.stringify({ summary: 'The pulse suppresses amplitude errors.', findings: [{ sourceId: units[0].id, quote: 'The pulse is robust against amplitude errors.', reason: 'Directly relevant to robustness.', importance: 3 }] });
}
describe('Agent document batch recovery', () => {
  it('accepts a single fenced JSON result with surrounding prose, keeping evidence validation', async () => {
    const fence = String.fromCharCode(96).repeat(3);
    const generate = vi.fn(async (messages: AiMessage[]) => ({ text: ['Result:', fence + 'json', batchReply(messages), fence, 'End.'].join(String.fromCharCode(10)) }));
    const result = await runDocumentResearch({ sources: [{ source: documentSource() }], task: 'read', query: 'robustness', generate });
    expect(result.complete).toBe(true); expect(result.findings[0].quote).toBe('The pulse is robust against amplitude errors.');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('repairs truncated output without recording it as completed coverage', async () => {
    const checkpoints: DocumentResearchCheckpoint[] = [];
    const generate = vi.fn(async (messages: AiMessage[]) => ({ text: batchReply(messages), finishReason: 'stop' as 'stop' | 'length' }))
      .mockImplementationOnce(async (messages: AiMessage[]) => ({ text: batchReply(messages), finishReason: 'length' as const }));
    const result = await runDocumentResearch({ sources: [{ source: documentSource() }], task: 'read', query: 'robustness', generate, onCheckpoint: checkpoint => { checkpoints.push(checkpoint); } });
    expect(result.complete).toBe(true); expect(generate).toHaveBeenCalledTimes(2);
    expect(String(generate.mock.calls[1][0].at(-1)!.content)).toMatch(/truncat|token/i);
    expect(checkpoints.filter(c => c.completedBatches > 0)).toHaveLength(1);
  });

  it('reports repeated invalid output at the call limit instead of a successful zero-progress pause', async () => {
    const checkpoints: DocumentResearchCheckpoint[] = [];
    await expect(runDocumentResearch({ sources: [{ source: documentSource() }], task: 'read', query: 'robustness', generate: async () => ({ text: 'not JSON' }), maxCalls: 2, onCheckpoint: checkpoint => { checkpoints.push(checkpoint); } })).rejects.toThrow(/validation failed after repair/i);
    expect(checkpoints.at(-1)?.coverage[0].readUnits).toEqual([]);
  });
});
