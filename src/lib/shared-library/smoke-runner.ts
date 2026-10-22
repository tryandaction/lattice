/**
 * Shared-library end-to-end smoke runner.
 *
 * Orchestrates the canonical two-user / two-device lifecycle against injected
 * fakes (repository, blob store, sync queue, network, search transport), so
 * the contract can be exercised without Supabase, R2 or a Worker. Every step
 * records an `operationId`, a `status` and — on failure — a `reason`, matching
 * the JSON shape the standalone `scripts/shared-library-smoke.mjs` CLI emits.
 */

import {
  buildIdempotencyKey,
  type SyncConflict,
  type SyncOperation,
} from "./domain";
import type { SharedLibraryRepository } from "./repository";
import { defaultSha256Hex, type BlobStore } from "./blob-store";
import type { SyncQueueStorage } from "./sync-queue";
import { SyncEngine, type PushResult } from "./sync-engine";
import {
  createSharedLibrarySearchClient,
  type SharedLibrarySearchTransport,
} from "./search-client";
import { validateSnapshotUrl } from "./web-snapshot";
import { buildConflictViewModels } from "./conflict-model";

export type SmokeStepStatus = "ok" | "failed";

export interface SmokeStepResult {
  step: string;
  operationId: string;
  status: SmokeStepStatus;
  reason?: string;
}

export interface SmokeReport {
  steps: SmokeStepResult[];
  summary: { ok: number; failed: number; total: number };
}

export interface SmokeNetwork {
  isOnline(): boolean;
  setOnline(online: boolean): void;
}

export interface SmokeRunnerDeps {
  repository: SharedLibraryRepository;
  peerRepository: SharedLibraryRepository;
  blob: BlobStore;
  queue: SyncQueueStorage;
  network: SmokeNetwork;
  push: (operations: SyncOperation[]) => Promise<PushResult>;
  pull: () => Promise<SyncOperation[]>;
  searchTransport: SharedLibrarySearchTransport;
  actorId: string;
  deviceId: string;
  peerActorId: string;
}

export async function runSharedLibrarySmoke(deps: SmokeRunnerDeps): Promise<SmokeReport> {
  const steps: SmokeStepResult[] = [];
  const state = {
    libraryId: "lib-1",
    itemId: "",
    childItemId: "",
    annotationId: "",
    versionId: "",
    sequence: 0,
  };

  const engine = new SyncEngine({
    storage: deps.queue,
    push: deps.push,
    pull: async () => {
      const remote = await deps.pull();
      for (const operation of remote) {
        await deps.repository.appendOperation(operation);
      }
    },
  });

  const nextOperation = (
    operationType: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown> = {},
  ): SyncOperation => {
    state.sequence += 1;
    return {
      id: `${deps.deviceId}:${state.sequence}`,
      libraryId: state.libraryId,
      actorId: deps.actorId,
      deviceId: deps.deviceId,
      clientSequence: state.sequence,
      operationType,
      entityType,
      entityId,
      payload,
      idempotencyKey: buildIdempotencyKey({
        deviceId: deps.deviceId,
        clientSequence: state.sequence,
      }),
      createdAt: new Date().toISOString(),
    };
  };

  const run = async (step: string, fn: () => Promise<string>): Promise<void> => {
    try {
      const operationId = await fn();
      steps.push({ step, operationId, status: "ok" });
    } catch (error) {
      steps.push({
        step,
        operationId: "",
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await run("create-library", async () => {
    const library = await deps.repository.createLibrary({
      name: "Research Group",
      createdBy: deps.actorId,
    });
    state.libraryId = library.id;
    const operation = nextOperation("library.create", "library", library.id, {
      name: library.name,
    });
    await deps.queue.put(operation);
    return operation.id;
  });

  await run("invite-member", async () => {
    const operation = nextOperation("member.invite", "member", deps.peerActorId, {
      role: "editor",
    });
    await deps.queue.put(operation);
    return operation.id;
  });

  await run("upload-pdf", async () => {
    const item = await deps.repository.createItem({
      libraryId: state.libraryId,
      kind: "pdf",
      title: "Quantum Paper",
      canonicalName: "quantum-paper",
    });
    state.itemId = item.id;

    const bytes = new TextEncoder().encode("%PDF-1.4 fake content");
    const upload = await deps.blob.createUpload({
      libraryId: state.libraryId,
      fileName: "paper.pdf",
      mimeType: "application/pdf",
      sizeBytes: bytes.byteLength,
    });
    const part = await deps.blob.uploadPart({
      uploadId: upload.uploadId,
      partNumber: 1,
      data: bytes.buffer,
    });
    const sha256 = await defaultSha256Hex(bytes.buffer);
    const completed = await deps.blob.completeUpload({
      uploadId: upload.uploadId,
      sha256,
      parts: [{ partNumber: part.partNumber, etag: part.etag }],
    });

    const version = await deps.repository.createVersion({
      itemId: item.id,
      blobId: completed.blobId,
      manifest: { pages: 1 },
      contentHash: sha256,
    });
    state.versionId = version.id;

    const operation = nextOperation("item.create", "item", item.id, {
      kind: "pdf",
      title: item.title,
    });
    await deps.queue.put(operation);
    return operation.id;
  });

  await run("create-child-markdown", async () => {
    const child = await deps.repository.addItemChild({
      parentItemId: state.itemId,
      relativePath: "notes.md",
      kind: "markdown",
      title: "Notes",
    });
    state.childItemId = child.childItemId;
    const operation = nextOperation("itemChild.create", "itemChild", child.childItemId, {
      parentItemId: state.itemId,
      relativePath: child.relativePath,
    });
    await deps.queue.put(operation);
    return operation.id;
  });

  await run("annotate", async () => {
    const annotation = await deps.repository.createAnnotation({
      itemId: state.itemId,
      versionId: state.versionId,
      kind: "highlight",
      target: { locatorType: "pdf-page", locator: { page: 1 } },
      style: {},
    });
    state.annotationId = annotation.id;
    const operation = nextOperation("annotation.create", "annotation", annotation.id, {
      kind: "highlight",
    });
    await deps.queue.put(operation);
    return operation.id;
  });

  await run("go-offline", async () => {
    deps.network.setOnline(false);
    let threw = false;
    try {
      await engine.pushPending();
    } catch {
      threw = true;
    }
    if (!threw) {
      throw new Error("expected the offline push to fail");
    }
    const pending = await deps.queue.listPending();
    if (pending.length === 0) {
      throw new Error("pending operations were dropped while offline");
    }
    return "";
  });

  await run("resume", async () => {
    deps.network.setOnline(true);
    const result = await engine.pushPending();
    if (!result || result.accepted.length === 0) {
      throw new Error("resume accepted no operations");
    }
    return "";
  });

  await run("pull", async () => {
    const before = (await deps.repository.listOperations()).length;
    await engine.connect();
    const after = await deps.repository.listOperations();
    if (after.length <= before) {
      throw new Error("pull did not ingest remote operations");
    }
    return after[after.length - 1]?.id ?? "";
  });

  await run("search", async () => {
    const client = createSharedLibrarySearchClient(deps.searchTransport);
    const response = await client.search({ q: "Entanglement" });
    if (response.results.length === 0) {
      throw new Error("search returned no results");
    }
    return "";
  });

  await run("delete", async () => {
    await deps.repository.trashItem(state.itemId);
    const operation = nextOperation("item.delete", "item", state.itemId);
    await deps.queue.put(operation);
    return operation.id;
  });

  await run("restore", async () => {
    const item = await deps.repository.restoreItem(state.itemId);
    if (item.status !== "active") {
      throw new Error("restore did not reactivate the item");
    }
    const operation = nextOperation("item.restore", "item", state.itemId);
    await deps.queue.put(operation);
    return operation.id;
  });

  await run("snapshot-guard", async () => {
    const blocked = validateSnapshotUrl("http://169.254.169.254/latest/meta-data");
    const allowed = validateSnapshotUrl("https://arxiv.org/abs/2506.15633");
    if (blocked.allowed || !allowed.allowed) {
      throw new Error("snapshot guard mis-classified a URL");
    }
    return "";
  });

  await run("conflict-classification", async () => {
    const conflict: SyncConflict = {
      id: "conflict-1",
      entityType: "item",
      entityId: state.itemId,
      reason: "binary-version",
      localOperationId: "device-1:1",
      remoteOperationId: "device-2:2",
      localPayload: { versionNumber: 3, authorId: deps.actorId, createdAt: "2026-08-20T00:00:00.000Z" },
      remotePayload: { versionNumber: 4, authorId: deps.peerActorId, createdAt: "2026-08-20T00:01:00.000Z" },
      createdAt: "2026-08-20T00:01:00.000Z",
    };
    const item = await deps.repository.getItem(state.itemId);
    const [view] = buildConflictViewModels([conflict], [item], []);
    if (!view || !view.recoverable) {
      throw new Error("conflict was not classified as recoverable");
    }
    return conflict.id;
  });

  const ok = steps.filter((step) => step.status === "ok").length;
  const failed = steps.length - ok;
  return { steps, summary: { ok, failed, total: steps.length } };
}
