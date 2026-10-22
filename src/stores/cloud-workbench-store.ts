"use client";

import { create } from "zustand";
import type { CloudLibraryWorkspaceController } from "@/lib/shared-library/cloud-workspace";
import { cloudScope } from "@/lib/shared-library/connection";
import { createCloudSourceProvider, type CloudLibrarySourceProvider } from "@/lib/shared-library/source-provider";
import type { Item, ItemKind, Library, LibraryRole } from "@/lib/shared-library/domain";
import type { SharedLibraryItemContent } from "@/lib/shared-library/content-store";
import type { CloudWorkspaceAnchor } from "@/lib/cloud-workspace-host";
import { setCloudWorkspaceProvider } from "@/lib/cloud-workspace-host";
import { cloudNavigationTarget } from "@/lib/shared-library/cloud-navigation";
import { cloudContentFromBytes, cloudFileKind } from "@/lib/shared-library/file-content";
import { persistCloudImportBatch, validateCloudImportBatch, type CloudImportFailure } from "@/lib/shared-library/cloud-import-batch";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import type { PaneId } from "@/types/layout";

export interface CloudWorkbenchState {
  active: boolean;
  managementOpen: boolean;
  controller: CloudLibraryWorkspaceController | null;
  provider: CloudLibrarySourceProvider | null;
  scope: string | null;
  libraryId: string;
  selectedFolderId?: string;
  revision: number;
  status: ReturnType<CloudLibraryWorkspaceController["getStatus"]> | null;
  role: LibraryRole | null;
  items: Item[];
  libraries: Library[];
  error: string | null;
  loading: boolean;
  openingItemId: string | null;
  uploading: boolean;
  uploadProgress: string;
  importFailures: CloudImportFailure[];
  pendingLocalUpload: LocalCloudUploadEntry | null;
  localUploadWarnings: string[];
  requestLocalUpload(entry: LocalCloudUploadEntry): void;
  dismissLocalUpload(): void;
  uploadLocalEntry(libraryId: string, parentItemId?: string): Promise<void>;
  setActive(active: boolean): void;
  setManagementOpen(open: boolean): void;
  setSelectedFolderId(id?: string): void;
  setError(error: unknown): void;
  bindController(controller: CloudLibraryWorkspaceController | null): void;
  selectLibrary(libraryId: string): Promise<void>;
  openItem(itemId: string, options?: { paneId?: PaneId; libraryId?: string; anchor?: CloudWorkspaceAnchor }): Promise<boolean>;
  refresh(): Promise<void>;
  uploadFiles(files: File[], parentItemId?: string | null): Promise<void>;
  cancelUpload(): void;
  createFolder(name: string, parentItemId?: string | null): Promise<Item>;
  createNote(name: string, parentItemId?: string | null): Promise<Item>;
  createFile(name: string, kind: ItemKind, content?: SharedLibraryItemContent, parentItemId?: string | null): Promise<Item>;
  renameItem(itemId: string, name: string): Promise<void>;
  moveItem(itemId: string, parentItemId?: string): Promise<void>;
  trashItem(itemId: string): Promise<void>;
  downloadItem(itemId: string): Promise<void>;
}
export interface LocalCloudUploadEntry {
  name: string;
  path: string;
  storagePath?: string;
  kind: "file" | "directory";
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  rootHandle: FileSystemDirectoryHandle;
}

let unsubscribeController: (() => void) | undefined;
let openSequence = 0;
let uploadCancelled = false;
let localUploadAbort: AbortController | null = null;
const parentOf = (item: Item) => typeof item.metadata.parentItemId === "string" ? item.metadata.parentItemId : undefined;

export const useCloudWorkbenchStore = create<CloudWorkbenchState>((set, get) => {
  function current() {
    const state = get();
    if (!state.controller || !state.provider || !state.scope) throw new Error("请先连接共享库。");
    return { ...state, controller: state.controller, provider: state.provider, scope: state.scope };
  }
  function assertIdentity(controller: CloudLibraryWorkspaceController) {
    if (get().controller !== controller || get().scope !== cloudScope(controller.connection, controller.userId)) throw new Error("云库账号或连接已切换，请重新打开文件。");
  }
  function project() {
    const { controller, libraryId } = get();
    if (!controller) return;
    const snapshot = controller.getSnapshot();
    set({ revision: get().revision + 1, libraries: snapshot.libraries, items: snapshot.revoked.includes(libraryId) ? [] : snapshot.items.filter(item => item.libraryId === libraryId && item.status !== "trashed"), role: snapshot.revoked.includes(libraryId) ? null : snapshot.roles[libraryId]?.role ?? null, status: controller.getStatus() });
  }
  async function action<T>(operation: () => Promise<T>): Promise<T> {
    set({ error: null });
    try { return await operation(); } catch (error) { get().setError(error); throw error; }
  }
  return {
    active: false, managementOpen: false, controller: null, provider: null, scope: null, libraryId: "", revision: 0, status: null, role: null, items: [], libraries: [], error: null, loading: false, openingItemId: null, uploading: false, uploadProgress: "", importFailures: [], pendingLocalUpload: null, localUploadWarnings: [],
    requestLocalUpload: pendingLocalUpload => set({ pendingLocalUpload, localUploadWarnings: [], error: null, ...(!get().controller ? { managementOpen: true } : {}) }),
    dismissLocalUpload: () => { if (!get().uploading) set({ pendingLocalUpload: null, localUploadWarnings: [] }); },
    uploadLocalEntry: (libraryId, parentItemId) => action(async () => {
      const { controller, pendingLocalUpload } = current();
      if (!pendingLocalUpload) throw new Error("没有选择本地文件。");
      if (get().uploading) throw new Error("已有文件正在上传。");
      set({ uploading: true, uploadProgress: `正在上传 ${pendingLocalUpload.name}…`, localUploadWarnings: [] });
      localUploadAbort = new AbortController();
      try {
        await controller.verifyAccess(libraryId); assertIdentity(controller);
        const { uploadLocalWorkspaceEntries } = await import("@/lib/shared-library/local-workspace-upload");
        const result = await uploadLocalWorkspaceEntries({ rootHandle: pendingLocalUpload.rootHandle, entries: [pendingLocalUpload], controller, libraryId, parentItemId, signal: localUploadAbort.signal });
        assertIdentity(controller); void controller.sync();
        set({ uploadProgress: `${result.items.length} 个条目及 ${result.annotationsImported} 条批注已加入同步队列`, localUploadWarnings: result.warnings, ...(result.warnings.length ? {} : { pendingLocalUpload: null }) });
      } finally { localUploadAbort = null; if (get().controller === controller) set({ uploading: false }); }
    }),
    setActive: active => set({ active }),
    setManagementOpen: managementOpen => set({ managementOpen }),
    setSelectedFolderId: selectedFolderId => set({ selectedFolderId }),
    setError: error => set({ error: error == null ? null : error instanceof Error ? error.message : String(error) }),
    bindController(controller) {
      unsubscribeController?.(); unsubscribeController = undefined; ++openSequence; uploadCancelled = true; localUploadAbort?.abort();
      const provider = controller ? createCloudSourceProvider(controller) : null;
      set({ controller, provider, scope: controller ? cloudScope(controller.connection, controller.userId) : null, libraryId: "", selectedFolderId: undefined, items: [], libraries: [], role: null, status: null, loading: false, openingItemId: null, uploading: false, uploadProgress: "", importFailures: [] });
      setCloudWorkspaceProvider(provider);
      if (controller) { unsubscribeController = controller.subscribe(project); project(); }
    },
    selectLibrary: libraryId => action(async () => {
      const { controller } = current(); set({ libraryId, selectedFolderId: undefined, loading: true }); project();
      try { if (libraryId) await controller.refreshLibrary(libraryId); assertIdentity(controller); project(); }
      finally { if (get().controller === controller) set({ loading: false }); }
    }),
    openItem: (itemId, options = {}) => action(async () => {
      const { controller, provider, scope } = current();
      const libraryId = options.libraryId ?? get().libraryId;
      const request = ++openSequence;
      set({ openingItemId: itemId });
      try {
        if (!controller.getSnapshot().items.some(item => item.id === itemId && item.libraryId === libraryId)) await controller.refreshLibrary(libraryId);
        const resource = await provider.read(libraryId, itemId);
        assertIdentity(controller); if (request !== openSequence) return false;
        if (resource.kind === "folder") { set({ selectedFolderId: itemId }); return true; }
        const item = controller.getSnapshot().items.find(item => item.id === itemId && item.libraryId === libraryId);
        set({ active: true, libraryId, selectedFolderId: item ? parentOf(item) : undefined }); project();
        const { useWorkspaceStore } = await import("@/stores/workspace-store");
        assertIdentity(controller); if (request !== openSequence) return false;
        const workspace = useWorkspaceStore.getState(); const paneId = options.paneId ?? workspace.layout.activePaneId;
        workspace.openCloudFileInPane(paneId, resource, scope);
        const target = cloudNavigationTarget(resource, options.anchor);
        if (target) useLinkNavigationStore.getState().setPendingNavigation(paneId, { filePath: resource.path, target });
        return true;
      } finally { if (request === openSequence) set({ openingItemId: null }); }
    }),
    refresh: () => action(async () => { const { controller, libraryId } = current(); await controller.refreshLibraries(); if (libraryId) await controller.refreshLibrary(libraryId); await controller.sync(); assertIdentity(controller); project(); }),
    cancelUpload: () => { uploadCancelled = true; localUploadAbort?.abort(); },
    uploadFiles: (files, requestedParent) => action(async () => {
      if (!files.length) return;
      if (get().uploading) throw new Error("正在添加文件，请稍后再上传。");
      const { controller, libraryId, selectedFolderId } = current(); const parentId = requestedParent === undefined ? selectedFolderId : requestedParent ?? undefined;
      if (!libraryId) throw new Error("请先选择小组库。");
      set({ uploading: true, uploadProgress: "正在添加文件…", importFailures: [] }); uploadCancelled = false;
      try {
        validateCloudImportBatch(files, controller.connection.maxFileBytes);
        const usage = navigator.onLine ? await controller.usage(libraryId) : undefined;
        const paths = validateCloudImportBatch(files, Math.min(controller.connection.maxFileBytes, usage?.maxFileBytes ?? Infinity), usage ? usage.maxStorageBytes - usage.usedBytes - usage.reservedBytes : undefined);
        assertIdentity(controller); const directories = new Map<string, string>(); let completed = 0;
        const result = await persistCloudImportBatch(files, paths, async (file, path) => {
          const content = cloudContentFromBytes(file.name, await file.arrayBuffer(), file.type, new Date().toISOString());
          assertIdentity(controller); if (uploadCancelled) throw new Error("上传已暂停。");
          const parts = path.split("/"); let parent = parentId;
          for (let depth = 0; depth < parts.length - 1; depth++) {
            const directoryPath = parts.slice(0, depth + 1).join("/");
            const existing = controller.getSnapshot().items.find(item => item.libraryId === libraryId && item.kind === "folder" && parentOf(item) === parent && item.canonicalName === parts[depth] && item.status === "active");
            let id = directories.get(directoryPath) ?? existing?.id;
            if (!id) id = (await controller.createItem({ libraryId, name: parts[depth], kind: "folder", parentItemId: parent })).id;
            directories.set(directoryPath, id); parent = id;
          }
          await controller.createItem({ libraryId, name: parts.at(-1)!, kind: cloudFileKind(file.name, file.type), parentItemId: parent }, content);
          set({ uploadProgress: `正在添加 ${++completed}/${files.length} 个文件` });
        }, () => uploadCancelled || get().controller !== controller);
        assertIdentity(controller); set({ importFailures: result.failures, uploadProgress: result.failures.length ? `${result.completed} 个已添加，${result.failures.length} 个未添加` : `${result.completed} 个文件已添加` }); void controller.sync();
      } finally { if (get().controller === controller) set({ uploading: false }); }
    }),
    createFolder: (name, parentItemId) => get().createFile(name, "folder", undefined, parentItemId),
    createNote: (name, parentItemId) => get().createFile(name, "markdown", { kind: "text", text: `# ${name.replace(/\.(?:md|markdown)$/i, "")}\n`, mimeType: "text/markdown", updatedAt: new Date().toISOString() }, parentItemId),
    createFile: (name, kind, content, parentItemId) => action(async () => { const { controller, libraryId, selectedFolderId } = current(); const item = await controller.createItem({ libraryId, name, kind, parentItemId: parentItemId === undefined ? selectedFolderId : parentItemId ?? undefined }, content); assertIdentity(controller); void controller.sync(); return item; }),
    renameItem: (itemId, name) => action(async () => { const { controller, libraryId, items } = current(); const item = items.find(item => item.id === itemId); if (!item) throw new Error("文件不存在。"); await controller.updateItem(libraryId, itemId, name, parentOf(item)); assertIdentity(controller); void controller.sync(); }),
    moveItem: (itemId, parentItemId) => action(async () => { const { controller, libraryId, items } = current(); const item = items.find(item => item.id === itemId); if (!item) throw new Error("文件不存在。"); await controller.updateItem(libraryId, itemId, item.canonicalName, parentItemId); assertIdentity(controller); void controller.sync(); }),
    trashItem: itemId => action(async () => { const { controller, libraryId } = current(); await controller.trashItem(libraryId, itemId); assertIdentity(controller); void controller.sync(); }),
    downloadItem: itemId => action(async () => { const { controller, provider, libraryId } = current(); const resource = await provider.read(libraryId, itemId); assertIdentity(controller); if (!resource.content) throw new Error("文件内容不可用。"); const data = resource.content.kind === "binary" ? resource.content.data : resource.content.text; const url = URL.createObjectURL(new Blob([data], { type: resource.content.mimeType })); const link = document.createElement("a"); link.href = url; link.download = resource.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }),
  };
});
