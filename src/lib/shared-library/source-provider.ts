import type { Annotation, Item, ItemKind, LibraryRole } from "./domain";
import type { SharedLibraryItemContent } from "./content-store";
import type { SharedLibrarySearchResponse } from "./search-client";
import type { CloudLibraryWorkspaceController } from "./cloud-workspace";
import { cloudScope } from "./connection";

export interface CloudLibraryResource {
  id: string;
  libraryId: string;
  itemId: string;
  versionId?: string;
  name: string;
  kind: ItemKind;
  path: string;
  role: LibraryRole;
  content: SharedLibraryItemContent | null;
}
export interface CloudLibrarySourceProvider {
  readonly scope?: string;
  resourceIdentity?(libraryId: string, itemId: string): string;
  list(libraryId: string, parentItemId?: string, signal?: AbortSignal): Promise<Item[]>;
  read(libraryId: string, itemId: string, signal?: AbortSignal): Promise<CloudLibraryResource>;
  search(libraryId: string, query: string, signal?: AbortSignal): Promise<SharedLibrarySearchResponse>;
  save(libraryId: string, itemId: string, content: SharedLibraryItemContent, signal?: AbortSignal, expectedVersionId?: string): Promise<void | string>;
  createChild?(libraryId: string, parentItemId: string, input: { name: string; kind: ItemKind; content: SharedLibraryItemContent; expectedParentVersion: string }, signal?: AbortSignal): Promise<Item>;
  createItem?(input: { libraryId: string; parentItemId: string; name: string; kind: ItemKind }, content: SharedLibraryItemContent, signal?: AbortSignal, expectedParentVersion?: string): Promise<Item>;
  annotations?(libraryId: string, itemId: string, signal?: AbortSignal): Promise<Annotation[]>;
}

export function cloudResourceIdentity(controller: CloudLibraryWorkspaceController, libraryId: string, itemId: string): string {
  return `lattice-cloud:${[controller.connection.id, controller.connection.apiUrl, controller.userId, libraryId, itemId].map(encodeURIComponent).join(":")}`;
}
export function createCloudSourceProvider(controller: CloudLibraryWorkspaceController): CloudLibrarySourceProvider {
  return {
    scope: cloudScope(controller.connection, controller.userId),
    resourceIdentity: (libraryId, itemId) => cloudResourceIdentity(controller, libraryId, itemId),
    list: (libraryId, parentItemId, signal) => controller.list(libraryId, parentItemId, signal),
    async read(libraryId, itemId, signal) {
      const { item, role, content } = await controller.readResource(libraryId, itemId, signal);
      const id = cloudResourceIdentity(controller, libraryId, itemId);
      return { id, libraryId, itemId, versionId: item.currentVersionId, name: item.canonicalName, kind: item.kind, path: `cloud://${encodeURIComponent(id)}`, role, content };
    },
    async search(libraryId, query, signal) {
      await controller.verifyAccess(libraryId, signal);
      const result = await controller.searchClient.search({ libraryId, q: query, signal });
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      await controller.verifyAccess(libraryId, signal);
      return result;
    },
    async save(libraryId, itemId, content, signal, expectedVersionId) { if (signal?.aborted) throw new DOMException("Cancelled", "AbortError"); return controller.save(libraryId, itemId, content, expectedVersionId); },
    createChild: (libraryId, parentItemId, input, signal) => controller.createChild(libraryId, parentItemId, input, signal),
    async createItem(input, content, signal, expectedParentVersion) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      return controller.createItem(input, content, expectedParentVersion);
    },
    async annotations(libraryId, itemId, signal) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const result = await controller.annotations(libraryId, itemId);
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      return result;
    },
  };
}
