import type { AiGenerateOptions, AiGenerateResult, AiMessage, AiResponseDiagnostics, AiStreamChunk, AiUsage } from './types';
import { AiRequestTimeoutError } from './request-lifecycle';
import { t } from '@/lib/i18n';

export class IncompleteAnswerError extends Error {
  readonly name = 'IncompleteAnswerError';
  constructor(message: string, readonly partialText: string, readonly reason: 'output_limit' | 'no_progress' | 'provider', readonly responseDiagnostics: AiResponseDiagnostics[] = []) { super(message); }
}

export class InterruptedAnswerError extends Error {
  readonly name = 'AbortError';
  constructor(readonly partialText: string, readonly responseDiagnostics: AiResponseDiagnostics[] = []) { super('Answer generation was stopped; received draft text is retained.'); }
}

/** A failed refinement must not discard the answer that was already produced. */
export function retainAnswerOnFailure(error: unknown, previousText: string): Error {
  const partialText = error instanceof IncompleteAnswerError || error instanceof InterruptedAnswerError ? error.partialText : '';
  const retained = partialText.length > previousText.length ? partialText : previousText;
  const diagnostics = error instanceof IncompleteAnswerError || error instanceof InterruptedAnswerError ? error.responseDiagnostics : [];
  if (error instanceof Error && error.name === 'AbortError') return new InterruptedAnswerError(retained, diagnostics);
  return new IncompleteAnswerError(error instanceof Error ? error.message : String(error), retained, error instanceof IncompleteAnswerError ? error.reason : 'provider', diagnostics);
}

type TextGeneration = (messages: AiMessage[], options: AiGenerateOptions) => Promise<Pick<AiGenerateResult, 'text' | 'finishReason'> & Partial<AiGenerateResult>>;
interface AnswerExecutionInput {
  messages: AiMessage[];
  options: AiGenerateOptions;
  generate: TextGeneration;
  stream?: (messages: AiMessage[], options: AiGenerateOptions) => AsyncIterable<AiStreamChunk>;
  maxSegments?: number;
  onDelta?: (text: string) => void;
  onContinuation?: (completedSegments: number) => void;
}

function continuationDelta(previous: string, incoming: string): string {
  if (!previous) return incoming;
  if (incoming.trim() === previous.trim()) return '';
  // Some gateways repeat the last sentence. Only remove an exact, substantive
  // suffix/prefix overlap, never a short coincidental word or mathematical token.
  for (let size = Math.min(previous.length, incoming.length, 2400); size >= 32; size--) {
    if (previous.endsWith(incoming.slice(0, size))) return incoming.slice(size);
  }
  if (!previous.endsWith('\n') && /^#{1,6}\s/.test(incoming)) return '\n\n' + incoming;
  return incoming;
}

function continuationMessages(messages: AiMessage[], text: string): AiMessage[] {
  const headings = text.match(/^#{1,6}\s+.+$/gm)?.slice(-16).join('\n') ?? '';
  return [
    ...messages,
    ...(text ? [{ role: 'assistant' as const, content: text.slice(-24000) }] : []),
    { role: 'user', content: text
      ? 'Continue the unfinished answer exactly where it ends. Preserve any unfinished word, equation or code fence. Do not restart, repeat the introduction, or shorten the requested explanation. Complete the remaining requirements using the same source ids and original evidence. Include necessary leading whitespace. Do not invent missing source details. Already delivered headings:\n' + headings
      : 'The previous call did not produce visible answer text. Produce a useful, bounded first part of the requested answer now, starting with the problem and core mechanism; later calls can cover remaining detail. Keep source grounding and explicitly identify evidence gaps. Do not return an empty response.' },
  ];
}

/** A token-limited segment is progress, not successful task completion or a lost answer. */
export async function executeAnswer(input: AnswerExecutionInput): Promise<AiGenerateResult & { generationSegments: number }> {
  if (!Number.isFinite(input.options.deadlineAt)) return executeAnswerSegments(input);
  const controller = new AbortController();
  const parent = input.options.signal;
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const remaining = Math.max(0, input.options.deadlineAt! - Date.now());
  const timeout = () => controller.abort(new AiRequestTimeoutError('overall', remaining));
  const timer = setTimeout(timeout, remaining);
  if (!remaining) timeout();
  try {
    return await executeAnswerSegments({ ...input, options: { ...input.options, signal: controller.signal } });
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
  }
}

/** Also stops injected/legacy providers that do not reject their promise on abort. */
function untilAborted<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason ?? new DOMException('Stopped', 'AbortError')); };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

async function* interruptibleStream(stream: AsyncIterable<AiStreamChunk>, signal?: AbortSignal): AsyncIterable<AiStreamChunk> {
  const iterator = stream[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await untilAborted(iterator.next(), signal);
      if (next.done) return;
      yield next.value;
    }
  } finally {
    // A stalled legacy iterator may never settle return(); cleanup must not block stop.
    if (signal?.aborted) void iterator.return?.().catch(() => {});
    else if (iterator.return) await untilAborted(iterator.return(), signal);
  }
}

async function executeAnswerSegments(input: AnswerExecutionInput): Promise<AiGenerateResult & { generationSegments: number }> {
  const maxSegments = Math.max(1, Math.min(4, Math.floor(input.maxSegments ?? 3)));
  let text = '', model = input.options.model ?? '', emptySegments = 0;
  let usage: AiUsage | undefined;
  let tokenBudget = input.options.maxTokens;
  const configuredCeiling = Number.isFinite(input.options.recoveryMaxTokens) && input.options.recoveryMaxTokens! > 0 ? Math.floor(input.options.recoveryMaxTokens!) : undefined;
  const recoveryLimit = Math.min(configuredCeiling ?? 32768, 32768);
  if (tokenBudget !== undefined && configuredCeiling !== undefined) tokenBudget = Math.min(tokenBudget, configuredCeiling);
  const responseDiagnostics: AiResponseDiagnostics[] = [];
  let recoveredEmptyOutput = false;
  let recoverWithoutStreaming = false;
  let recoveringEmptyResponse = false;
  for (let segment = 0; segment < maxSegments; segment++) {
    if (input.options.signal?.aborted) {
      if (input.options.signal.reason instanceof AiRequestTimeoutError) throw new IncompleteAnswerError(input.options.signal.reason.message, text, 'provider', responseDiagnostics);
      throw new InterruptedAnswerError(text, responseDiagnostics);
    }
    if (segment) input.onContinuation?.(segment);
    const messages = segment ? continuationMessages(input.messages, text) : input.messages;
    let segmentDiagnostics: AiResponseDiagnostics | undefined;
    const reportDiagnostics = (diagnostics: AiResponseDiagnostics) => {
      if (segmentDiagnostics === diagnostics) return;
      segmentDiagnostics = diagnostics;
      responseDiagnostics.push(diagnostics);
      input.options.onResponseDiagnostics?.(diagnostics);
    };
    const options = { ...input.options, maxTokens: tokenBudget, onResponseDiagnostics: reportDiagnostics, temperature: recoveringEmptyResponse ? Math.max(input.options.temperature ?? 0.2, 0.2) : input.options.temperature, onProgress: input.options.onProgress && ((progress: Parameters<NonNullable<AiGenerateOptions['onProgress']>>[0]) => input.options.onProgress?.({ ...progress, phase: segment && progress.phase === 'waiting' ? 'continuing' : progress.phase })) };
    let segmentText = '', finishReason: AiGenerateResult['finishReason'];
    let segmentUsage: AiUsage | undefined;
    let ended = false, published = false;
    const publish = () => {
      if (published) return;
      published = true;
      const delta = continuationDelta(text, segmentText);
      text += delta;
      if (delta && !(input.stream && segment === 0)) input.onDelta?.(delta);
    };
    try {
      if (input.stream && !recoverWithoutStreaming) {
        for await (const chunk of interruptibleStream(input.stream(messages, options), input.options.signal)) {
          input.options.signal?.throwIfAborted();
          if (chunk.type === 'text' && chunk.text) {
            segmentText += chunk.text;
            if (segment === 0) input.onDelta?.(chunk.text);
          } else if (chunk.type === 'done') { ended = true; finishReason = 'stop'; break; }
          else if (chunk.type === 'error') {
            if (chunk.code === 'output_limit' || (!chunk.code && /(?:truncat|incomplete).*(?:token|output) limit|maximum output tokens/i.test(chunk.error ?? ''))) {
              ended = true; finishReason = 'length'; break;
            }
            throw new Error(chunk.error ?? 'The provider could not complete this answer.');
          }
        }
        if (!ended) throw new Error('The provider stream ended without a completion event.');
      } else {
        const result = await untilAborted(input.generate(messages, options), input.options.signal);
        input.options.signal?.throwIfAborted();
        segmentText = result.text ?? ''; finishReason = result.finishReason;
        model = result.model || model;
        segmentUsage = result.usage;
        if (result.responseDiagnostics) reportDiagnostics(result.responseDiagnostics);
      }
      segmentUsage ??= segmentDiagnostics?.usage;
      if (segmentUsage) usage = { promptTokens: (usage?.promptTokens ?? 0) + segmentUsage.promptTokens, completionTokens: (usage?.completionTokens ?? 0) + segmentUsage.completionTokens, totalTokens: (usage?.totalTokens ?? 0) + segmentUsage.totalTokens, ...(usage?.reasoningTokens === undefined && segmentUsage.reasoningTokens === undefined ? {} : { reasoningTokens: (usage?.reasoningTokens ?? 0) + (segmentUsage.reasoningTokens ?? 0) }) };
      input.options.signal?.throwIfAborted();
      const before = text;
      publish();
      const added = text.slice(before.length).trim();
      if (!added) emptySegments++;
      if (finishReason === 'refusal' || finishReason === 'tool_calls' || finishReason === 'unknown') throw new Error('The provider did not complete the requested text answer.');
      if (!added) {
        if ((finishReason === 'length' && tokenBudget !== undefined && tokenBudget >= recoveryLimit)
          || (segment > 0 && finishReason !== 'length') || emptySegments >= 2 || segment + 1 >= maxSegments) {
          throw new IncompleteAnswerError(text.trim()
            ? '模型未继续输出有效内容，已保留现有草稿；可继续剩余任务。'
            : finishReason === 'length' && tokenBudget !== undefined && tokenBudget >= recoveryLimit
              ? t('chat.outputCeilingNoText', { tokens: tokenBudget })
              : '模型未返回可见回答；请检查模型输出额度和推理设置后重试。', text, 'no_progress', responseDiagnostics);
        }
        // Recovery consumes the next ordinary segment and shares cancellation and usage.
        if (!recoveredEmptyOutput && tokenBudget && tokenBudget < recoveryLimit) {
          tokenBudget = finishReason === 'length'
            ? Math.min(recoveryLimit, Math.max(tokenBudget * 2, 8192))
            : Math.min(recoveryLimit, Math.max(tokenBudget, 4096));
          recoveredEmptyOutput = true;
        }
        recoveringEmptyResponse = true;
        recoverWithoutStreaming = Boolean(input.stream) && !text.trim();
        continue;
      } else {
        emptySegments = 0;
      }
      if (finishReason !== 'length') return { text, model, finishReason, ...(usage ? { usage } : {}), ...(segmentDiagnostics ? { responseDiagnostics: segmentDiagnostics } : {}), generationSegments: segment + 1 };
    } catch (error) {
      if (input.options.signal?.aborted) {
        // Only bytes received before cancellation are collected in segmentText.
        // Do not publish late deltas or turn a stopped message back into a run.
        const retained = published ? text : text + continuationDelta(text, segmentText);
        if (input.options.signal.reason instanceof AiRequestTimeoutError) throw new IncompleteAnswerError(input.options.signal.reason.message, retained, 'provider', responseDiagnostics);
        throw new InterruptedAnswerError(retained, responseDiagnostics);
      }
      publish();
      if (error instanceof IncompleteAnswerError) throw error;
      if (text || responseDiagnostics.length) throw new IncompleteAnswerError(error instanceof Error ? error.message : String(error), text, 'provider', responseDiagnostics);
      throw error;
    }
  }
  throw new IncompleteAnswerError('The answer reached the bounded continuation budget. The generated draft is retained; continue the remaining task.', text, 'output_limit', responseDiagnostics);
}
