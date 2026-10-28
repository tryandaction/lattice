import type { AnnotationItem } from '@/types/universal-annotation';

/** Cloud adapters can reorder object keys; every persisted value still matters. */
export function annotationItemsEqual(left: AnnotationItem, right: AnnotationItem): boolean {
  const serialize = (annotation: AnnotationItem) => JSON.stringify(annotation, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value);
  return serialize(left) === serialize(right);
}
