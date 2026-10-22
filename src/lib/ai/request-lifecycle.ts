export interface AiRequestTimeouts {
  firstResponseMs: number;
  idleMs: number;
  totalMs: number;
}

export interface AiRequestProgress {
  phase: 'preparing' | 'waiting' | 'receiving' | 'responding' | 'retrying' | 'continuing' | 'validating';
  startedAt: number;
  lastActivityAt: number;
  attempt: number;
}

export class AiRequestTimeoutError extends Error {
  readonly name = 'AiRequestTimeoutError';
  constructor(readonly phase: 'first-response' | 'idle' | 'overall', readonly durationMs: number) {
    super('AI request ' + phase + ' timed out after ' + Math.ceil(durationMs / 1000) + ' seconds.');
  }
}

function bounded(value: number, fallback: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(1000, value)) : fallback;
}

/** The profile timeout controls silence, never the entire length of a live answer. */
export function generationTimeouts(profileTimeout: number, streaming: boolean, overrides?: { firstResponseMs?: number; totalMs?: number }): AiRequestTimeouts {
  const idleMs = bounded(profileTimeout, 30000, 300000);
  const totalMs = bounded(overrides?.totalMs ?? 600000, 600000, 1800000);
  const firstResponseMs = Math.min(totalMs, bounded(overrides?.firstResponseMs ?? 120000, 120000, 300000));
  return { firstResponseMs, idleMs: streaming ? idleMs : Math.max(idleMs, firstResponseMs), totalMs };
}

export function requestProgressReporter(onProgress: ((value: AiRequestProgress) => void) | undefined, startedAt: number, attempt: number) {
  let responding = false;
  let phase: AiRequestProgress['phase'] | undefined;
  let lastSent = -Infinity;
  const report = (next: AiRequestProgress['phase']) => {
    const now = Date.now();
    if (phase === next && now - lastSent < 1000) return;
    phase = next; lastSent = now;
    onProgress?.({ phase: next, startedAt, lastActivityAt: now, attempt });
  };
  return { report, activity: () => report(responding ? 'responding' : 'receiving'), text: () => { responding = true; report('responding'); } };
}

export function createRequestLifecycle(
  timeouts: AiRequestTimeouts,
  parent?: AbortSignal | null,
  onActivity?: () => void,
) {
  const controller = new AbortController();
  let disposed = false;
  const fail = (phase: AiRequestTimeoutError['phase'], durationMs: number) => {
    if (!disposed && !controller.signal.aborted) controller.abort(new AiRequestTimeoutError(phase, durationMs));
  };
  let silenceTimer = setTimeout(() => fail('first-response', timeouts.firstResponseMs), timeouts.firstResponseMs);
  const totalTimer = setTimeout(() => fail('overall', timeouts.totalMs), timeouts.totalMs);
  const abort = () => controller.abort(parent?.reason ?? new DOMException('Request aborted', 'AbortError'));
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(silenceTimer); clearTimeout(totalTimer);
    parent?.removeEventListener('abort', abort);
  };
  const activity = () => {
    if (disposed || controller.signal.aborted) return;
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => fail('idle', timeouts.idleMs), timeouts.idleMs);
    onActivity?.();
  };
  const track = (response: Response): Response => {
    if (!response.body) { dispose(); return response; }
    const reader = response.body.getReader();
    let ended = false;
    let abortRead = () => {};
    const cleanup = () => { ended = true; controller.signal.removeEventListener('abort', abortRead); dispose(); };
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        abortRead = () => {
          if (ended) return;
          cleanup();
          stream.error(controller.signal.reason);
          void reader.cancel(controller.signal.reason).catch(() => {});
        };
        if (controller.signal.aborted) abortRead();
        else controller.signal.addEventListener('abort', abortRead, { once: true });
      },
      async pull(stream) {
        try {
          const next = await reader.read();
          if (ended) return;
          if (next.done) { cleanup(); stream.close(); reader.releaseLock(); }
          else { if (next.value.byteLength) activity(); stream.enqueue(next.value); }
        } catch (error) {
          if (!ended) { cleanup(); stream.error(error); }
        }
      },
      cancel(reason) { cleanup(); void reader.cancel(reason).catch(() => {}); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  return { signal: controller.signal, activity, dispose, track };
}
