/**
 * Conflict view model and resolution actions.
 *
 * Turns raw `SyncConflict` records into something the conflict center can
 * render: the entity involved, both sides (local/remote version + author +
 * time), a recommended action, and a recoverable payload. Every resolution
 * action maps to a distinct sync operation so the UI never shows a generic
 * "sync failed" — it always routes a concrete, recoverable action.
 */

import type {
  Annotation,
  ConflictReason,
  IsoTimestamp,
  Item,
  SyncConflict,
} from "./domain";

export type ConflictResolutionAction =
  | { kind: "keep-local" }
  | { kind: "adopt-remote" }
  | { kind: "copy-as-new-item" }
  | { kind: "merge-annotations" }
  | { kind: "restore-deletion" };

export interface ConflictSide {
  versionLabel: string;
  authorId: string;
  timestamp: IsoTimestamp;
  payload: Record<string, unknown>;
  isRemote: boolean;
}

export interface ConflictViewModel {
  conflictId: string;
  entityType: string;
  entityId: string;
  reason: ConflictReason;
  title: string;
  description: string;
  local: ConflictSide | null;
  remote: ConflictSide | null;
  recommendedAction: ConflictResolutionAction;
  recoverable: boolean;
  recoverablePayload?: Record<string, unknown>;
  createdAt: IsoTimestamp;
}

const REASON_META: Record<
  ConflictReason,
  { label: string; recommended: ConflictResolutionAction; recoverable: boolean }
> = {
  "binary-version": {
    label: "Binary version conflict",
    recommended: { kind: "adopt-remote" },
    recoverable: true,
  },
  "annotation-revision": {
    label: "Annotation revision conflict",
    recommended: { kind: "merge-annotations" },
    recoverable: true,
  },
  "delete-edit": {
    label: "Delete vs edit conflict",
    recommended: { kind: "restore-deletion" },
    recoverable: true,
  },
  "permission-revoked": {
    label: "Permission revoked",
    recommended: { kind: "keep-local" },
    recoverable: false,
  },
  "quota-exceeded": {
    label: "Quota exceeded",
    recommended: { kind: "keep-local" },
    recoverable: false,
  },
};

export function classifyConflictReason(reason: ConflictReason): {
  label: string;
  recommended: ConflictResolutionAction;
  recoverable: boolean;
} {
  return REASON_META[reason];
}

export function conflictActionLabel(action: ConflictResolutionAction): string {
  switch (action.kind) {
    case "keep-local":
      return "Keep local";
    case "adopt-remote":
      return "Adopt remote";
    case "copy-as-new-item":
      return "Copy as new item";
    case "merge-annotations":
      return "Merge annotations";
    case "restore-deletion":
      return "Restore deletion";
  }
}

export function conflictActionToOperation(
  action: ConflictResolutionAction,
  conflict: SyncConflict,
): { operationType: string; payload: Record<string, unknown> } {
  switch (action.kind) {
    case "keep-local":
      return { operationType: "conflict.resolve.keep-local", payload: { conflictId: conflict.id } };
    case "adopt-remote":
      return {
        operationType: "conflict.resolve.adopt-remote",
        payload: { conflictId: conflict.id, remoteOperationId: conflict.remoteOperationId },
      };
    case "copy-as-new-item":
      return {
        operationType: "item.copy",
        payload: { conflictId: conflict.id, entityId: conflict.entityId },
      };
    case "merge-annotations":
      return {
        operationType: "annotation.merge",
        payload: { conflictId: conflict.id, entityId: conflict.entityId },
      };
    case "restore-deletion":
      return {
        operationType: "item.restore",
        payload: { conflictId: conflict.id, entityId: conflict.entityId },
      };
  }
}

function buildSide(
  payload: Record<string, unknown> | undefined,
  operationId: string | undefined,
  isRemote: boolean,
): ConflictSide | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const versionNumber = typeof record.versionNumber === "number" ? record.versionNumber : undefined;
  const revision = typeof record.revision === "number" ? record.revision : undefined;
  const label =
    versionNumber !== undefined
      ? `v${versionNumber}`
      : revision !== undefined
        ? `r${revision}`
        : (operationId ?? "unknown");
  return {
    versionLabel: `${label} (${isRemote ? "remote" : "local"})`,
    authorId: typeof record.authorId === "string" ? record.authorId : "unknown",
    timestamp: typeof record.createdAt === "string" ? record.createdAt : "",
    payload: record,
    isRemote,
  };
}

export function buildConflictViewModels(
  conflicts: readonly SyncConflict[],
  items: readonly Item[],
  annotations: readonly Annotation[],
): ConflictViewModel[] {
  const itemById = new Map(items.map((entry) => [entry.id, entry]));
  void annotations; // annotation bodies ride inside conflict payloads; kept for future joins

  return conflicts.map((entry) => {
    const meta = REASON_META[entry.reason];
    const item = itemById.get(entry.entityId);
    const local = buildSide(entry.localPayload, entry.localOperationId, false);
    const remote = buildSide(entry.remotePayload, entry.remoteOperationId, true);
    const recoverablePayload = entry.remotePayload ?? entry.localPayload;

    return {
      conflictId: entry.id,
      entityType: entry.entityType,
      entityId: entry.entityId,
      reason: entry.reason,
      title: item?.title ?? entry.entityId,
      description: meta.label,
      local,
      remote,
      recommendedAction: meta.recommended,
      recoverable: meta.recoverable,
      recoverablePayload,
      createdAt: entry.createdAt,
    };
  });
}
