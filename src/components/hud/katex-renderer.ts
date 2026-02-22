'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadKaTeX, getKaTeX } from '@/components/editor/codemirror/live-preview/katex-loader';

type KaTeXModule = typeof import('katex').default;

const FALLBACK_CLASS = 'text-xs text-gray-400';

function fallback(latex: string): string {
  return `<span class="${FALLBACK_CLASS}">${latex}</span>`;
}

export function useKaTeXRenderer() {
  const [katex, setKatex] = useState<KaTeXModule | null>(() => getKaTeX());

  useEffect(() => {
    if (katex) return;
    let active = true;
    loadKaTeX()
      .then((mod) => {
        if (active) setKatex(mod);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [katex]);

  return useCallback(
    (latex: string) => {
      if (!katex) return fallback(latex);
      try {
        return katex.renderToString(latex, {
          throwOnError: false,
          displayMode: false,
          output: 'html',
        });
      } catch {
        return fallback(latex);
      }
    },
    [katex]
  );
}
