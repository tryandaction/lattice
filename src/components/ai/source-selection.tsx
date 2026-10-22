'use client';

import { useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronRight, Folder, FileText, Plus, X } from 'lucide-react';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { TreeNode } from '@/types/file-system';
import { buildSourceSelectionMention, parseSourceSelections, invalidSourceSelectionMentions, type AgentSourceSelection } from '@/lib/ai/source-index';
import { getCloudWorkspaceSnapshot, subscribeCloudWorkspaceHost } from '@/lib/cloud-workspace-host';
import { CloudSourceSelection } from './cloud-source-selection';

function SourceTreeNode({ node, onSelect }: { node: TreeNode; onSelect: (selection: AgentSourceSelection) => void }) {
  const [expanded, setExpanded] = useState(false);
  const directory = node.kind === 'directory';
  return <li className="min-w-0">
    <div className="flex min-w-0 items-center gap-1 py-0.5">
      {directory ? <button type="button" onClick={() => setExpanded(value => !value)} aria-label={`展开 ${node.name}`} aria-expanded={expanded} className="p-1">
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button> : <span className="w-5" />}
      {directory ? <Folder className="h-3 w-3 shrink-0" /> : <FileText className="h-3 w-3 shrink-0" />}
      <button type="button" title={node.path} onClick={() => onSelect({ kind: directory ? 'folder' : 'file', path: node.path })}
        className="min-w-0 truncate rounded px-1 py-1 text-left hover:bg-accent" aria-label={`选择${directory ? '文件夹' : '文件'} ${node.path}`}>{node.name}</button>
    </div>
    {node.kind === 'directory' && expanded ? <ul className="ml-4 border-l border-border pl-1">{node.children.map(child => <SourceTreeNode key={child.path} node={child} onSelect={onSelect} />)}</ul> : null}
  </li>;
}

/** Source selections are explicit workspace authorizations, separate from read coverage. */
export function SourceSelection({ input, onInputChange, disabled }: { input: string; onInputChange: (value: string | ((current: string) => string)) => void; disabled: boolean }) {
  const cloud = useSyncExternalStore(subscribeCloudWorkspaceHost, getCloudWorkspaceSnapshot, getCloudWorkspaceSnapshot);
  const [open, setOpen] = useState(false);
  const root = useWorkspaceStore(state => state.fileTree.root);
  const hasRoot = useWorkspaceStore(state => Boolean(state.rootHandle));
  const selected = parseSourceSelections(input);
  const add = (selection: AgentSourceSelection) => {
    if (selected.some(source => source.kind === selection.kind && source.path === selection.path)) return;
    onInputChange(current => `${current}${current && !/\s$/.test(current) ? ' ' : ''}${buildSourceSelectionMention(selection)} `);
  };
  if (cloud.active) return <CloudSourceSelection key={`${cloud.provider?.scope}:${cloud.resource?.libraryId}`} host={cloud} input={input} onInputChange={onInputChange} disabled={disabled} />;
  return <div className="relative px-1 py-1 text-[11px]" data-testid="ai-source-selection">
    <div className="flex flex-wrap items-center gap-1">
      <button type="button" disabled={disabled || !hasRoot} onClick={() => setOpen(value => !value)} aria-expanded={open}
        title={hasRoot ? '选择当前工作区文件或文件夹' : '先打开工作区以选择文件'} data-testid="ai-source-select-toggle" className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-muted-foreground hover:bg-accent disabled:opacity-50">
        <Plus className="h-3 w-3" />选择来源
      </button>
      {selected.map(source => <span key={`${source.kind}:${source.path}`} title={source.path} className="inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-0.5">
        <span className="max-w-48 truncate">{source.path || '当前工作区'}</span>
        <button type="button" disabled={disabled} aria-label={`移除来源 ${source.path}`} onClick={() => onInputChange(current => current.replace(buildSourceSelectionMention(source), ''))}><X className="h-3 w-3" /></button>
      </span>)}
    </div>
    {open ? <div className="max-h-48 overflow-auto rounded border border-border bg-background p-2" data-testid="ai-source-picker">
      <p className="mb-1 text-muted-foreground">选择范围供读取；实际阅读页／段落会显示在执行记录中。</p>
      <button type="button" onClick={() => add({ kind: 'folder', path: '.' })} className="mb-1 rounded px-1 py-1 hover:bg-accent">选择当前工作区</button>
      {root ? <ul>{root.children.map(node => <SourceTreeNode key={node.path} node={node} onSelect={add} />)}</ul> : <p>文件树尚未加载。</p>}
    </div> : null}
    {invalidSourceSelectionMentions(input).length ? <p role="status" className="text-amber-700 dark:text-amber-300">来源提及的编码尚不完整，请修正或重新选择；完整正文保持原样。</p> : null}
  </div>;
}
