import type { AnnotationItem } from '@/types/universal-annotation';

export type AnnotationVisibilityMode = 'all' | 'mine' | 'others' | 'hidden';
export interface AnnotationVisibilityPreference {
  mode: AnnotationVisibilityMode;
  hiddenAuthors: string[];
}
export interface AnnotationVisibilityDocument {
  identity: string;
  viewScope?: string;
  authorId: string;
}
export const DEFAULT_ANNOTATION_VISIBILITY: AnnotationVisibilityPreference = { mode: 'all', hiddenAuthors: [] };

export function annotationVisibilityStorageKey(document: AnnotationVisibilityDocument | null): string | null {
  return document ? `lattice:cloud-annotation-visibility:v1:${JSON.stringify([document.authorId, document.viewScope ?? document.identity])}` : null;
}

export function parseAnnotationVisibility(raw: string | null): AnnotationVisibilityPreference {
  try {
    const value = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    if (!value || value.version !== 1 || !['all', 'mine', 'others', 'hidden'].includes(String(value.mode))) return DEFAULT_ANNOTATION_VISIBILITY;
    return {
      mode: value.mode as AnnotationVisibilityMode,
      hiddenAuthors: Array.isArray(value.hiddenAuthors)
        ? [...new Set(value.hiddenAuthors.filter((author): author is string => typeof author === 'string' && author.length > 0))]
        : [],
    };
  } catch {
    return DEFAULT_ANNOTATION_VISIBILITY;
  }
}

/** View filtering only. Persist and AI consumers must keep the complete source collection. */
export function filterVisibleAnnotations<T extends Pick<AnnotationItem, 'author'>>(annotations: T[], authorId: string, preference: AnnotationVisibilityPreference): T[] {
  if (preference.mode === 'hidden') return [];
  if (preference.mode === 'all' && preference.hiddenAuthors.length === 0) return annotations;
  const hidden = new Set(preference.hiddenAuthors);
  return annotations.filter(annotation => !hidden.has(annotation.author)
    && (preference.mode !== 'mine' || annotation.author === authorId)
    && (preference.mode !== 'others' || annotation.author !== authorId));
}
