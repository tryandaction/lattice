/**
 * AI Completion Provider
 * Handles completion requests with caching and debouncing
 */

import { getDefaultProvider } from './providers';
import type { AiMessage } from './types';

interface CompletionCacheEntry {
  text: string;
  timestamp: number;
}

const cache = new Map<string, CompletionCacheEntry>();
const CACHE_TTL = 60_000; // 1 minute
const CACHE_MAX = 100;

function getCacheKey(prefix: string, suffix: string): string {
  // Use last 200 chars of prefix + first 100 chars of suffix as key
  const p = prefix.slice(-200);
  const s = suffix.slice(0, 100);
  return `${p}|||${s}`;
}

function pruneCache(): void {
  if (cache.size <= CACHE_MAX) return;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.timestamp > CACHE_TTL) cache.delete(key);
  }
  // If still too large, remove oldest
  if (cache.size > CACHE_MAX) {
    const keys = [...cache.keys()];
    for (let i = 0; i < keys.length - CACHE_MAX / 2; i++) {
      cache.delete(keys[i]);
    }
  }
}

/**
 * Request an inline completion from the AI provider
 */
export async function requestCompletion(
  prefix: string,
  suffix: string,
  fileName: string,
  signal?: AbortSignal
): Promise<string | null> {
  if (!prefix.trim() && !suffix.trim()) return null;

  // Check cache
  const cacheKey = getCacheKey(prefix, suffix);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.text;
  }

  const provider = getDefaultProvider();
  if (!provider || !provider.isConfigured()) return null;

  const messages: AiMessage[] = [
    {
      role: 'system',
      content: `You are an inline code/text completion engine. Given the text before and after the cursor, output ONLY the completion text. No explanations, no markdown fences, no extra text. Output the natural continuation (1-3 lines max). If no good completion exists, output nothing.`,
    },
    {
      role: 'user',
      content: `File: ${fileName}\n\n<prefix>\n${prefix.slice(-1500)}\n</prefix>\n<cursor/>\n<suffix>\n${suffix.slice(0, 500)}\n</suffix>`,
    },
  ];

  try {
    const result = await provider.generate(messages, {
      temperature: 0.2,
      maxTokens: 150,
      signal,
    });

    const text = result.text.trim();
    if (!text) return null;

    // Cache result
    pruneCache();
    cache.set(cacheKey, { text, timestamp: Date.now() });

    return text;
  } catch (err) {
    if ((err as Error).name === 'AbortError') return null;
    console.warn('[AI Completion] Request failed:', err);
    return null;
  }
}

/**
 * Clear the completion cache
 */
export function clearCompletionCache(): void {
  cache.clear();
}
