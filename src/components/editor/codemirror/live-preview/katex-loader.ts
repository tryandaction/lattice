/**
 * Shared KaTeX Loader
 * Prevents duplicate KaTeX module loading across plugins
 */

type KaTeXModule = typeof import('katex').default;

let katex: KaTeXModule | null = null;
let loadPromise: Promise<KaTeXModule> | null = null;

function resolveKaTeX(module: KaTeXModule | { default?: KaTeXModule }): KaTeXModule {
  if ('default' in module && module.default) {
    return module.default;
  }
  return module as KaTeXModule;
}

/**
 * Load KaTeX module (singleton pattern)
 * @returns Promise resolving to KaTeX module
 */
export async function loadKaTeX(): Promise<KaTeXModule> {
  if (katex) return katex;
  if (loadPromise) return loadPromise;

  loadPromise = import('katex')
    .then((module) => {
      katex = resolveKaTeX(module as { default?: KaTeXModule });
      return katex;
    })
    .catch((err) => {
      console.error('Failed to load KaTeX:', err);
      loadPromise = null; // Reset on error to allow retry
      throw err;
    });

  return loadPromise;
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
