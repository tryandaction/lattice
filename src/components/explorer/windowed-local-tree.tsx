"use client";

import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { DirectoryNode, TreeNode } from '@/types/file-system';
import { useExplorerStore } from '@/stores/explorer-store';
import { TreeNodeComponent } from './tree-node';

const ESTIMATED_ROW_HEIGHT = 28;
const OVERSCAN = 6;
export const LOCAL_TREE_WINDOW_THRESHOLD = 300;
export interface VisibleLocalTreeRow { node: TreeNode; depth: number; siblingIndex: number; siblingCount: number; }

/** Traversal keeps every expanded PDF child and directory available without mounting each row. */
export function collectVisibleLocalTreeRows(root: DirectoryNode): VisibleLocalTreeRow[] {
  const rows: VisibleLocalTreeRow[] = [];
  const visit = (node: TreeNode, depth: number, siblingIndex: number, siblingCount: number) => {
    rows.push({node, depth, siblingIndex, siblingCount});
    if (node.isExpanded && node.children) node.children.forEach((child, index) => visit(child, depth + 1, index, node.children!.length));
  };
  visit(root, 0, 0, 1);
  return rows;
}

function scrollParent(element: HTMLElement): HTMLElement {
  let parent = element.parentElement;
  while (parent) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY || getComputedStyle(parent).overflow)) return parent;
    parent = parent.parentElement;
  }
  return element;
}

export interface WindowedLocalTreeHandle { navigate: (key: string) => void; }

export const WindowedLocalTree = forwardRef<WindowedLocalTreeHandle, { rows: VisibleLocalTreeRow[] }>(function WindowedLocalTree({ rows }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const lastReveal = useRef<string | null>(null);
  const measuredReveal = useRef<{path: string | null; estimatedHeight: number} | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const previousCount = useRef(rows.length);
  const [windowState, setWindowState] = useState({top: 0, height: 560});
  const [measurements, setMeasurements] = useState<{estimatedHeight: number; heights: Map<string, number>}>(() => ({estimatedHeight: ESTIMATED_ROW_HEIGHT, heights: new Map()}));
  const indexByPath = useMemo(() => new Map(rows.map((row, index) => [row.node.path, index])), [rows]);
  const offsets = useMemo(() => {
    const result = [0];
    for (const row of rows) result.push(result[result.length - 1] + (measurements.heights.get(row.node.path) ?? measurements.estimatedHeight));
    return result;
  }, [rows, measurements]);
  const selectedPath = useExplorerStore(state => state.selectedPath);
  const renamingPath = useExplorerStore(state => state.renamingPath);

  const updateWindow = useCallback(() => {
    const host = viewport.current, element = container.current;
    if (!host || !element) return;
    const offset = element.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop;
    const top = Math.max(0, host.scrollTop - offset), height = host.clientHeight || 560;
    setWindowState(previous => previous.top === top && previous.height === height ? previous : {top, height});
  }, []);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const host = scrollParent(element);
    viewport.current = host;
    host.addEventListener('scroll', updateWindow, {passive: true});
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(updateWindow) : null;
    observer?.observe(host);
    updateWindow();
    return () => { host.removeEventListener('scroll', updateWindow); observer?.disconnect(); };
  }, [updateWindow]);

  // Measure natural content height, including touch targets and inline rename errors.
  // Estimated heights only cover rows outside the current DOM window.
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const mountedRows = Array.from(element.querySelectorAll<HTMLElement>('[data-windowed-path]'));
    const measure = () => {
      const current = mountedRows.map(row => ({path: row.dataset.windowedPath!, height: row.getBoundingClientRect().height})).filter(row => row.height > 0);
      if (!current.length) return;
      const normal = current.filter(row => row.path !== renamingPath).map(row => row.height).sort((a,b) => a-b);
      const estimate = normal.length ? normal[Math.floor(normal.length / 2)] : undefined;
      setMeasurements(previous => {
        const estimatedHeight = estimate ?? previous.estimatedHeight;
        const resized = Math.abs(estimatedHeight - previous.estimatedHeight) > 0.5;
        // A responsive row-size change invalidates old offscreen measurements too.
        const heights = resized ? new Map<string, number>() : new Map([...previous.heights].filter(([path]) => indexByPath.has(path)));
        let changed = resized || heights.size !== previous.heights.size;
        for (const row of current) if (Math.abs((heights.get(row.path) ?? 0) - row.height) > 0.5) { heights.set(row.path, row.height); changed = true; }
        return changed ? {heights, estimatedHeight} : previous;
      });
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    mountedRows.forEach(row => observer?.observe(row));
    return () => observer?.disconnect();
  });

  const reveal = useCallback((index: number, focus: boolean) => {
    const host = viewport.current, element = container.current, row = rows[index];
    if (!host || !element || !row) return;
    const offset = element.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop;
    const top = offsets[index], rowHeight = offsets[index + 1] - top, height = host.clientHeight || 560;
    const relativeTop = host.scrollTop - offset;
    if (top < relativeTop) host.scrollTop = offset + top;
    else if (top + rowHeight > relativeTop + height) host.scrollTop = offset + top + rowHeight - height;
    if (focus) pendingFocus.current = row.node.path;
    // Use the intended logical range immediately; focus must not wait for a browser scroll event.
    setWindowState({top: Math.max(0, host.scrollTop - offset), height});
  }, [rows, offsets]);

  useImperativeHandle(ref, () => ({navigate: key => reveal(key === 'End' ? rows.length - 1 : 0, true)}), [reveal, rows.length]);

  useLayoutEffect(() => {
    const path = renamingPath || selectedPath;
    if (path === lastReveal.current) return;
    const index = path ? indexByPath.get(path) : undefined;
    if (!path || index !== undefined) lastReveal.current = path;
    if (index !== undefined) reveal(index, false);
  }, [renamingPath, selectedPath, reveal, indexByPath]);

  useLayoutEffect(() => {
    const path = renamingPath || selectedPath;
    const previous = measuredReveal.current;
    measuredReveal.current = {path, estimatedHeight: measurements.estimatedHeight};
    if (!path || !previous || previous.path !== path || previous.estimatedHeight === measurements.estimatedHeight) return;
    const index = indexByPath.get(path);
    if (index !== undefined) reveal(index, false);
  }, [measurements.estimatedHeight, renamingPath, selectedPath, indexByPath, reveal]);

  const indexAt = (top: number) => {
    let low = 0, high = rows.length;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (offsets[middle + 1] <= top) low = middle + 1; else high = middle; }
    return Math.min(rows.length - 1, low);
  };
  const windowed = rows.length > LOCAL_TREE_WINDOW_THRESHOLD;
  const start = windowed ? Math.max(0, indexAt(windowState.top) - OVERSCAN) : 0;
  const end = windowed ? Math.min(rows.length, indexAt(windowState.top + windowState.height) + OVERSCAN + 1) : rows.length;
  const mounted = new Set(Array.from({length: Math.max(0, end - start)}, (_, index) => start + index));
  // Do not discard an in-progress rename or a focused menu owner during pointer scrolling.
  for (const path of [renamingPath, focusedPath, selectedPath]) {
    const index = path ? indexByPath.get(path) : undefined;
    if (index !== undefined) mounted.add(index);
  }

  useLayoutEffect(() => {
    const element = container.current;
    const focusPath = pendingFocus.current;
    if (element && focusPath) {
      const row = Array.from(element.querySelectorAll<HTMLElement>('[data-windowed-path]')).find(item => item.dataset.windowedPath === focusPath);
      row?.querySelector<HTMLButtonElement>('[data-explorer-focus="true"]')?.focus({preventScroll: true});
      pendingFocus.current = null;
    }
    if (previousCount.current !== rows.length) updateWindow();
    previousCount.current = rows.length;
  });

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return;
    const path = target.closest<HTMLElement>('[data-windowed-path]')?.dataset.windowedPath;
    const index = path ? indexByPath.get(path) ?? -1 : -1;
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'ArrowDown') next = Math.min(rows.length - 1, index + 1);
    else return;
    event.preventDefault(); event.stopPropagation(); reveal(next, true);
  };

  return <div ref={container} data-explorer-windowed={windowed ? 'true' : 'false'} style={{height: offsets[rows.length], position: 'relative'}} onKeyDown={navigate}
    onFocusCapture={event => setFocusedPath((event.target as HTMLElement).closest<HTMLElement>('[data-windowed-path]')?.dataset.windowedPath || null)}>
    {[...mounted].sort((a,b) => a-b).map(index => {
      const row = rows[index];
      const expandable = row.node.kind === 'directory' || Boolean(row.node.children?.length || row.node.canExpandVirtualChildren);
      return <div key={row.node.path} data-windowed-path={row.node.path} role="treeitem" aria-level={row.depth + 1} aria-selected={selectedPath === row.node.path}
        aria-posinset={row.siblingIndex + 1} aria-setsize={row.siblingCount} aria-expanded={expandable ? Boolean(row.node.isExpanded) : undefined}
        style={{position:'absolute',top:offsets[index],left:0,right:0}}>
        <TreeNodeComponent node={row.node} depth={row.depth} renderChildren={false}/>
      </div>;
    })}
  </div>;
});
