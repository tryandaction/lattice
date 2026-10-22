import { findPane, getAllPaneIds } from '@/lib/layout-utils';
import { getDesktopHandlePath } from '@/lib/desktop-file-system';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useContentCacheStore } from '@/stores/content-cache-store';
import { emitVaultChange } from '@/lib/plugins/runtime';
import { normalizeWorkspaceWritePath } from './workbench-actions';

export function createWorkspaceWriteGuard(root: FileSystemDirectoryHandle) {
  const matchingTabs = (path: string) => {
    const state = useWorkspaceStore.getState();
    const normalize = (value: string) => {
      const relative = normalizeWorkspaceWritePath(root, value);
      return getDesktopHandlePath(root) ? relative.toLowerCase() : relative;
    };
    return getAllPaneIds(state.layout.root).flatMap(id => findPane(state.layout.root, id)?.tabs ?? [])
      .filter(tab => { try { return normalize(tab.filePath) === normalize(path); } catch { return false; } });
  };
  return {
    beforeWrite(path: string) {
      if (useWorkspaceStore.getState().rootHandle !== root) throw new Error('工作区已切换，请回到原工作区后保存。');
      if (matchingTabs(path).some(tab => tab.isDirty || useContentCacheStore.getState().hasUnsavedChanges(tab.id))) {
        throw new Error('目标文件有未保存修改，请先保存或取消编辑后再应用建议。');
      }
    },
    async refresh(path: string, handle: FileSystemFileHandle) {
      if (useWorkspaceStore.getState().rootHandle !== root) return;
      const tabs = matchingTabs(path);
      if (tabs.length) {
        const content = await (await handle.getFile()).text();
        if (useWorkspaceStore.getState().rootHandle !== root) return;
        for (const tab of matchingTabs(path)) {
          const cache = useContentCacheStore.getState();
          if (!tab.isDirty && !cache.hasUnsavedChanges(tab.id)) cache.setContent(tab.id, content, content);
        }
      }
      emitVaultChange(path);
    },
  };
}
