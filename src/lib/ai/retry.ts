/**
 * AI Request Retry Logic
 * Exponential backoff with error-type awareness
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 16000,
};

/**
 * Determine if an error is retryable based on HTTP status
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Rate limited
    if (msg.includes('429') || msg.includes('rate limit')) return true;
    // Server errors
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return true;
    // Network errors
    if (msg.includes('network') || msg.includes('timeout') || msg.includes('econnreset')) return true;
  }
  return false;
}

/**
 * Extract Retry-After header value in ms (if present in error message)
 */
function getRetryAfterMs(error: unknown): number | null {
  if (error instanceof Error) {
    const match = error.message.match(/retry.?after[:\s]*(\d+)/i);
    if (match) return parseInt(match[1], 10) * 1000;
  }
  return null;
}

/**
 * Wrap an async function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry auth errors (401, 403)
      const msg = lastError.message.toLowerCase();
      if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden')) {
        throw lastError;
      }

      // Don't retry on last attempt
      if (attempt >= opts.maxRetries) break;

      // Only retry retryable errors
      if (!isRetryableError(error)) throw lastError;

      // Calculate delay
      const retryAfter = getRetryAfterMs(error);
      const exponentialDelay = Math.min(
        opts.initialDelayMs * Math.pow(2, attempt),
        opts.maxDelayMs
      );
      const delay = retryAfter ?? exponentialDelay;

      opts.onRetry?.(attempt + 1, lastError);
      console.warn(`[AI Retry] Attempt ${attempt + 1}/${opts.maxRetries}, waiting ${delay}ms...`);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error('Retry failed');
}
