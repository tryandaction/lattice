"use client";

export type SharedLibraryItemContent =
  | {
      kind: "text";
      mimeType: string;
      text: string;
      updatedAt: string;
    }
  | {
      kind: "binary";
      mimeType: string;
      data: ArrayBuffer;
      updatedAt: string;
    };

export interface SharedLibraryContentStore {
  get(itemId: string): Promise<SharedLibraryItemContent | null>;
  put(itemId: string, content: SharedLibraryItemContent): Promise<void>;
  remove(itemId: string): Promise<void>;
}

function cloneContent(content: SharedLibraryItemContent): SharedLibraryItemContent {
  if (content.kind === "text") {
    return { ...content };
  }
  return { ...content, data: content.data.slice(0) };
}

export class InMemorySharedLibraryContentStore implements SharedLibraryContentStore {
  private readonly values = new Map<string, SharedLibraryItemContent>();

  async get(itemId: string): Promise<SharedLibraryItemContent | null> {
    const content = this.values.get(itemId);
    return content ? cloneContent(content) : null;
  }

  async put(itemId: string, content: SharedLibraryItemContent): Promise<void> {
    this.values.set(itemId, cloneContent(content));
  }

  async remove(itemId: string): Promise<void> {
    this.values.delete(itemId);
  }
}

const CONTENT_DB_NAME = "lattice-shared-library-content";
const CONTENT_STORE_NAME = "items";

function openContentDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONTENT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CONTENT_STORE_NAME)) {
        request.result.createObjectStore(CONTENT_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open content database"));
  });
}

class IndexedDbSharedLibraryContentStore implements SharedLibraryContentStore {
  async get(itemId: string): Promise<SharedLibraryItemContent | null> {
    const database = await openContentDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(CONTENT_STORE_NAME, "readonly")
        .objectStore(CONTENT_STORE_NAME)
        .get(itemId);
      request.onsuccess = () => {
        const content = request.result as SharedLibraryItemContent | undefined;
        resolve(content ? cloneContent(content) : null);
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to read item content"));
    });
  }

  async put(itemId: string, content: SharedLibraryItemContent): Promise<void> {
    const database = await openContentDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(CONTENT_STORE_NAME, "readwrite");
      transaction.objectStore(CONTENT_STORE_NAME).put(cloneContent(content), itemId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to write item content"));
    });
  }

  async remove(itemId: string): Promise<void> {
    const database = await openContentDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(CONTENT_STORE_NAME, "readwrite");
      transaction.objectStore(CONTENT_STORE_NAME).delete(itemId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to remove item content"));
    });
  }
}

let defaultStore: SharedLibraryContentStore | null = null;
const memoryFallback = new InMemorySharedLibraryContentStore();

export function getSharedLibraryContentStore(): SharedLibraryContentStore {
  if (defaultStore) {
    return defaultStore;
  }
  if (typeof indexedDB === "undefined") {
    defaultStore = memoryFallback;
    return defaultStore;
  }

  const indexedDbStore = new IndexedDbSharedLibraryContentStore();
  defaultStore = {
    async get(itemId) {
      try {
        return await indexedDbStore.get(itemId);
      } catch {
        return memoryFallback.get(itemId);
      }
    },
    async put(itemId, content) {
      try {
        await indexedDbStore.put(itemId, content);
      } catch {
        await memoryFallback.put(itemId, content);
      }
    },
    async remove(itemId) {
      try {
        await indexedDbStore.remove(itemId);
      } catch {
        await memoryFallback.remove(itemId);
      }
    },
  };
  return defaultStore;
}

export async function getSharedLibraryItemContent(itemId: string): Promise<SharedLibraryItemContent | null> {
  return getSharedLibraryContentStore().get(itemId);
}

export async function saveSharedLibraryItemContent(itemId: string, content: SharedLibraryItemContent): Promise<void> {
  await getSharedLibraryContentStore().put(itemId, content);
}

export async function removeSharedLibraryItemContent(itemId: string): Promise<void> {
  await getSharedLibraryContentStore().remove(itemId);
}
