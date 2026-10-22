'use client';

import { useEffect, useRef, useState } from 'react';
import { Folder, FileText, Plus, X } from 'lucide-react';
import { getCloudWorkspaceSnapshot, type CloudWorkspaceSnapshot } from '@/lib/cloud-workspace-host';
import type { Item } from '@/lib/shared-library/domain';
import { buildCloudSourceSelectionMention, parseCloudSourceSelections, invalidCloudSourceSelectionMentions, type CloudAgentSourceSelection } from '@/lib/ai/cloud-source';

export function CloudSourceSelection({ host, input, onInputChange, disabled }: {
  host: CloudWorkspaceSnapshot; input: string; onInputChange: (value: string | ((current: string) => string)) => void; disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [parentId, setParentId] = useState<string | undefined>();
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const selections = parseCloudSourceSelections(input);
  const add = (selection: CloudAgentSourceSelection) => {
    if (selections.some(source => source.libraryId === selection.libraryId && source.itemId === selection.itemId && source.kind === selection.kind)) return;
    onInputChange(current => `${current}${current && !/\s$/.test(current) ? ' ' : ''}${buildCloudSourceSelectionMention(selection)} `);
  };
  const load = async (folderId?: string) => {
    if (!host.provider || !host.resource) return;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setError(null); setLoading(true); setParentId(folderId);
    try {
      const result = await host.provider.list(host.resource.libraryId, folderId, request.signal);
      request.signal.throwIfAborted();
      if (getCloudWorkspaceSnapshot().provider !== host.provider || !getCloudWorkspaceSnapshot().active) return;
      setItems(result.filter(item => item.libraryId === host.resource!.libraryId && item.status === 'active'));
    } catch (cause) { if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (!request.signal.aborted) setLoading(false); }
  };
  const matches = items.filter(item => item.canonicalName.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <div className="px-1 py-1 text-[11px]" data-testid="ai-cloud-source-selection">
    <div className="flex flex-wrap items-center gap-1">
      <span className="max-w-full truncate text-muted-foreground" title={host.resource?.id}>云当前来源：{host.resource?.name ?? '请先打开云文件'}</span>
      <button type="button" disabled={disabled || !host.provider || !host.resource} aria-expanded={open} data-testid="ai-source-select-toggle" className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-accent disabled:opacity-50"
        onClick={() => { const next = !open; setOpen(next); if (next) void load(host.resource?.kind === 'folder' ? host.resource.itemId : undefined); }}><Plus className="h-3 w-3" />选择云来源</button>
      {selections.map(source => <span className="inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5" key={`${source.libraryId}:${source.itemId}`}>
        <span className="max-w-40 truncate">{items.find(item => item.id === source.itemId)?.canonicalName ?? source.itemId}</span>
        <button type="button" aria-label={`移除云来源 ${source.itemId}`} disabled={disabled} onClick={() => onInputChange(current => current.replace(buildCloudSourceSelectionMention(source), ''))}><X className="h-3 w-3" /></button>
      </span>)}
    </div>
    {open ? <div className="max-h-52 space-y-1 overflow-auto rounded border border-border bg-background p-2" data-testid="ai-cloud-source-picker">
      <p className="text-muted-foreground">从当前授权云库选择；列表只用于发现，回答前会重新读取权限和版本。</p>
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
