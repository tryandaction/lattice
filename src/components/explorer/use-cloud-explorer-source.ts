"use client";

import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";
import type { Item } from "@/lib/shared-library/domain";
import type { ExplorerCreateKind, ExplorerSourceAdapter, ExplorerSourceNode } from "./explorer-source";

const parentId = (item: Item) => typeof item.metadata.parentItemId === "string" ? item.metadata.parentItemId : undefined;
const ROOT_ID = "lattice-cloud-root";

function uniqueName(items: Item[], parent: string | undefined, desired: string) {
  const existing = new Set(items.filter(item => parentId(item) === parent).map(item => item.canonicalName.toLocaleLowerCase()));
  if (!existing.has(desired.toLocaleLowerCase())) return desired;
  const dot = desired.lastIndexOf("."); const stem = dot > 0 ? desired.slice(0, dot) : desired; const suffix = dot > 0 ? desired.slice(dot) : "";
  let index = 2;
  while (existing.has(`${stem} ${index}${suffix}`.toLocaleLowerCase())) index += 1;
  return `${stem} ${index}${suffix}`;
}

/** Cloud projects enter the same Explorer, with source identity kept out of local FS. */
export function useCloudExplorerSource(): ExplorerSourceAdapter | null {
  const state = useCloudWorkbenchStore(useShallow(value => ({
    active: value.active, scope: value.scope, libraryId: value.libraryId, role: value.role,
    selectedFolderId: value.selectedFolderId, items: value.items, libraries: value.libraries,
    loading: value.loading, uploading: value.uploading, error: value.error,
  })));
  const sourceId = `cloud:${state.scope ?? "disconnected"}:${state.libraryId}`;
  const [selection, setSelection] = useState<{ sourceId: string; nodeId: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, ReadonlySet<string>>>({});
  const sourceExpanded = expanded[sourceId];
  const root = useMemo<ExplorerSourceNode | null>(() => {
    if (!state.libraryId) return null;
    const nodes = new Map<string, ExplorerSourceNode>();
    const itemsById = new Map(state.items.map(item => [item.id, item]));
    for (const item of state.items) nodes.set(item.id, {
      id: item.id, name: item.canonicalName || item.title, kind: item.kind === "folder" ? "directory" : "file",
      extension: item.canonicalName.split(".").at(-1), children: [], childrenState: "ready", isExpanded: sourceExpanded?.has(item.id) ?? false,
    });
    const libraryRoot: ExplorerSourceNode = { id: ROOT_ID, name: state.libraries.find(library => library.id === state.libraryId)?.name ?? "云端文件夹", kind: "directory", children: [], isExpanded: !sourceExpanded?.has(ROOT_ID), childrenState: "ready" };
    for (const item of state.items) {
      const node = nodes.get(item.id)!; const parent = parentId(item); const parentNode = parent ? nodes.get(parent) : undefined;
      // Reject cycles instead of making a recursive rendering graph.
      const ancestors = new Set([item.id]); let ancestor = parent; let cycle = false;
      while (ancestor) { if (ancestors.has(ancestor)) { cycle = true; break; } ancestors.add(ancestor); const item = itemsById.get(ancestor); ancestor = item ? parentId(item) : undefined; }
      (parentNode && !cycle ? parentNode : libraryRoot).children!.push(node);
    }
    const sort = (node: ExplorerSourceNode) => {
      node.children?.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name));
      node.children?.forEach(sort);
    };
    sort(libraryRoot);
    return libraryRoot;
  }, [state.items, state.libraries, state.libraryId, sourceExpanded]);
  const writable = state.role === "owner" || state.role === "admin" || state.role === "editor";
  if (!state.active) return null;
  const parent = (node: ExplorerSourceNode) => node.id === ROOT_ID ? null : node.id;
  const store = () => {
    const current = useCloudWorkbenchStore.getState();
    if (current.scope !== state.scope || current.libraryId !== state.libraryId) throw new Error("云端账号或文件夹已切换，请重新选择文件。");
    return current;
  };
  const select = (node: ExplorerSourceNode) => {
    setSelection({ sourceId, nodeId: node.id });
    if (node.kind === "directory") store().setSelectedFolderId(node.id === ROOT_ID ? undefined : node.id);
    else { const item = state.items.find(item => item.id === node.id); store().setSelectedFolderId(item ? parentId(item) : undefined); }
  };
  const openParent = (node: ExplorerSourceNode) => {
    if (node.id === ROOT_ID) return;
    setExpanded(current => ({ ...current, [sourceId]: new Set([...(current[sourceId] ?? []), node.id]) }));
  };
  const create = async (kind: ExplorerCreateKind, target: ExplorerSourceNode) => {
    if (!writable) throw new Error("当前小组库为只读，不能新建文件。");
    const parentItemId = parent(target);
    const name = uniqueName(state.items, parentItemId ?? undefined, kind === "directory" ? "New Folder" : kind === "notebook" ? "Untitled.ipynb" : kind === "note" ? "Untitled.md" : "untitled.txt");
    const created = kind === "directory" ? await store().createFolder(name, parentItemId)
      : kind === "note" ? await store().createNote(name, parentItemId)
        : await store().createFile(name, kind === "notebook" ? "notebook" : "data", {
          kind: "text", text: kind === "notebook" ? JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }) : "",
          mimeType: kind === "notebook" ? "application/x-ipynb+json" : "text/plain", updatedAt: new Date().toISOString(),
        }, parentItemId);
    openParent(target); setSelection({ sourceId, nodeId: created.id });
    if (kind === "directory") store().setSelectedFolderId(created.id);
    else await store().openItem(created.id);
  };
  return {
    id: sourceId, label: state.scope ? "请选择云端文件夹" : "请连接云端文件夹", root,
    selectedId: selection?.sourceId === sourceId ? selection.nodeId : state.selectedFolderId ?? ROOT_ID,
    loading: state.loading || state.uploading, error: state.error, readOnly: !writable,
    select, toggle: node => setExpanded(current => { const next = new Set(current[sourceId] ?? []); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return { ...current, [sourceId]: next }; }),
    open: node => store().openItem(node.id), refresh: () => store().refresh(),
    rename: writable ? (node, name) => store().renameItem(node.id, name) : undefined,
    remove: writable ? node => store().trashItem(node.id) : undefined,
    create: writable ? create : undefined,
    upload: writable ? async (files, target) => {
      if (files.some(file => /\.pdf$/i.test(file.name))) toast.info("要同时上传批注与子文件，请从本地 PDF 右键上传到云端库。");
      await store().uploadFiles(files, parent(target)); openParent(target);
    } : undefined,
    move: writable ? async (node, target) => { await store().moveItem(node.id, parent(target) ?? undefined); openParent(target); } : undefined,
    download: node => store().downloadItem(node.id),
  };
}
