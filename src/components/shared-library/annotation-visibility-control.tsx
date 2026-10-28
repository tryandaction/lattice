'use client';

import { useId, useMemo, useRef } from 'react';
import { ChevronDown, Eye } from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import type { AnnotationItem } from '@/types/universal-annotation';
import type { AnnotationVisibilityMode, AnnotationVisibilityPreference } from '@/lib/shared-library/annotation-visibility';

const COPY = {
  'zh-CN': {
    title: '批注显示', scope: '批注范围', members: '按成员显示', self: '自己',
    modes: { all: '全部', mine: '仅自己', others: '仅他人', hidden: '全部隐藏' },
    note: '仅调整当前视图；带批注导出使用当前可见批注。',
  },
  'en-US': {
    title: 'Annotation visibility', scope: 'Annotation scope', members: 'Show by member', self: 'You',
    modes: { all: 'All', mine: 'Only mine', others: 'Only others', hidden: 'Hide all' },
    note: 'Changes your view only. Annotated exports include visible annotations.',
  },
} as const;
const MODES: AnnotationVisibilityMode[] = ['all', 'mine', 'others', 'hidden'];

/** A small cloud-only control; the existing local PDF sidebar remains the reader. */
export function AnnotationVisibilityControl({ annotations, authorId, authorNames, preference, visibleCount, onModeChange, onAuthorVisibleChange }: {
  annotations: AnnotationItem[];
  authorId: string;
  authorNames?: Record<string, string>;
  preference: AnnotationVisibilityPreference;
  visibleCount: number;
  onModeChange: (mode: AnnotationVisibilityMode) => void;
  onAuthorVisibleChange: (authorId: string, visible: boolean) => void;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale === 'en-US' ? 'en-US' : 'zh-CN'];
  const scopeId = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const members = useMemo(() => {
    const counts = new Map<string, number>();
    for (const annotation of annotations) {
      if (annotation.target.type === 'pdf') counts.set(annotation.author, (counts.get(annotation.author) ?? 0) + 1);
    }
    return [...new Set([authorId, ...Object.keys(authorNames ?? {}), ...counts.keys()])].map(id => ({ id, count: counts.get(id) ?? 0 }));
  }, [annotations, authorId, authorNames]);
  const totalCount = members.reduce((sum, member) => sum + member.count, 0);
  return (
    <div className="flex shrink-0 items-center justify-end border-b border-border bg-background px-2 py-1 text-xs">
      <details ref={detailsRef} className="relative min-w-0" onKeyDown={event => {
        if (event.key === 'Escape' && detailsRef.current) {
          detailsRef.current.open = false;
          detailsRef.current.querySelector('summary')?.focus();
        }
      }}>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{copy.title}</span>
          <span className="text-foreground">{copy.modes[preference.mode]}</span>
          <span className="tabular-nums">{visibleCount}/{totalCount}</span>
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </summary>
        <div className="absolute right-0 top-full z-40 mt-1 w-64 max-w-[calc(100vw-1rem)] space-y-3 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md">
          <label htmlFor={scopeId} className="block space-y-1.5">
            <span className="font-medium">{copy.scope}</span>
            <select id={scopeId} aria-label={copy.scope} value={preference.mode} onChange={event => onModeChange(event.target.value as AnnotationVisibilityMode)} className="block w-full rounded border border-input bg-background px-2 py-1.5 text-xs">
              {MODES.map(mode => <option key={mode} value={mode}>{copy.modes[mode]}</option>)}
            </select>
          </label>
          <fieldset disabled={preference.mode === 'hidden'} className="min-w-0 space-y-1 disabled:opacity-50">
            <legend className="mb-1 font-medium">{copy.members}</legend>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {members.map(member => (
                <label key={member.id} className="flex min-w-0 cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-accent" title={member.id}>
                  <input type="checkbox" aria-label={authorNames?.[member.id] ?? member.id} checked={!preference.hiddenAuthors.includes(member.id)} onChange={event => onAuthorVisibleChange(member.id, event.target.checked)} />
                  <span className="min-w-0 flex-1 truncate">{authorNames?.[member.id] ?? member.id}{member.id === authorId ? ` (${copy.self})` : ''}</span>
                  <span className="tabular-nums text-muted-foreground">{member.count}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{copy.note}</p>
        </div>
      </details>
    </div>
  );
}
