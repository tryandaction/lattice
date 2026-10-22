import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryBlobStore, RemoteBlobStore, type BlobStore } from "../blob-store";
import { UploadManager } from "../upload-manager";
import { isSharedLibraryError } from "../errors";

function deterministicHash(data: ArrayBuffer): Promise<string> {
  return Promise.resolve(`sha-${data.byteLength}`);
}

function encode(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer;
}

describe("upload manager", () => {
  let store: InMemoryBlobStore;

  beforeEach(() => {
    store = new InMemoryBlobStore({ hash: deterministicHash });
  });

  it("uploads a file in parts and completes with a blob id", async () => {
    const manager = new UploadManager({ store, hash: deterministicHash });
    const data = encode("hello shared library");
    const result = await manager.uploadFile({
      libraryId: "lib-1",
      fileName: "paper.pdf",
      mimeType: "application/pdf",
      data,
      partSize: 5,
    });
    expect(result.blobId).toMatch(/^blob-/);
    expect(result.sha256).toBe(`sha-${data.byteLength}`);
  });

  it("retries a transient part failure", async () => {
    store.failNextPartUploads(1);
    const manager = new UploadManager({
      store,
      hash: deterministicHash,
      backoff: { baseDelayMs: 1, maxDelayMs: 10 },
    });
    const data = encode("abcdef");
    const result = await manager.uploadFile({
      libraryId: "lib-1",
      fileName: "a.md",
      mimeType: "text/markdown",
      data,
      partSize: 2,
    });
    expect(result.blobId).toMatch(/^blob-/);
  });

  it("uses the server negotiated object size for a 20MiB PDF", async () => {
    const sizes: number[] = [];
    const data = new ArrayBuffer(20 * 1024 * 1024);
    const negotiated: BlobStore = {
      createUpload: async input => ({ ...input, uploadId: "negotiated", partSize: input.sizeBytes, status: "initiated", createdAt: "2026-10-17T00:00:00Z" }),
      uploadPart: async input => { sizes.push(input.data.byteLength); return { partNumber: input.partNumber, etag: "verified" }; },
      completeUpload: async () => ({ blobId: "large-pdf" }),
      abortUpload: async () => {},
      getDownloadUrl: async () => ({ url: "fixture", expiresAt: "fixture" }),
    };
    const result = await new UploadManager({ store: negotiated, hash: deterministicHash }).uploadFile({ libraryId: "lib-1", fileName: "synthetic.pdf", mimeType: "application/pdf", data });
    expect(result.blobId).toBe("large-pdf");
    expect(sizes).toEqual([data.byteLength]);
  });

  it("surfaces a permanent UPLOAD_HASH_MISMATCH", async () => {
    const manager = new UploadManager({ store, hash: deterministicHash });
    const session = await manager.initiate({
      libraryId: "lib-1",
      fileName: "a.md",
      mimeType: "text/markdown",
      sizeBytes: 3,
    });
    await manager.uploadPartWithRetry({
      uploadId: session.uploadId,
      partNumber: 1,
      data: encode("abc"),
    });

    let caught: unknown = null;
    try {
      await manager.complete(session.uploadId, "wrong-hash", [
        { partNumber: 1, etag: `etag-${session.uploadId}-1` },
      ]);
    } catch (error) {
      caught = error;
    }
    if (!isSharedLibraryError(caught)) {
      throw new Error("expected a SharedLibraryError");
    }
    expect(caught.code).toBe("UPLOAD_HASH_MISMATCH");
    expect(caught.retryable).toBe(false);
  });

  it("surfaces UPLOAD_EXPIRED for an expired session", async () => {
    const manager = new UploadManager({ store, hash: deterministicHash });
    const session = await manager.initiate({
      libraryId: "lib-1",
      fileName: "a.md",
      mimeType: "text/markdown",
      sizeBytes: 3,
    });
    store.expireUpload(session.uploadId);

    let caught: unknown = null;
    try {
      await manager.uploadPartWithRetry({
        uploadId: session.uploadId,
        partNumber: 1,
        data: new Uint8Array([1]).buffer,
      });
    } catch (error) {
      caught = error;
    }
    if (!isSharedLibraryError(caught)) {
      throw new Error("expected a SharedLibraryError");
    }
    expect(caught.code).toBe("UPLOAD_EXPIRED");
    expect(caught.retryable).toBe(false);
  });

  it("dedupes duplicate complete calls", async () => {
    const manager = new UploadManager({ store, hash: deterministicHash });
    const session = await manager.initiate({
      libraryId: "lib-1",
      fileName: "a.md",
      mimeType: "text/markdown",
      sizeBytes: 3,
    });
    const part = await manager.uploadPartWithRetry({
      uploadId: session.uploadId,
      partNumber: 1,
      data: encode("abc"),
    });

    const first = await manager.complete(session.uploadId, "sha-3", [
      { partNumber: 1, etag: part.etag },
    ]);
    const second = await manager.complete(session.uploadId, "sha-3", [
      { partNumber: 1, etag: part.etag },
    ]);
    expect(first.blobId).toBe(second.blobId);
  });

  it("cleans up on abort", async () => {
    const manager = new UploadManager({ store, hash: deterministicHash });
    const session = await manager.initiate({
      libraryId: "lib-1",
      fileName: "a.md",
      mimeType: "text/markdown",
      sizeBytes: 3,
    });
    await manager.abort(session.uploadId);

    let caught: unknown = null;
    try {
      await manager.uploadPartWithRetry({
        uploadId: session.uploadId,
        partNumber: 1,
        data: new Uint8Array([1]).buffer,
      });
    } catch (error) {
      caught = error;
    }
    expect(isSharedLibraryError(caught)).toBe(true);
  });
});

describe("remote blob store", () => {
  it("maps multipart and download requests through the shared transport", async () => {
    const transport = {
      request: async (input: { path: string; method: string; body?: unknown; responseType?: string }) => {
        if (input.path.endsWith("/uploads")) {
          return { status: 201, body: { uploadId: "upload-1", libraryId: "lib-1", fileName: "a.md", mimeType: "text/markdown", sizeBytes: 3, status: "initiated", createdAt: "2026-08-30T00:00:00.000Z" } };
        }
        if (input.path.includes("/parts/1")) return { status: 200, body: { partNumber: 1, etag: "etag-1" } };
        if (input.path.endsWith("/complete")) return { status: 201, body: { blobId: "blob-1" } };
        if (input.path.endsWith("/download-url")) return { status: 200, body: { url: "https://api.test/content", expiresAt: "2026-08-30T01:00:00.000Z" } };
        return { status: 200, body: new ArrayBuffer(3) };
      },
    };
    const store = new RemoteBlobStore(transport);
    const session = await store.createUpload({ libraryId: "lib-1", fileName: "a.md", mimeType: "text/markdown", sizeBytes: 3 });
    expect((await store.uploadPart({ uploadId: session.uploadId, partNumber: 1, data: new ArrayBuffer(3) })).etag).toBe("etag-1");
    expect(await store.completeUpload({ uploadId: session.uploadId, sha256: "a".repeat(64), parts: [{ partNumber: 1, etag: "etag-1" }] })).toEqual({ blobId: "blob-1" });
    await expect(store.getDownloadUrl("blob-1")).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const downloadStore = new RemoteBlobStore(transport, { libraryId: "lib-1" });
    await expect(downloadStore.getDownloadUrl("blob-1")).resolves.toMatchObject({ url: "https://api.test/content" });
    await expect(downloadStore.downloadBlob("blob-1")).resolves.toMatchObject({ data: expect.any(ArrayBuffer) });
  });
});
