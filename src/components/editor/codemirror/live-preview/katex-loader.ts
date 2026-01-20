/**
 * Shared KaTeX Loader
 * Prevents duplicate KaTeX module loading across plugins
 */

let katex: any = null;
let loadPromise: Promise<any> | null = null;

/**
 * Load KaTeX module (singleton pattern)
 * @returns Promise resolving to KaTeX module
 */
export async function loadKaTeX(): Promise<any> {
  if (katex) return katex;
  if (loadPromise) return loadPromise;

  loadPromise = import('katex')
    .then((module) => {
      katex = module.default || module;
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
export function getKaTeX(): any {
  return katex;
}

/**
 * Check if KaTeX is loaded
 * @returns true if KaTeX is loaded
 */
export function isKaTeXLoaded(): boolean {
  return katex !== null;
}
