/**
 * Remote repository mapped onto the shared-library HTTP API (`/v1`).
 *
 * `RemoteRepository` receives a `SharedLibraryTransport` (implemented by
 * `ApiTransport`) so HTTP concerns stay behind one boundary and never leak
 * into React components. Routes follow design section 13.
 *
 * Item-scoped routes use stable item ids. The API re-checks Library membership
 * server-side, so clients do not need to duplicate library ids for each item.
 */

import type {
  Annotation,
  AnnotationComment,
  Item,
  ItemChild,
  ItemVersion,
  Library,
  SyncOperation,
} from "./domain";
import type {
  CreateAnnotationInput,
  CreateCommentInput,
  CreateItemChildInput,
  CreateItemInput,
  CreateLibraryInput,
  CreateVersionInput,
  ListItemsInput,
  ListLibrariesInput,
  SharedLibraryRepository,
  UpdateItemInput,
  UpdateCommentInput,
} from "./repository";
import { SyncEngine, type PullResult, type PushResult } from "./sync-engine";
import type { SyncQueueStorage } from "./sync-queue";

export interface TransportRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  responseType?: "json" | "arrayBuffer";
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface TransportResponse {
  status: number;
  body: unknown;
  requestId?: string;
}

export interface SharedLibraryTransport {
  request(input: TransportRequest): Promise<TransportResponse>;
}

export class RemoteRepository implements SharedLibraryRepository {
  constructor(private readonly transport: SharedLibraryTransport) {}

  private async request(input: TransportRequest): Promise<unknown> {
    const response = await this.transport.request(input);
    if (typeof response.body === "object" && response.body !== null && "data" in response.body) {
      return (response.body as { data: unknown }).data;
    }
    return response.body;
  }

  async createLibrary(input: CreateLibraryInput): Promise<Library> {
    return (await this.request({
      method: "POST",
      path: "/v1/libraries",
      body: input,
    })) as Library;
  }

  async listLibraries(input?: ListLibrariesInput): Promise<Library[]> {
    return (await this.request({
      method: "GET",
      path: "/v1/libraries",
      query: input?.organizationId ? { organizationId: input.organizationId } : undefined,
    })) as Library[];
  }

  async getLibrary(libraryId: string): Promise<Library> {
    return (await this.request({
      method: "GET",
      path: `/v1/libraries/${libraryId}`,
    })) as Library;
  }

  async listItems(input: ListItemsInput): Promise<Item[]> {
    return (await this.request({
      method: "GET",
      path: `/v1/libraries/${input.libraryId}/items`,
      query: {
        ...(input.collectionId ? { collectionId: input.collectionId } : {}),
        ...(input.includeTrashed ? { includeTrashed: true } : {}),
      },
    })) as Item[];
  }

  async getItem(itemId: string): Promise<Item> {
    return (await this.request({ method: "GET", path: `/v1/items/${encodeURIComponent(itemId)}` })) as Item;
  }

  async createItem(input: CreateItemInput): Promise<Item> {
    return (await this.request({
      method: "POST",
      path: `/v1/libraries/${input.libraryId}/items`,
      body: {
        collectionId: input.collectionId,
        kind: input.kind,
        title: input.title,
        canonicalName: input.canonicalName,
        sourceUrl: input.sourceUrl,
        metadata: input.metadata,
        id: input.id,
        createdBy: input.createdBy,
      },
    })) as Item;
  }

  async updateItem(input: UpdateItemInput): Promise<Item> {
    return (await this.request({
      method: "PATCH",
      path: `/v1/items/${encodeURIComponent(input.itemId)}`,
      body: {
        title: input.title,
        canonicalName: input.canonicalName,
        collectionId: input.collectionId,
        metadata: input.metadata,
      },
    })) as Item;
  }

  async trashItem(itemId: string): Promise<Item> {
    return (await this.request({ method: "DELETE", path: `/v1/items/${encodeURIComponent(itemId)}` })) as Item;
  }

  async restoreItem(itemId: string): Promise<Item> {
    return (await this.request({ method: "POST", path: `/v1/items/${encodeURIComponent(itemId)}/restore` })) as Item;
  }

  async addItemChild(input: CreateItemChildInput): Promise<ItemChild> {
    return (await this.request({
      method: "POST",
      path: `/v1/items/${encodeURIComponent(input.parentItemId)}/children`,
      body: { relativePath: input.relativePath, kind: input.kind, title: input.title },
    })) as ItemChild;
  }

  async listItemChildren(itemId: string): Promise<ItemChild[]> {
    return (await this.request({ method: "GET", path: `/v1/items/${encodeURIComponent(itemId)}/children` })) as ItemChild[];
  }

  async createVersion(input: CreateVersionInput): Promise<ItemVersion> {
    return (await this.request({
      method: "POST",
      path: `/v1/items/${encodeURIComponent(input.itemId)}/versions`,
      body: { blobId: input.blobId, manifest: input.manifest, contentHash: input.contentHash, baseVersionId: input.baseVersionId },
    })) as ItemVersion;
  }

  async listItemVersions(itemId: string): Promise<ItemVersion[]> {
    return (await this.request({ method: "GET", path: `/v1/items/${encodeURIComponent(itemId)}/versions` })) as ItemVersion[];
  }

  async createAnnotation(input: CreateAnnotationInput): Promise<Annotation> {
    return (await this.request({
      method: "POST",
      path: `/v1/items/${input.itemId}/annotations`,
      body: {
        versionId: input.versionId,
        kind: input.kind,
        target: input.target,
        quote: input.quote,
        geometry: input.geometry,
        style: input.style,
        body: input.body,
      },
    })) as Annotation;
  }

  async listAnnotations(itemId: string): Promise<Annotation[]> {
    return (await this.request({
      method: "GET",
      path: `/v1/items/${itemId}/annotations`,
    })) as Annotation[];
  }

  async createComment(input: CreateCommentInput): Promise<AnnotationComment> {
    return (await this.request({
      method: "POST",
      path: `/v1/annotations/${encodeURIComponent(input.annotationId)}/comments`,
      body: { body: input.body, parentId: input.parentId },
    })) as AnnotationComment;
  }

  async listComments(annotationId: string): Promise<AnnotationComment[]> {
    return (await this.request({
      method: "GET",
      path: `/v1/annotations/${encodeURIComponent(annotationId)}/comments`,
    })) as AnnotationComment[];
  }

  async updateComment(input: UpdateCommentInput): Promise<AnnotationComment> {
    return (await this.request({
      method: "PATCH",
      path: `/v1/comments/${encodeURIComponent(input.commentId)}`,
      body: { body: input.body },
    })) as AnnotationComment;
  }

  async deleteComment(commentId: string): Promise<void> {
    await this.request({ method: "DELETE", path: `/v1/comments/${encodeURIComponent(commentId)}` });
  }

  async appendOperation(operation: SyncOperation): Promise<void> {
    await this.request({
      method: "POST",
      path: `/v1/libraries/${operation.libraryId}/sync/push`,
      body: { operations: [operation] },
      idempotencyKey: operation.idempotencyKey,
    });
  }

  async pushOperations(operations: readonly SyncOperation[]): Promise<PushResult> {
    if (operations.length === 0) {
      return { accepted: [], rejected: [], conflicts: [] };
    }
    const libraryId = operations[0].libraryId;
    if (operations.some((operation) => operation.libraryId !== libraryId)) {
      return {
        accepted: [],
        rejected: operations.map((operation) => ({ operationId: operation.id, retryable: false, reason: "A sync batch cannot span libraries" })),
        conflicts: [],
      };
    }
    const response = await this.request({
      method: "POST",
      path: `/v1/libraries/${encodeURIComponent(libraryId)}/sync/push`,
      body: { operations },
    });
    const value = (response && typeof response === "object" ? response : {}) as Partial<PushResult>;
    return {
      accepted: Array.isArray(value.accepted) ? value.accepted.filter((id): id is string => typeof id === "string") : [],
      rejected: Array.isArray(value.rejected) ? value.rejected as PushResult["rejected"] : [],
      conflicts: Array.isArray(value.conflicts) ? value.conflicts as PushResult["conflicts"] : [],
    };
  }

  async pullOperations(libraryId: string, cursor?: string, limit?: number): Promise<PullResult> {
    const response = await this.request({
      method: "GET",
      path: `/v1/libraries/${encodeURIComponent(libraryId)}/sync/pull`,
      query: { cursor, limit },
    });
    const value = response && typeof response === "object" ? response as Partial<PullResult> : {};
    return {
      operations: Array.isArray(value.operations) ? value.operations as SyncOperation[] : [],
      ...(typeof value.cursor === "string" ? { cursor: value.cursor } : {}),
      ...(typeof value.hasMore === "boolean" ? { hasMore: value.hasMore } : {}),
    };
  }

  createSyncEngine(options: {
    libraryId: string;
    storage: SyncQueueStorage;
    initialCursor?: string;
    saveCursor?: (cursor: string) => Promise<void>;
    applyRemote?: (operations: SyncOperation[]) => Promise<void>;
  }): SyncEngine {
    // The repository owns transport details; the engine owns retry, cursor and
    // queue state. Keeping these responsibilities separate makes Desktop and
    // Web behavior identical.
    return new SyncEngine({
      storage: options.storage,
      push: (operations) => this.pushOperations(operations),
      pull: (cursor) => this.pullOperations(options.libraryId, cursor),
      initialCursor: options.initialCursor,
      saveCursor: options.saveCursor,
      applyRemote: options.applyRemote,
    });
  }

  async listOperations(input: { libraryId?: string; cursor?: string; limit?: number } | string = {}): Promise<SyncOperation[]> {
    const query = typeof input === "string" ? { libraryId: input } : input;
    if (!query.libraryId) {
      return [];
    }
    const response = await this.request({
      method: "GET",
      path: `/v1/libraries/${encodeURIComponent(query.libraryId)}/sync/pull`,
      query: { cursor: query.cursor, limit: query.limit },
    });
    if (Array.isArray(response)) return response as SyncOperation[];
    if (typeof response === "object" && response !== null && "operations" in response) {
      return ((response as { operations?: unknown }).operations ?? []) as SyncOperation[];
    }
    return [];
  }
}
