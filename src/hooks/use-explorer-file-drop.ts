'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { useFileSystem } from '@/hooks/use-file-system';
import { useI18n } from '@/hooks/use-i18n';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { resolveDirectoryHandle } from '@/lib/file-operations';
import { captureExternalDrop, hasExternalFileDrop, hasInternalEntryDrop, importDroppedEntries, parseExplorerEntryDrop } from '@/lib/explorer-file-drop';
import { useExplorerStore } from '@/stores/explorer-store';

/** One import boundary around the existing local Explorer; shared trees own their drops. */
export function useExplorerFileDrop() {
  const { t } = useI18n();
  const root = useWorkspaceStore(state => state.rootHandle);
  const { refreshDirectory, ensureDirectoryExpanded, copyEntry, moveEntry } = useFileSystem({ subscribeToTree: false });
  const [hovered, setHovered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setHovered(null);
    setBusy(false);
    return () => { controller.current?.abort(); controller.current = null; };
  }, [root]);

  const targetPath = useCallback((element: EventTarget | null) => {
    const row = element instanceof Element ? element.closest<HTMLElement>('[data-explorer-drop-directory]') : null;
    return row?.dataset.explorerDropDirectory ?? useWorkspaceStore.getState().fileTree.root?.path ?? root?.name ?? '';
  }, [root]);
  const onDragOverCapture = useCallback((event: DragEvent<HTMLElement>) => {
    if (!root || !hasExternalFileDrop(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy';
    setHovered(targetPath(event.target));
  }, [root, targetPath]);
  const onDropCapture = useCallback((event: DragEvent<HTMLElement>) => {
    if (!root || !hasExternalFileDrop(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation();
    const path = targetPath(event.target);
    setHovered(null);
    if (controller.current) return;
    const entries = captureExternalDrop(event.dataTransfer);
    const task = new AbortController(); controller.current = task; setBusy(true);
    void (async () => {
      try {
        const target = await resolveDirectoryHandle(root, path);
        if (!target) throw new Error(t('explorer.drop.targetMissing'));
        const report = await importDroppedEntries(target, await entries, task.signal);
        if (task.signal.aborted || useWorkspaceStore.getState().rootHandle !== root) return;
        await refreshDirectory({ silent: true });
        await ensureDirectoryExpanded(report.containerName ? `${path}/${report.containerName}` : path);
        if (report.errors.length) toast.error(t('explorer.drop.failed', { count: report.errors.length }), { description: report.errors[0] });
        if (report.imported.length) toast.success(t('explorer.drop.imported', { count: report.imported.length }), report.containerName
          ? { description: t('explorer.drop.browserIsolated', { path: `${path}/${report.containerName}` }) } : undefined);
      } catch (error) {
        if (!task.signal.aborted) toast.error(t('explorer.drop.error'), { description: error instanceof Error ? error.message : String(error) });
      } finally { if (controller.current === task) { controller.current = null; setBusy(false); } }
    })();
  }, [ensureDirectoryExpanded, refreshDirectory, root, t, targetPath]);
  // Row handlers stop propagation when they own a drop (folder/PDF child).
  // Remaining local drops land in the root or the ordinary file's parent.
  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!root || !hasInternalEntryDrop(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = event.ctrlKey || event.metaKey ? 'copy' : 'move';
    setHovered(targetPath(event.target));
  }, [root, targetPath]);
  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    if (!root || !hasInternalEntryDrop(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation(); setHovered(null);
    const source = parseExplorerEntryDrop(event.dataTransfer), path = targetPath(event.target);
    if (!source || source.path === path || path.startsWith(source.path + '/') || controller.current) return;
    const copy = event.ctrlKey || event.metaKey;
    const task = new AbortController(); controller.current = task; setBusy(true);
    void (async () => {
      try {
        const report = await (copy ? copyEntry : moveEntry)(source.path, path);
        if (task.signal.aborted || useWorkspaceStore.getState().rootHandle !== root) return;
        if (!report.success || !report.path) throw new Error(report.error || t('explorer.move.failed'));
        if (!copy) {
          const state = useWorkspaceStore.getState();
          if (source.kind === 'directory') state.updateTabPathPrefix(source.path, report.path);
          else if (report.handle?.kind === 'file') state.updateTabFile(source.path, report.path, report.handle as FileSystemFileHandle);
          else state.updateTabPath(source.path, report.path);
        }
        useExplorerStore.getState().setSelection(report.path, source.kind);
        await ensureDirectoryExpanded(path);
      } catch (error) {
        if (!task.signal.aborted) toast.error(error instanceof Error ? error.message : t('explorer.move.failed'));
      } finally { if (controller.current === task) { controller.current = null; setBusy(false); } }
    })();
  }, [copyEntry, ensureDirectoryExpanded, moveEntry, root, t, targetPath]);
  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setHovered(null);
  }, []);
  return { hovered, busy, onDragOverCapture, onDropCapture, onDragLeave, onDragOver, onDrop };
}
