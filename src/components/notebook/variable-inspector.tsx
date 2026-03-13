/**
 * Variable Inspector Component
 *
 * 显示 Python 命名空间中的变量信息
 * - 变量名、类型、值、大小、形状
 * - 支持搜索和排序
 * - 可展开查看详细信息
 */

'use client';

import { useState } from 'react';
import { useNotebookStore } from '@/stores/notebook-store';
import { X } from 'lucide-react';

interface VariableInspectorProps {
  onClose?: () => void;
}

export function VariableInspector({ onClose }: VariableInspectorProps) {
  const variables = useNotebookStore((state) => state.variables);
  const [sortBy, setSortBy] = useState<'name' | 'type' | 'size'>('name');
  const [filter, setFilter] = useState('');

  const sortedVars = Array.from(variables.entries())
    .filter(([name]) => name.toLowerCase().includes(filter.toLowerCase()))
    .sort(([nameA, varA], [nameB, varB]) => {
      if (sortBy === 'name') return nameA.localeCompare(nameB);
      if (sortBy === 'type') return varA.type.localeCompare(varB.type);
      if (sortBy === 'size') return (varB.size || 0) - (varA.size || 0);
      return 0;
    });

  return (
    <div className="h-full flex flex-col border-l border-border bg-background">
      {/* 头部 */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Variables</h3>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-muted transition-colors"
              title="Close variable inspector"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <input
          type="text"
          placeholder="Filter variables..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-2 py-1 text-sm border border-border rounded bg-background"
        />
      </div>

      {/* 排序选项 */}
      <div className="flex gap-2 p-2 border-b border-border text-xs">
        <button
          onClick={() => setSortBy('name')}
          className={`px-2 py-1 rounded ${
            sortBy === 'name' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
          }`}
        >
          Name
        </button>
        <button
          onClick={() => setSortBy('type')}
          className={`px-2 py-1 rounded ${
            sortBy === 'type' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
          }`}
        >
          Type
        </button>
        <button
          onClick={() => setSortBy('size')}
          className={`px-2 py-1 rounded ${
            sortBy === 'size' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
          }`}
        >
          Size
        </button>
      </div>

      {/* 变量列表 */}
      <div className="flex-1 overflow-auto">
        {sortedVars.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">
            {filter ? 'No matching variables' : 'No variables to display'}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sortedVars.map(([name, info]) => (
              <VariableItem key={name} name={name} info={info} />
            ))}
          </div>
        )}
      </div>

      {/* 底部统计 */}
      <div className="p-2 border-t border-border text-xs text-muted-foreground text-center">
        {sortedVars.length} variable{sortedVars.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

function VariableItem({
  name,
  info,
}: {
  name: string;
  info: { type: string; value: string; size: number | null; shape: string | null };
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="p-2 hover:bg-muted/50 cursor-pointer transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-mono font-semibold truncate">{name}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {info.type}
          </span>
        </div>
        {info.shape && (
          <span className="text-xs text-muted-foreground font-mono">{info.shape}</span>
        )}
        <span className="text-xs text-muted-foreground">
          {expanded ? '▼' : '▶'}
        </span>
      </div>

      {expanded && (
        <div className="mt-2 p-2 bg-muted rounded text-xs space-y-1">
          <div className="font-mono break-all">
            <span className="text-muted-foreground">Value:</span>{' '}
            <span className="text-foreground">{info.value}</span>
          </div>
          {info.size !== null && (
            <div className="font-mono">
              <span className="text-muted-foreground">Size:</span>{' '}
              <span className="text-foreground">{formatBytes(info.size)}</span>
            </div>
          )}
          {info.shape && (
            <div className="font-mono">
              <span className="text-muted-foreground">Shape:</span>{' '}
              <span className="text-foreground">{info.shape}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
