/**
 * Idempotent job state machine for shared-library background tasks
 * (text extraction, URL snapshot, thumbnail generation).
 *
 * Jobs are plain data — the Worker/Desktop runner reads due jobs, advances
 * them through `start`/`succeed`/`fail`, and persists the updated record.
 * Retries are bounded and recorded (`attempts`, `nextRetryAt`, `lastError`);
 * a job that exhausts its attempts lands in a terminal `failed` state that is
 * readable from the UI instead of silently disappearing.
 */

export type SharedLibraryJobKind = "extract-text" | "snapshot-url" | "generate-thumbnail";
export type SharedLibraryJobStatus = "pending" | "running" | "succeeded" | "failed";

export interface SharedLibraryJob {
  id: string;
  kind: SharedLibraryJobKind;
  targetItemId: string;
  targetChildItemId?: string;
  payload: Record<string, unknown>;
  status: SharedLibraryJobStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: string;
  lastError?: string;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type SharedLibraryJobEvent =
  | { type: "start" }
  | { type: "succeed"; result?: Record<string, unknown> }
  | { type: "fail"; reason: string; nextRetryAt?: string };

export function computeJobRetryDelay(
  attempts: number,
  baseDelayMs = 60_000,
  maxDelayMs = 3_600_000,
): number {
  return Math.min(baseDelayMs * 2 ** Math.max(0, attempts), maxDelayMs);
}

export function advanceSharedLibraryJob(
  job: SharedLibraryJob,
  event: SharedLibraryJobEvent,
  now: string = new Date().toISOString(),
): SharedLibraryJob {
  switch (event.type) {
    case "start":
      if (job.status === "succeeded" || job.status === "failed") {
        return job; // terminal states are never re-entered
      }
      return { ...job, status: "running", updatedAt: now };
    case "succeed":
      return {
        ...job,
        status: "succeeded",
        result: event.result ?? job.result,
        lastError: undefined,
        updatedAt: now,
      };
    case "fail": {
      const attempts = job.attempts + 1;
      const exhausted = attempts >= job.maxAttempts;
      const nextRetryAt = exhausted
        ? undefined
        : (event.nextRetryAt ??
          new Date(Date.parse(now) + computeJobRetryDelay(attempts)).toISOString());
      return {
        ...job,
        status: exhausted ? "failed" : "pending",
        attempts,
        lastError: event.reason,
        nextRetryAt,
        updatedAt: now,
      };
    }
  }
}

export function isSharedLibraryJobDue(
  job: SharedLibraryJob,
  now: string = new Date().toISOString(),
): boolean {
  if (job.status !== "pending") {
    return false;
  }
  if (!job.nextRetryAt) {
    return true;
  }
  return Date.parse(job.nextRetryAt) <= Date.parse(now);
}

export function upsertSharedLibraryJob(
  jobs: readonly SharedLibraryJob[],
  next: SharedLibraryJob,
): SharedLibraryJob[] {
  const index = jobs.findIndex((job) => job.id === next.id);
  if (index === -1) {
    return [...jobs, next];
  }
  const copy = [...jobs];
  copy[index] = next;
  return copy;
}
