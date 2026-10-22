/**
 * Shared Library domain model.
 *
 * Identity rules (hard constraints):
 * - Every entity id is an opaque, stable id (UUID-like string), never a file
 *   path or file name.
 * - All timestamps are ISO-8601 strings; device-independent ordering never
 *   relies on `Date.now()` values shared across devices.
 * - PDF annotation geometry keeps the existing page-local normalized (0-1)
 *   coordinate semantics; viewport/CSS pixel coordinates never enter this
 *   model (enforced by `validators.ts`).
 */

export type IsoTimestamp = string;

// Stable opaque entity ids. Descriptive aliases — never file paths.
export type OrganizationId = string;
export type LibraryId = string;
export type CollectionId = string;
export type ItemId = string;
export type VersionId = string;
export type BlobId = string;
export type AnnotationId = string;
export type CommentId = string;
export type OperationId = string;
export type ActorId = string;
export type DeviceId = string;

export const LIBRARY_ROLES = ["owner", "admin", "editor", "commenter", "viewer"] as const;
export type LibraryRole = (typeof LIBRARY_ROLES)[number];

export const CAPABILITIES = [
  "library.read",
  "library.update",
  "library.delete",
  "member.manage",
  "collection.manage",
  "item.read",
  "item.create",
  "item.update",
  "item.move",
  "item.delete",
  "item.restore",
  "itemChild.create",
  "version.create",
  "annotation.create",
  "comment.create",
  "comment.editOwn",
  "comment.editOthers",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const ITEM_KINDS = [
  "pdf",
  "markdown",
  "code",
  "notebook",
  "docx",
  "pptx",
  "image",
  "web_snapshot",
  "data",
  "folder",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_STATUSES = ["active", "archived", "trashed", "conflicted"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const LIBRARY_VISIBILITIES = ["private", "public"] as const;
export type LibraryVisibility = (typeof LIBRARY_VISIBILITIES)[number];

export const MEMBER_STATUSES = ["active", "invited", "suspended"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const ANNOTATION_KINDS = [
  "highlight",
  "underline",
  "area",
  "text",
  "ink",
  "comment",
] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

export const ANNOTATION_STATUSES = ["active", "resolved", "deleted", "conflicted"] as const;
export type AnnotationStatus = (typeof ANNOTATION_STATUSES)[number];

export const ANNOTATION_LOCATOR_TYPES = [
  "pdf-page",
  "markdown-heading",
  "code-line",
  "notebook-cell",
  "docx-paragraph",
  "pptx-slide",
  "web-paragraph",
  "image-region",
] as const;
export type AnnotationLocatorType = (typeof ANNOTATION_LOCATOR_TYPES)[number];

export type SharedLocatorValue = string | number | readonly number[];

export interface SharedAnnotationTarget {
  locatorType: AnnotationLocatorType;
  locator: Record<string, SharedLocatorValue>;
}

export const EVIDENCE_SOURCE_TYPES = [
  "pdf-page",
  "pdf-annotation",
  "markdown-heading",
  "code-line",
  "notebook-cell",
  "docx-paragraph",
  "pptx-slide",
  "web-paragraph",
] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Library {
  id: LibraryId;
  organizationId: OrganizationId;
  name: string;
  slug: string;
  description?: string;
  visibility: LibraryVisibility;
  settings: Record<string, unknown>;
  createdBy: ActorId;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  archivedAt?: IsoTimestamp;
}

export interface LibraryMember {
  libraryId: LibraryId;
  userId: ActorId;
  displayName?: string;
  role: LibraryRole;
  status: MemberStatus;
  lastSeenAt?: IsoTimestamp;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface Collection {
  id: CollectionId;
  libraryId: LibraryId;
  parentCollectionId?: CollectionId;
  name: string;
  sortKey: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface Item {
  id: ItemId;
  libraryId: LibraryId;
  collectionId?: CollectionId;
  kind: ItemKind;
  title: string;
  canonicalName: string;
  sourceUrl?: string;
  metadata: Record<string, unknown>;
  currentVersionId?: VersionId;
  contentHash?: string;
  status: ItemStatus;
  createdBy: ActorId;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt?: IsoTimestamp;
}

export interface ItemChild {
  parentItemId: ItemId;
  childItemId: ItemId;
  relativePath: string;
  kind: ItemKind;
  sortKey: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface ItemVersion {
  id: VersionId;
  itemId: ItemId;
  versionNumber: number;
  blobId?: BlobId;
  manifest: Record<string, unknown>;
  contentHash: string;
  createdBy: ActorId;
  baseVersionId?: VersionId;
  createdAt: IsoTimestamp;
}

export interface Annotation {
  id: AnnotationId;
  itemId: ItemId;
  versionId: VersionId;
  authorId: ActorId;
  kind: AnnotationKind;
  target: SharedAnnotationTarget;
  quote?: Record<string, unknown>;
  geometry?: Record<string, unknown>;
  style: Record<string, unknown>;
  body: Record<string, unknown>;
  status: AnnotationStatus;
  revision: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt?: IsoTimestamp;
}

export interface AnnotationComment {
  id: CommentId;
  /** Parent annotation id; optional for legacy thread-only snapshots. */
  annotationId?: AnnotationId;
  parentId?: AnnotationId;
  authorId: ActorId;
  body: string;
  createdAt: IsoTimestamp;
  updatedAt?: IsoTimestamp;
  deletedAt?: IsoTimestamp;
}

export interface SyncOperation {
  id: OperationId;
  libraryId: LibraryId;
  actorId: ActorId;
  deviceId: DeviceId;
  clientSequence: number;
  operationType: string;
  entityType: string;
  entityId: string;
  baseVersion?: number;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: IsoTimestamp;
  appliedAt?: IsoTimestamp;
  rejectedAt?: IsoTimestamp;
  rejectionReason?: string;
}

export interface SyncCursor {
  libraryId: LibraryId;
  deviceId: DeviceId;
  cursor: string;
  updatedAt: IsoTimestamp;
}

export type ConflictReason =
  | "binary-version"
  | "annotation-revision"
  | "delete-edit"
  | "permission-revoked"
  | "quota-exceeded";

export interface SyncConflict {
  id: OperationId;
  entityType: string;
  entityId: string;
  localOperationId?: OperationId;
  remoteOperationId?: OperationId;
  reason: ConflictReason;
  localPayload?: Record<string, unknown>;
  remotePayload?: Record<string, unknown>;
  createdAt: IsoTimestamp;
  resolvedAt?: IsoTimestamp;
}

export interface SharedEvidenceRef {
  libraryId: LibraryId;
  itemId: ItemId;
  versionId?: VersionId;
  childItemId?: ItemId;
  sourceType: EvidenceSourceType;
  locator: Record<string, SharedLocatorValue>;
  quote?: string;
  createdAt: IsoTimestamp;
}

// UI-facing sync state; the engine keeps a finer internal state machine.
export const SYNC_STATUSES = [
  "local_only",
  "syncing",
  "synced",
  "offline",
  "conflicted",
  "failed",
] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isItemKind(value: unknown): value is ItemKind {
  return typeof value === "string" && (ITEM_KINDS as readonly string[]).includes(value);
}

export function isLibraryRole(value: unknown): value is LibraryRole {
  return typeof value === "string" && (LIBRARY_ROLES as readonly string[]).includes(value);
}

export function isAnnotationLocatorType(value: unknown): value is AnnotationLocatorType {
  return (
    typeof value === "string" &&
    (ANNOTATION_LOCATOR_TYPES as readonly string[]).includes(value)
  );
}

const MIME_TO_ITEM_KIND: Record<string, ItemKind> = {
  "application/pdf": "pdf",
  "text/x-typescript": "code",
  "text/typescript": "code",
  "application/typescript": "code",
  "application/x-typescript": "code",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "text/html": "web_snapshot",
  "application/xhtml+xml": "web_snapshot",
  "application/x-ipynb+json": "notebook",
  "application/json": "data",
  "text/plain": "data",
  "application/octet-stream": "data",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint": "pptx",
  "image/png": "image",
  "image/jpeg": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/svg+xml": "image",
  "image/bmp": "image",
};

/**
 * Maps a MIME type to a first-class `ItemKind`. Values that are already a
 * known kind are returned normalized; completely unknown inputs are returned
 * unchanged so callers can decide how to degrade.
 */
export function normalizeItemKind(input: string): string {
  if (typeof input !== "string") {
    return String(input);
  }
  const trimmed = input.trim().toLowerCase();
  if (isItemKind(trimmed)) {
    return trimmed;
  }
  return MIME_TO_ITEM_KIND[trimmed] ?? input;
}

/**
 * Builds the stable, per-device idempotency key used to deduplicate sync
 * operations. The key must be reproducible and must not depend on wall-clock
 * time.
 */
export function buildIdempotencyKey(input: { deviceId: string; clientSequence: number }): string {
  return `${input.deviceId}:${input.clientSequence}`;
}
