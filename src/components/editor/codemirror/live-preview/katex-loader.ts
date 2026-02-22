/**
 * Shared KaTeX Loader
 * Prevents duplicate KaTeX module loading across plugins
 * Includes retry with exponential backoff
 */

type KaTeXModule = typeof import('katex').default;

let katex: KaTeXModule | null = null;
let loadPromise: Promise<KaTeXModule> | null = null;
let retryCount = 0;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // exponential backoff

function resolveKaTeX(module: KaTeXModule | { default?: KaTeXModule }): KaTeXModule {
  if ('default' in module && module.default) {
    return module.default;
  }
  return module as KaTeXModule;
}

/**
 * Load KaTeX module with retry logic (singleton pattern)
 * @returns Promise resolving to KaTeX module
 */
export async function loadKaTeX(): Promise<KaTeXModule> {
  if (katex) return katex;
  if (loadPromise) return loadPromise;

  loadPromise = attemptLoad();
  return loadPromise;
}

async function attemptLoad(): Promise<KaTeXModule> {
  try {
    const katexModule = await import('katex');
    katex = resolveKaTeX(katexModule as { default?: KaTeXModule });
    retryCount = 0;
    return katex;
  } catch (err) {
    loadPromise = null;
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAYS[retryCount] ?? 4000;
      retryCount++;
      console.warn(`[KaTeX] Load failed (attempt ${retryCount}/${MAX_RETRIES}), retrying in ${delay}ms...`, err);
      await new Promise(resolve => setTimeout(resolve, delay));
      loadPromise = attemptLoad();
      return loadPromise;
    }
    console.error(`[KaTeX] Failed to load after ${MAX_RETRIES} retries:`, err);
    retryCount = 0;
    throw err;
  }
}

/**
 * Get loaded KaTeX instance (synchronous)
 * @returns KaTeX module or null if not loaded
 */
export function getKaTeX(): KaTeXModule | null {
  return katex;
}

/**
 * Check if KaTeX is loaded
 * @returns true if KaTeX is loaded
 */
export function isKaTeXLoaded(): boolean {
  return katex !== null;
}
