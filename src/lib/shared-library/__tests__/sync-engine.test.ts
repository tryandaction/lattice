import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemorySyncQueueStorage } from "../sync-queue";
import { computeRetryDelay, SyncEngine, type PushResult } from "../sync-engine";
import type { SyncOperation } from "../domain";

function makeOperation(id: string, deviceId: string, clientSequence: number): SyncOperation {
  return {
    id,
    libraryId: "lib-1",
    actorId: "user-1",
    deviceId,
    clientSequence,
    operationType: "item.create",
    entityType: "item",
    entityId: "item-1",
    payload: {},
    idempotencyKey: `${deviceId}:${clientSequence}`,
    createdAt: "2026-08-20T00:00:00.000Z",
  };
}

describe("sync engine", () => {
  let storage: InMemorySyncQueueStorage;

  beforeEach(() => {
    storage = new InMemorySyncQueueStorage();
  });

  it("computes exponential backoff delays with a cap", () => {
    expect(computeRetryDelay(0, 100, 1000)).toBe(100);
    expect(computeRetryDelay(1, 100, 1000)).toBe(200);
    expect(computeRetryDelay(2, 100, 1000)).toBe(400);
    expect(computeRetryDelay(10, 100, 1000)).toBe(1000);
  });

  it("pushes pending operations and accepts them", async () => {
    const push = vi.fn(
      async (): Promise<PushResult> => ({
        accepted: ["op-1"],
        rejected: [],
        conflicts: [],
      }),
    );
    const engine = new SyncEngine({ storage, push });
    await engine.connect();
    await storage.put(makeOperation("op-1", "d1", 1));

    const result = await engine.pushPending();
    expect(result?.accepted).toEqual(["op-1"]);
    expect(push).toHaveBeenCalledTimes(1);
    expect(await storage.listPending()).toHaveLength(0);
    expect(engine.getState()).toBe("ready");
  });

  it("retains pending operations when the push throws a network error", async () => {
    const push = vi.fn(async () => {
      throw new Error("network down");
    });
    const engine = new SyncEngine({ storage, push });
    await engine.connect();
    await storage.put(makeOperation("op-1", "d1", 1));

    await expect(engine.pushPending()).rejects.toThrow("network down");
    expect(engine.getState()).toBe("failed");
    expect(await storage.listPending()).toHaveLength(1);
  });

  it("recovers pending operations after recreating the engine", async () => {
    const failingPush = vi.fn(async () => {
      throw new Error("boom");
    });
    const first = new SyncEngine({ storage, push: failingPush });
    await first.connect();
    await storage.put(makeOperation("op-1", "d1", 1));
    await expect(first.pushPending()).rejects.toThrow("boom");

    const push = vi.fn(
      async (): Promise<PushResult> => ({
        accepted: ["op-1"],
        rejected: [],
        conflicts: [],
      }),
    );
    const second = new SyncEngine({ storage, push });
    await second.connect();

    expect(await storage.listPending()).toHaveLength(1);
    await second.pushPending();
    expect(await storage.listPending()).toHaveLength(0);
  });

  it("moves permanently rejected operations to conflict and enters conflicted state", async () => {
    const push = vi.fn(
      async (): Promise<PushResult> => ({
        accepted: [],
        rejected: [
          { operationId: "op-1", retryable: false, reason: "base version mismatch" },
        ],
        conflicts: [],
      }),
    );
    const engine = new SyncEngine({ storage, push });
    await engine.connect();
    await storage.put(makeOperation("op-1", "d1", 1));

    const result = await engine.pushPending();
    expect(result?.rejected).toHaveLength(1);
    expect(await storage.listPending()).toHaveLength(0);
    expect(await storage.listConflicted()).toHaveLength(1);
    expect(engine.getState()).toBe("conflicted");
  });

  it("requeues retryable rejections with backoff metadata", async () => {
    const push = vi.fn(
      async (): Promise<PushResult> => ({
        accepted: [],
        rejected: [{ operationId: "op-1", retryable: true, reason: "timeout" }],
        conflicts: [],
      }),
    );
    const engine = new SyncEngine({
      storage,
      push,
      backoff: { baseDelayMs: 100, maxDelayMs: 1000 },
    });
    await engine.connect();
    await storage.put(makeOperation("op-1", "d1", 1));

    await engine.pushPending();

    const pending = await storage.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].attempts).toBe(1);
    expect(pending[0].nextRetryAt).toBeDefined();
  });

  it("applies pulled operations before persisting each cursor", async () => {
    const applied: SyncOperation[] = [];
    const cursors: string[] = [];
    const engine = new SyncEngine({
      storage,
      push: async () => ({ accepted: [], rejected: [], conflicts: [] }),
      pull: async (cursor) => cursor
        ? { operations: [], cursor: "cursor-2", hasMore: false }
        : { operations: [makeOperation("remote-1", "remote", 1)], cursor: "cursor-1", hasMore: true },
      applyRemote: async (operations) => { applied.push(...operations); },
      saveCursor: async (cursor) => { cursors.push(cursor); },
    });

    await engine.connect();

    expect(applied.map((entry) => entry.id)).toEqual(["remote-1"]);
    expect(cursors).toEqual(["cursor-1", "cursor-2"]);
    expect(engine.getCursor()).toBe("cursor-2");
  });
});
