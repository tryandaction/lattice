import { validateSnapshotUrl } from "@/lib/shared-library/web-snapshot";
import type { SharedLibraryJob, SharedLibraryJobKind } from "@/lib/shared-library/job-state";

export interface SnapshotUrlJobPayload {
  url: string;
}

export interface SnapshotUrlJobResult {
  snapshotKey: string;
  title?: string;
}

export function createSnapshotUrlJob(input: {
  targetItemId: string;
  payload: SnapshotUrlJobPayload;
  maxAttempts?: number;
  now?: string;
}): SharedLibraryJob {
  const now = input.now ?? new Date().toISOString();
  return {
    id: `snapshot-url:${input.targetItemId}:${encodeURIComponent(input.payload.url)}`,
    kind: "snapshot-url" satisfies SharedLibraryJobKind,
    targetItemId: input.targetItemId,
    payload: input.payload as unknown as Record<string, unknown>,
    status: "pending",
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 5,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Rejects SSRF/dangerous URLs before the fetch ever happens. A rejected job
 * should be marked failed with `reason` so the UI can explain why the URL-only
 * item was not snapshotted.
 */
export function validateSnapshotUrlJobPayload(
  payload: SnapshotUrlJobPayload,
): { ok: boolean; reason?: string } {
  const validation = validateSnapshotUrl(payload.url);
  return { ok: validation.allowed, reason: validation.reason };
}
