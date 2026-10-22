import { beforeEach, describe, expect, it } from "vitest";
import { InMemorySyncQueueStorage, PersistentSyncQueueStorage } from "../sync-queue";
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

describe("sync queue storage", () => {
  let storage: InMemorySyncQueueStorage;

  beforeEach(() => {
    storage = new InMemorySyncQueueStorage();
  });

  it("enqueues operations and lists them sorted by client sequence", async () => {
    await storage.put(makeOperation("op-3", "d1", 3));
    await storage.put(makeOperation("op-1", "d1", 1));
    await storage.put(makeOperation("op-2", "d1", 2));

    const pending = await storage.listPending();
    expect(pending.map((entry) => entry.operation.id)).toEqual(["op-1", "op-2", "op-3"]);
  });

  it("dedupes operations by idempotency key", async () => {
    const base = makeOperation("op-1", "d1", 1);
    await storage.put(base);
    await storage.put({ ...base, id: "op-1-duplicate" });

    expect(await storage.listPending()).toHaveLength(1);
  });

  it("removes accepted operations", async () => {
    await storage.put(makeOperation("op-1", "d1", 1));
    await storage.markAccepted("op-1");

    expect(await storage.listPending()).toHaveLength(0);
  });

  it("keeps retryable operations pending with backoff metadata", async () => {
    await storage.put(makeOperation("op-1", "d1", 1));
    await storage.markRetryable("op-1", "2026-08-20T00:01:00.000Z", "network");

    const pending = await storage.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].attempts).toBe(1);
    expect(pending[0].nextRetryAt).toBe("2026-08-20T00:01:00.000Z");
    expect(pending[0].lastError).toBe("network");
  });

  it("moves permanently rejected operations into the conflict list", async () => {
    await storage.put(makeOperation("op-1", "d1", 1));
    await storage.markConflict("op-1", "base version mismatch");

    expect(await storage.listPending()).toHaveLength(0);
    const conflicts = await storage.listConflicted();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].lastError).toBe("base version mismatch");
  });

  it("restores pending operations from a new persistent queue instance", async () => {
    const values = new Map<string, unknown>();
    const persistent = {
      get: async <T>(key: string) => (values.get(key) as T | undefined) ?? null,
      set: async <T>(key: string, value: T) => { values.set(key, value); },
      remove: async (key: string) => { values.delete(key); },
      clear: async () => { values.clear(); },
    };
    const first = new PersistentSyncQueueStorage({ storage: persistent, key: "queue" });
    await first.put(makeOperation("op-1", "d1", 1));
    const second = new PersistentSyncQueueStorage({ storage: persistent, key: "queue" });
    await expect(second.listPending()).resolves.toHaveLength(1);
  });
});
