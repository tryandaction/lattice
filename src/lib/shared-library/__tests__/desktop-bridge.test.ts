import { describe, expect, it, vi } from "vitest";
import {
  BridgeSyncQueueStorage,
  createDesktopSyncBridge,
  startBackgroundSync,
  type DesktopSyncBridge,
} from "../desktop-bridge";
import type { SyncOperation } from "../domain";
import type { QueuedOperation } from "../sync-queue";
import type { TauriInvoke } from "@/lib/storage-adapter";

function op(id: string, sequence = 1): SyncOperation {
  return {
    id,
    libraryId: "lib-1",
    actorId: "user-1",
    deviceId: "d1",
    clientSequence: sequence,
    operationType: "item.create",
    entityType: "item",
    entityId: "item-1",
    payload: {},
    idempotencyKey: `d1:${sequence}`,
    createdAt: "2026-08-20T00:00:00.000Z",
  };
}

function makeFakeBridge(): DesktopSyncBridge & { persisted: QueuedOperation[][] } {
  let store: QueuedOperation[] = [];
  const persisted: QueuedOperation[][] = [];
  return {
    isDesktop: () => true,
    getSecureValue: async () => null,
    setSecureValue: async () => {},
    removeSecureValue: async () => {},
    async getQueueSnapshot() {
      return store.map((entry) => ({ ...entry }));
    },
    async persistQueue(entries) {
      store = entries.map((entry) => ({ ...entry }));
      persisted.push(store);
    },
    persisted,
  };
}

describe("desktop sync bridge", () => {
  it("routes secure and queue commands through the injected invoke on desktop", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "shared_library_secure_get") {
        return "device-1";
      }
      if (command === "shared_library_queue_load") {
        return [];
      }
      return null;
    }) as unknown as TauriInvoke;

    const bridge = createDesktopSyncBridge({ invoke, isDesktopHost: () => true });

    expect(bridge.isDesktop()).toBe(true);
    await expect(bridge.getSecureValue("deviceId")).resolves.toBe("device-1");
    expect(invoke).toHaveBeenCalledWith("shared_library_secure_get", { key: "deviceId" });

    await bridge.setSecureValue("session", "tok");
    expect(invoke).toHaveBeenCalledWith("shared_library_secure_set", {
      key: "session",
      value: "tok",
    });

    await bridge.persistQueue([]);
    expect(invoke).toHaveBeenCalledWith("shared_library_queue_save", { entries: [] });
  });

  it("falls back to the web stores when not on desktop", async () => {
    const secure = {
      get: vi.fn(async () => "web-value"),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    };
    const queue = {
      load: vi.fn(async () => [] as QueuedOperation[]),
      save: vi.fn(async () => {}),
    };
    const invoke = vi.fn(async () => null) as unknown as TauriInvoke;

    const bridge = createDesktopSyncBridge({
      invoke,
      isDesktopHost: () => false,
      secureStore: secure,
      queueStore: queue,
    });

    await expect(bridge.getSecureValue("k")).resolves.toBe("web-value");
    expect(invoke).not.toHaveBeenCalled();
    expect(secure.get).toHaveBeenCalledWith("k");

    await bridge.persistQueue([]);
    expect(queue.save).toHaveBeenCalledWith([]);
  });
});

describe("BridgeSyncQueueStorage", () => {
  it("persists each mutation through the bridge", async () => {
    const bridge = makeFakeBridge();
    const queue = new BridgeSyncQueueStorage(bridge);

    await queue.put(op("op-1", 1));
    expect(bridge.persisted.length).toBe(1);

    await queue.markAccepted("op-1");
    expect(await queue.listPending()).toEqual([]);
    expect(bridge.persisted.length).toBe(2);
  });

  it("dedupes operations by idempotency key", async () => {
    const bridge = makeFakeBridge();
    const queue = new BridgeSyncQueueStorage(bridge);

    await queue.put(op("op-1", 1));
    await queue.put({ ...op("op-2", 2), idempotencyKey: "d1:1" });

    expect((await queue.listPending()).length).toBe(1);
  });

  it("tracks attempts and retry scheduling", async () => {
    const bridge = makeFakeBridge();
    const queue = new BridgeSyncQueueStorage(bridge);

    await queue.put(op("op-1", 1));
    await queue.markRetryable("op-1", "2026-08-20T00:01:00.000Z", "boom");

    const pending = await queue.listPending();
    expect(pending[0].attempts).toBe(1);
    expect(pending[0].nextRetryAt).toBe("2026-08-20T00:01:00.000Z");
  });

  it("moves permanently rejected operations to conflicted", async () => {
    const bridge = makeFakeBridge();
    const queue = new BridgeSyncQueueStorage(bridge);

    await queue.put(op("op-1", 1));
    await queue.markConflict("op-1", "forbidden");

    expect(await queue.listPending()).toEqual([]);
    expect((await queue.listConflicted()).length).toBe(1);
  });

  it("serializes concurrent mutations instead of dropping one operation", async () => {
    const bridge = makeFakeBridge();
    const queue = new BridgeSyncQueueStorage(bridge);

    await Promise.all([queue.put(op("op-1", 1)), queue.put(op("op-2", 2))]);

    expect((await queue.listPending()).map((entry) => entry.operation.id)).toEqual(["op-1", "op-2"]);
  });
});

describe("startBackgroundSync", () => {
  const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("pumps pending operations while online and stops after dispose", async () => {
    const pushPending = vi.fn(async () => ({ accepted: [], rejected: [], conflicts: [] }));
    const handle = startBackgroundSync({
      engine: { pushPending, getState: () => "ready" as const },
      pollIntervalMs: 5,
    });

    await tick(15);
    expect(pushPending).toHaveBeenCalled();

    handle.dispose();
    const count = pushPending.mock.calls.length;
    await tick(25);
    expect(pushPending.mock.calls.length).toBe(count);
  });

  it("does not push while offline", async () => {
    const pushPending = vi.fn(async () => ({ accepted: [], rejected: [], conflicts: [] }));
    const onStateChange = vi.fn();
    const handle = startBackgroundSync({
      engine: { pushPending, getState: () => "offline" as const },
      isOnline: () => false,
      pollIntervalMs: 5,
      onStateChange,
    });

    await tick(15);
    expect(pushPending).not.toHaveBeenCalled();
    expect(onStateChange).toHaveBeenCalledWith("offline");
    handle.dispose();
  });

  it("keeps running after a transient push error", async () => {
    let calls = 0;
    const onError = vi.fn();
    const pushPending = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("network down");
      }
      return { accepted: [], rejected: [], conflicts: [] };
    });

    const handle = startBackgroundSync({
      engine: { pushPending, getState: () => "ready" as const },
      pollIntervalMs: 5,
      onError,
    });

    await tick(20);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(onError).toHaveBeenCalledTimes(1);
    handle.dispose();
  });
});
