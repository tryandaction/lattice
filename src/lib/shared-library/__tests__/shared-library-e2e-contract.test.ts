import { describe, expect, it, vi } from "vitest";
import { InMemorySharedLibraryRepository } from "@/lib/shared-library/local-repository";
import { InMemorySyncQueueStorage } from "@/lib/shared-library/sync-queue";
import { InMemoryBlobStore } from "@/lib/shared-library/blob-store";
import { SharedLibraryError } from "@/lib/shared-library/errors";
import { runSharedLibrarySmoke } from "@/lib/shared-library/smoke-runner";
import type { SyncOperation } from "@/lib/shared-library/domain";
import { buildIdempotencyKey } from "@/lib/shared-library/domain";
import type { SharedLibrarySearchTransport } from "@/lib/shared-library/search-client";

describe("shared library end-to-end contract", () => {
  it("completes the full lifecycle across two users and two devices with fakes", async () => {
    const repository = new InMemorySharedLibraryRepository();
    const peerRepository = new InMemorySharedLibraryRepository();
    const queue = new InMemorySyncQueueStorage();
    const blob = new InMemoryBlobStore();

    let online = true;
    const network = { isOnline: () => online, setOnline: (value: boolean) => (online = value) };

    // The peer device already has a library and one comment operation.
    await peerRepository.createLibrary({ name: "Research Group", createdBy: "user-2" });
    const peerOp: SyncOperation = {
      id: "device-2:1",
      libraryId: "lib-1",
      actorId: "user-2",
      deviceId: "device-2",
      clientSequence: 1,
      operationType: "comment.create",
      entityType: "annotation",
      entityId: "ann-1",
      payload: { body: "Nice figure" },
      idempotencyKey: buildIdempotencyKey({ deviceId: "device-2", clientSequence: 1 }),
      createdAt: "2026-08-20T00:00:00.000Z",
    };
    await peerRepository.appendOperation(peerOp);

    const searchTransport: SharedLibrarySearchTransport = {
      search: vi.fn(async () => ({
        results: [
          {
            itemId: "item-1",
            childItemId: "child-1",
            sourceType: "child-item" as const,
            snippet: "…entanglement…",
            locator: { locatorType: "offset", locator: { offset: 3 } },
            permissionSnapshot: { libraryId: "lib-1", itemId: "item-1", canRead: true },
            updatedAt: "2026-08-20T00:00:00.000Z",
          },
        ],
      })),
    };

    const push = async (operations: SyncOperation[]) => {
      if (!network.isOnline()) {
        throw new SharedLibraryError({
          code: "NETWORK_ERROR",
          message: "offline",
          retryable: true,
        });
      }
      for (const operation of operations) {
        await peerRepository.appendOperation(operation);
      }
      return {
        accepted: operations.map((operation) => operation.id),
        rejected: [],
        conflicts: [],
      };
    };
    const pull = async () => peerRepository.listOperations();

    const report = await runSharedLibrarySmoke({
      repository,
      peerRepository,
      blob,
      queue,
      network,
      push,
      pull,
      searchTransport,
      actorId: "user-1",
      deviceId: "device-1",
      peerActorId: "user-2",
    });

    expect(report.summary.failed).toBe(0);
    expect(report.steps.every((step) => step.status === "ok")).toBe(true);
    expect(report.steps.map((step) => step.step)).toEqual([
      "create-library",
      "invite-member",
      "upload-pdf",
      "create-child-markdown",
      "annotate",
      "go-offline",
      "resume",
      "pull",
      "search",
      "delete",
      "restore",
      "snapshot-guard",
      "conflict-classification",
    ]);

    // Local-first state was mutated.
    expect((await repository.listLibraries()).length).toBe(1);
    const items = await repository.listItems({ libraryId: "lib-1" });
    expect(items.some((item) => item.kind === "pdf")).toBe(true);
    expect(items.some((item) => item.kind === "markdown")).toBe(true);
    const pdfItem = items.find((item) => item.kind === "pdf");
    expect(pdfItem).toBeTruthy();
    expect((await repository.listAnnotations(pdfItem!.id)).length).toBe(1);
    expect((await repository.listItemVersions(pdfItem!.id)).length).toBe(1);

    // The peer received the pushed operations (deduplicated by idempotency key).
    const peerOperations = await peerRepository.listOperations();
    expect(peerOperations.some((operation) => operation.operationType === "library.create")).toBe(true);
    expect(peerOperations.some((operation) => operation.operationType === "item.create")).toBe(true);
    expect(peerOperations.some((operation) => operation.operationType === "annotation.create")).toBe(true);

    // Search went through the shared client and returned the contract.
    expect(searchTransport.search).toHaveBeenCalledWith(expect.objectContaining({ q: "entanglement" }));
  });

  it("never drops pending operations while offline", async () => {
    const repository = new InMemorySharedLibraryRepository();
    const peerRepository = new InMemorySharedLibraryRepository();
    const queue = new InMemorySyncQueueStorage();
    const blob = new InMemoryBlobStore();
    let online = false; // start offline
    const network = { isOnline: () => online, setOnline: (value: boolean) => (online = value) };

    const push = async (operations: SyncOperation[]) => {
      if (!network.isOnline()) {
        throw new SharedLibraryError({ code: "NETWORK_ERROR", message: "offline", retryable: true });
      }
      for (const operation of operations) {
        await peerRepository.appendOperation(operation);
      }
      return { accepted: operations.map((o) => o.id), rejected: [], conflicts: [] };
    };

    const report = await runSharedLibrarySmoke({
      repository,
      peerRepository,
      blob,
      queue,
      network,
      push,
      pull: async () => [],
      searchTransport: { search: async () => ({ results: [] }) },
      actorId: "user-1",
      deviceId: "device-1",
      peerActorId: "user-2",
    });

    // The go-offline step verifies retention; the run still progresses.
    const offlineStep = report.steps.find((step) => step.step === "go-offline");
    expect(offlineStep?.status).toBe("ok");
  });

  it("reports a failing step with a reason instead of throwing", async () => {
    const repository = new InMemorySharedLibraryRepository();
    const peerRepository = new InMemorySharedLibraryRepository();
    const queue = new InMemorySyncQueueStorage();
    const blob = new InMemoryBlobStore();
    let online = true;
    const network = { isOnline: () => online, setOnline: (value: boolean) => (online = value) };

    const report = await runSharedLibrarySmoke({
      repository,
      peerRepository,
      blob,
      queue,
      network,
      push: async (operations) => ({
        accepted: operations.map((o) => o.id),
        rejected: [],
        conflicts: [],
      }),
      pull: async () => [],
      searchTransport: {
        search: async () => {
          throw new SharedLibraryError({ code: "NETWORK_ERROR", message: "search down", retryable: true });
        },
      },
      actorId: "user-1",
      deviceId: "device-1",
      peerActorId: "user-2",
    });

    const searchStep = report.steps.find((step) => step.step === "search");
    expect(searchStep?.status).toBe("failed");
    expect(searchStep?.reason).toContain("search down");
    expect(report.summary.failed).toBeGreaterThanOrEqual(1);
  });
});
