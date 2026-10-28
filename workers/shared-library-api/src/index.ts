/**
 * Deployable Shared Library API for Cloudflare Workers.
 *
 * The Worker is intentionally a thin policy-preserving facade over Supabase
 * PostgREST: it extracts the user subject from the bearer token, forwards the
 * same user JWT so Postgres RLS remains authoritative, converts camelCase API
 * payloads to the database schema, and returns stable JSON envelopes.
 */

import { StorageRequestError, SupabaseBlobStore, SUPABASE_MAX_UPLOAD_BYTES } from "./supabase-storage";
import { handleTeamAiRoute, type TeamAiEnv } from './team-ai';
import { dispatchGitHubIntegration, handleGitHubWebhook, processGitHubWebhookDeliveries, type GitHubIntegrationEnv } from './github';
import { handleGitHubJobs } from './github-jobs';
import { dispatch as dispatchAudit } from './collaboration-audit';
import type { CloudIntegrationContext } from './integration-context';

export interface SharedLibraryWorkerEnv extends TeamAiEnv, GitHubIntegrationEnv {
  GITHUB_SYNC_JOB_SECRET?: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  ALLOWED_ORIGINS?: string;
  /** Optional Cloudflare R2 binding. Metadata remains authoritative in Supabase. */
  LIBRARY_BLOBS?: R2BucketLike;
  /** New uploads use this backend. Stored descriptors retain their backend. */
  BLOB_BACKEND?: "r2" | "supabase";
  MAX_UPLOAD_BYTES?: string;
  /** Trusted deployment adapter sets this when the API has a gateway prefix. */
  PUBLIC_API_BASE_URL?: string;
}

interface R2MultipartUploadLike {
  uploadId: string;
  key: string;
  uploadPart(partNumber: number, data: ArrayBuffer): Promise<{ etag: string }>;
  complete(parts: Array<{ partNumber: number; etag: string }>): Promise<void>;
  abort(): Promise<void>;
}

interface R2ObjectLike {
  body: ReadableStream<Uint8Array> | null;
  httpMetadata?: { contentType?: string; contentLength?: number };
}

interface R2BucketLike {
  put?(key: string, data: ArrayBuffer, options?: { httpMetadata?: Record<string, string> }): Promise<unknown>;
  createMultipartUpload(key: string, options?: { httpMetadata?: Record<string, string> }): Promise<R2MultipartUploadLike>;
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUploadLike;
  get(key: string): Promise<R2ObjectLike | null>;
}

interface DbRecord {
  [key: string]: unknown;
}

interface ActorContext {
  accessToken: string;
  userId: string;
}

function requestId(): string {
  return `sl-${crypto.randomUUID()}`;
}

function corsHeaders(request: Request, env: SharedLibraryWorkerEnv, id: string): Headers {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const headers = new Headers({
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,idempotency-key",
    "access-control-expose-headers": "x-request-id",
    "x-request-id": id,
    "cache-control": "no-store",
  });
  if (origin && (allowed.length === 0 || allowed.includes(origin))) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  return headers;
}

function json(request: Request, env: SharedLibraryWorkerEnv, id: string, body: unknown, status = 200): Response {
  const headers = corsHeaders(request, env, id);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(
  request: Request,
  env: SharedLibraryWorkerEnv,
  id: string,
  code: string,
  message: string,
  status: number,
  retryable = false,
): Response {
  return json(request, env, id, { error: { code, message, retryable, requestId: id } }, status);
}

function parseJwtSubject(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}

function requireActor(request: Request): ActorContext | Response {
  const header = request.headers.get("Authorization") ?? "";
  const accessToken = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const userId = accessToken ? parseJwtSubject(accessToken) : null;
  if (!accessToken || !userId) {
    return new Response(null, { status: 401 });
  }
  return { accessToken, userId };
}

async function dbRequest(
  env: SharedLibraryWorkerEnv,
  actor: ActorContext,
  table: string,
  init: RequestInit = {},
  query?: Record<string, string | number | undefined>,
): Promise<{ response: Response; body: unknown }> {
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL.replace(/\/+$/, ""));
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, String(value));
  });
  const headers = new Headers(init.headers);
  headers.set("apikey", env.SUPABASE_ANON_KEY);
  headers.set("authorization", `Bearer ${actor.accessToken}`);
  headers.set("accept", "application/json");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { response, body };
}

function mapLibrary(record: DbRecord): DbRecord {
  return {
    id: record.id,
    organizationId: record.organization_id,
    name: record.name,
    slug: record.slug,
    description: record.description,
    visibility: record.visibility,
    settings: record.settings ?? {},
    createdBy: record.created_by,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    ...(record.archived_at ? { archivedAt: record.archived_at } : {}),
  };
}

function mapItem(record: DbRecord): DbRecord {
  return {
    id: record.id,
    libraryId: record.library_id,
    collectionId: record.collection_id ?? undefined,
    kind: record.kind,
    title: record.title,
    canonicalName: record.canonical_name,
    sourceUrl: record.source_url ?? undefined,
    metadata: record.metadata ?? {},
    currentVersionId: record.current_version_id ?? undefined,
    contentHash: record.content_hash ?? undefined,
    status: record.status,
    createdBy: record.created_by,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    deletedAt: record.deleted_at ?? undefined,
  };
}

function mapChild(record: DbRecord): DbRecord {
  return {
    parentItemId: record.parent_item_id,
    childItemId: record.child_item_id,
    relativePath: record.relative_path,
    kind: record.kind,
    sortKey: record.sort_key,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function mapVersion(record: DbRecord): DbRecord {
  return {
    id: record.id,
    itemId: record.item_id,
    versionNumber: record.version_number,
    blobId: record.blob_id ?? undefined,
    manifest: record.manifest ?? {},
    contentHash: record.content_hash,
    createdBy: record.created_by,
    baseVersionId: record.base_version_id ?? undefined,
    createdAt: record.created_at,
  };
}

function mapAnnotation(record: DbRecord): DbRecord {
  return {
    id: record.id,
    itemId: record.item_id,
    versionId: record.version_id,
    authorId: record.author_id,
    kind: record.kind,
    target: record.target,
    quote: record.quote ?? undefined,
    geometry: record.geometry ?? undefined,
    style: record.style ?? {},
    body: record.body ?? {},
    status: record.status,
    revision: record.revision,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    deletedAt: record.deleted_at ?? undefined,
  };
}

function mapComment(record: DbRecord): DbRecord {
  return {
    id: record.id,
    annotationId: record.annotation_id,
    ...(record.parent_id ? { parentId: record.parent_id } : {}),
    authorId: record.author_id,
    body: record.body,
    createdAt: record.created_at,
    ...(record.updated_at ? { updatedAt: record.updated_at } : {}),
    ...(record.deleted_at ? { deletedAt: record.deleted_at } : {}),
  };
}

function mapOperation(record: DbRecord): DbRecord {
  return {
    id: record.id,
    libraryId: record.library_id,
    actorId: record.actor_id,
    deviceId: record.device_id,
    clientSequence: record.client_sequence,
    operationType: record.operation_type,
    entityType: record.entity_type,
    entityId: record.entity_id,
    baseVersion: record.base_version ?? undefined,
    payload: record.payload ?? {},
    idempotencyKey: record.idempotency_key,
    createdAt: record.created_at,
    appliedAt: record.applied_at ?? undefined,
    rejectedAt: record.rejected_at ?? undefined,
    rejectionReason: record.rejection_reason ?? undefined,
  };
}

function sanitizeSearchTerm(value: string): string {
  return value
    .replace(/[,*()%]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function mapSearchResult(record: DbRecord): DbRecord {
  const body = typeof record.body === "string" ? record.body : "";
  const snippet = typeof record.snippet === "string" && record.snippet
    ? record.snippet
    : body.slice(0, 240);
  const permissionSnapshot = record.permission_snapshot && typeof record.permission_snapshot === "object"
    ? record.permission_snapshot
    : {};
  return {
    itemId: record.item_id,
    ...(record.child_item_id ? { childItemId: record.child_item_id } : {}),
    sourceType: typeof record.source_type === "string" ? record.source_type : "item",
    snippet,
    locator: record.locator && typeof record.locator === "object"
      ? { locatorType: "search", locator: record.locator }
      : undefined,
    permissionSnapshot: {
      libraryId: record.library_id,
      itemId: record.item_id,
      canRead: true,
      ...(permissionSnapshot && typeof (permissionSnapshot as DbRecord).role === "string"
        ? { role: (permissionSnapshot as DbRecord).role }
        : {}),
    },
    updatedAt: record.updated_at,
    ...(typeof record.score === "number" ? { score: record.score } : {}),
  };
}

const MAX_DEFAULT_UPLOAD_BYTES = 100 * 1024 * 1024;

function maxUploadBytes(env: SharedLibraryWorkerEnv): number {
  const configured = Number(env.MAX_UPLOAD_BYTES ?? "");
  const limit = Number.isSafeInteger(configured) && configured > 0 ? configured : MAX_DEFAULT_UPLOAD_BYTES;
  return Math.min(limit, env.BLOB_BACKEND === "supabase" ? SUPABASE_MAX_UPLOAD_BYTES : Infinity);
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isAllowedUploadMime(mimeType: string): boolean {
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mimeType);
}

interface UploadDescriptor { libraryId: string; key: string; uploadId: string; fileName: string; mimeType: string; sizeBytes: number; partSize?: number; storageBackend?: "r2" | "supabase" }

function encodeUploadSession(input: UploadDescriptor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeUploadSession(value: string): UploadDescriptor | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    return typeof parsed.libraryId === "string" && typeof parsed.key === "string" && typeof parsed.uploadId === "string" && typeof parsed.fileName === "string" && typeof parsed.mimeType === "string" && typeof parsed.sizeBytes === "number"
      ? { libraryId: parsed.libraryId, key: parsed.key, uploadId: parsed.uploadId, fileName: parsed.fileName, mimeType: parsed.mimeType, sizeBytes: parsed.sizeBytes, ...(Number.isSafeInteger(parsed.partSize) && Number(parsed.partSize) > 0 ? { partSize: Number(parsed.partSize) } : {}), ...(parsed.storageBackend === "supabase" ? { storageBackend: "supabase" as const } : {}) }
      : null;
  } catch {
    return null;
  }
}

function requireBlobBinding(request: Request, env: SharedLibraryWorkerEnv, id: string, actor: ActorContext, backend = env.BLOB_BACKEND ?? "r2"): R2BucketLike | SupabaseBlobStore | Response {
  if (backend === "supabase") return new SupabaseBlobStore(env, actor.accessToken);
  if (!env.LIBRARY_BLOBS) {
    return errorResponse(request, env, id, "STORAGE_UNAVAILABLE", "Object storage is not configured", 503, true);
  }
  return env.LIBRARY_BLOBS;
}

async function readBody(request: Request): Promise<DbRecord> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? body as DbRecord : {};
}

/** Bound binary request memory even when the sender omits Content-Length. */
async function readUploadPart(request: Request, expectedSize: number): Promise<ArrayBuffer | null> {
  if (!request.body) return expectedSize === 0 ? new ArrayBuffer(0) : null;
  const reader = request.body.getReader();
  const data = new Uint8Array(expectedSize);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return offset === expectedSize ? data.buffer : null;
      if (offset + value.byteLength > expectedSize) { await reader.cancel(); return null; }
      data.set(value, offset); offset += value.byteLength;
    }
  } finally { reader.releaseLock(); }
}

/** Storage RLS and the database guard prevent deletion/abort of committed blobs. */
async function cleanInvalidStorageUpload(env: SharedLibraryWorkerEnv, actor: ActorContext, storage: SupabaseBlobStore, session: UploadDescriptor, uploadToken: string): Promise<boolean> {
  await storage.remove(session.key);
  const remaining = await storage.get(session.key);
  if (remaining) { await remaining.body?.cancel(); return false; }
  const aborted = await dbRequest(env, actor, "cloud_upload_sessions", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "aborted" }) }, { id: `eq.${uploadToken}`, library_id: `eq.${session.libraryId}` });
  return aborted.response.ok && Array.isArray(aborted.body) && (aborted.body[0] as DbRecord | undefined)?.state === "aborted";
}

async function handleRequest(request: Request, env: SharedLibraryWorkerEnv, id: string): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/v1/integrations/github/webhook') return handleGitHubWebhook(request, env);
  if (path === '/v1/integrations/github/jobs/run') return handleGitHubJobs(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env, id) });
  const actorResult = requireActor(request);
  if (actorResult instanceof Response) return errorResponse(request, env, id, "UNAUTHORIZED", "Authentication required", 401);
  const actor = actorResult;
  const url = new URL(request.url);
  const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (segments[0] !== "v1") return errorResponse(request, env, id, "NOT_FOUND", "Route not found", 404);

  try {
    const integrationContext: CloudIntegrationContext = {
      env, actor, segments, url,
      db: (table, init, query) => dbRequest(env, actor, table, init, query),
      json: (body, status) => json(request, env, id, body, status),
      error: (code, message, status, retryable) => errorResponse(request, env, id, code, message, status, retryable),
    };
    for (const dispatch of [handleTeamAiRoute, dispatchGitHubIntegration, dispatchAudit]) {
      const result = await dispatch(request, integrationContext);
      if (result) return result;
    }
    if (segments[1] === "invitations" && segments[2] === "accept" && request.method === "POST") {
      const input = await readBody(request);
      if (typeof input.token !== "string" || !/^[a-f0-9]{64}$/.test(input.token)) return errorResponse(request, env, id, "INVALID_INPUT", "Invalid invitation token", 400);
      const hash = await sha256Hex(new TextEncoder().encode(input.token).buffer);
      const result = await dbRequest(env, actor, "rpc/cloud_accept_invitation", { method: "POST", body: JSON.stringify({ p_hash: hash }) });
      return result.response.ok ? json(request, env, id, { libraryId: result.body }) : errorResponse(request, env, id, "FORBIDDEN", "Invitation invalid, expired or revoked", 403);
    }
    if (segments[1] === "search" && request.method === "GET") {
      const term = sanitizeSearchTerm(url.searchParams.get("q") ?? "");
      if (!term) return json(request, env, id, { results: [] });
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 100);
      const cursor = url.searchParams.get("cursor") ?? undefined;
      const result = await dbRequest(env, actor, "search_documents", undefined, {
        select: "*",
        or: `title.ilike.*${term}*,body.ilike.*${term}*`,
        ...(cursor ? { updated_at: `gt.${cursor}` } : {}),
        order: "updated_at.asc,id.asc",
        limit,
      });
      if (!result.response.ok) {
        return errorResponse(request, env, id, "DATABASE_ERROR", "Unable to search shared libraries", result.response.status, result.response.status >= 500);
      }
      const rows = Array.isArray(result.body) ? result.body as DbRecord[] : [];
      return json(request, env, id, {
        results: rows.map(mapSearchResult),
        ...(rows.length > 0 ? { nextCursor: String(rows[rows.length - 1].updated_at) } : {}),
        total: rows.length,
      });
    }

    if (segments[1] === "annotations" && segments[2] && segments[3] === "comments") {
      const annotationId = segments[2];
      if (request.method === "GET" && segments.length === 4) {
        const result = await dbRequest(env, actor, "annotation_comments", undefined, { select: "*", annotation_id: `eq.${annotationId}`, order: "created_at.asc" });
        return result.response.ok ? json(request, env, id, (result.body as DbRecord[]).map(mapComment)) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to list comments", result.response.status, result.response.status >= 500);
      }
      if (request.method === "POST" && segments.length === 4) {
        const input = await readBody(request);
        const body = typeof input.body === "string" ? input.body.trim() : "";
        if (!body || body.length > 20_000) return errorResponse(request, env, id, "INVALID_INPUT", "Comment body is required", 400);
        if (input.id) {
          const existing = await dbRequest(env, actor, "annotation_comments", undefined, { id: `eq.${input.id}`, annotation_id: `eq.${annotationId}`, select: "*" });
          const prior = Array.isArray(existing.body) ? existing.body[0] as DbRecord : null;
          if (prior) return prior.author_id === actor.userId ? json(request, env, id, mapComment(prior)) : errorResponse(request, env, id, "FORBIDDEN", "Comment belongs to another actor", 403);
        }
        const result = await dbRequest(env, actor, "annotation_comments", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...(input.id ? { id: input.id } : {}), annotation_id: annotationId, parent_id: typeof input.parentId === "string" ? input.parentId : null, author_id: actor.userId, body }) });
        const record = Array.isArray(result.body) ? result.body[0] : result.body;
        return result.response.ok ? json(request, env, id, mapComment(record as DbRecord), 201) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to create comment", result.response.status, result.response.status >= 500);
      }
    }

    if (segments[1] === "comments" && segments[2] && segments.length === 3) {
      const commentId = segments[2];
      if (request.method === "PATCH") {
        const input = await readBody(request);
        const body = typeof input.body === "string" ? input.body.trim() : "";
        if (!body || body.length > 20_000) return errorResponse(request, env, id, "INVALID_INPUT", "Comment body is required", 400);
        const result = await dbRequest(env, actor, "annotation_comments", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ body, updated_at: new Date().toISOString() }) }, { id: `eq.${commentId}` });
        const record = Array.isArray(result.body) ? result.body[0] : result.body;
        return result.response.ok ? json(request, env, id, mapComment(record as DbRecord)) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to update comment", result.response.status, result.response.status >= 500);
      }
      if (request.method === "DELETE") {
        const result = await dbRequest(env, actor, "annotation_comments", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }, { id: `eq.${commentId}` });
        return result.response.ok ? json(request, env, id, { deleted: true }) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to delete comment", result.response.status, result.response.status >= 500);
      }
    }

    if (segments[1] === "libraries" && segments.length === 2) {
      if (request.method === "GET") {
        const organizationId = url.searchParams.get("organizationId") ?? undefined;
        const result = await dbRequest(env, actor, "libraries", undefined, { select: "*", ...(organizationId ? { organization_id: `eq.${organizationId}` } : {}), order: "updated_at.desc" });
        return result.response.ok ? json(request, env, id, (result.body as DbRecord[]).map(mapLibrary)) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to list libraries", result.response.status, result.response.status >= 500);
      }
      if (request.method === "POST") {
        const input = await readBody(request);
        let organizationId = typeof input.organizationId === "string" ? input.organizationId : null;
        if (!organizationId) {
          const organization = await dbRequest(env, actor, "organizations", {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({ name: input.name ?? "Lattice Organization", slug: `org-${crypto.randomUUID()}`, created_by: actor.userId }),
          });
          const createdOrganization = Array.isArray(organization.body) ? organization.body[0] as DbRecord | undefined : undefined;
          organizationId = typeof createdOrganization?.id === "string" ? createdOrganization.id : null;
        }
        if (!organizationId) return errorResponse(request, env, id, "VALIDATION_FAILED", "organizationId is required", 422);
        const result = await dbRequest(env, actor, "libraries", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ organization_id: organizationId, name: input.name, slug: input.slug ?? String(input.name ?? "library").toLowerCase().replace(/[^a-z0-9]+/g, "-"), description: input.description ?? null, visibility: input.visibility ?? "private", created_by: actor.userId }),
        });
        const record = Array.isArray(result.body) ? result.body[0] : result.body;
        return result.response.ok ? json(request, env, id, mapLibrary(record as DbRecord), 201) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to create library", result.response.status);
      }
    }

    if (segments[1] === "libraries" && segments[2]) {
      const libraryId = segments[2];
      if (segments[3] === "changes" && request.method === "GET") {
        const cursor = url.searchParams.get("cursor") ?? "0";
        if (!/^\d+$/.test(cursor)) return errorResponse(request, env, id, "INVALID_INPUT", "Invalid change cursor", 400);
        const requestedLimit = Number(url.searchParams.get("limit") ?? 200);
        const limit = Number.isFinite(requestedLimit) ? Math.min(500, Math.max(1, Math.floor(requestedLimit))) : 200;
        const access = await dbRequest(env, actor, "library_members", undefined, { library_id: `eq.${libraryId}`, user_id: `eq.${actor.userId}`, status: "eq.active", select: "role" });
        if (!access.response.ok || !Array.isArray(access.body) || !access.body.length) return errorResponse(request, env, id, "FORBIDDEN", "Active library membership required", 403);
        const result = await dbRequest(env, actor, "cloud_library_changes", undefined, { library_id: `eq.${libraryId}`, sequence: `gt.${cursor}`, select: "*", order: "sequence.asc", limit });
        if (!result.response.ok) return errorResponse(request, env, id, "DATABASE_ERROR", "Unable to read changes", result.response.status, result.response.status >= 500);
        const rows = Array.isArray(result.body) ? result.body as DbRecord[] : [];
        return json(request, env, id, { changes: rows.map(row => ({ sequence: String(row.sequence), type: row.entity_type, value: row.entity_type === "item" ? mapItem(row.payload as DbRecord) : row.entity_type === "annotation" ? mapAnnotation(row.payload as DbRecord) : mapComment(row.payload as DbRecord) })), cursor: rows.length ? String(rows.at(-1)!.sequence) : cursor, hasMore: rows.length === limit });
      }
      if (segments[3] === "usage" && request.method === "GET") {
        const result = await dbRequest(env, actor, "rpc/cloud_library_usage", { method: "POST", body: JSON.stringify({ p_library_id: libraryId }) });
        return result.response.ok ? json(request, env, id, { ...(result.body as DbRecord), maxFileBytes: maxUploadBytes(env) }) : errorResponse(request, env, id, "FORBIDDEN", "Library usage access denied", 403);
      }
      if (segments[3] === "health" && request.method === "GET") {
        const result = await dbRequest(env, actor, "rpc/cloud_library_health", { method: "POST", body: JSON.stringify({ p_library_id: libraryId }) });
        return result.response.ok ? json(request, env, id, { ...(result.body as DbRecord), maxFileBytes: maxUploadBytes(env) }) : errorResponse(request, env, id, result.response.status >= 500 || result.response.status === 404 ? "DATABASE_ERROR" : "FORBIDDEN", "Library health check unavailable or admin access denied", result.response.status >= 500 || result.response.status === 404 ? 503 : 403, result.response.status >= 500 || result.response.status === 404);
      }
      if (["items", "sync"].includes(segments[3]) && request.method === "GET") {
        const access = await dbRequest(env, actor, "library_members", undefined, { library_id: `eq.${libraryId}`, user_id: `eq.${actor.userId}`, status: "eq.active", select: "role" });
        if (!access.response.ok || !Array.isArray(access.body) || access.body.length === 0) return errorResponse(request, env, id, "FORBIDDEN", "Active library membership required", 403);
      }
      if (segments[3] === "members") {
        const memberId = segments[4] === "me" ? actor.userId : segments[4];
        if (request.method === "GET") {
          const result = await dbRequest(env, actor, "library_members", undefined, { select: "*", library_id: `eq.${libraryId}`, ...(memberId ? { user_id: `eq.${memberId}`, status: "eq.active" } : {}) });
          const entries = Array.isArray(result.body) ? result.body as DbRecord[] : [];
          const mapped = entries.map(m => ({ libraryId: m.library_id, userId: m.user_id, displayName: m.display_name ?? undefined, role: m.role, status: m.status, createdAt: m.created_at, updatedAt: m.updated_at }));
          if (!result.response.ok || (memberId && mapped.length === 0)) return errorResponse(request, env, id, "FORBIDDEN", "Library membership required", 403);
          return json(request, env, id, memberId ? mapped[0] : mapped);
        }
        if (memberId && (request.method === "PATCH" || request.method === "DELETE")) {
          const input = request.method === "PATCH" ? await readBody(request) : {};
          if (request.method === "PATCH" && input.displayName !== undefined) {
            if (segments[4] !== "me" || typeof input.displayName !== "string" || !input.displayName.trim() || input.displayName.trim().length > 60 || Object.keys(input).some(key => key !== "displayName")) return errorResponse(request, env, id, "INVALID_INPUT", "Set only your own 1–60 character nickname", 400);
            const result = await dbRequest(env, actor, "rpc/cloud_set_member_display_name", { method: "POST", body: JSON.stringify({ p_library_id: libraryId, p_display_name: input.displayName.trim() }) });
            const record = (Array.isArray(result.body) ? result.body[0] : result.body) as DbRecord | undefined;
            return result.response.ok && record?.user_id ? json(request, env, id, { libraryId: record.library_id, userId: record.user_id, displayName: record.display_name, role: record.role, status: record.status, createdAt: record.created_at, updatedAt: record.updated_at }) : errorResponse(request, env, id, "FORBIDDEN", "Nickname change denied", 403);
          }
          if (request.method === "PATCH" && (input.role !== undefined ? !["viewer", "commenter", "editor", "admin"].includes(String(input.role)) : input.status !== "suspended")) return errorResponse(request, env, id, "INVALID_INPUT", "Invalid member role or status", 400);
          const result = await dbRequest(env, actor, "library_members", { method: request.method, headers: { Prefer: "return=representation" }, ...(request.method === "PATCH" ? { body: JSON.stringify({ ...(input.role !== undefined ? { role: input.role } : { status: input.status }), updated_at: new Date().toISOString() }) } : {}) }, { library_id: `eq.${libraryId}`, user_id: `eq.${memberId}`, role: "neq.owner" });
          return result.response.ok && Array.isArray(result.body) && result.body.length ? json(request, env, id, { changed: true }) : errorResponse(request, env, id, "FORBIDDEN", "Member change denied", 403);
        }
      }
      if (segments[3] === "invitations") {
        if (segments.length === 4 && request.method === "POST") {
          const input = await readBody(request);
          if (typeof input.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || !["viewer", "commenter", "editor", "admin"].includes(String(input.role))) return errorResponse(request, env, id, "INVALID_INPUT", "Email and role required", 400);
          const token = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");
          const tokenHash = await sha256Hex(new TextEncoder().encode(token).buffer);
          const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
          const result = await dbRequest(env, actor, "invitations", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ library_id: libraryId, email: input.email.toLowerCase(), role: input.role, token: tokenHash, expires_at: expiresAt, invited_by: actor.userId }) });
          const record = Array.isArray(result.body) ? result.body[0] as DbRecord : null;
          return result.response.ok && record ? json(request, env, id, { id: record.id, token, expiresAt }, 201) : errorResponse(request, env, id, "FORBIDDEN", "Invitation permission required", 403);
        }
        if (segments.length === 4 && request.method === "GET") {
          const result = await dbRequest(env, actor, "invitations", undefined, { library_id: `eq.${libraryId}`, select: "id,email,role,status,expires_at" });
          return result.response.ok ? json(request, env, id, result.body) : errorResponse(request, env, id, "FORBIDDEN", "Invitation permission required", 403);
        }
        if (segments[4] && request.method === "DELETE") {
          const result = await dbRequest(env, actor, "invitations", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "revoked" }) }, { library_id: `eq.${libraryId}`, id: `eq.${segments[4]}` });
          return result.response.ok && Array.isArray(result.body) && result.body.length ? json(request, env, id, { revoked: true }) : errorResponse(request, env, id, "FORBIDDEN", "Invitation revocation denied", 403);
        }
      }
      if (segments.length === 3 && request.method === "GET") {
        const result = await dbRequest(env, actor, "libraries", undefined, { select: "*", id: `eq.${libraryId}` });
        const record = Array.isArray(result.body) ? result.body[0] : null;
        return record ? json(request, env, id, mapLibrary(record as DbRecord)) : errorResponse(request, env, id, "NOT_FOUND", "Library not found", 404);
      }
      if (segments[3] === "items") {
        if (segments.length === 4 && request.method === "GET") {
          const collectionId = url.searchParams.get("collectionId") ?? undefined;
          const includeTrashed = url.searchParams.get("includeTrashed") === "true";
          const result = await dbRequest(env, actor, "items", undefined, { select: "*", library_id: `eq.${libraryId}`, ...(collectionId ? { collection_id: `eq.${collectionId}` } : {}), ...(!includeTrashed ? { status: "neq.trashed" } : {}), order: "updated_at.desc" });
          return result.response.ok ? json(request, env, id, (result.body as DbRecord[]).map(mapItem)) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to list items", result.response.status, result.response.status >= 500);
        }
        if (segments.length === 4 && request.method === "POST") {
          const input = await readBody(request);
          if (typeof input.id === "string") {
            const existing = await dbRequest(env, actor, "items", undefined, { id: `eq.${input.id}`, library_id: `eq.${libraryId}`, select: "*" });
            const prior = Array.isArray(existing.body) ? existing.body[0] as DbRecord : null;
            if (prior) return prior.created_by === actor.userId ? json(request, env, id, mapItem(prior)) : errorResponse(request, env, id, "FORBIDDEN", "Item id belongs to another actor", 403);
          }
          const result = await dbRequest(env, actor, "items", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...(input.id ? { id: input.id } : {}), library_id: libraryId, collection_id: input.collectionId ?? null, kind: input.kind, title: input.title, canonical_name: input.canonicalName, source_url: input.sourceUrl ?? null, metadata: input.metadata ?? {}, created_by: actor.userId }) });
          const record = Array.isArray(result.body) ? result.body[0] : result.body;
          return result.response.ok ? json(request, env, id, mapItem(record as DbRecord), 201) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to create item", result.response.status);
        }
      }
      if (segments[3] === "search" && request.method === "GET") {
        const membership = await dbRequest(env, actor, "library_members", undefined, { library_id: `eq.${libraryId}`, user_id: `eq.${actor.userId}`, status: "eq.active", select: "role" });
        if (!membership.response.ok || !Array.isArray(membership.body) || membership.body.length === 0) return errorResponse(request, env, id, "FORBIDDEN", "Active library membership required", 403);
        const term = sanitizeSearchTerm(url.searchParams.get("q") ?? "");
        if (!term) return json(request, env, id, { results: [] });
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 100);
        const cursor = url.searchParams.get("cursor") ?? undefined;
        const result = await dbRequest(env, actor, "search_documents", undefined, {
          select: "*",
          library_id: `eq.${libraryId}`,
          or: `title.ilike.*${term}*,body.ilike.*${term}*`,
          ...(cursor ? { updated_at: `gt.${cursor}` } : {}),
          order: "updated_at.asc,id.asc",
          limit,
        });
        if (!result.response.ok) {
          return errorResponse(request, env, id, "DATABASE_ERROR", "Unable to search shared library", result.response.status, result.response.status >= 500);
        }
        const rows = Array.isArray(result.body) ? result.body as DbRecord[] : [];
        return json(request, env, id, {
          results: rows.map(mapSearchResult),
          ...(rows.length > 0 ? { nextCursor: String(rows[rows.length - 1].updated_at) } : {}),
          total: rows.length,
        });
      }
      if (segments[3] === "uploads") {
        const membership = await dbRequest(env, actor, "library_members", undefined, { library_id: `eq.${libraryId}`, user_id: `eq.${actor.userId}`, status: "eq.active", select: "role" });
        const member = Array.isArray(membership.body) ? membership.body[0] as DbRecord : null;
        if (!membership.response.ok || !member || !["editor", "admin", "owner"].includes(String(member.role))) return errorResponse(request, env, id, "FORBIDDEN", "Upload requires an active editor", 403);
        if (segments[4] === "cleanup" && segments.length === 5 && request.method === "POST") {
          const stale = await dbRequest(env, actor, "cloud_upload_sessions", undefined, { library_id: `eq.${libraryId}`, ...(["owner", "admin"].includes(String(member.role)) ? {} : { user_id: `eq.${actor.userId}` }), state: "eq.active", expires_at: `lt.${new Date().toISOString()}`, select: "id,descriptor", limit: 25 });
          if (!stale.response.ok) return errorResponse(request, env, id, "DATABASE_ERROR", "Unable to list expired uploads", stale.response.status, true);
          let cleaned = 0;
          for (const row of Array.isArray(stale.body) ? stale.body as DbRecord[] : []) {
            const descriptor = row.descriptor as UploadDescriptor;
            if (descriptor?.storageBackend !== "supabase" || !descriptor.key?.startsWith(`libraries/${libraryId}/blobs/`)) continue;
            await new SupabaseBlobStore(env, actor.accessToken).remove(descriptor.key);
            const aborted = await dbRequest(env, actor, "cloud_upload_sessions", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "aborted" }) }, { id: `eq.${row.id}`, library_id: `eq.${libraryId}` });
            if (!aborted.response.ok || !Array.isArray(aborted.body) || (aborted.body[0] as DbRecord | undefined)?.state !== "aborted") return errorResponse(request, env, id, "DATABASE_ERROR", "Cleanup failed; capacity remains reserved", aborted.response.ok ? 503 : aborted.response.status, true);
            cleaned++;
          }
          return json(request, env, id, { cleaned, batchLimit: 25 });
        }
        if (segments.length === 4 && request.method === "POST") {
          const storage = requireBlobBinding(request, env, id, actor);
          if (storage instanceof Response) return storage;
          const input = await readBody(request);
          const fileName = typeof input.fileName === "string" ? input.fileName.trim() : "";
          const mimeType = typeof input.mimeType === "string" ? input.mimeType.trim().toLowerCase() : "";
          const sizeBytes = Number(input.sizeBytes);
          if (!fileName || fileName.length > 255 || /[\\/\u0000]/.test(fileName)) {
            return errorResponse(request, env, id, "INVALID_INPUT", "A safe fileName is required", 400);
          }
          if (!mimeType || !isAllowedUploadMime(mimeType)) {
            return errorResponse(request, env, id, "INVALID_INPUT", "File type is not allowed", 400);
          }
          if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > Math.min(maxUploadBytes(env), storage instanceof SupabaseBlobStore ? SUPABASE_MAX_UPLOAD_BYTES : Infinity)) {
            return errorResponse(request, env, id, "QUOTA_EXCEEDED", "File exceeds the configured upload limit; local bytes are retained", 413);
          }
          const operationKey = request.headers.get("idempotency-key");
          if (operationKey && !/^[a-f0-9-]{36}$/i.test(operationKey)) return errorResponse(request, env, id, "INVALID_INPUT", "Upload idempotency key must be a UUID", 400);
          if (operationKey) {
            const prior = await dbRequest(env, actor, "cloud_upload_sessions", undefined, { id: `eq.${operationKey}`, library_id: `eq.${libraryId}`, user_id: `eq.${actor.userId}`, select: "descriptor,created_at,expires_at,state" });
            const record = Array.isArray(prior.body) ? prior.body[0] as DbRecord : null;
            if (record) {
              const descriptor = record.descriptor as DbRecord;
              if (descriptor.fileName !== fileName || descriptor.mimeType !== mimeType || descriptor.sizeBytes !== sizeBytes) return errorResponse(request, env, id, "INVALID_INPUT", "Upload replay payload changed", 400);
              if (record.state === "aborted" || Date.parse(String(record.expires_at)) < Date.now()) return errorResponse(request, env, id, "UPLOAD_EXPIRED", "Upload session expired", 410);
              return json(request, env, id, { uploadId: operationKey, libraryId, fileName, mimeType, sizeBytes, ...(descriptor.partSize ? { partSize: descriptor.partSize } : {}), status: "initiated", createdAt: record.created_at });
            }
          }
          const key = `libraries/${libraryId}/blobs/${crypto.randomUUID()}`;
          const multipart = storage instanceof SupabaseBlobStore ? null : await storage.createMultipartUpload(key, { httpMetadata: { contentType: mimeType } });
          const uploadId = operationKey ?? crypto.randomUUID();
          const partSize = storage instanceof SupabaseBlobStore ? Math.max(sizeBytes, 1) : 5 * 1024 * 1024;
          const descriptor = { libraryId, key, uploadId: multipart?.uploadId ?? uploadId, fileName, mimeType, sizeBytes, partSize, storageBackend: storage instanceof SupabaseBlobStore ? "supabase" : "r2" };
          const registered = await dbRequest(env, actor, "cloud_upload_sessions", { method: "POST", body: JSON.stringify({ id: uploadId, library_id: libraryId, user_id: actor.userId, descriptor }) });
          if (!registered.response.ok) { await multipart?.abort(); const quota = (registered.body as DbRecord)?.code === "P0001"; return errorResponse(request, env, id, quota ? "QUOTA_EXCEEDED" : "DATABASE_ERROR", quota ? "Library or service storage quota exceeded; local bytes are retained" : "Unable to persist upload session", quota ? 413 : registered.response.status, !quota); }
          return json(request, env, id, {
            uploadId,
            libraryId,
            fileName,
            mimeType,
            sizeBytes,
            partSize,
            status: "initiated",
            createdAt: new Date().toISOString(),
          }, 201);
        }
        const uploadToken = segments[4];
        const sessionResult = uploadToken ? await dbRequest(env, actor, "cloud_upload_sessions", undefined, { id: `eq.${uploadToken}`, library_id: `eq.${libraryId}`, user_id: `eq.${actor.userId}`, select: "descriptor,expires_at,state" }) : null;
        const sessionRecord = sessionResult && Array.isArray(sessionResult.body) ? sessionResult.body[0] as DbRecord : null;
        const session = sessionRecord?.descriptor ? decodeUploadSession(encodeUploadSession(sessionRecord.descriptor as Parameters<typeof encodeUploadSession>[0])) : null;
        if (sessionRecord && Date.parse(String(sessionRecord.expires_at)) < Date.now() && segments[5] !== "abort" && !(segments[5] === "complete" && sessionRecord.state === "complete")) return errorResponse(request, env, id, "UPLOAD_EXPIRED", "Upload expired; restart while retaining local bytes", 410);
        if (!session || session.libraryId !== libraryId) {
          return errorResponse(request, env, id, "NOT_FOUND", "Upload session not found", 404);
        }
        if (!session.key.startsWith(`libraries/${libraryId}/blobs/`)) return errorResponse(request, env, id, "FORBIDDEN", "Upload key outside library", 403);
        if (sessionRecord?.state === "aborted" && segments[5] === "abort" && request.method === "POST") return json(request, env, id, { aborted: true });
        if (sessionRecord?.state === "aborted" || (segments[5] === "parts" && sessionRecord?.state === "complete")) return errorResponse(request, env, id, "UPLOAD_EXPIRED", "Upload is no longer active", 410);
        const storage = requireBlobBinding(request, env, id, actor, session.storageBackend ?? "r2");
        if (storage instanceof Response) return storage;
        const multipart = storage instanceof SupabaseBlobStore ? null : storage.resumeMultipartUpload(session.key, session.uploadId);
        if (segments[5] === "parts" && request.method === "PUT" && segments.length === 7) {
          const partNumber = Number(segments[6]);
          if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
            return errorResponse(request, env, id, "INVALID_INPUT", "Invalid upload part number", 400);
          }
          const partSize = session.partSize ?? 5 * 1024 * 1024;
          const expectedSize = Math.min(partSize, Math.max(session.sizeBytes - (partNumber - 1) * partSize, 0));
          const declaredLength = request.headers.get("content-length");
          if (declaredLength !== null && Number(declaredLength) !== expectedSize) return errorResponse(request, env, id, "INVALID_INPUT", "Part does not match declared file size", 400);
          if (partNumber > Math.max(1, Math.ceil(session.sizeBytes / partSize))) return errorResponse(request, env, id, "INVALID_INPUT", "Part does not match declared file size", 400);
          const data = await readUploadPart(request, expectedSize);
          if (!data) return errorResponse(request, env, id, "INVALID_INPUT", "Part does not match declared file size", 400);
          if ((data.byteLength === 0 && session.sizeBytes !== 0) || data.byteLength > Math.min(maxUploadBytes(env), partSize)) {
            return errorResponse(request, env, id, "INVALID_INPUT", "Upload part is empty or too large", 400);
          }
          if (storage instanceof SupabaseBlobStore) {
            if (partNumber !== 1 || session.sizeBytes > SUPABASE_MAX_UPLOAD_BYTES || data.byteLength !== session.sizeBytes) return errorResponse(request, env, id, "INVALID_INPUT", "Supabase upload requires one complete negotiated part", 400);
            const etag = await sha256Hex(data);
            const created = await storage.upload(session.key, data, session.mimeType);
            if (!created) {
              const prior = await storage.get(session.key);
              const persisted = prior?.body ? await new Response(prior.body).arrayBuffer() : null;
              if (!persisted || persisted.byteLength !== data.byteLength || await sha256Hex(persisted) !== etag) {
                if (!await cleanInvalidStorageUpload(env, actor, storage, session, uploadToken)) return errorResponse(request, env, id, "STORAGE_UNAVAILABLE", "Conflicting bytes could not be cleaned; upload identity retained", 503, true);
                return errorResponse(request, env, id, "UPLOAD_HASH_MISMATCH", "Conflicting uncommitted bytes were cleaned; retry with a new upload", 422);
              }
            }
            return json(request, env, id, { partNumber, etag });
          }
          const uploaded = await multipart!.uploadPart(partNumber, data);
          return json(request, env, id, { partNumber, etag: uploaded.etag });
        }
        if (segments[5] === "complete" && request.method === "POST" && segments.length === 6) {
          const input = await readBody(request);
          const existing = await dbRequest(env, actor, "blobs", undefined, { select: "id,sha256", library_id: `eq.${libraryId}`, storage_key: `eq.${session.key}`, limit: 1 });
          const existingRecord = Array.isArray(existing.body) ? existing.body[0] as DbRecord | undefined : undefined;
          if (existingRecord?.id) return existingRecord.sha256 === input.sha256 ? json(request, env, id, { blobId: existingRecord.id }) : errorResponse(request, env, id, "UPLOAD_HASH_MISMATCH", "Upload replay hash mismatch", 422);
          const parts = Array.isArray(input.parts)
            ? input.parts.filter((part): part is DbRecord => Boolean(part && typeof part === "object"))
              .map((part) => ({ partNumber: Number(part.partNumber), etag: String(part.etag ?? "") }))
            : [];
          const sha256 = typeof input.sha256 === "string" ? input.sha256.toLowerCase() : "";
          if (!/^[a-f0-9]{64}$/.test(sha256) || parts.length === 0 || parts.some((part) => !Number.isSafeInteger(part.partNumber) || part.partNumber < 1 || !part.etag)) {
            return errorResponse(request, env, id, "INVALID_INPUT", "Upload completion payload is invalid", 400);
          }
          if (storage instanceof SupabaseBlobStore && (parts.length !== 1 || parts[0].partNumber !== 1 || parts[0].etag !== sha256)) return errorResponse(request, env, id, "INVALID_INPUT", "Supabase completion requires one verified part", 400);
          let storedObject = await storage.get(session.key);
          if (!storedObject) {
            if (storage instanceof SupabaseBlobStore) return errorResponse(request, env, id, "STORAGE_UNAVAILABLE", "Upload part has not been persisted", 503, true);
            if (session.sizeBytes === 0 && storage.put) { await storage.put(session.key, new ArrayBuffer(0), { httpMetadata: { contentType: session.mimeType } }); await multipart!.abort().catch(() => undefined); }
            else await multipart!.complete(parts);
            storedObject = await storage.get(session.key);
          }
          if (!storedObject?.body) {
            return errorResponse(request, env, id, "STORAGE_UNAVAILABLE", "Uploaded blob could not be read back", 503, true);
          }
          const storedBytes = await new Response(storedObject.body).arrayBuffer();
          if (storedBytes.byteLength !== session.sizeBytes || await sha256Hex(storedBytes) !== sha256) {
            if (storage instanceof SupabaseBlobStore) {
              // Retain the reservation if physical deletion or state confirmation
              // fails. A retry/cleanup must never report absent bytes early.
              if (!await cleanInvalidStorageUpload(env, actor, storage, session, uploadToken)) return errorResponse(request, env, id, "STORAGE_UNAVAILABLE", "Invalid bytes could not be cleaned; upload identity retained", 503, true);
            }
            await multipart?.abort().catch(() => undefined);
            return errorResponse(request, env, id, "UPLOAD_HASH_MISMATCH", "Uploaded content failed integrity verification", 422);
          }
          if (storage instanceof SupabaseBlobStore) {
            const completed = await dbRequest(env, actor, "rpc/cloud_complete_storage_upload", { method: "POST", body: JSON.stringify({ p_upload_id: uploadToken, p_sha256: sha256 }) });
            return completed.response.ok && typeof completed.body === "string" ? json(request, env, id, { blobId: completed.body }, 201) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to atomically register uploaded blob", completed.response.status, completed.response.status >= 500);
          }
          const blob = await dbRequest(env, actor, "blobs", {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({ library_id: libraryId, storage_key: session.key, size_bytes: session.sizeBytes, sha256, mime_type: session.mimeType, uploaded_by: actor.userId }),
          });
          const record = Array.isArray(blob.body) ? blob.body[0] : blob.body;
          if (blob.response.ok && record) { await dbRequest(env, actor, "cloud_upload_sessions", { method: "PATCH", body: JSON.stringify({ state: "complete" }) }, { id: `eq.${uploadToken}` }); return json(request, env, id, { blobId: (record as DbRecord).id }, 201); }
          return errorResponse(request, env, id, "DATABASE_ERROR", "Unable to register uploaded blob", blob.response.status, blob.response.status >= 500);
        }
        if (segments[5] === "abort" && request.method === "POST" && segments.length === 6) {
          if (sessionRecord?.state === "complete") return errorResponse(request, env, id, "INVALID_INPUT", "Committed uploads cannot be aborted", 409);
          if (storage instanceof SupabaseBlobStore) await storage.remove(session.key);
          else await multipart!.abort();
          const aborted = await dbRequest(env, actor, "cloud_upload_sessions", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "aborted" }) }, { id: `eq.${uploadToken}` });
          if (!aborted.response.ok || (storage instanceof SupabaseBlobStore && (!Array.isArray(aborted.body) || (aborted.body[0] as DbRecord | undefined)?.state !== "aborted"))) return errorResponse(request, env, id, "DATABASE_ERROR", "Cleanup could not release upload reservation", aborted.response.ok ? 503 : aborted.response.status, true);
          return json(request, env, id, { aborted: true });
        }
      }
      if (segments[3] === "blobs" && segments[4]) {
        if (segments[4] === "find" && request.method === "GET") {
          const hash = url.searchParams.get("hash") ?? "";
          if (!/^[a-f0-9]{64}$/.test(hash)) return errorResponse(request, env, id, "INVALID_INPUT", "Invalid content hash", 400);
          const result = await dbRequest(env, actor, "blobs", undefined, { library_id: `eq.${libraryId}`, sha256: `eq.${hash}`, select: "id", limit: 1 });
          const record = Array.isArray(result.body) ? result.body[0] as DbRecord : null;
          return result.response.ok ? json(request, env, id, { ...(record ? { blobId: record.id } : {}) }) : errorResponse(request, env, id, "DATABASE_ERROR", "Blob lookup failed", result.response.status, true);
        }
        const blobId = segments[4];
        const blob = await dbRequest(env, actor, "blobs", undefined, { select: "*", id: `eq.${blobId}`, library_id: `eq.${libraryId}`, limit: 1 });
        const record = Array.isArray(blob.body) ? blob.body[0] as DbRecord | undefined : undefined;
        if (!record?.id) return errorResponse(request, env, id, "NOT_FOUND", "Blob not found", 404);
        if (!String(record.storage_key).startsWith(`libraries/${libraryId}/blobs/`)) return errorResponse(request, env, id, "FORBIDDEN", "Blob key outside authorized library", 403);
        const storage = requireBlobBinding(request, env, id, actor, record.storage_backend === "supabase" ? "supabase" : "r2");
        if (storage instanceof Response) return storage;
        if (segments[5] === "download-url" && request.method === "GET" && segments.length === 6) {
          const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
          return json(request, env, id, { url: `${env.PUBLIC_API_BASE_URL ?? new URL(request.url).origin}/v1/libraries/${encodeURIComponent(libraryId)}/blobs/${encodeURIComponent(blobId)}/content`, expiresAt });
        }
        if (segments[5] === "content" && request.method === "GET" && segments.length === 6) {
          const object = await storage.get(String(record.storage_key));
          if (!object?.body) return errorResponse(request, env, id, "NOT_FOUND", "Blob content not found", 404);
          const headers = corsHeaders(request, env, id);
          headers.set("content-type", String(record.mime_type ?? object.httpMetadata?.contentType ?? "application/octet-stream"));
          headers.set("content-disposition", "attachment");
          headers.set("x-content-type-options", "nosniff");
          headers.set("cache-control", "no-store");
          if (object.httpMetadata?.contentLength !== undefined) headers.set("content-length", String(object.httpMetadata.contentLength));
          return new Response(object.body, { status: 200, headers });
        }
      }
      if (segments[3] === "sync" && segments[4] === "pull" && request.method === "GET") {
        const cursor = url.searchParams.get("cursor");
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 200), 1), 500);
        const result = await dbRequest(env, actor, "sync_operations", undefined, { select: "*", library_id: `eq.${libraryId}`, ...(cursor ? { created_at: `gt.${cursor}` } : {}), order: "created_at.asc,id.asc", limit });
        const operations = Array.isArray(result.body) ? result.body : [];
        const nextCursor = operations.length > 0 ? String((operations[operations.length - 1] as DbRecord).created_at) : cursor;
        return result.response.ok ? json(request, env, id, { operations: operations.map((entry) => mapOperation(entry as DbRecord)), cursor: nextCursor, hasMore: operations.length === limit }) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to pull operations", result.response.status, result.response.status >= 500);
      }
      if (segments[3] === "sync" && segments[4] === "push" && request.method === "POST") {
        const input = await readBody(request);
        const operations = Array.isArray(input.operations) ? input.operations : [];
        const rows = operations.filter((entry): entry is DbRecord => Boolean(entry && typeof entry === "object")).map((entry) => ({ id: entry.id, library_id: libraryId, actor_id: actor.userId, device_id: entry.deviceId, client_sequence: entry.clientSequence, operation_type: entry.operationType, entity_type: entry.entityType, entity_id: entry.entityId, base_version: entry.baseVersion ?? null, payload: entry.payload ?? {}, idempotency_key: entry.idempotencyKey, created_at: entry.createdAt }));
        const result = await dbRequest(env, actor, "sync_operations", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows) });
        return result.response.ok ? json(request, env, id, { accepted: operations.map((entry) => entry.id), rejected: [], conflicts: [] }) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to push operations", result.response.status, result.response.status >= 500);
      }
    }

    if (segments[1] === "items" && segments[2]) {
      const itemId = segments[2];
      if (segments[3] === "index-text" && request.method === "POST") {
        const input = await readBody(request);
        if (typeof input.text !== "string" || new TextEncoder().encode(input.text).byteLength > 1024 * 1024) return errorResponse(request, env, id, "INVALID_INPUT", "Index text exceeds limit", 400);
        const result = await dbRequest(env, actor, "rpc/cloud_index_text", { method: "POST", body: JSON.stringify({ p_item_id: itemId, p_version_id: input.versionId, p_text: input.text }) });
        if (result.response.ok) return json(request, env, id, { indexed: true });
        if (result.response.status === 400 || result.response.status === 409) return json(request, env, id, { indexed: false, stale: true });
        return errorResponse(request, env, id, "DATABASE_ERROR", "Text index rejected", result.response.status, true);
      }
      if (segments[3] === "annotation-mutations" && request.method === "POST") {
        const input = await readBody(request);
        const result = await dbRequest(env, actor, "rpc/cloud_mutate_annotation", { method: "POST", body: JSON.stringify({ p_item_id: itemId, p_annotation: input.annotation, p_base_revision: input.baseRevision, p_deleted: input.deleted ?? false, p_operation_id: request.headers.get("idempotency-key") }) });
        const conflict = (result.body as DbRecord)?.code === "40001";
        return result.response.ok ? json(request, env, id, mapAnnotation(result.body as DbRecord)) : errorResponse(request, env, id, conflict ? "SYNC_CONFLICT" : "DATABASE_ERROR", conflict ? "Annotation revision changed" : "Annotation mutation rejected", conflict ? 409 : result.response.status, result.response.status >= 500);
      }
      if (segments.length === 3 && request.method === "GET") {
        const result = await dbRequest(env, actor, "items", undefined, { select: "*", id: `eq.${itemId}` });
        const record = Array.isArray(result.body) ? result.body[0] : null;
        return record ? json(request, env, id, mapItem(record as DbRecord)) : errorResponse(request, env, id, "NOT_FOUND", "Item not found", 404);
      }
      if (segments.length === 3 && request.method === "PATCH") {
        const input = await readBody(request);
        if (input.metadataPatch !== undefined) {
          if (!input.metadataPatch || typeof input.metadataPatch !== 'object' || Array.isArray(input.metadataPatch) || (input.expectedVersionId !== null && typeof input.expectedVersionId !== 'string')) return errorResponse(request, env, id, 'INVALID_INPUT', 'Metadata patch and explicit version baseline required', 400);
          const result = await dbRequest(env, actor, 'rpc/cloud_update_item_metadata', { method: 'POST', body: JSON.stringify({ p_item_id: itemId, p_patch: input.metadataPatch, p_expected_version_id: input.expectedVersionId }) });
          const record = Array.isArray(result.body) ? result.body[0] : result.body;
          const conflict = !result.response.ok && (result.response.status === 409 || (result.body as DbRecord)?.code === '40001');
          return result.response.ok && record ? json(request, env, id, mapItem(record as DbRecord)) : errorResponse(request, env, id, conflict ? 'SYNC_CONFLICT' : 'DATABASE_ERROR', conflict ? 'Content version changed; source metadata was not overwritten' : 'Metadata update rejected', conflict ? 409 : result.response.ok ? 409 : result.response.status);
        }
        const result = await dbRequest(env, actor, "items", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...(input.title !== undefined ? { title: input.title } : {}), ...(input.canonicalName !== undefined ? { canonical_name: input.canonicalName } : {}), ...(input.collectionId !== undefined ? { collection_id: input.collectionId } : {}), ...(input.metadata !== undefined ? { metadata: input.metadata } : {}), updated_at: new Date().toISOString() }) }, { id: `eq.${itemId}` });
        const record = Array.isArray(result.body) ? result.body[0] : result.body;
        return result.response.ok ? json(request, env, id, mapItem(record as DbRecord)) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to update item", result.response.status);
      }
      if (segments.length === 3 && request.method === "DELETE") {
        const result = await dbRequest(env, actor, "items", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "trashed", deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }, { id: `eq.${itemId}` });
        const record = Array.isArray(result.body) ? result.body[0] : result.body;
        return result.response.ok ? json(request, env, id, mapItem(record as DbRecord)) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to trash item", result.response.status);
      }
      if (segments[3] === "restore" && request.method === "POST") {
        const result = await dbRequest(env, actor, "items", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "active", deleted_at: null, updated_at: new Date().toISOString() }) }, { id: `eq.${itemId}` });
        const record = Array.isArray(result.body) ? result.body[0] : result.body;
        return result.response.ok ? json(request, env, id, mapItem(record as DbRecord)) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to restore item", result.response.status);
      }
      if (segments[3] === "children") {
        if (request.method === "GET") {
          const result = await dbRequest(env, actor, "item_children", undefined, { select: "*", parent_item_id: `eq.${itemId}`, order: "sort_key.asc" });
          return result.response.ok ? json(request, env, id, (result.body as DbRecord[]).map(mapChild)) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to list item children", result.response.status);
        }
        if (request.method === "POST") {
          const input = await readBody(request);
          const parent = await dbRequest(env, actor, "items", undefined, { select: "library_id", id: `eq.${itemId}` });
          const parentRecord = Array.isArray(parent.body) ? parent.body[0] as DbRecord | undefined : undefined;
          if (!parentRecord?.library_id) return errorResponse(request, env, id, "NOT_FOUND", "Parent item not found", 404);
          const child = await dbRequest(env, actor, "items", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ library_id: parentRecord.library_id, kind: input.kind, title: input.title ?? input.relativePath, canonical_name: input.relativePath, created_by: actor.userId }) });
          const childRecord = Array.isArray(child.body) ? child.body[0] as DbRecord | undefined : undefined;
          if (!childRecord?.id) return errorResponse(request, env, id, "DATABASE_ERROR", "Unable to create child item", child.response.status);
          const relation = await dbRequest(env, actor, "item_children", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ parent_item_id: itemId, child_item_id: childRecord.id, relative_path: input.relativePath, kind: input.kind, sort_key: input.relativePath }) });
          const relationRecord = Array.isArray(relation.body) ? relation.body[0] : relation.body;
          return relation.response.ok ? json(request, env, id, mapChild(relationRecord as DbRecord), 201) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to create child relation", relation.response.status);
        }
      }
      if (segments[3] === "versions") {
        if (request.method === "GET") {
          const result = await dbRequest(env, actor, "item_versions", undefined, { select: "*", item_id: `eq.${itemId}`, order: "version_number.desc" });
          return result.response.ok ? json(request, env, id, (result.body as DbRecord[]).map(mapVersion)) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to list versions", result.response.status);
        }
        if (request.method === "POST") {
          const input = await readBody(request);
          if (input.id) {
            const result = await dbRequest(env, actor, "rpc/cloud_commit_version", { method: "POST", body: JSON.stringify({ p_item_id: itemId, p_id: input.id, p_blob_id: input.blobId, p_hash: input.contentHash, p_manifest: input.manifest ?? {}, p_base_id: input.baseVersionId ?? null }) });
            const record = Array.isArray(result.body) ? result.body[0] : result.body;
            const conflict = !result.response.ok && (result.response.status === 409 || (result.body as DbRecord)?.code === "40001");
            return result.response.ok ? json(request, env, id, mapVersion(record as DbRecord), 201) : errorResponse(request, env, id, conflict ? "SYNC_CONFLICT" : "DATABASE_ERROR", conflict ? "Remote version changed; both versions are retained" : "Version commit rejected", conflict ? 409 : result.response.status, result.response.status >= 500);
          }
          const latest = await dbRequest(env, actor, "item_versions", undefined, { select: "version_number", item_id: `eq.${itemId}`, order: "version_number.desc", limit: 1 });
          const latestNumber = Array.isArray(latest.body) && latest.body[0] && typeof (latest.body[0] as DbRecord).version_number === "number" ? Number((latest.body[0] as DbRecord).version_number) : 0;
          const result = await dbRequest(env, actor, "item_versions", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ item_id: itemId, version_number: latestNumber + 1, blob_id: input.blobId ?? null, manifest: input.manifest ?? {}, content_hash: input.contentHash, base_version_id: input.baseVersionId ?? null, created_by: actor.userId }) });
          const record = Array.isArray(result.body) ? result.body[0] : result.body;
          return result.response.ok ? json(request, env, id, mapVersion(record as DbRecord), 201) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to create version", result.response.status);
        }
      }
      if (segments[3] === "annotations") {
        if (request.method === "GET") {
          const result = await dbRequest(env, actor, "annotations", undefined, { select: "*", item_id: `eq.${itemId}`, order: "updated_at.asc" });
          return result.response.ok ? json(request, env, id, (result.body as DbRecord[]).map(mapAnnotation)) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to list annotations", result.response.status);
        }
        if (request.method === "POST") {
          const input = await readBody(request);
          const result = await dbRequest(env, actor, "annotations", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ ...(input.id ? { id: input.id } : {}), item_id: itemId, version_id: input.versionId, kind: input.kind, target: input.target, quote: input.quote ?? null, geometry: input.geometry ?? null, style: input.style ?? {}, body: input.body ?? {}, revision: 1, author_id: actor.userId }) });
          const record = Array.isArray(result.body) ? result.body[0] : result.body;
          return result.response.ok ? json(request, env, id, mapAnnotation(record as DbRecord), 201) : errorResponse(request, env, id, "DATABASE_ERROR", "Unable to create annotation", result.response.status);
        }
      }
    }

    return errorResponse(request, env, id, "NOT_FOUND", "Route not found", 404);
  } catch (error) {
    if (error instanceof StorageRequestError) return errorResponse(request, env, id, "STORAGE_UNAVAILABLE", error.message, error.status === 401 || error.status === 403 ? error.status : 503, error.status >= 500);
    return errorResponse(request, env, id, "NETWORK_ERROR", error instanceof Error ? error.message : "Unexpected API error", 500, true);
  }
}

const worker = {
  async scheduled(_event: unknown, env: SharedLibraryWorkerEnv): Promise<void> {
    if (env.GITHUB_WEBHOOK_SECRET && env.SUPABASE_SERVICE_ROLE_KEY) await processGitHubWebhookDeliveries(env);
  },
  fetch(request: Request, env: SharedLibraryWorkerEnv): Promise<Response> {
    const id = requestId();
    return handleRequest(request, env, id);
  },
};

export default worker;
export { handleRequest };
