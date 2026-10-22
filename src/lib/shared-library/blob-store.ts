/**
 * Object storage boundary for shared-library blobs (R2/S3 backed in cloud).
 *
 * The `BlobStore` interface is the only way the UploadManager and item
 * versioning talk to object storage. It supports multipart uploads with an
 * `Idempotency-Key`-style contract: `completeUpload` is idempotent per
 * upload session and verifies content hashes. The in-memory fake is used by
 * tests and local-only mode.
 */

import { SharedLibraryError } from "./errors";
import type { SharedLibraryTransport } from "./remote-repository";

export interface UploadSession {
  uploadId: string;
  libraryId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Server-authoritative transport chunk size; absent on legacy 5 MiB sessions. */
  partSize?: number;
  status: "initiated" | "completed" | "aborted";
  createdAt: string;
}

export interface CreateUploadInput {
  libraryId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  idempotencyKey?: string;
}

export interface UploadPartInput {
  uploadId: string;
  partNumber: number;
  data: ArrayBuffer;
}

export interface UploadPartResult {
  partNumber: number;
  etag: string;
}

export interface CompleteUploadInput {
  uploadId: string;
  sha256: string;
  parts: Array<{ partNumber: number; etag: string }>;
}

export interface BlobStore {
  createUpload(input: CreateUploadInput): Promise<UploadSession>;
  uploadPart(input: UploadPartInput): Promise<UploadPartResult>;
  completeUpload(input: CompleteUploadInput): Promise<{ blobId: string }>;
  abortUpload(uploadId: string): Promise<void>;
  getDownloadUrl(blobId: string): Promise<{ url: string; expiresAt: string }>;
}

function unwrapTransportBody(body: unknown): unknown {
  if (typeof body === "object" && body !== null && "data" in body) {
    return (body as { data: unknown }).data;
  }
  return body;
}

/**
 * Cloud API-backed BlobStore. It deliberately keeps multipart semantics in
 * the shared BlobStore contract, so UploadManager retry/idempotency behavior
 * is identical for Web, Desktop and the in-memory test adapter.
 */
export class RemoteBlobStore implements BlobStore {
  private readonly uploadLibraries = new Map<string, string>();

  constructor(
    private readonly transport: SharedLibraryTransport,
    private readonly options: { libraryId?: string } = {},
  ) {}

  private libraryForUpload(uploadId: string): string {
    const libraryId = this.uploadLibraries.get(uploadId) ?? this.options.libraryId;
    if (!libraryId) {
      throw new SharedLibraryError({ code: "INVALID_INPUT", message: "A library id is required for blob upload", retryable: false });
    }
    return libraryId;
  }

  private libraryForBlob(): string {
    if (!this.options.libraryId) {
      throw new SharedLibraryError({ code: "INVALID_INPUT", message: "A library id is required for blob download", retryable: false });
    }
    return this.options.libraryId;
  }

  private async request(input: Parameters<SharedLibraryTransport["request"]>[0]): Promise<unknown> {
    const response = await this.transport.request(input);
    return unwrapTransportBody(response.body);
  }

  async createUpload(input: CreateUploadInput): Promise<UploadSession> {
    const value = await this.request({
      method: "POST",
      path: `/v1/libraries/${encodeURIComponent(input.libraryId)}/uploads`,
      body: input,
      idempotencyKey: input.idempotencyKey,
    });
    if (!value || typeof value !== "object") {
      throw new SharedLibraryError({ code: "DATABASE_ERROR", message: "Upload service returned an invalid session", retryable: true });
    }
    const session = value as UploadSession;
    if (typeof session.uploadId !== "string" || typeof session.libraryId !== "string") {
      throw new SharedLibraryError({ code: "DATABASE_ERROR", message: "Upload service returned an invalid session", retryable: true });
    }
    this.uploadLibraries.set(session.uploadId, session.libraryId);
    return session;
  }

  async uploadPart(input: UploadPartInput): Promise<UploadPartResult> {
    const value = await this.request({
      method: "PUT",
      path: `/v1/libraries/${encodeURIComponent(this.libraryForUpload(input.uploadId))}/uploads/${encodeURIComponent(input.uploadId)}/parts/${input.partNumber}`,
      body: input.data,
    });
    if (!value || typeof value !== "object" || typeof (value as { etag?: unknown }).etag !== "string") {
      throw new SharedLibraryError({ code: "DATABASE_ERROR", message: "Upload service returned an invalid part", retryable: true });
    }
    return { partNumber: input.partNumber, etag: (value as { etag: string }).etag };
  }

  async completeUpload(input: CompleteUploadInput): Promise<{ blobId: string }> {
    const value = await this.request({
      method: "POST",
      path: `/v1/libraries/${encodeURIComponent(this.libraryForUpload(input.uploadId))}/uploads/${encodeURIComponent(input.uploadId)}/complete`,
      body: input,
    });
    const blobId = value && typeof value === "object" ? (value as { blobId?: unknown }).blobId : undefined;
    if (typeof blobId !== "string" || !blobId) {
      throw new SharedLibraryError({ code: "DATABASE_ERROR", message: "Upload service returned no blob id", retryable: true });
    }
    return { blobId };
  }

  async abortUpload(uploadId: string): Promise<void> {
    await this.request({ method: "POST", path: `/v1/libraries/${encodeURIComponent(this.libraryForUpload(uploadId))}/uploads/${encodeURIComponent(uploadId)}/abort` });
    this.uploadLibraries.delete(uploadId);
  }

  async getDownloadUrl(blobId: string): Promise<{ url: string; expiresAt: string }> {
    const value = await this.request({ method: "GET", path: `/v1/libraries/${encodeURIComponent(this.libraryForBlob())}/blobs/${encodeURIComponent(blobId)}/download-url` });
    const url = value && typeof value === "object" ? (value as { url?: unknown }).url : undefined;
    const expiresAt = value && typeof value === "object" ? (value as { expiresAt?: unknown }).expiresAt : undefined;
    if (typeof url !== "string" || typeof expiresAt !== "string") {
      throw new SharedLibraryError({ code: "DATABASE_ERROR", message: "Blob service returned an invalid download URL", retryable: true });
    }
    return { url, expiresAt };
  }

  async downloadBlob(blobId: string): Promise<{ data: ArrayBuffer; mimeType?: string }> {
    const response = await this.transport.request({
      method: "GET",
      path: `/v1/libraries/${encodeURIComponent(this.libraryForBlob())}/blobs/${encodeURIComponent(blobId)}/content`,
      responseType: "arrayBuffer",
    });
    if (response.body instanceof ArrayBuffer) {
      return { data: response.body };
    }
    if (ArrayBuffer.isView(response.body)) {
      const view = response.body as Uint8Array;
      return { data: view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer };
    }
    if (Object.prototype.toString.call(response.body) !== "[object ArrayBuffer]") {
      throw new SharedLibraryError({ code: "DATABASE_ERROR", message: "Blob service returned invalid content", retryable: true });
    }
    return { data: response.body as ArrayBuffer };
  }
}

export type HashFn = (data: ArrayBuffer) => Promise<string>;

export class InMemoryBlobStore implements BlobStore {
  private readonly hashFn: HashFn;
  private readonly uploads = new Map<string, UploadSession>();
  private readonly parts = new Map<string, Map<number, { data: ArrayBuffer; etag: string }>>();
  private readonly completed = new Map<string, { blobId: string; sha256: string }>();
  private readonly aborted = new Set<string>();
  private readonly expired = new Set<string>();
  private counter = 0;
  private transientFailuresRemaining = 0;

  constructor(options?: { hash?: HashFn }) {
    this.hashFn = options?.hash ?? defaultSha256Hex;
  }

  /** Makes the next N `uploadPart` calls fail transiently (test helper). */
  failNextPartUploads(count: number): void {
    this.transientFailuresRemaining = count;
  }

  /** Marks an upload session as expired (test helper). */
  expireUpload(uploadId: string): void {
    this.expired.add(uploadId);
  }

  async createUpload(input: CreateUploadInput): Promise<UploadSession> {
    this.counter += 1;
    const session: UploadSession = {
      uploadId: `upload-${this.counter}`,
      libraryId: input.libraryId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      status: "initiated",
      createdAt: new Date().toISOString(),
    };
    this.uploads.set(session.uploadId, session);
    return session;
  }

  async uploadPart(input: UploadPartInput): Promise<UploadPartResult> {
    const upload = this.uploads.get(input.uploadId);
    if (!upload || this.aborted.has(input.uploadId)) {
      throw new SharedLibraryError({
        code: "NOT_FOUND",
        message: `Upload session ${input.uploadId} is not active`,
        retryable: false,
      });
    }
    if (this.expired.has(input.uploadId)) {
      throw new SharedLibraryError({
        code: "UPLOAD_EXPIRED",
        message: "Upload session expired; re-initiate the upload",
        retryable: false,
      });
    }
    if (this.transientFailuresRemaining > 0) {
      this.transientFailuresRemaining -= 1;
      throw new SharedLibraryError({
        code: "NETWORK_ERROR",
        message: "Transient object-storage failure",
        retryable: true,
      });
    }

    const partMap = this.parts.get(input.uploadId) ?? new Map();
    const etag = `etag-${input.uploadId}-${input.partNumber}`;
    partMap.set(input.partNumber, { data: input.data, etag });
    this.parts.set(input.uploadId, partMap);
    return { partNumber: input.partNumber, etag };
  }

  async completeUpload(input: CompleteUploadInput): Promise<{ blobId: string }> {
    const upload = this.uploads.get(input.uploadId);
    if (!upload || this.aborted.has(input.uploadId)) {
      throw new SharedLibraryError({
        code: "NOT_FOUND",
        message: `Upload session ${input.uploadId} is not active`,
        retryable: false,
      });
    }
    if (this.expired.has(input.uploadId)) {
      throw new SharedLibraryError({
        code: "UPLOAD_EXPIRED",
        message: "Upload session expired; re-initiate the upload",
        retryable: false,
      });
    }

    const cached = this.completed.get(input.uploadId);
    if (cached) {
      if (cached.sha256 !== input.sha256) {
        throw new SharedLibraryError({
          code: "UPLOAD_HASH_MISMATCH",
          message: "Re-completed upload with a different content hash",
          retryable: false,
        });
      }
      return { blobId: cached.blobId };
    }

    const partMap = this.parts.get(input.uploadId) ?? new Map();
    if (partMap.size === 0 || input.parts.length !== partMap.size) {
      throw new SharedLibraryError({
        code: "UPLOAD_INCOMPLETE",
        message: "Not all parts have been uploaded",
        retryable: false,
      });
    }

    const sorted = [...partMap.entries()].sort(([a], [b]) => a - b);
    const total = sorted.reduce((sum, [, part]) => sum + part.data.byteLength, 0);
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const [, part] of sorted) {
      combined.set(new Uint8Array(part.data), offset);
      offset += part.data.byteLength;
    }
    const actualSha = await this.hashFn(combined.buffer);
    if (actualSha !== input.sha256) {
      throw new SharedLibraryError({
        code: "UPLOAD_HASH_MISMATCH",
        message: "Content hash does not match the uploaded parts",
        retryable: false,
      });
    }

    this.counter += 1;
    const blobId = `blob-${this.counter}`;
    this.completed.set(input.uploadId, { blobId, sha256: input.sha256 });
    upload.status = "completed";
    return { blobId };
  }

  async abortUpload(uploadId: string): Promise<void> {
    this.aborted.add(uploadId);
    this.parts.delete(uploadId);
    const upload = this.uploads.get(uploadId);
    if (upload) {
      upload.status = "aborted";
    }
  }

  async getDownloadUrl(blobId: string): Promise<{ url: string; expiresAt: string }> {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    return { url: `https://cdn.example.com/${blobId}?expires=${encodeURIComponent(expiresAt)}`, expiresAt };
  }
}

export async function defaultSha256Hex(data: ArrayBuffer): Promise<string> {
  if (typeof crypto !== "undefined" && typeof crypto.subtle?.digest === "function") {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  return `sha-${data.byteLength}`;
}
