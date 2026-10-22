import type { AiGenerateResult, AiProtocol, AiResponseDiagnostics, AiUsage } from './types';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}
const BLOCK_TYPES = new Set(['text', 'output_text', 'message', 'thinking', 'redacted_thinking', 'reasoning', 'refusal', 'tool_use', 'server_tool_use', 'tool_result', 'function_call', 'image', 'audio']);
const STOP_REASONS = new Set(['max_tokens', 'length', 'max_output_tokens', 'MAX_TOKENS', 'refusal', 'content_filter', 'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'tool_use', 'tool_calls', 'function_call', 'end_turn', 'stop_sequence', 'stop', 'completed', 'STOP', 'pause_turn', 'model_context_window_exceeded', 'incomplete', 'failed', 'error']);

export function responseDiagnosticMetadata(diagnostics?: AiResponseDiagnostics): Record<string, string | number | boolean | null> {
  if (!diagnostics) return {};
  return { responseProtocol: diagnostics.protocol, responseMode: diagnostics.mode,
    responseBlockTypes: diagnostics.blockTypes.join(',').slice(0, 240), responseVisibleCharacters: diagnostics.visibleCharacters,
    responseStopReason: diagnostics.stopReason ?? null, responseFinishReason: diagnostics.finishReason ?? null,
    responsePromptTokens: diagnostics.usage?.promptTokens ?? null, responseCompletionTokens: diagnostics.usage?.completionTokens ?? null,
    responseReasoningTokens: diagnostics.usage?.reasoningTokens ?? null, responseTotalTokens: diagnostics.usage?.totalTokens ?? null };
}

export function protocolStopReason(protocol: AiProtocol, data: Record<string, unknown>): unknown {
  const first = Array.isArray(data.choices) ? record(data.choices[0]) : {};
  const candidate = Array.isArray(data.candidates) ? record(data.candidates[0]) : {};
  return protocol === 'anthropic-messages' ? data.stop_reason
    : protocol === 'openai-chat-completions' ? first.finish_reason
    : protocol === 'openai-responses' ? record(data.incomplete_details).reason ?? data.status
    : protocol === 'gemini-generate-content' ? candidate.finishReason : data.done_reason;
}

/** Retains only enumerated labels and numerical counts while consuming each payload. */
export function createOutputDiagnostics(protocol: AiProtocol, mode: AiResponseDiagnostics['mode']) {
  const blocks = new Set<string>();
  let visibleCharacters = 0, stopReason: string | undefined;
  let promptTokens: number | undefined, completionTokens: number | undefined, totalTokens: number | undefined, reasoningTokens: number | undefined;
  const addBlock = (type: unknown) => { if (typeof type === 'string') blocks.add(BLOCK_TYPES.has(type) ? type : 'unknown'); };
  const addParts = (value: unknown, gemini = false) => {
    if (typeof value === 'string') { if (value) addBlock('text'); return; }
    if (!Array.isArray(value)) return;
    for (const item of value) {
      const part = record(item);
      addBlock(gemini ? part.thought === true ? 'thinking' : typeof part.text === 'string' ? 'text' : 'unknown' : part.type);
    }
  };
  const observe = (event: Record<string, unknown>, characters = 0) => {
    visibleCharacters += characters;
    const data = protocol === 'anthropic-messages' && event.type === 'message_start' ? record(event.message)
      : protocol === 'openai-responses' && event.response ? record(event.response) : event;
    if (protocol === 'anthropic-messages') {
      addParts(data.content);
      if (event.type === 'content_block_start') addBlock(record(event.content_block).type);
      if (event.type === 'content_block_delta') {
        const type = record(event.delta).type;
        if (type === 'text_delta') addBlock('text');
        if (type === 'thinking_delta' || type === 'signature_delta') addBlock('thinking');
      }
    } else if (protocol === 'openai-responses') {
      if (typeof data.output_text === 'string' && data.output_text) addBlock('output_text');
      for (const item of Array.isArray(data.output) ? data.output : []) {
        const output = record(item); addBlock(output.type); addParts(output.content);
      }
      if (event.item) { const item = record(event.item); addBlock(item.type); addParts(item.content); }
      if (event.type === 'response.output_text.delta') addBlock('output_text');
      if (event.type === 'response.reasoning_summary_text.delta' || event.type === 'response.reasoning_text.delta') addBlock('reasoning');
    } else if (protocol === 'openai-chat-completions') {
      const first = Array.isArray(data.choices) ? record(data.choices[0]) : {};
      const message = record(first.message ?? first.delta);
      addParts(message.content);
      if (typeof message.reasoning_content === 'string' || typeof message.reasoning === 'string') addBlock('reasoning');
      if (message.tool_calls) addBlock('function_call');
      if (message.refusal) addBlock('refusal');
    } else if (protocol === 'gemini-generate-content') {
      const first = Array.isArray(data.candidates) ? record(data.candidates[0]) : {};
      addParts(record(first.content).parts, true);
    } else {
      addParts(record(data.message).content);
      if (typeof record(data.message).thinking === 'string') addBlock('thinking');
    }
    const rawStop = protocolStopReason(protocol, protocol === 'anthropic-messages' && event.type === 'message_delta' ? record(event.delta) : data);
    if (rawStop !== undefined && rawStop !== null) stopReason = typeof rawStop === 'string' && STOP_REASONS.has(rawStop) ? rawStop : 'unknown';
    const usage = record(data.usage), geminiUsage = record(data.usageMetadata);
    const input = protocol === 'anthropic-messages' || protocol === 'openai-responses' ? usage.input_tokens : protocol === 'gemini-generate-content' ? geminiUsage.promptTokenCount : protocol === 'ollama-native' ? data.prompt_eval_count : usage.prompt_tokens;
    const output = protocol === 'anthropic-messages' || protocol === 'openai-responses' ? usage.output_tokens : protocol === 'gemini-generate-content' ? geminiUsage.candidatesTokenCount : protocol === 'ollama-native' ? data.eval_count : usage.completion_tokens;
    promptTokens = tokenCount(input) ?? promptTokens;
    completionTokens = tokenCount(output) ?? completionTokens;
    totalTokens = tokenCount(protocol === 'gemini-generate-content' ? geminiUsage.totalTokenCount : usage.total_tokens) ?? totalTokens;
    reasoningTokens = tokenCount(protocol === 'gemini-generate-content' ? geminiUsage.thoughtsTokenCount : record(protocol === 'openai-responses' ? usage.output_tokens_details : usage.completion_tokens_details).reasoning_tokens) ?? reasoningTokens;
  };
  const snapshot = (finishReason?: AiGenerateResult['finishReason']): AiResponseDiagnostics => {
    const usage: AiUsage | undefined = promptTokens !== undefined || completionTokens !== undefined || totalTokens !== undefined
      ? { promptTokens: promptTokens ?? 0, completionTokens: completionTokens ?? 0, totalTokens: totalTokens ?? (promptTokens ?? 0) + (completionTokens ?? 0), ...(reasoningTokens === undefined ? {} : { reasoningTokens }) } : undefined;
    return { protocol, mode, blockTypes: [...blocks], visibleCharacters, ...(stopReason ? { stopReason } : {}), ...(finishReason ? { finishReason } : {}), ...(usage ? { usage } : {}) };
  };
  return { observe, snapshot };
}
