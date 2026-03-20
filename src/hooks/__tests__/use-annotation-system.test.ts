import { describe, expect, it } from 'vitest';
import { resolveAnnotationFileCandidates } from '../use-annotation-system';

describe('use-annotation-system helpers', () => {
  it('prefers full workspace path and keeps legacy filename fallback when needed', () => {
    expect(resolveAnnotationFileCandidates('figure.png', 'papers/week1/figure.png')).toEqual([
      'papers-week1-figure.png',
      'figure.png',
    ]);
  });

  it('isolates same-name image sidecars by workspace path', () => {
    expect(resolveAnnotationFileCandidates('figure.png', 'experiments/week1/figure.png')).toEqual([
      'experiments-week1-figure.png',
      'figure.png',
    ]);
    expect(resolveAnnotationFileCandidates('figure.png', 'experiments/week2/figure.png')).toEqual([
      'experiments-week2-figure.png',
      'figure.png',
    ]);
  });

  it('returns a single candidate when full path and filename map to the same id', () => {
    expect(resolveAnnotationFileCandidates('notes.md', 'notes.md')).toEqual([
      'notes.md',
    ]);
  });
});
