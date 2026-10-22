/**
 * Shared Library web shell store.
 *
 * UI-facing state for the library shell: the list of libraries, the items of
 * the active library, and the currently open item. All reads/writes go
 * through an injected `SharedLibraryRepository` — components never touch
 * transport or storage directly. The factory form lets tests supply a
 * deterministic in-memory repository; the default instance backs the Web
 * route with the local in-memory repository until a cloud client is bound.
 */

import { create } from "zustand";
import type { Annotation, AnnotationComment, Item, Library } from "@/lib/shared-library/domain";
import type {
  CreateItemInput,
  CreateLibraryInput,
  CreateAnnotationInput,
  CreateCommentInput,
  SharedLibraryRepository,
} from "@/lib/shared-library/repository";
import { PersistentSharedLibraryRepository } from "@/lib/shared-library/local-repository";
import {
  getSharedLibraryContentStore,
  type SharedLibraryContentStore,
  type SharedLibraryItemContent,
} from "@/lib/shared-library/content-store";

export interface SharedLibraryState {
  libraries: Library[];
  items: Item[];
  activeLibraryId: string | null;
  activeItemId: string | null;
  isLoading: boolean;
  error: string | null;
  annotationsByItemId: Record<string, Annotation[]>;
  commentsByAnnotationId: Record<string, AnnotationComment[]>;
}

export interface SharedLibraryActions {
  loadLibraries: () => Promise<void>;
  openLibrary: (libraryId: string) => Promise<void>;
  openItem: (itemId: string) => void;
  closeItem: () => void;
  closeLibrary: () => void;
  createLibrary: (input: CreateLibraryInput) => Promise<Library>;
  createItem: (input: CreateItemInput) => Promise<Item>;
  createItemWithContent: (input: CreateItemInput, content: SharedLibraryItemContent) => Promise<Item>;
  saveItemContent: (itemId: string, content: SharedLibraryItemContent) => Promise<Item>;
  ensureCurrentVersion: (itemId: string) => Promise<string>;
  loadAnnotations: (itemId: string) => Promise<void>;
  createAnnotation: (input: CreateAnnotationInput) => Promise<Annotation>;
  loadComments: (annotationId: string) => Promise<void>;
  createComment: (input: CreateCommentInput) => Promise<AnnotationComment>;
}

export type SharedLibraryStore = SharedLibraryState & SharedLibraryActions;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sha256Content(content: SharedLibraryItemContent): Promise<string> {
  const bytes = content.kind === "text"
    ? new TextEncoder().encode(content.text)
    : new Uint8Array(content.data);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  return `local-${bytes.byteLength}`;
}

export function createSharedLibraryStore(
  repository: SharedLibraryRepository,
  options: { contentStore?: SharedLibraryContentStore } = {},
) {
  const contentStore = options.contentStore ?? getSharedLibraryContentStore();
  const contentSaveTails = new Map<string, Promise<void>>();
  const commentLoadInFlight = new Map<string, Promise<void>>();
  const loadedCommentAnnotations = new Set<string>();
  return create<SharedLibraryStore>((set) => ({
    libraries: [],
    items: [],
    activeLibraryId: null,
    activeItemId: null,
    isLoading: false,
    error: null,
    annotationsByItemId: {},
    commentsByAnnotationId: {},

    async loadLibraries() {
      set({ isLoading: true, error: null });
      try {
        const libraries = await repository.listLibraries();
        set({ libraries });
      } catch (error) {
        set({ error: toErrorMessage(error) });
      } finally {
        set({ isLoading: false });
      }
    },

    async openLibrary(libraryId) {
      set({ activeLibraryId: libraryId, activeItemId: null, items: [], error: null });
      set({ isLoading: true });
      try {
        const items = await repository.listItems({ libraryId });
        set({ items });
      } catch (error) {
        set({ error: toErrorMessage(error) });
      } finally {
        set({ isLoading: false });
      }
    },

    openItem: (itemId) => set({ activeItemId: itemId }),
    closeItem: () => set({ activeItemId: null }),
    closeLibrary: () => set({ activeLibraryId: null, activeItemId: null, items: [] }),

    async createLibrary(input) {
      const library = await repository.createLibrary(input);
      set((state) => ({ libraries: [...state.libraries, library] }));
      return library;
    },

    async createItem(input) {
      const item = await repository.createItem(input);
      set((state) => ({ items: [...state.items, item] }));
      return item;
    },

    async createItemWithContent(input, content) {
      const item = await repository.createItem(input);
      try {
        await contentStore.put(item.id, content);
        const bytes = content.kind === "text" ? new TextEncoder().encode(content.text) : new Uint8Array(content.data);
        const digest = await sha256Content(content);
        const version = await repository.createVersion({
          itemId: item.id,
          manifest: { mimeType: content.mimeType, sizeBytes: bytes.byteLength },
          contentHash: digest,
        });
        const versionedItem = { ...item, currentVersionId: version.id, contentHash: digest };
        set((state) => ({ items: [...state.items, versionedItem] }));
        return versionedItem;
      } catch (error) {
        await contentStore.remove(item.id).catch(() => undefined);
        await repository.trashItem(item.id).catch(() => undefined);
        throw error;
      }
    },

    async saveItemContent(itemId, content) {
      const previousTail = contentSaveTails.get(itemId) ?? Promise.resolve();
      let resolveTail: (() => void) | undefined;
      const nextTail = new Promise<void>((resolve) => { resolveTail = resolve; });
      const queuedTail = previousTail.then(() => nextTail);
      contentSaveTails.set(itemId, queuedTail);
      try {
        await previousTail;
        const item = await repository.getItem(itemId);
        const previousContent = await contentStore.get(itemId);
        const bytes = content.kind === "text" ? new TextEncoder().encode(content.text) : new Uint8Array(content.data);
        try {
          await contentStore.put(itemId, content);
          const version = await repository.createVersion({
            itemId,
            manifest: { mimeType: content.mimeType, sizeBytes: bytes.byteLength },
            contentHash: await sha256Content(content),
            baseVersionId: item.currentVersionId,
          });
          const updated = { ...item, currentVersionId: version.id, contentHash: version.contentHash };
          set((state) => ({ items: state.items.map((entry) => entry.id === itemId ? updated : entry) }));
          return updated;
        } catch (error) {
          if (previousContent) await contentStore.put(itemId, previousContent).catch(() => undefined);
          else await contentStore.remove(itemId).catch(() => undefined);
          throw error;
        }
      } finally {
        resolveTail?.();
        if (contentSaveTails.get(itemId) === queuedTail) contentSaveTails.delete(itemId);
      }
    },

    async ensureCurrentVersion(itemId) {
      const item = await repository.getItem(itemId);
      if (item.currentVersionId) {
        set((state) => ({
          items: state.items.map((entry) => entry.id === itemId ? item : entry),
        }));
        return item.currentVersionId;
      }

      // Older local snapshots could contain content without a version row.
      // Reuse an existing version when possible, otherwise create one from
      // the durable content store so annotations always have an immutable
      // anchor.
      const versions = await repository.listItemVersions(itemId);
      const latestVersion = versions[versions.length - 1];
      if (latestVersion) {
        set((state) => ({
          items: state.items.map((entry) => entry.id === itemId
            ? { ...entry, currentVersionId: latestVersion.id, contentHash: latestVersion.contentHash }
            : entry),
        }));
        return latestVersion.id;
      }

      const content = await contentStore.get(itemId);
      if (!content) {
        throw new Error("This item has no stored content to version yet.");
      }
      const bytes = content.kind === "text" ? new TextEncoder().encode(content.text) : new Uint8Array(content.data);
      const version = await repository.createVersion({
        itemId,
        manifest: { mimeType: content.mimeType, sizeBytes: bytes.byteLength },
        contentHash: await sha256Content(content),
      });
      set((state) => ({
        items: state.items.map((entry) => entry.id === itemId
          ? { ...entry, currentVersionId: version.id, contentHash: version.contentHash }
          : entry),
      }));
      return version.id;
    },

    async loadAnnotations(itemId) {
      try {
        const annotations = await repository.listAnnotations(itemId);
        set((state) => ({ annotationsByItemId: { ...state.annotationsByItemId, [itemId]: annotations } }));
      } catch (error) {
        set({ error: toErrorMessage(error) });
      }
    },

    async createAnnotation(input) {
      const annotation = await repository.createAnnotation(input);
      set((state) => ({
        annotationsByItemId: {
          ...state.annotationsByItemId,
          [input.itemId]: [...(state.annotationsByItemId[input.itemId] ?? []), annotation],
        },
      }));
      return annotation;
    },

    async loadComments(annotationId) {
      if (loadedCommentAnnotations.has(annotationId)) return;
      const existing = commentLoadInFlight.get(annotationId);
      if (existing) return existing;

      const load = (async () => {
        try {
          const comments = await repository.listComments(annotationId);
          set((state) => ({ commentsByAnnotationId: { ...state.commentsByAnnotationId, [annotationId]: comments } }));
          loadedCommentAnnotations.add(annotationId);
        } catch (error) {
          set({ error: toErrorMessage(error) });
        } finally {
          commentLoadInFlight.delete(annotationId);
        }
      })();
      commentLoadInFlight.set(annotationId, load);
      return load;
    },

    async createComment(input) {
      const comment = await repository.createComment(input);
      loadedCommentAnnotations.add(input.annotationId);
      set((state) => ({
        commentsByAnnotationId: {
          ...state.commentsByAnnotationId,
          [input.annotationId]: [...(state.commentsByAnnotationId[input.annotationId] ?? []), comment],
        },
      }));
      return comment;
    },
  }));
}

export const useSharedLibraryStore = createSharedLibraryStore(
  new PersistentSharedLibraryRepository(),
);
