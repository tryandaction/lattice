/**
 * Remote content resolver for Item Workspace.
 *
 * Metadata and versions stay in the repository; binary/text bytes are fetched
 * through RemoteBlobStore only after the caller has already passed API/RLS
 * authorization. The resolver is intentionally separate from the local
 * IndexedDB store so offline content remains available without pretending it
 * is remotely synchronized.
 */

import type { Item, ItemVersion } from "./domain";
import type { SharedLibraryContentStore, SharedLibraryItemContent } from "./content-store";
import type { SharedLibraryRepository } from "./repository";
import { RemoteBlobStore } from "./blob-store";
import type { SharedLibraryTransport } from "./remote-repository";

function isTextMimeType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith("text/")
    || normalized.includes("json")
    || normalized.includes("javascript")
    || normalized.includes("xml")
    || normalized.includes("yaml");
}

function currentVersion(item: Item, versions: readonly ItemVersion[]): ItemVersion | null {
  if (item.currentVersionId) {
    return versions.find((version) => version.id === item.currentVersionId) ?? null;
  }
  return versions.reduce<ItemVersion | null>(
    (latest, version) => !latest || version.versionNumber > latest.versionNumber ? version : latest,
    null,
  );
}

export async function loadRemoteSharedLibraryItemContent(
  repository: SharedLibraryRepository,
  transport: SharedLibraryTransport,
  itemId: string,
): Promise<SharedLibraryItemContent | null> {
  const item = await repository.getItem(itemId);
  const versions = await repository.listItemVersions(itemId);
  const version = currentVersion(item, versions);
  if (!version?.blobId) return null;

  const blobStore = new RemoteBlobStore(transport, { libraryId: item.libraryId });
  const downloaded = await blobStore.downloadBlob(version.blobId);
  const mimeType = typeof version.manifest.mimeType === "string"
    ? version.manifest.mimeType
    : downloaded.mimeType ?? "application/octet-stream";
  const updatedAt = version.createdAt;
  if (isTextMimeType(mimeType)) {
    return {
      kind: "text",
      mimeType,
      text: new TextDecoder().decode(downloaded.data),
      updatedAt,
    };
  }
  return { kind: "binary", mimeType, data: downloaded.data, updatedAt };
}

/** Read-through store for a remote item. Writes are deliberately rejected;
 * uploads must go through UploadManager + version commit atomically. */
export class RemoteSharedLibraryContentStore implements SharedLibraryContentStore {
  constructor(
    private readonly repository: SharedLibraryRepository,
    private readonly transport: SharedLibraryTransport,
  ) {}

  get(itemId: string): Promise<SharedLibraryItemContent | null> {
    return loadRemoteSharedLibraryItemContent(this.repository, this.transport, itemId);
  }

  async put(): Promise<void> {
    throw new Error("Remote content must be uploaded through UploadManager before creating a version.");
  }

  async remove(): Promise<void> {
    // A failed local projection must not delete a remote immutable blob.
  }
}
