/**
 * Persistent sync operation queue.
 *
 * The queue is the durable, local-first boundary for pending sync operations:
 * a network failure, app crash, or process restart must never drop an
 * operation. The storage adapter is swappable — IndexedDB on Web, Tauri files
 * on Desktop, and an in-memory Map in tests — while the queue semantics stay
 * identical.
 */

import type { SyncOperation, IsoTimestamp } from "./domain";
import { getStorageAdapter, type StorageAdapter } from "@/lib/storage-adapter";

export type QueuedOperationState = "pending" | "conflicted";

export interface QueuedOperation {
  operation: SyncOperation;
  state: QueuedOperationState;
  /** Number of failed push attempts so far. */
  attempts: number;
  /** When the next push attempt is allowed (ISO). Absent for never-retried ops. */
  nextRetryAt?: IsoTimestamp;
  lastError?: string;
  enqueuedAt: IsoTimestamp;
}

export interface SyncQueueStorage {
  /** Enqueue an operation; duplicates by idempotency key are ignored. */
  put(operation: SyncOperation): Promise<void>;
  /** Pending operations ordered by client sequence (stable ordering). */
  listPending(): Promise<QueuedOperation[]>;
  /** Remove an operation that the server accepted. */
  markAccepted(operationId: string): Promise<void>;
  /** Keep the operation pending and schedule its next attempt. */
  markRetryable(operationId: string, nextRetryAt: IsoTimestamp, lastError?: string): Promise<void>;
  /** Move a permanently rejected operation to the conflict list. */
  markConflict(operationId: string, lastError?: string): Promise<void>;
  /** Permanently rejected operations waiting for user resolution. */
  listConflicted(): Promise<QueuedOperation[]>;
}

/**
 * Deterministic in-memory queue used by tests and as the local default. It is
 * deliberately the same shape as the IndexedDB/Tauri adapters so the engine
 * never knows which backend it talks to.
 */
export class InMemorySyncQueueStorage implements SyncQueueStorage {
  private queue = new Map<string, QueuedOperation>();
  private seenIdempotencyKeys = new Set<string>();

  async put(operation: SyncOperation): Promise<void> {
    if (this.seenIdempotencyKeys.has(operation.idempotencyKey)) {
      return;
    }
    this.seenIdempotencyKeys.add(operation.idempotencyKey);
    this.queue.set(operation.id, {
      operation,
      state: "pending",
      attempts: 0,
      enqueuedAt: new Date().toISOString(),
    });
  }

  async listPending(): Promise<QueuedOperation[]> {
    return [...this.queue.values()]
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
    this.queue.delete(operationId);
  }

  async markRetryable(
    operationId: string,
    nextRetryAt: IsoTimestamp,
    lastError?: string,
  ): Promise<void> {
    const entry = this.queue.get(operationId);
    if (!entry) {
      return;
    }
    this.queue.set(operationId, {
      ...entry,
      state: "pending",
      attempts: entry.attempts + 1,
      nextRetryAt,
      lastError,
    });
  }

  async markConflict(operationId: string, lastError?: string): Promise<void> {
    const entry = this.queue.get(operationId);
    if (!entry) {
      return;
    }
    this.queue.set(operationId, {
      ...entry,
      state: "conflicted",
      lastError,
    });
  }

  async listConflicted(): Promise<QueuedOperation[]> {
    return [...this.queue.values()].filter((entry) => entry.state === "conflicted");
  }
}

/** Durable queue for Web and desktop storage adapters. */
export class PersistentSyncQueueStorage implements SyncQueueStorage {
  private readonly storage: StorageAdapter;
  private readonly key: string;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: { storage?: StorageAdapter; key?: string } = {}) {
    this.storage = options.storage ?? getStorageAdapter();
    this.key = options.key ?? "lattice-shared-library-sync-queue-v1";
  }

  private async read(): Promise<Map<string, QueuedOperation>> {
    const loaded = await this.storage.get<QueuedOperation[]>(this.key);
    const entries = Array.isArray(loaded) ? loaded : [];
    return new Map(entries.filter((entry) => entry?.operation?.id).map((entry) => [entry.operation.id, entry]));
  }

  private async write(map: Map<string, QueuedOperation>): Promise<void> {
    await this.storage.set(this.key, [...map.values()]);
  }

  private serialize<T>(mutation: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(mutation, mutation);
    this.mutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  async put(operation: SyncOperation): Promise<void> {
    await this.serialize(async () => {
      const map = await this.read();
      if ([...map.values()].some((entry) => entry.operation.idempotencyKey === operation.idempotencyKey)) return;
      map.set(operation.id, { operation, state: "pending", attempts: 0, enqueuedAt: new Date().toISOString() });
      await this.write(map);
    });
  }

  async listPending(): Promise<QueuedOperation[]> {
    return [...(await this.read()).values()]
      .filter((entry) => entry.state === "pending")
      .sort((a, b) => a.operation.clientSequence - b.operation.clientSequence || a.enqueuedAt.localeCompare(b.enqueuedAt));
  }

  async markAccepted(operationId: string): Promise<void> {
    await this.serialize(async () => {
      const map = await this.read();
      if (map.delete(operationId)) await this.write(map);
    });
  }

  async markRetryable(operationId: string, nextRetryAt: IsoTimestamp, lastError?: string): Promise<void> {
    await this.serialize(async () => {
      const map = await this.read();
      const entry = map.get(operationId);
      if (!entry) return;
      map.set(operationId, { ...entry, state: "pending", attempts: entry.attempts + 1, nextRetryAt, lastError });
      await this.write(map);
    });
  }

  async markConflict(operationId: string, lastError?: string): Promise<void> {
    await this.serialize(async () => {
      const map = await this.read();
      const entry = map.get(operationId);
      if (!entry) return;
      map.set(operationId, { ...entry, state: "conflicted", lastError });
      await this.write(map);
    });
  }

  async listConflicted(): Promise<QueuedOperation[]> {
    return [...(await this.read()).values()].filter((entry) => entry.state === "conflicted");
  }
}
