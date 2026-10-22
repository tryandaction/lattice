"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { ChevronDown, ChevronRight, CircleAlert, Folder, FolderOpen, Loader2 } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";
import { DeleteConfirmDialog, FileContextMenu } from "./file-context-menu";
import { ExplorerFileIcon, ExplorerTreeRow } from "./tree-row";
import { findSourceNode, type ExplorerSourceAdapter, type ExplorerSourceNode } from "./explorer-source";

const SOURCE_DRAG_MIME = "application/x-lattice-source-entry";

export function SourceTreeNode({ node, source, depth }: { node: ExplorerSourceNode; source: ExplorerSourceAdapter; depth: number }) {
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(node.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const renamingPending = useRef(false);
  const folder = node.kind === "directory";
  const expandable = folder || Boolean(node.children?.length);
  const writable = !source.readOnly && !busy;
  const isRoot = source.root?.id === node.id;
  const canRename = writable && !isRoot && Boolean(source.rename);
  const canDelete = writable && !isRoot && Boolean(source.remove);
  const Chevron = node.isExpanded ? ChevronDown : ChevronRight;
  const FolderIcon = node.isExpanded ? FolderOpen : Folder;

  useEffect(() => {
    if (!renaming || !input.current) return;
    input.current.focus();
    const initialName = input.current.value;
    const extension = folder ? -1 : initialName.lastIndexOf(".");
    input.current.setSelectionRange(0, extension > 0 ? extension : initialName.length);
  }, [renaming, folder]); // Keep selection while the user edits the name.

  const run = async (action: () => void | Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const beginRename = () => { if (canRename) { setName(node.name); setError(null); setRenaming(true); } };
  const rename = async () => {
    if (!canRename || renamingPending.current) return;
    const next = name.trim();
    if (!next) { setError("名称不能为空"); return; }
    if (next === node.name) { setRenaming(false); return; }
    renamingPending.current = true;
    await run(async () => { await source.rename?.(node, next); setRenaming(false); });
    renamingPending.current = false;
  };
  const draggedNode = (event: DragEvent) => {
    try {
      const raw = event.dataTransfer.getData(SOURCE_DRAG_MIME);
      if (!raw) return null;
      const payload = JSON.parse(raw) as { sourceId?: string; nodeId?: string };
      if (payload.sourceId !== source.id || typeof payload.nodeId !== "string") return null;
      const dragged = findSourceNode(source.root, payload.nodeId);
      return dragged && dragged.id !== node.id && !findSourceNode(dragged, node.id) ? dragged : null;
    } catch { return null; }
  };
  const acceptDrop = (event: DragEvent) => folder && writable && (
    Boolean(source.upload && Array.from(event.dataTransfer.types ?? []).includes("Files")) ||
    Boolean(source.move && (draggedNode(event) || Array.from(event.dataTransfer.types ?? []).includes(SOURCE_DRAG_MIME)))
  );

  return <>
    {renaming ? <div className="flex flex-col px-2 py-0.5" style={{ paddingLeft: depth * 12 + (folder ? 4 : 8) }}>
      <input ref={input} data-explorer-rename-input="true" aria-label={t("explorer.context.rename")} value={name}
        onChange={event => { setName(event.target.value); setError(null); }} onBlur={() => void rename()}
        onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); void rename(); } else if (event.key === "Escape") { event.preventDefault(); setRenaming(false); setError(null); } }}
        className="min-w-0 flex-1 rounded border bg-background px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
    </div> : <div className="relative">
    {!folder && expandable ? <button type="button" aria-label={node.isExpanded ? t("explorer.pdf.collapseChildren") : t("explorer.pdf.expandChildren")}
      className="absolute top-1 z-10 flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground" style={{ left: depth * 12 + 8 }}
      onClick={event => { event.stopPropagation(); void run(() => source.toggle(node)); }}><Chevron className="h-4 w-4" /></button> : null}
    <ExplorerTreeRow depth={depth} directory={folder} selected={source.selectedId === node.id}
      aria-expanded={expandable ? Boolean(node.isExpanded) : undefined} aria-busy={busy || node.childrenState === "loading"}
      data-source-id={source.id} data-source-node-id={node.id} draggable={writable && !isRoot && Boolean(source.move)}
      onFocus={() => source.select(node)}
      onClick={() => { source.select(node); void run(() => folder ? source.toggle(node) : source.open(node)); }}
      onKeyDown={event => {
        if (event.key === "F2") { event.preventDefault(); event.stopPropagation(); beginRename(); }
        else if (event.key === "Delete" && canDelete) { event.preventDefault(); setConfirmDelete(true); }
        else if (expandable && (event.key === "ArrowRight" && !node.isExpanded || event.key === "ArrowLeft" && node.isExpanded)) { event.preventDefault(); void run(() => source.toggle(node)); }
      }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); source.select(node); setContextMenu({ x: event.clientX, y: event.clientY }); }}
      onDragStart={event => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(SOURCE_DRAG_MIME, JSON.stringify({ sourceId: source.id, nodeId: node.id })); source.select(node); }}
      onDragOver={event => { if (acceptDrop(event)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)} onDragEnd={() => setDragOver(false)}
      onDrop={event => {
        setDragOver(false);
        if (!folder || !writable) return;
        const files = Array.from(event.dataTransfer.files ?? []);
        if (files.length && source.upload) { event.preventDefault(); void run(() => source.upload!(files, node)); return; }
        const dragged = draggedNode(event);
        if (dragged && source.move) { event.preventDefault(); void run(() => source.move!(dragged, node)); }
      }}
      className={cn("hover:bg-accent/50 focus:bg-accent focus:outline-none", dragOver && "bg-primary/10 ring-1 ring-primary/50", busy && "animate-pulse")}
    >
      {folder ? <><Chevron className="h-4 w-4 shrink-0 text-muted-foreground" /><FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" /></>
        : <><span className="w-4 shrink-0" /><ExplorerFileIcon extension={node.extension ?? node.name.split(".").at(-1) ?? ""} className="h-4 w-4 shrink-0 text-muted-foreground" /></>}
      <span className={cn("truncate", folder && "font-medium")}>{node.name}</span>
      {node.childrenState === "loading" ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
        : node.childrenState === "error" ? <CircleAlert className="ml-auto h-3.5 w-3.5 text-destructive" />
          : folder ? <span className="ml-auto font-scientific text-muted-foreground">{node.children?.length ?? 0}</span> : null}
    </ExplorerTreeRow></div>}
    {(error || node.error) && <p role="alert" className="px-3 py-1 text-xs text-destructive">{error ?? node.error}</p>}
    {expandable && node.isExpanded ? <div className="animate-in fade-in-0 slide-in-from-top-1 duration-150">
      {node.children?.map(child => <SourceTreeNode key={child.id} node={child} source={source} depth={depth + 1} />)}
    </div> : null}
    {contextMenu && <FileContextMenu {...contextMenu} isDirectory={folder} canRename={canRename} canDelete={canDelete}
      onRename={beginRename} onDelete={() => { if (canDelete) setConfirmDelete(true); }} onClose={() => setContextMenu(null)}
      onNewFile={folder && writable && source.create ? () => void run(() => source.create!("file", node)) : undefined}
      onNewFolder={folder && writable && source.create ? () => void run(() => source.create!("directory", node)) : undefined}
      actions={!folder ? [
        { label: t("explorer.context.openInLattice"), onSelect: () => void run(() => source.open(node)) },
        ...(source.download ? [{ label: "下载", onSelect: () => void run(() => source.download!(node)) }] : []),
      ] : []} />}
    {confirmDelete && <DeleteConfirmDialog fileName={node.name} itemType={folder ? "folder" : "file"}
      onCancel={() => setConfirmDelete(false)} onConfirm={() => { if (canDelete) void run(async () => { await source.remove?.(node); setConfirmDelete(false); }); }} />}
  </>;
}
