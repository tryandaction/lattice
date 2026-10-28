import { describe, expect, it } from 'vitest';
import type { AnnotationItem } from '@/types/universal-annotation';
import {
  annotationVisibilityStorageKey,
  filterVisibleAnnotations,
  parseAnnotationVisibility,
} from '../annotation-visibility';

const annotations = [
  { id: 'mine', author: 'me' },
  { id: 'alice', author: 'alice' },
  { id: 'bob', author: 'bob' },
] as AnnotationItem[];

describe('shared annotation visibility', () => {
  it.each([
    ['all', ['mine', 'alice', 'bob']],
    ['mine', ['mine']],
    ['others', ['alice', 'bob']],
    ['hidden', []],
  ] as const)('applies the %s view without changing the complete collection', (mode, expected) => {
    const result = filterVisibleAnnotations(annotations, 'me', { mode, hiddenAuthors: [] });
    expect(result.map(annotation => annotation.id)).toEqual(expected);
    expect(annotations.map(annotation => annotation.id)).toEqual(['mine', 'alice', 'bob']);
  });

  it('intersects the selected scope with member choices and includes new members by default', () => {
    expect(filterVisibleAnnotations(annotations, 'me', { mode: 'others', hiddenAuthors: ['alice'] }).map(annotation => annotation.id)).toEqual(['bob']);
  });

  it('isolates preferences by account and stable connection/file scope', () => {
    const document = { identity: 'file:version-1', viewScope: 'connection-1:file', authorId: 'me' };
    const key = annotationVisibilityStorageKey(document);
    expect(annotationVisibilityStorageKey({ ...document, identity: 'file:version-2' })).toBe(key);
    expect(annotationVisibilityStorageKey({ ...document, authorId: 'alice' })).not.toBe(key);
    expect(annotationVisibilityStorageKey({ ...document, viewScope: 'connection-2:file' })).not.toBe(key);
    expect(annotationVisibilityStorageKey({ ...document, viewScope: 'connection-1:other-file' })).not.toBe(key);
    expect(annotationVisibilityStorageKey(null)).toBeNull();
  });

  it('falls back safely when saved preferences are invalid or from an unsupported schema', () => {
    for (const value of ['invalid', '{"version":2,"mode":"hidden"}', '{"version":1,"mode":"surprise"}']) {
      expect(parseAnnotationVisibility(value)).toEqual({ mode: 'all', hiddenAuthors: [] });
    }
    expect(parseAnnotationVisibility('{"version":1,"mode":"mine","hiddenAuthors":["alice",1,"alice",""]}')).toEqual({ mode: 'mine', hiddenAuthors: ['alice'] });
  });
});
