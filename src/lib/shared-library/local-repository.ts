/**
 * Deterministic in-memory local repository.
 *
 * This is the first local adapter: a pure, synchronous-under-the-hood Map
 * implementation that makes Library/Item/Version/Annotation flows testable
 * without any cloud resource. It is intentionally separate from the
 * repository contract and is the fake used by contract tests; a filesystem-
 * backed local repository will replace it where persistence matters (see the
 * desktop sync and migration tasks).
 */

import type {
  Annotation,
  AnnotationComment,
  Item,
  ItemChild,
  ItemVersion,
  Library,
  LibraryId,
  SyncOperation,
  ItemId,
  IsoTimestamp,
} from "./domain";
import {
  SharedLibraryError,
} from "./errors";
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
import { getStorageAdapter, type StorageAdapter } from "@/lib/storage-adapter";

export interface SharedLibraryRepositorySnapshot {
  version: 1;
  libraries: Library[];
  items: Item[];
  itemChildren: ItemChild[];
  versions: ItemVersion[];
  annotations: Annotation[];
  comments: AnnotationComment[];
  operations: SyncOperation[];
  counters: Record<string, number>;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export class InMemorySharedLibraryRepository implements SharedLibraryRepository {
  protected libraries = new Map<string, Library>();
  protected items = new Map<string, Item>();
  protected itemChildren = new Map<string, ItemChild[]>();
  protected versions = new Map<string, ItemVersion[]>();
  protected annotations = new Map<string, Annotation[]>();
  protected comments = new Map<string, AnnotationComment[]>();
  protected operations: SyncOperation[] = [];
  protected seenIdempotencyKeys = new Set<string>();
  protected counters: Record<string, number> = {};

  exportSnapshot(): SharedLibraryRepositorySnapshot {
    return {
      version: 1,
      libraries: [...this.libraries.values()],
      items: [...this.items.values()],
      itemChildren: [...this.itemChildren.values()].flat(),
      versions: [...this.versions.values()].flat(),
      annotations: [...this.annotations.values()].flat(),
      comments: [...this.comments.values()].flat(),
      operations: [...this.operations],
      counters: { ...this.counters },
    };
  }

  restoreSnapshot(snapshot: SharedLibraryRepositorySnapshot): void {
    if (!snapshot || snapshot.version !== 1) {
      return;
    }
    const libraries = Array.isArray(snapshot.libraries) ? snapshot.libraries : [];
    const items = Array.isArray(snapshot.items) ? snapshot.items : [];
    const itemChildren = Array.isArray(snapshot.itemChildren) ? snapshot.itemChildren : [];
    const versions = Array.isArray(snapshot.versions) ? snapshot.versions : [];
    const annotations = Array.isArray(snapshot.annotations) ? snapshot.annotations : [];
    const comments = Array.isArray(snapshot.comments) ? snapshot.comments : [];
    const operations = Array.isArray(snapshot.operations) ? snapshot.operations : [];
    this.libraries = new Map(libraries.map((entry) => [entry.id, entry]));
    this.items = new Map(items.map((entry) => [entry.id, entry]));
    this.itemChildren = new Map();
    itemChildren.forEach((entry) => {
      const siblings = this.itemChildren.get(entry.parentItemId) ?? [];
      siblings.push(entry);
      this.itemChildren.set(entry.parentItemId, siblings);
    });
    this.versions = new Map();
    versions.forEach((entry) => {
      const versions = this.versions.get(entry.itemId) ?? [];
      versions.push(entry);
      this.versions.set(entry.itemId, versions);
    });
    this.annotations = new Map();
    annotations.forEach((entry) => {
      const annotations = this.annotations.get(entry.itemId) ?? [];
      annotations.push(entry);
      this.annotations.set(entry.itemId, annotations);
    });
    this.comments = new Map();
    comments.forEach((entry) => {
      const list = this.comments.get(entry.annotationId ?? "") ?? [];
      list.push(entry);
      this.comments.set(entry.annotationId ?? "", list);
    });
    this.operations = [...operations];
    this.seenIdempotencyKeys = new Set(operations.map((entry) => entry.idempotencyKey));
    this.counters = snapshot.counters && typeof snapshot.counters === "object"
      ? { ...snapshot.counters }
      : {};
  }

  private nextId(prefix: string): string {
    this.counters[prefix] = (this.counters[prefix] ?? 0) + 1;
    return `${prefix}-${this.counters[prefix]}`;
  }

  private now(): IsoTimestamp {
    return new Date().toISOString();
  }

  private notFound(entityType: string, entityId: string): SharedLibraryError {
    return new SharedLibraryError({
      code: "NOT_FOUND",
      message: `${entityType} not found`,
      retryable: false,
      entityType,
      entityId,
    });
  }

  async createLibrary(input: CreateLibraryInput): Promise<Library> {
    const id = this.nextId("lib");
    const now = this.now();
    const library: Library = {
      id,
      organizationId: input.organizationId ?? "org-default",
      name: input.name,
      slug: input.slug ?? slugify(input.name),
      description: input.description,
      visibility: input.visibility ?? "private",
      settings: {},
      createdBy: input.createdBy ?? "local",
      createdAt: now,
      updatedAt: now,
    };
    this.libraries.set(id, library);
    return library;
  }

  async listLibraries(input?: ListLibrariesInput): Promise<Library[]> {
    const libraries = [...this.libraries.values()];
    if (!input?.organizationId) {
      return libraries;
    }
    return libraries.filter((library) => library.organizationId === input.organizationId);
  }

  async getLibrary(libraryId: LibraryId): Promise<Library> {
    const library = this.libraries.get(libraryId);
    if (!library) {
      throw this.notFound("library", libraryId);
    }
    return library;
  }

  async createItem(input: CreateItemInput): Promise<Item> {
    const id = input.id ?? this.nextId("item");
    const now = this.now();
    const item: Item = {
      id,
      libraryId: input.libraryId,
      collectionId: input.collectionId,
      kind: input.kind,
      title: input.title,
      canonicalName: input.canonicalName,
      sourceUrl: input.sourceUrl,
      metadata: input.metadata ?? {},
      status: "active",
      createdBy: input.createdBy ?? "local",
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(id, item);
    return item;
  }

  async listItems(input: ListItemsInput): Promise<Item[]> {
    const items = [...this.items.values()].filter(
      (item) => item.libraryId === input.libraryId,
    );
    const filtered = items.filter((item) => {
      if (input.collectionId && item.collectionId !== input.collectionId) {
        return false;
      }
      if (!input.includeTrashed && item.status === "trashed") {
        return false;
      }
      return true;
    });
    return filtered;
  }

  async getItem(itemId: ItemId): Promise<Item> {
    const item = this.items.get(itemId);
    if (!item) {
      throw this.notFound("item", itemId);
    }
    return item;
  }

  async updateItem(input: UpdateItemInput): Promise<Item> {
    const current = await this.getItem(input.itemId);
    const updated: Item = {
      ...current,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.canonicalName !== undefined ? { canonicalName: input.canonicalName } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      collectionId: input.collectionId === null ? undefined : input.collectionId ?? current.collectionId,
      updatedAt: this.now(),
    };
    this.items.set(updated.id, updated);
    return updated;
  }

  async trashItem(itemId: ItemId): Promise<Item> {
    const current = await this.getItem(itemId);
    const updated: Item = {
      ...current,
      status: "trashed",
      deletedAt: this.now(),
      updatedAt: this.now(),
    };
    this.items.set(itemId, updated);
    return updated;
  }

  async restoreItem(itemId: ItemId): Promise<Item> {
    const current = await this.getItem(itemId);
    const { deletedAt: _deletedAt, ...rest } = current;
    const updated: Item = {
      ...rest,
      status: "active",
      updatedAt: this.now(),
    };
    this.items.set(itemId, updated);
    return updated;
  }

  async addItemChild(input: CreateItemChildInput): Promise<ItemChild> {
    await this.getItem(input.parentItemId);
    const fileName = input.relativePath.split("/").filter(Boolean).pop() ?? input.relativePath;
    const child = await this.createItem({
      libraryId: (await this.getItem(input.parentItemId)).libraryId,
      kind: input.kind,
      title: input.title ?? fileName,
      canonicalName: input.relativePath,
    });
    const now = this.now();
    const relation: ItemChild = {
      parentItemId: input.parentItemId,
      childItemId: child.id,
      relativePath: input.relativePath,
      kind: input.kind,
      sortKey: input.relativePath,
      createdAt: now,
      updatedAt: now,
    };
    const siblings = this.itemChildren.get(input.parentItemId) ?? [];
    siblings.push(relation);
    this.itemChildren.set(input.parentItemId, siblings);
    return relation;
  }

  async listItemChildren(itemId: ItemId): Promise<ItemChild[]> {
    return this.itemChildren.get(itemId) ?? [];
  }

  async createVersion(input: CreateVersionInput): Promise<ItemVersion> {
    const item = await this.getItem(input.itemId);
    const existing = this.versions.get(input.itemId) ?? [];
    const id = this.nextId("ver");
    const version: ItemVersion = {
      id,
      itemId: input.itemId,
      versionNumber: existing.length + 1,
      blobId: input.blobId,
      manifest: input.manifest,
      contentHash: input.contentHash,
      createdBy: input.createdBy ?? "local",
      baseVersionId: input.baseVersionId,
      createdAt: this.now(),
    };
    existing.push(version);
    this.versions.set(input.itemId, existing);
    this.items.set(item.id, {
      ...item,
      currentVersionId: id,
      contentHash: input.contentHash,
      updatedAt: version.createdAt,
    });
    return version;
  }

  async listItemVersions(itemId: ItemId): Promise<ItemVersion[]> {
    return this.versions.get(itemId) ?? [];
  }

  async createAnnotation(input: CreateAnnotationInput): Promise<Annotation> {
    await this.getItem(input.itemId);
    const now = this.now();
    const annotation: Annotation = {
      id: this.nextId("ann"),
      itemId: input.itemId,
      versionId: input.versionId,
      authorId: "local",
      kind: input.kind,
      target: input.target,
      quote: input.quote,
      geometry: input.geometry,
      style: input.style,
      body: input.body ?? {},
      status: "active",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const list = this.annotations.get(input.itemId) ?? [];
    list.push(annotation);
    this.annotations.set(input.itemId, list);
    return annotation;
  }

  async listAnnotations(itemId: ItemId): Promise<Annotation[]> {
    return this.annotations.get(itemId) ?? [];
  }

  async createComment(input: CreateCommentInput): Promise<AnnotationComment> {
    await this.getAnnotation(input.annotationId);
    const body = input.body.trim();
    if (!body || body.length > 20_000) {
      throw new SharedLibraryError({ code: "INVALID_INPUT", message: "Comment body is required", retryable: false });
    }
    const now = this.now();
    const comment: AnnotationComment = {
      id: this.nextId("comment"),
      annotationId: input.annotationId,
      parentId: input.parentId,
      authorId: input.createdBy ?? "local",
      body,
      createdAt: now,
      updatedAt: now,
    };
    const list = this.comments.get(input.annotationId) ?? [];
    list.push(comment);
    this.comments.set(input.annotationId, list);
    return comment;
  }

  private async getAnnotation(annotationId: string): Promise<Annotation> {
    for (const list of this.annotations.values()) {
      const annotation = list.find((entry) => entry.id === annotationId);
      if (annotation) return annotation;
    }
    throw this.notFound("annotation", annotationId);
  }

  async listComments(annotationId: string): Promise<AnnotationComment[]> {
    return this.comments.get(annotationId) ?? [];
  }

  async updateComment(input: UpdateCommentInput): Promise<AnnotationComment> {
    const body = input.body.trim();
    if (!body || body.length > 20_000) {
      throw new SharedLibraryError({ code: "INVALID_INPUT", message: "Comment body is required", retryable: false });
    }
    for (const [annotationId, list] of this.comments.entries()) {
      const index = list.findIndex((entry) => entry.id === input.commentId);
      if (index === -1) continue;
      const current = list[index];
      const updated = { ...current, body, updatedAt: this.now() };
      list[index] = updated;
      this.comments.set(annotationId, list);
      return updated;
    }
    throw this.notFound("comment", input.commentId);
  }

  async deleteComment(commentId: string): Promise<void> {
    for (const [annotationId, list] of this.comments.entries()) {
      const index = list.findIndex((entry) => entry.id === commentId);
      if (index === -1) continue;
      const current = list[index];
      list[index] = { ...current, deletedAt: this.now() };
      this.comments.set(annotationId, list);
      return;
    }
    throw this.notFound("comment", commentId);
  }

  async appendOperation(operation: SyncOperation): Promise<void> {
    if (this.seenIdempotencyKeys.has(operation.idempotencyKey)) {
      return;
    }
    this.seenIdempotencyKeys.add(operation.idempotencyKey);
    this.operations.push(operation);
  }

  async listOperations(): Promise<SyncOperation[]> {
    return [...this.operations];
  }
}

export interface PersistentSharedLibraryRepositoryOptions {
  storage?: StorageAdapter;
  key?: string;
}

/**
 * Durable local-first repository. Metadata is persisted through the existing
 * Web localStorage/Tauri store adapter; binary content is kept in the separate
 * IndexedDB content store and never serialized into localStorage.
 */
export class PersistentSharedLibraryRepository implements SharedLibraryRepository {
  private readonly storage: StorageAdapter;
  private readonly key: string;
  private readonly inner = new InMemorySharedLibraryRepository();
  private readonly hydrated: Promise<void>;
  private persistTail: Promise<void> = Promise.resolve();

  constructor(options: PersistentSharedLibraryRepositoryOptions = {}) {
    this.storage = options.storage ?? getStorageAdapter();
    this.key = options.key ?? "lattice-shared-library-repository-v1";
    this.hydrated = this.hydrate();
  }

  private async hydrate(): Promise<void> {
    const snapshot = await this.storage.get<SharedLibraryRepositorySnapshot>(this.key);
    if (snapshot) {
      this.inner.restoreSnapshot(snapshot);
    }
  }

  private async read<T>(operation: () => Promise<T>): Promise<T> {
    await this.hydrated;
    return operation();
  }

  private async write<T>(operation: () => Promise<T>): Promise<T> {
    await this.hydrated;
    const result = await operation();
    this.persistTail = this.persistTail.then(async () => {
      await this.storage.set(this.key, this.inner.exportSnapshot());
    });
    await this.persistTail;
    return result;
  }

  createLibrary(input: CreateLibraryInput): Promise<Library> { return this.write(() => this.inner.createLibrary(input)); }
  listLibraries(input?: ListLibrariesInput): Promise<Library[]> { return this.read(() => this.inner.listLibraries(input)); }
  getLibrary(id: string): Promise<Library> { return this.read(() => this.inner.getLibrary(id)); }
  listItems(input: ListItemsInput): Promise<Item[]> { return this.read(() => this.inner.listItems(input)); }
  getItem(id: string): Promise<Item> { return this.read(() => this.inner.getItem(id)); }
  createItem(input: CreateItemInput): Promise<Item> { return this.write(() => this.inner.createItem(input)); }
  updateItem(input: UpdateItemInput): Promise<Item> { return this.write(() => this.inner.updateItem(input)); }
  trashItem(id: string): Promise<Item> { return this.write(() => this.inner.trashItem(id)); }
  restoreItem(id: string): Promise<Item> { return this.write(() => this.inner.restoreItem(id)); }
  addItemChild(input: CreateItemChildInput): Promise<ItemChild> { return this.write(() => this.inner.addItemChild(input)); }
  listItemChildren(id: string): Promise<ItemChild[]> { return this.read(() => this.inner.listItemChildren(id)); }
  createVersion(input: CreateVersionInput): Promise<ItemVersion> { return this.write(() => this.inner.createVersion(input)); }
  listItemVersions(id: string): Promise<ItemVersion[]> { return this.read(() => this.inner.listItemVersions(id)); }
  createAnnotation(input: CreateAnnotationInput): Promise<Annotation> { return this.write(() => this.inner.createAnnotation(input)); }
  listAnnotations(id: string): Promise<Annotation[]> { return this.read(() => this.inner.listAnnotations(id)); }
  createComment(input: CreateCommentInput): Promise<AnnotationComment> { return this.write(() => this.inner.createComment(input)); }
  listComments(id: string): Promise<AnnotationComment[]> { return this.read(() => this.inner.listComments(id)); }
  updateComment(input: UpdateCommentInput): Promise<AnnotationComment> { return this.write(() => this.inner.updateComment(input)); }
  deleteComment(id: string): Promise<void> { return this.write(() => this.inner.deleteComment(id)); }
  appendOperation(operation: SyncOperation): Promise<void> { return this.write(() => this.inner.appendOperation(operation)); }
  listOperations(): Promise<SyncOperation[]> { return this.read(() => this.inner.listOperations()); }
}
