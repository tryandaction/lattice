/**
 * Desktop sync bridge and background queue.
 *
 * The bridge is the only seam the shared-library Web/Desktop shell uses to
 * reach Tauri: secure value storage (device identity, session tokens) and
 * durable sync-queue persistence are typed commands behind one interface.
 * When not running inside Tauri the bridge falls back to injected Web stores,
 * so the same code path works on Web and in tests.
 *
 * `BridgeSyncQueueStorage` implements `SyncQueueStorage` over the bridge,
 * persisting every mutation, and `startBackgroundSync` pumps the engine's
 * pending operations on an interval while respecting online/offline — it
 * never deletes pending operations on a network failure.
 */

import { getTauriInvoke, isTauriHost, type TauriInvoke } from "@/lib/storage-adapter";
import type { SyncEngine, SyncEngineState } from "./sync-engine";
import type { SyncOperation } from "./domain";
import type { QueuedOperation, SyncQueueStorage } from "./sync-queue";

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export interface SecureValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface QueueSnapshotStore {
  load(): Promise<QueuedOperation[]>;
  save(entries: readonly QueuedOperation[]): Promise<void>;
}

export interface DesktopSyncBridge {
  isDesktop(): boolean;
  getSecureValue(key: string): Promise<string | null>;
  setSecureValue(key: string, value: string): Promise<void>;
  removeSecureValue(key: string): Promise<void>;
  getQueueSnapshot(): Promise<QueuedOperation[]>;
  persistQueue(entries: readonly QueuedOperation[]): Promise<void>;
}

export interface DesktopSyncBridgeOptions {
  invoke?: TauriInvoke | null;
  isDesktopHost?: () => boolean;
  secureStore?: SecureValueStore;
  queueStore?: QueueSnapshotStore;
}

const DESKTOP_SECURE_GET = "shared_library_secure_get";
const DESKTOP_SECURE_SET = "shared_library_secure_set";
const DESKTOP_SECURE_REMOVE = "shared_library_secure_remove";
const DESKTOP_QUEUE_LOAD = "shared_library_queue_load";
const DESKTOP_QUEUE_SAVE = "shared_library_queue_save";

function createMemorySecureStore(): SecureValueStore {
  const values = new Map<string, string>();
  return {
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async remove(key) {
      values.delete(key);
    },
  };
}

function createMemoryQueueStore(): QueueSnapshotStore {
  let entries: QueuedOperation[] = [];
  return {
    async load() {
      return entries;
    },
    async save(next) {
      entries = [...next];
    },
  };
}

function normalizeQueueEntries(value: unknown): QueuedOperation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is QueuedOperation => {
    if (typeof entry !== "object" || entry === null) {
      return false;
    }
    const candidate = entry as Record<string, unknown>;
    const operation = candidate.operation as Record<string, unknown> | undefined;
    return (
      typeof operation === "object" &&
      operation !== null &&
      typeof operation.id === "string" &&
      typeof operation.idempotencyKey === "string" &&
      (candidate.state === "pending" || candidate.state === "conflicted")
    );
  });
}

export function createDesktopSyncBridge(
  options: DesktopSyncBridgeOptions = {},
): DesktopSyncBridge {
  const invoke = options.invoke ?? getTauriInvoke();
  const isDesktopHost = options.isDesktopHost ?? isTauriHost;
  const secureStore = options.secureStore ?? createMemorySecureStore();
  const queueStore = options.queueStore ?? createMemoryQueueStore();
  const desktop = () => Boolean(invoke) && isDesktopHost();

  return {
    isDesktop: desktop,

    async getSecureValue(key) {
      if (desktop()) {
        return invoke!<string | null>(DESKTOP_SECURE_GET, { key });
      }
      return secureStore.get(key);
    },

    async setSecureValue(key, value) {
      if (desktop()) {
        await invoke!<void>(DESKTOP_SECURE_SET, { key, value });
        return;
      }
      await secureStore.set(key, value);
    },

    async removeSecureValue(key) {
      if (desktop()) {
        await invoke!<void>(DESKTOP_SECURE_REMOVE, { key });
        return;
      }
      await secureStore.remove(key);
    },

    async getQueueSnapshot() {
      if (desktop()) {
        return normalizeQueueEntries(await invoke!<unknown>(DESKTOP_QUEUE_LOAD));
      }
      return queueStore.load();
    },

    async persistQueue(entries) {
      if (desktop()) {
        await invoke!<void>(DESKTOP_QUEUE_SAVE, { entries: [...entries] });
        return;
      }
      await queueStore.save(entries);
    },
  };
}

// ---------------------------------------------------------------------------
// Durable queue over the bridge
// ---------------------------------------------------------------------------

/**
 * `SyncQueueStorage` whose every mutation is persisted through the desktop
 * bridge, so the sync engine runs against a durable queue without knowing the
 * storage backend.
 */
export class BridgeSyncQueueStorage implements SyncQueueStorage {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly bridge: DesktopSyncBridge) {}

  private serializeMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(mutation, mutation);
    this.mutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async read(): Promise<Map<string, QueuedOperation>> {
    const entries = await this.bridge.getQueueSnapshot();
    return new Map(entries.map((entry) => [entry.operation.id, entry]));
  }

  private async write(map: Map<string, QueuedOperation>): Promise<void> {
    await this.bridge.persistQueue([...map.values()]);
  }

  async put(operation: SyncOperation): Promise<void> {
    await this.serializeMutation(async () => {
      const map = await this.read();
      for (const entry of map.values()) {
        if (entry.operation.idempotencyKey === operation.idempotencyKey) return;
      }
      map.set(operation.id, { operation, state: "pending", attempts: 0, enqueuedAt: new Date().toISOString() });
      await this.write(map);
    });
  }

  async listPending(): Promise<QueuedOperation[]> {
    const entries = [...(await this.read()).values()];
    return entries
      .filter((entry) => entry.state === "pending")
      .sort((left, right) => {
        const bySequence = left.operation.clientSequence - right.operation.clientSequence;
        if (bySequence !== 0) {
          return bySequence;
        }
        return left.enqueuedAt.localeCompare(right.enqueuedAt);
      });
  }

  async markAccepted(operationId: string): Promise<void> {
    await this.serializeMutation(async () => {
      const map = await this.read();
      if (map.delete(operationId)) await this.write(map);
    });
  }

  async markRetryable(
    operationId: string,
    nextRetryAt: string,
    lastError?: string,
  ): Promise<void> {
    await this.serializeMutation(async () => {
      const map = await this.read();
      const entry = map.get(operationId);
      if (!entry) return;
      map.set(operationId, { ...entry, state: "pending", attempts: entry.attempts + 1, nextRetryAt, lastError });
      await this.write(map);
    });
  }

  async markConflict(operationId: string, lastError?: string): Promise<void> {
    await this.serializeMutation(async () => {
      const map = await this.read();
      const entry = map.get(operationId);
      if (!entry) return;
      map.set(operationId, { ...entry, state: "conflicted", lastError });
      await this.write(map);
    });
  }

  async listConflicted(): Promise<QueuedOperation[]> {
    return [...(await this.read()).values()].filter(
      (entry) => entry.state === "conflicted",
    );
  }
}

// ---------------------------------------------------------------------------
// Background sync worker
// ---------------------------------------------------------------------------

export interface BackgroundSyncOptions {
  engine: Pick<SyncEngine, "pushPending" | "getState">;
  isOnline?: () => boolean;
  pollIntervalMs?: number;
  onStateChange?: (state: SyncEngineState) => void;
  onError?: (error: unknown) => void;
}

export interface BackgroundSyncHandle {
  dispose(): void;
  runOnce(): Promise<void>;
}

export function startBackgroundSync(options: BackgroundSyncOptions): BackgroundSyncHandle {
  const pollIntervalMs = options.pollIntervalMs ?? 30_000;
  let disposed = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function runOnce(): Promise<void> {
    if (disposed) {
      return;
    }
    const online = options.isOnline ? options.isOnline() : true;
    if (!online) {
      options.onStateChange?.("offline");
      return;
    }
    try {
      await options.engine.pushPending();
      options.onStateChange?.(options.engine.getState());
    } catch (error) {
      // Transient failure: keep pending operations; schedule the next attempt.
      options.onError?.(error);
    }
  }

  async function loop(): Promise<void> {
    if (disposed || running) {
      return;
    }
    running = true;
    try {
      await runOnce();
    } finally {
      running = false;
      if (!disposed) {
        timer = setTimeout(() => {
          void loop();
        }, pollIntervalMs);
      }
    }
  }

  void loop();

  return {
    dispose() {
      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    runOnce,
  };
}
