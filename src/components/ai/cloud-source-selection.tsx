'use client';

import { useEffect, useRef, useState } from 'react';
import { Folder, FileText, Plus, X } from 'lucide-react';
import { getCloudWorkspaceSnapshot, type CloudWorkspaceSnapshot } from '@/lib/cloud-workspace-host';
import type { Item } from '@/lib/shared-library/domain';
import { buildCloudSourceSelectionMention, parseCloudSourceSelections, invalidCloudSourceSelectionMentions, type CloudAgentSourceSelection } from '@/lib/ai/cloud-source';
import { useI18n } from '@/hooks/use-i18n';
import { getCloudAiSourceName } from '@/lib/shared-library/cloud-ai-entry';
import { cloudAiLabels } from '@/lib/shared-library/cloud-ai-labels';
import type { CloudLibrarySourceProvider } from '@/lib/shared-library/source-provider';
import { cloudComposerInput, withoutCloudComposerSource } from '@/lib/ai/cloud-composer-input';

export function CloudSourceSelection({ host, input, onInputChange, disabled, expectedScope }: {
  host: CloudWorkspaceSnapshot; input: string; onInputChange: (value: string | ((current: string) => string)) => void; disabled: boolean;
  expectedScope?: string | null;
}) {
  const { locale } = useI18n();
  const labels = cloudAiLabels(locale);
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<{ provider: CloudLibrarySourceProvider; scope?: string; libraryId: string; items: Item[] } | null>(null);
  const [parentId, setParentId] = useState<string | undefined>();
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const selections = parseCloudSourceSelections(cloudComposerInput(input).mentions.join(' '));
  const libraryId = selections[0]?.libraryId ?? host.resource?.libraryId;
  const providerIsCurrent = () => Boolean(host.provider && getCloudWorkspaceSnapshot().provider === host.provider
    && (!expectedScope || host.provider.scope === expectedScope));
  const scopeChanged = !providerIsCurrent();
  const items = !scopeChanged && listing?.provider === host.provider && listing?.scope === host.provider?.scope && listing?.libraryId === libraryId ? listing.items : [];
  const sourceName = (source: CloudAgentSourceSelection) => {
    if (scopeChanged) return source.itemId;
    if (host.resource?.libraryId === source.libraryId && host.resource.itemId === source.itemId) return host.resource.name;
    return items.find(item => item.libraryId === source.libraryId && item.id === source.itemId)?.canonicalName
      ?? getCloudAiSourceName(host.provider, source) ?? source.itemId;
  };
  const add = (selection: CloudAgentSourceSelection) => {
    if (!providerIsCurrent()) return;
    if (selections.some(source => source.libraryId === selection.libraryId && source.itemId === selection.itemId && source.kind === selection.kind)) return;
    onInputChange(current => `${current}${current && !/\s$/.test(current) ? ' ' : ''}${buildCloudSourceSelectionMention(selection)} `);
  };
  const load = async (folderId?: string) => {
    if (!host.provider || !libraryId || !providerIsCurrent()) return;
    const provider = host.provider, scope = provider.scope;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setError(null); setLoading(true); setParentId(folderId);
    try {
      const result = await provider.list(libraryId, folderId, request.signal);
      request.signal.throwIfAborted();
      if (getCloudWorkspaceSnapshot().provider !== provider || provider.scope !== scope) return;
      setListing({ provider, scope, libraryId, items: result.filter(item => item.libraryId === libraryId && item.status === 'active') });
    } catch (cause) { if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (!request.signal.aborted) setLoading(false); }
  };
  const matches = items.filter(item => item.canonicalName.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <div className="px-1 py-1 text-[11px]" data-testid="ai-cloud-source-selection">
    <div className="flex flex-wrap items-center gap-1">
      <span className="max-w-full truncate text-muted-foreground">{selections.length ? labels.selected : host.resource && !scopeChanged ? labels.opened(host.resource.name) : labels.noOpenedFile}</span>
      <button type="button" disabled={disabled || scopeChanged || !libraryId} aria-expanded={open && !scopeChanged} data-testid="ai-source-select-toggle" className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-accent disabled:opacity-50"
        onClick={() => { const next = !open; setOpen(next); if (next) void load(selections[0]?.kind === 'folder' ? selections[0].itemId : !selections.length && host.resource?.kind === 'folder' ? host.resource.itemId : undefined); }}><Plus className="h-3 w-3" />{labels.select}</button>
      {selections.map(source => <span className="inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5" key={`${source.libraryId}:${source.itemId}`}>
        {source.kind === 'folder' ? <Folder className="h-3 w-3 shrink-0" /> : <FileText className="h-3 w-3 shrink-0" />}
        <span className="max-w-40 truncate" title={`${source.libraryId}/${source.itemId}`}>{sourceName(source)}</span>
        <button type="button" aria-label={`移除云来源 ${source.itemId}`} disabled={disabled} onClick={() => onInputChange(current => withoutCloudComposerSource(current, source))}><X className="h-3 w-3" /></button>
      </span>)}
    </div>
    {scopeChanged && selections.length ? <p role="status" className="text-amber-700 dark:text-amber-300">{labels.scopeChanged}</p> : null}
    {open && !scopeChanged ? <div className="max-h-52 space-y-1 overflow-auto rounded border border-border bg-background p-2" data-testid="ai-cloud-source-picker">
      <p className="text-muted-foreground">{labels.readingSelection}</p>
      {parentId ? <button type="button" className="rounded px-1 py-1 underline" onClick={() => void load()}>返回云库根目录</button> : null}
      <input aria-label="筛选云来源" className="w-full rounded border border-border bg-background px-2 py-1" value={filter} onChange={event => setFilter(event.target.value)} placeholder="筛选当前目录" />
      {loading ? <p role="status">正在读取授权列表…</p> : null}
      {error ? <p role="alert" className="text-destructive">{error} <button type="button" className="underline" onClick={() => void load(parentId)}>重试</button></p> : null}
      <ul>{matches.slice(0, 200).map(item => <li key={item.id} className="flex min-w-0 items-center gap-1 py-0.5">
        {item.kind === 'folder' ? <Folder className="h-3 w-3 shrink-0" /> : <FileText className="h-3 w-3 shrink-0" />}
        <button type="button" className="min-w-0 truncate rounded px-1 py-1 text-left hover:bg-accent" aria-label={`选择云${item.kind === 'folder' ? '文件夹' : '文件'} ${item.canonicalName}`}
          onClick={() => add({ kind: item.kind === 'folder' ? 'folder' : 'file', libraryId: item.libraryId, itemId: item.id })}>{item.canonicalName}</button>
        {item.kind === 'folder' ? <button type="button" className="ml-auto shrink-0 rounded px-1 py-1 underline" onClick={() => void load(item.id)}>打开文件夹</button> : null}
      </li>)}</ul>
      {matches.length > 200 ? <p>当前显示前 200 项；输入名称继续筛选。</p> : null}
    </div> : null}
    {invalidCloudSourceSelectionMentions(input).length ? <p role="status" className="text-amber-700 dark:text-amber-300">云来源提及的编码尚不完整，请重新选择；正文保持原样。</p> : null}
  </div>;
}
