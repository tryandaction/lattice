/**
 * Shared Library repository boundary.
 *
 * The repository is the single data-access seam for Library/Collection/Item/
 * Version/Annotation reads and writes. React components and stores depend on
 * this interface — never on Supabase tables, R2 buckets, or raw fetch URLs.
 */

import type {
  Annotation,
  AnnotationComment,
  AnnotationKind,
  ActorId,
  CollectionId,
  Item,
  ItemChild,
  ItemKind,
  ItemVersion,
  Library,
  LibraryId,
  LibraryVisibility,
  OrganizationId,
  SharedAnnotationTarget,
  SyncOperation,
  ItemId,
  VersionId,
  BlobId,
} from "./domain";

export interface ListLibrariesInput {
  organizationId?: OrganizationId;
}

export interface CreateLibraryInput {
  name: string;
  slug?: string;
  description?: string;
  visibility?: LibraryVisibility;
  organizationId?: OrganizationId;
  createdBy?: ActorId;
}

export interface ListItemsInput {
  libraryId: LibraryId;
  collectionId?: CollectionId;
  includeTrashed?: boolean;
}

export interface CreateItemInput {
  libraryId: LibraryId;
  collectionId?: CollectionId;
  kind: ItemKind;
  title: string;
  canonicalName: string;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
  id?: ItemId;
  createdBy?: ActorId;
}

export interface UpdateItemInput {
  itemId: ItemId;
  title?: string;
  canonicalName?: string;
  collectionId?: CollectionId | null;
  metadata?: Record<string, unknown>;
}

export interface CreateItemChildInput {
  parentItemId: ItemId;
  relativePath: string;
  kind: ItemKind;
  title?: string;
}

export interface CreateVersionInput {
  itemId: ItemId;
  blobId?: BlobId;
  manifest: Record<string, unknown>;
  contentHash: string;
  baseVersionId?: VersionId;
  createdBy?: ActorId;
}

export interface CreateAnnotationInput {
  itemId: ItemId;
  versionId: VersionId;
  kind: AnnotationKind;
  target: SharedAnnotationTarget;
  style: Record<string, unknown>;
  quote?: Record<string, unknown>;
  geometry?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

export interface CreateCommentInput {
  annotationId: string;
  parentId?: string;
  body: string;
  createdBy?: ActorId;
}

export interface UpdateCommentInput {
  commentId: string;
  body: string;
}

export interface SharedLibraryRepository {
  createLibrary(input: CreateLibraryInput): Promise<Library>;
  listLibraries(input?: ListLibrariesInput): Promise<Library[]>;
  getLibrary(libraryId: LibraryId): Promise<Library>;

  listItems(input: ListItemsInput): Promise<Item[]>;
  getItem(itemId: ItemId): Promise<Item>;
  createItem(input: CreateItemInput): Promise<Item>;
  updateItem(input: UpdateItemInput): Promise<Item>;
  trashItem(itemId: ItemId): Promise<Item>;
  restoreItem(itemId: ItemId): Promise<Item>;

  addItemChild(input: CreateItemChildInput): Promise<ItemChild>;
  listItemChildren(itemId: ItemId): Promise<ItemChild[]>;

  createVersion(input: CreateVersionInput): Promise<ItemVersion>;
  listItemVersions(itemId: ItemId): Promise<ItemVersion[]>;

  createAnnotation(input: CreateAnnotationInput): Promise<Annotation>;
  listAnnotations(itemId: ItemId): Promise<Annotation[]>;
  createComment(input: CreateCommentInput): Promise<AnnotationComment>;
  listComments(annotationId: string): Promise<AnnotationComment[]>;
  updateComment(input: UpdateCommentInput): Promise<AnnotationComment>;
  deleteComment(commentId: string): Promise<void>;

  appendOperation(operation: SyncOperation): Promise<void>;
  listOperations(input?: { libraryId?: LibraryId; cursor?: string; limit?: number } | LibraryId): Promise<SyncOperation[]>;
}
