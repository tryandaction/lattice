/**
 * Upload manager for multipart object-storage uploads.
 *
 * Splits a file into parts, uploads each part with bounded retries, computes a
 * content hash, and completes the upload idempotently. Failures clean up the
 * upload session. Permanent storage errors (`UPLOAD_HASH_MISMATCH`,
 * `UPLOAD_EXPIRED`, `UPLOAD_INCOMPLETE`) are surfaced as-is — never retried —
 * while transient failures use the same exponential backoff as the sync
 * engine.
 */

import { isSharedLibraryError } from "./errors";
import { computeRetryDelay } from "./sync-engine";
import type { BlobStore, CreateUploadInput, HashFn, UploadPartResult, UploadSession } from "./blob-store";

export interface UploadManagerOptions {
  store: BlobStore;
  backoff?: { baseDelayMs: number; maxDelayMs: number };
  maxPartRetries?: number;
  hash?: HashFn;
}

const DEFAULT_BACKOFF = { baseDelayMs: 50, maxDelayMs: 500 };
const DEFAULT_MAX_PART_RETRIES = 3;

function isRetryableUploadError(error: unknown): boolean {
  return isSharedLibraryError(error) && error.retryable;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class UploadManager {
  private readonly store: BlobStore;
  private readonly backoff: { baseDelayMs: number; maxDelayMs: number };
  private readonly maxPartRetries: number;
  private readonly hashFn: HashFn;

  constructor(options: UploadManagerOptions) {
    this.store = options.store;
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
    this.maxPartRetries = options.maxPartRetries ?? DEFAULT_MAX_PART_RETRIES;
    this.hashFn = options.hash ?? (async (data) => {
      const { defaultSha256Hex } = await import("./blob-store");
      return defaultSha256Hex(data);
    });
  }

  async initiate(input: CreateUploadInput): Promise<UploadSession> {
    return this.store.createUpload(input);
  }

  async uploadPartWithRetry(input: {
    uploadId: string;
    partNumber: number;
    data: ArrayBuffer;
  }): Promise<UploadPartResult> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.store.uploadPart(input);
      } catch (error) {
        if (!isRetryableUploadError(error) || attempt >= this.maxPartRetries) {
          throw error;
        }
        attempt += 1;
        await delay(computeRetryDelay(attempt - 1, this.backoff.baseDelayMs, this.backoff.maxDelayMs));
      }
    }
  }

  async computeSha256(data: ArrayBuffer): Promise<string> {
    return this.hashFn(data);
  }

  async complete(
    uploadId: string,
    sha256: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<{ blobId: string }> {
    return this.store.completeUpload({ uploadId, sha256, parts });
  }

  async abort(uploadId: string): Promise<void> {
    await this.store.abortUpload(uploadId);
  }

  async uploadFile(input: {
    libraryId: string;
    fileName: string;
    mimeType: string;
    data: ArrayBuffer;
    partSize?: number;
  }): Promise<{ blobId: string; sha256: string }> {
    const session = await this.initiate({
      libraryId: input.libraryId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.data.byteLength,
    });
    const partSize = session.partSize ?? input.partSize ?? 5 * 1024 * 1024;

    try {
      if (!Number.isSafeInteger(partSize) || partSize < 1) throw new Error("Upload service returned an invalid part size");
      const parts: Array<{ partNumber: number; etag: string }> = [];
      for (
        let offset = 0, partNumber = 1;
        offset < Math.max(input.data.byteLength, 1);
        offset += partSize, partNumber += 1
      ) {
        const slice = input.data.slice(offset, Math.min(offset + partSize, input.data.byteLength));
        const result = await this.uploadPartWithRetry({
          uploadId: session.uploadId,
          partNumber,
          data: slice,
        });
        parts.push({ partNumber: result.partNumber, etag: result.etag });
      }

      const sha256 = await this.computeSha256(input.data);
      const { blobId } = await this.complete(session.uploadId, sha256, parts);
      return { blobId, sha256 };
    } catch (error) {
      await this.abort(session.uploadId).catch(() => {});
      throw error;
    }
  }

  async getDownloadUrl(blobId: string): Promise<{ url: string; expiresAt: string }> {
    return this.store.getDownloadUrl(blobId);
  }
}
