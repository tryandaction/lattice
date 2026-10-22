// Cooldowns are shared by provider instances, but never persist credentials.
const cooldowns = new Map<string, number>();

export class AiRateLimitError extends Error {
  readonly name = 'AiRateLimitError';
  readonly code = 'rate_limited';
  readonly recoverable = true;

  constructor(profileName: string, readonly retryAt: number) {
    super(`${profileName}: The provider rate-limited the request (429). Retry after ${Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))} seconds; the task can continue from its saved checkpoint.`);
  }
}

type QuotaProviderCode = 'enforced_spend_limit_reached' | 'insufficient_quota';

export class AiQuotaExceededError extends Error {
  readonly name = 'AiQuotaExceededError';
  readonly code = 'quota_exceeded';
  readonly httpStatus = 429;
  readonly recoverable = false;

  constructor(profileName: string, readonly providerCode: QuotaProviderCode) {
    super(`${profileName}: The provider quota or spending limit is exhausted (429). Check the provider's billing or usage limits before continuing.`);
  }
}

/** Inspect only a small, promptly completed error body; never await a stalled close. */
async function readQuotaCode(response: Response, options: { signal?: AbortSignal | null; deadline?: number }): Promise<QuotaProviderCode | undefined> {
  const budget = Math.min(250, (options.deadline ?? Infinity) - Date.now());
  if (!response.body) return undefined;
  if (options.signal?.aborted || budget <= 0) {
    void response.body.cancel().catch(() => {});
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Request aborted', 'AbortError');
    return undefined;
  }
  const reader = response.body.getReader();
  const payload = await new Promise<string | undefined>((resolve, reject) => {
    let settled = false;
    const finish = (text?: string, aborted = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
      if (aborted) reject(options.signal?.reason ?? new DOMException('Request aborted', 'AbortError'));
      else resolve(text);
    };
    const abort = () => finish(undefined, true);
    const timer = setTimeout(() => finish(), budget);
    options.signal?.addEventListener('abort', abort, { once: true });
    const consume = async () => {
      const decoder = new TextDecoder();
      let bytes = 0, text = '';
      while (!settled) {
        const chunk = await reader.read();
        if (settled) return;
        if (chunk.done) { finish(text + decoder.decode()); return; }
        bytes += chunk.value.byteLength;
        if (bytes > 16 * 1024) { finish(); return; }
        text += decoder.decode(chunk.value, { stream: true });
      }
    };
    void consume().catch(() => finish());
  });
  if (!payload) return undefined;
  try {
    const value = JSON.parse(payload) as { error?: { code?: unknown; type?: unknown; details?: { error_code?: unknown } } } | null;
    // Provider documentation defines these structured fields. Message prose is not evidence.
    // https://platform.claude.com/docs/en/api/rate-limits#reaching-your-spend-cap
    if (value?.error?.details?.error_code === 'enforced_spend_limit_reached') return 'enforced_spend_limit_reached';
    // https://developers.openai.com/api/docs/guides/error-codes
    if (value?.error?.code === 'insufficient_quota' || value?.error?.type === 'insufficient_quota') return 'insufficient_quota';
  } catch { /* A malformed or oversized body does not identify a permanent quota error. */ }
  return undefined;
}

function durationMs(value: string): number | undefined {
  if (!/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(value)) return undefined;
  const units: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000 };
  let duration = 0;
  for (const part of value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) duration += Number(part[1]) * units[part[2]];
  return duration;
}

function retryAfterMs(headers: Headers, now: number): number | undefined {
  const retryAfter = headers.get('retry-after')?.trim();
  if (retryAfter) {
    const delay = /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now;
    if (Number.isFinite(delay) && delay >= 0) return delay;
  }
  const delays: number[] = [];
  for (const name of ['x-ratelimit-reset', 'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens', 'ratelimit-reset', 'anthropic-ratelimit-requests-reset', 'anthropic-ratelimit-tokens-reset']) {
    const value = headers.get(name)?.trim();
    if (!value) continue;
    let delay = durationMs(value);
    if (delay === undefined) {
      if (/^\d+(?:\.\d+)?$/.test(value)) {
        const number = Number(value);
        // Standard RateLimit-Reset is a delta; gateways also use epoch seconds or milliseconds.
        delay = number >= 1e12 ? number - now : number >= 1e9 ? number * 1000 - now : number * 1000;
      } else delay = Date.parse(value) - now;
    }
    if (Number.isFinite(delay) && delay >= 0) delays.push(delay);
  }
  return delays.length ? Math.max(...delays) : undefined;
}

export async function recordRateLimit(scope: string, profileName: string, response: Response, attempt: number, options: { signal?: AbortSignal | null; deadline?: number } = {}): Promise<AiRateLimitError | AiQuotaExceededError> {
  const now = Date.now();
  for (const [key, until] of cooldowns) if (until <= now) cooldowns.delete(key);
  const backoff = Math.min(1000 * 2 ** attempt, 30000);
  const hint = retryAfterMs(response.headers, now);
  if (hint === undefined) {
    const code = await readQuotaCode(response, options);
    if (code) return new AiQuotaExceededError(profileName, code);
  } else {
    void response.body?.cancel().catch(() => {});
  }
  const delay = hint === undefined ? backoff * (1 + Math.random() * 0.25) : Math.max(100, hint) + Math.random() * 250;
  const retryAt = Math.max(cooldowns.get(scope) ?? 0, now + Math.ceil(delay));
  cooldowns.set(scope, retryAt);
  return new AiRateLimitError(profileName, retryAt);
}

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); cleanup(); reject(signal?.reason ?? new DOMException('Request aborted', 'AbortError')); };
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function waitForRateLimit(scope: string, profileName: string, options: { signal?: AbortSignal | null; deadline?: number; onWaiting?: () => void }): Promise<void> {
  for (;;) {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Request aborted', 'AbortError');
    const now = Date.now();
    const retryAt = cooldowns.get(scope) ?? 0;
    if (retryAt <= now) return;
    const remaining = (options.deadline ?? Infinity) - now;
    if (remaining <= 0) throw new AiRateLimitError(profileName, retryAt);
    options.onWaiting?.();
    // Bound each timer to avoid overflow even for very distant server reset dates.
    await wait(Math.min(retryAt - now, remaining, 60000), options.signal);
  }
}
