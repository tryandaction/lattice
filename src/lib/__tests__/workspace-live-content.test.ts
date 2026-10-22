import { beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateCleanWorkspaceFiles, refreshCleanWorkspaceFile, relocateCleanWorkspaceFiles, relocateCleanWorkspaceFilesForRenames } from "@/lib/workspace-live-content";
import { getWorkspaceFileRevision } from "@/lib/workspace-file-revisions";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { FileTabState } from "@/types/layout";

function tab(id: string, path: string, text = "disk"): FileTabState {
  return { id, fileName: path.split("/").pop()!, filePath: path, scrollPosition: 42, isDirty: false,
    fileHandle: { getFile: async () => ({ text: async () => text }) } as unknown as FileSystemFileHandle };
}
function mount(tabs: FileTabState[]) {
  useWorkspaceStore.setState({ layout: { activePaneId: "pane", root: { type: "pane", id: "pane", tabs, activeTabIndex: 0 } } });
}
beforeEach(() => useContentCacheStore.getState().clearCache());

describe("external content changes", () => {
  it("invalidates a changed binary without reading its potentially large bytes into JavaScript", async () => {
    const binary = tab("pdf-sync", "root/paper.pdf");
    const read = vi.fn();
    binary.fileHandle = { getFile: read } as unknown as FileSystemFileHandle;
    mount([binary]);
    expect(await refreshCleanWorkspaceFile(binary, () => true)).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(getWorkspaceFileRevision(binary.id)).toBeGreaterThan(0);
  });
  it("refreshes clean text while preserving editor position and all dirty drafts", async () => {
    const clean = tab("clean-sync", "root/clean.txt", "new disk");
    const dirty = tab("dirty-sync", "root/dirty.txt", "external");
    mount([clean, dirty]);
    const cache = useContentCacheStore.getState();
    cache.setContent(clean.id, "old", "old");
    cache.saveEditorState(clean.id, { cursorPosition: 6, scrollTop: 240 });
    cache.setContent(dirty.id, "my draft", "original");
    expect(await refreshCleanWorkspaceFile(clean, () => true)).toBe(true);
    expect(await refreshCleanWorkspaceFile(dirty, () => true)).toBe(false);
    expect(cache.getContent(clean.id)?.content).toBe("new disk");
    expect(cache.getEditorState(clean.id)?.scrollTop).toBe(240);
    expect(cache.getContent(dirty.id)?.content).toBe("my draft");
    expect(getWorkspaceFileRevision(clean.id)).toBeGreaterThan(0);
    expect(useWorkspaceStore.getState().layout.root).toMatchObject({ tabs: [{ scrollPosition: 42 }, { scrollPosition: 42 }] });
  });

  it("does not overwrite a draft created while an external read was pending", async () => {
    let release!: (value: string) => void;
    const pending = new Promise<string>(resolve => { release = resolve; });
    const file = tab("racing-sync", "root/notes.md");
    file.fileHandle = { getFile: async () => ({ text: () => pending }) } as unknown as FileSystemFileHandle;
    mount([file]);
    const operation = refreshCleanWorkspaceFile(file, () => true);
    useContentCacheStore.getState().setContent(file.id, "new user draft", "old");
    release("disk replacement");
    expect(await operation).toBe(false);
    expect(useContentCacheStore.getState().getContent(file.id)?.content).toBe("new user draft");
  });

  it("moves clean child tabs after a directory rename and preserves dirty child tabs", async () => {
    const clean = tab("renamed-clean", "root/old/clean.txt");
    const dirty = tab("renamed-dirty", "root/old/dirty.txt");
    mount([clean, dirty]);
    useContentCacheStore.getState().setContent(dirty.id, "draft", "old");
    const next = {} as FileSystemFileHandle;
    const root = { name: "root", getDirectoryHandle: async () => ({ getFileHandle: async () => next }) } as unknown as FileSystemDirectoryHandle;
    await relocateCleanWorkspaceFiles(root, "root/old", "root/new", () => true);
    expect(useWorkspaceStore.getState().layout.root).toMatchObject({ tabs: [
      { filePath: "root/new/clean.txt", fileHandle: next, scrollPosition: 42 },
      { filePath: "root/old/dirty.txt", scrollPosition: 42 },
    ] });
    expect(invalidateCleanWorkspaceFiles(["root/old"])).toEqual([]);
  });

  it('binds swapped file paths to their original tabs once for the complete rename batch', async () => {
    const first = tab('swap-first', 'root/a.txt'), second = tab('swap-second', 'root/b.txt');
    mount([first, second]);
    const firstHandle = {} as FileSystemFileHandle, secondHandle = {} as FileSystemFileHandle;
    const root = { name: 'root', getFileHandle: async (name: string) => name === 'b.txt' ? firstHandle : secondHandle } as FileSystemDirectoryHandle;
    await relocateCleanWorkspaceFilesForRenames(root, [
      { from: 'root/a.txt', to: 'root/temporary.txt' },
      { from: 'root/b.txt', to: 'root/a.txt' },
      { from: 'root/temporary.txt', to: 'root/b.txt' },
    ], () => true);
    expect(useWorkspaceStore.getState().layout.root).toMatchObject({ tabs: [
      { id: first.id, filePath: 'root/b.txt', fileHandle: firstHandle, scrollPosition: 42 },
      { id: second.id, filePath: 'root/a.txt', fileHandle: secondHandle, scrollPosition: 42 },
    ] });
  });

  it('retains a draft created after one rename resolved while the rest of the batch was pending', async () => {
    const first = tab('batch-new-draft', 'root/first.txt'), second = tab('batch-clean', 'root/second.txt');
    mount([first, second]);
    const root = { name: 'root', getFileHandle: async (name: string) => {
      if (name === 'second-new.txt') useContentCacheStore.getState().setContent(first.id, 'new draft', 'old');
      return {} as FileSystemFileHandle;
    } } as FileSystemDirectoryHandle;
    await relocateCleanWorkspaceFilesForRenames(root, [
      { from: 'root/first.txt', to: 'root/first-new.txt' },
      { from: 'root/second.txt', to: 'root/second-new.txt' },
    ], () => true);
    expect(useWorkspaceStore.getState().layout.root).toMatchObject({ tabs: [
      { id: first.id, filePath: 'root/first.txt', fileHandle: first.fileHandle },
      { id: second.id, filePath: 'root/second-new.txt' },
    ] });
    expect(useContentCacheStore.getState().getContent(first.id)?.content).toBe('new draft');
  });
});
