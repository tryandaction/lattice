"use client";

import { useEffect, useRef, useState } from 'react';
import { History, RefreshCw, X } from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import type { CloudAuditEvent, CloudAuditPage, CloudAuditPageOptions } from '@/lib/shared-library/collaboration-audit';

export interface CloudActivityHistoryProps {
  libraryId: string;
  loadPage: (options: CloudAuditPageOptions) => Promise<CloudAuditPage>;
  onOpenVersionHistory?: (itemId: string, versionId?: string) => void;
  onClose: () => void;
  inline?: boolean;
}
interface FeedState extends CloudAuditPage { libraryId: string; loading: boolean; error: string | null }
const button = 'inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent disabled:pointer-events-none disabled:opacity-50';
const labels: Record<string, [string, string]> = {
  library: ['资料库', 'Library'], collection: ['集合', 'Collection'], item: ['条目', 'Item'], version: ['内容版本', 'Content version'],
  annotation: ['批注', 'Annotation'], comment: ['评论', 'Comment'], member: ['成员', 'Member'],
  created: ['创建', 'Created'], updated: ['更新', 'Updated'], deleted: ['删除', 'Deleted'], trashed: ['移入回收站', 'Moved to trash'], restored: ['恢复', 'Restored'],
  'role-changed': ['修改权限', 'Changed role'], 'status-changed': ['修改成员状态', 'Changed membership'],
};

export function CloudActivityHistory({ libraryId, loadPage, onOpenVersionHistory, onClose, inline = false }: CloudActivityHistoryProps) {
  const { locale, formatDate } = useI18n();
  const zh = locale.startsWith('zh');
  const label = (value: string) => labels[value]?.[zh ? 0 : 1] ?? value;
  const empty: FeedState = { libraryId, events: [], nextCursor: null, hasMore: false, loading: true, error: null };
  const [state, setState] = useState<FeedState>(empty);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef<AbortController | null>(null);
  // Never expose the previous library's cached rows while its replacement loads.
  const shown = state.libraryId === libraryId ? state : empty;
  useEffect(() => {
    const controller = new AbortController();
    pending.current?.abort(); pending.current = controller;
    void loadPage({ limit: 30, signal: controller.signal }).then(page => {
      if (!controller.signal.aborted) setState({ ...page, libraryId, loading: false, error: null });
    }).catch(cause => {
      if (!controller.signal.aborted) setState({ libraryId, events: [], nextCursor: null, hasMore: false, loading: false, error: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => controller.abort();
  }, [libraryId, loadPage, refresh]);
  useEffect(() => () => pending.current?.abort(), []);

  async function more() {
    if (shown.loading || !shown.nextCursor) return;
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    setState(previous => ({ ...previous, loading: true, error: null }));
    try {
      const page = await loadPage({ cursor: shown.nextCursor, limit: 30, signal: controller.signal });
      if (!controller.signal.aborted) setState(previous => {
        const seen = new Set(previous.events.map(event => event.id));
        return { ...page, libraryId, events: [...previous.events, ...page.events.filter(event => !seen.has(event.id))], loading: false, error: null };
      });
    } catch (cause) {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, loading: false, error: cause instanceof Error ? cause.message : String(cause) }));
    }
  }
  function reload() { pending.current?.abort(); setState(empty); setRefresh(value => value + 1); }
  const title = zh ? '活动记录' : 'Activity history';
  return <aside aria-label={title} className={inline ? 'flex max-h-[60dvh] min-h-80 w-full flex-col border-t border-border bg-background' : 'absolute inset-y-0 right-0 z-30 flex w-full max-w-xl flex-col border-l border-border bg-background shadow-xl'} data-testid="cloud-activity-history">
    <header className="flex items-center gap-2 border-b border-border p-3">
      <History className="size-4 text-muted-foreground" /><h2 className="flex-1 text-sm font-medium">{title}</h2>
      <button type="button" className={button} aria-label={zh ? '刷新活动记录' : 'Refresh activity history'} disabled={shown.loading} onClick={reload}><RefreshCw className="size-3.5" /></button>
      <button type="button" className={button} aria-label={zh ? '关闭活动记录' : 'Close activity history'} onClick={onClose}><X className="size-3.5" /></button>
    </header>
    {shown.error ? <p role="alert" className="border-b border-border p-3 text-xs text-destructive">{shown.error}</p> : null}
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {!shown.loading && !shown.error && shown.events.length === 0 ? <p className="text-xs text-muted-foreground">{zh ? '还没有活动记录' : 'No activity yet'}</p> : null}
      <ol className="space-y-3">{shown.events.map((event: CloudAuditEvent) => <li key={event.id} data-testid="cloud-activity-event" className="rounded border border-border p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{event.actorDisplayName || event.actorId || (zh ? '系统' : 'System')}</span><span>{label(event.action)}</span><span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{label(event.entityType)}</span></div>
        <p className="mt-1 break-words font-medium">{event.targetLabel}</p>
        {event.action === 'role-changed' ? <p className="mt-1 text-muted-foreground">{String(event.before?.role ?? '')} → {String(event.after?.role ?? '')}</p> : null}
        {event.entityType === 'version' && event.after?.version_number != null ? <p className="mt-1 text-muted-foreground">{zh ? '版本' : 'Version'} {String(event.after.version_number)}</p> : null}
        <time dateTime={event.createdAt} className="mt-1 block text-muted-foreground">{formatDate(event.createdAt)}</time>
        <div className="mt-2 flex flex-wrap items-start gap-2">
          {event.itemId && event.versionId && onOpenVersionHistory ? <button type="button" className={button} onClick={() => onOpenVersionHistory(event.itemId!, event.versionId!)}>{zh ? '查看内容版本' : 'View content versions'}</button> : null}
          <details className="max-w-full"><summary className="cursor-pointer py-1 text-muted-foreground">{zh ? '变更详情' : 'Change details'}</summary><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2">{JSON.stringify({ [zh ? '变更前' : 'before']: event.before, [zh ? '变更后' : 'after']: event.after }, null, 2)}</pre></details>
        </div>
      </li>)}</ol>
      {shown.loading ? <p role="status" className="py-3 text-xs text-muted-foreground">{zh ? '正在加载活动记录…' : 'Loading activity…'}</p> : null}
      {shown.hasMore ? <button type="button" className={button + ' mt-3'} disabled={shown.loading} onClick={() => void more()}>{zh ? '加载更早记录' : 'Load earlier activity'}</button> : null}
    </div>
  </aside>;
}
