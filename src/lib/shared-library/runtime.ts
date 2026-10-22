/**
 * Shared Library runtime composition root.
 *
 * Hosts (Web, Desktop, tests) configure this once after authentication. The
 * returned objects share one ApiTransport instance, so bearer refresh,
 * timeout/error mapping and request tracing stay consistent across metadata,
 * search, blob upload and remote content loading.
 */

import type { ApiConfig } from "./api-config";
import { ApiTransport } from "./api-transport";
import { RemoteBlobStore } from "./blob-store";
import { UploadManager } from "./upload-manager";
import { RemoteSharedLibraryContentStore } from "./remote-content";
import { RemoteRepository } from "./remote-repository";
import { createSharedLibrarySearchClient, RemoteSharedLibrarySearchTransport } from "./search-client";
import type { SyncQueueStorage } from "./sync-queue";
import type { SyncOperation } from "./domain";
import type { CreateItemInput } from "./repository";
import type { SharedLibraryItemContent } from "./content-store";
import { createSharedLibraryStore } from "@/stores/shared-library-store";

export function createSharedLibraryRuntime(config: ApiConfig) {
  const transport = new ApiTransport(config);
  const repository = new RemoteRepository(transport);
  const searchClient = createSharedLibrarySearchClient(new RemoteSharedLibrarySearchTransport(transport));
  const contentStore = new RemoteSharedLibraryContentStore(repository, transport);
  return {
    transport,
    repository,
    searchClient,
    createBlobStore: (libraryId: string) => new RemoteBlobStore(transport, { libraryId }),
    contentStore,
    createStore: () => createSharedLibraryStore(repository, { contentStore }),
    async createItemWithContent(input: CreateItemInput, content: SharedLibraryItemContent) {
      const item = await repository.createItem(input);
      try {
        const bytes = content.kind === "text" ? new TextEncoder().encode(content.text).buffer : content.data;
        const upload = await new UploadManager({ store: new RemoteBlobStore(transport, { libraryId: input.libraryId }) }).uploadFile({
          libraryId: input.libraryId,
          fileName: input.canonicalName,
          mimeType: content.mimeType,
          data: bytes,
        });
        const version = await repository.createVersion({
          itemId: item.id,
          blobId: upload.blobId,
          manifest: { mimeType: content.mimeType, sizeBytes: bytes.byteLength },
          contentHash: upload.sha256,
        });
        return { ...item, currentVersionId: version.id, contentHash: upload.sha256 };
      } catch (error) {
        await repository.trashItem(item.id).catch(() => undefined);
        throw error;
      }
    },
    createSyncEngine: (input: {
      libraryId: string;
      storage: SyncQueueStorage;
      initialCursor?: string;
      saveCursor?: (cursor: string) => Promise<void>;
      applyRemote?: (operations: SyncOperation[]) => Promise<void>;
    }) => repository.createSyncEngine(input),
  };
}

export type SharedLibraryRuntime = ReturnType<typeof createSharedLibraryRuntime>;
