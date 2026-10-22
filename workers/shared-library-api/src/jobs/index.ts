import type { SharedLibraryJob, SharedLibraryJobKind } from "@/lib/shared-library/job-state";
import { createExtractTextJob } from "./extract-text";
import { createSnapshotUrlJob } from "./snapshot-url";
import { createGenerateThumbnailJob } from "./generate-thumbnail";

export * from "./extract-text";
export * from "./snapshot-url";
export * from "./generate-thumbnail";

export type CreateJobInput =
  | { kind: "extract-text"; targetItemId: string; payload: Parameters<typeof createExtractTextJob>[0]["payload"] }
  | { kind: "snapshot-url"; targetItemId: string; payload: Parameters<typeof createSnapshotUrlJob>[0]["payload"] }
  | { kind: "generate-thumbnail"; targetItemId: string; payload: Parameters<typeof createGenerateThumbnailJob>[0]["payload"] };

/** Routes a job kind to its idempotent factory. */
export function createSharedLibraryJob(
  input: CreateJobInput & { maxAttempts?: number; now?: string },
): SharedLibraryJob {
  switch (input.kind) {
    case "extract-text":
      return createExtractTextJob(input);
    case "snapshot-url":
      return createSnapshotUrlJob(input);
    case "generate-thumbnail":
      return createGenerateThumbnailJob(input);
  }
}

export function isSharedLibraryJobKind(value: unknown): value is SharedLibraryJobKind {
  return (
    value === "extract-text" || value === "snapshot-url" || value === "generate-thumbnail"
  );
}
