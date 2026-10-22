/**
 * Sync engine state machine.
 *
 * The engine drives push (and, later, pull) against the durable sync queue.
 * States are a closed set; a network exception only moves the engine into
 * `failed` — it never deletes pending operations. Recreating the engine over
 * the same storage must recover the full pending set.
 */

import type { SyncOperation } from "./domain";
import type { SyncQueueStorage } from "./sync-queue";

export type SyncEngineState =
  | "offline"
  | "registering"
  | "pulling"
  | "ready"
  | "pushing"
  | "conflicted"
  | "failed";

export interface PushResult {
  accepted: string[];
  rejected: Array<{
    operationId: string;
    retryable: boolean;
    reason?: string;
    entityType?: string;
    entityId?: string;
  }>;
  conflicts: Array<{ operationId: string; reason?: string }>;
}

export interface PullResult {
  operations: SyncOperation[];
  cursor?: string;
  hasMore?: boolean;
}

export interface BackoffOptions {
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface SyncEngineOptions {
  storage: SyncQueueStorage;
  /** Transports a batch of operations to the remote API. */
  push: (operations: SyncOperation[]) => Promise<PushResult>;
  /** Optional pull step run during `connect`; cursor is opaque to the engine. */
  pull?: (cursor?: string) => Promise<PullResult | void>;
  /** Applies remote operations before advancing the cursor. */
  applyRemote?: (operations: SyncOperation[]) => Promise<void>;
  initialCursor?: string;
  saveCursor?: (cursor: string) => Promise<void>;
  backoff?: BackoffOptions;
}

const DEFAULT_BACKOFF: BackoffOptions = { baseDelayMs: 200, maxDelayMs: 30_000 };

export function computeRetryDelay(
  attempts: number,
  baseDelayMs = DEFAULT_BACKOFF.baseDelayMs,
  maxDelayMs = DEFAULT_BACKOFF.maxDelayMs,
): number {
  const exponent = Math.max(0, attempts);
  const delay = baseDelayMs * 2 ** exponent;
  return Math.min(delay, maxDelayMs);
}

export class SyncEngine {
  private state: SyncEngineState = "offline";
  private readonly storage: SyncQueueStorage;
  private readonly pushFn: SyncEngineOptions["push"];
  private readonly pullFn?: (cursor?: string) => Promise<PullResult | void>;
  private readonly applyRemote?: (operations: SyncOperation[]) => Promise<void>;
  private readonly saveCursor?: (cursor: string) => Promise<void>;
  private cursor: string | undefined;
  private readonly backoff: BackoffOptions;

  constructor(options: SyncEngineOptions) {
    this.storage = options.storage;
    this.pushFn = options.push;
    this.pullFn = options.pull;
    this.applyRemote = options.applyRemote;
    this.saveCursor = options.saveCursor;
    this.cursor = options.initialCursor;
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
  }

  getState(): SyncEngineState {
    return this.state;
  }

  getCursor(): string | undefined {
    return this.cursor;
  }

  async connect(): Promise<void> {
    this.state = "registering";
    try {
      this.state = "pulling";
      if (this.pullFn) {
        let page: PullResult | void;
        do {
          page = await this.pullFn(this.cursor);
          if (!page) break;
          if (page.operations.length > 0 && this.applyRemote) {
            await this.applyRemote(page.operations);
          }
          if (page.cursor) {
            this.cursor = page.cursor;
            if (this.saveCursor) await this.saveCursor(page.cursor);
          }
        } while (page.hasMore);
      }
      this.state = "ready";
    } catch (error) {
      this.state = "failed";
      throw error;
    }
  }

  async pushPending(): Promise<PushResult | null> {
    const pending = await this.storage.listPending();
    const now = Date.now();
    const due = pending.filter(
      (entry) => !entry.nextRetryAt || Date.parse(entry.nextRetryAt) <= now,
    );

    if (due.length === 0) {
      if (this.state !== "conflicted" && this.state !== "failed") {
        this.state = "ready";
      }
      return null;
    }

    this.state = "pushing";
    try {
      const result = await this.pushFn(due.map((entry) => entry.operation));

      for (const operationId of result.accepted ?? []) {
        await this.storage.markAccepted(operationId);
      }

      let hasConflict = (result.conflicts ?? []).length > 0;
      for (const conflict of result.conflicts ?? []) {
        await this.storage.markConflict(conflict.operationId, conflict.reason);
      }

      for (const rejection of result.rejected ?? []) {
        if (rejection.retryable) {
          const queued = pending.find(
            (entry) => entry.operation.id === rejection.operationId,
          );
          const currentAttempts = queued?.attempts ?? 0;
          const delay = computeRetryDelay(
            currentAttempts,
            this.backoff.baseDelayMs,
            this.backoff.maxDelayMs,
          );
          const nextRetryAt = new Date(Date.now() + delay).toISOString();
          await this.storage.markRetryable(
            rejection.operationId,
            nextRetryAt,
            rejection.reason,
          );
        } else {
          hasConflict = true;
          await this.storage.markConflict(rejection.operationId, rejection.reason);
        }
      }

      this.state = hasConflict ? "conflicted" : "ready";
      return result;
    } catch (error) {
      // Transient failure: keep every pending operation in the durable queue.
      this.state = "failed";
      throw error;
    }
  }
}
