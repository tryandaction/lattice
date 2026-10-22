import type { SharedLibraryJob, SharedLibraryJobKind } from "@/lib/shared-library/job-state";

export interface GenerateThumbnailJobPayload {
  sourceObjectKey: string;
  width?: number;
  height?: number;
}

export interface GenerateThumbnailJobResult {
  thumbnailKey: string;
}

export function createGenerateThumbnailJob(input: {
  targetItemId: string;
  payload: GenerateThumbnailJobPayload;
  maxAttempts?: number;
  now?: string;
}): SharedLibraryJob {
  const now = input.now ?? new Date().toISOString();
  return {
    id: `generate-thumbnail:${input.targetItemId}:${input.payload.sourceObjectKey}`,
    kind: "generate-thumbnail" satisfies SharedLibraryJobKind,
    targetItemId: input.targetItemId,
    payload: input.payload as unknown as Record<string, unknown>,
    status: "pending",
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 5,
    createdAt: now,
    updatedAt: now,
  };
}
