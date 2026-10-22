import { normalizeSearchText } from "@/lib/searchable-text";
import type { SharedLibraryJob, SharedLibraryJobKind } from "@/lib/shared-library/job-state";

export interface ExtractTextJobPayload {
  sourceType: "url" | "child-item";
  childItemId?: string;
  url?: string;
  objectKey?: string;
}

export interface ExtractTextJobResult {
  textLength: number;
  objectKey: string;
}

/**
 * Creates an idempotent text-extraction job. The job id is deterministic from
 * the target item and source scope, so re-enqueueing the same content does not
 * create a duplicate job.
 */
export function createExtractTextJob(input: {
  targetItemId: string;
  payload: ExtractTextJobPayload;
  maxAttempts?: number;
  now?: string;
}): SharedLibraryJob {
  const now = input.now ?? new Date().toISOString();
  const scope =
    input.payload.childItemId ?? input.payload.objectKey ?? input.payload.url ?? "root";
  return {
    id: `extract-text:${input.targetItemId}:${scope}`,
    kind: "extract-text" satisfies SharedLibraryJobKind,
    targetItemId: input.targetItemId,
    targetChildItemId: input.payload.childItemId,
    payload: input.payload as unknown as Record<string, unknown>,
    status: "pending",
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 5,
    createdAt: now,
    updatedAt: now,
  };
}

/** Shared normalization — remote extract jobs reuse the local searchable-text pipeline. */
export function normalizeExtractedText(raw: string): string {
  return normalizeSearchText(raw);
}
