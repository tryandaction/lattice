import { create } from "zustand";
import type { TransientPdfAnnotation } from "@/lib/ai/transient-pdf-annotations";
import type { AnnotationItem } from "@/types/universal-annotation";
import { normalizeWorkspacePath } from "@/lib/link-router/path-utils";

export interface PdfCompanionOperation {
  kind: "injection" | "undo";
  requestId: string;
  fileIdentity: string;
  consumerId: string;
}

/** Resolve only known workspace aliases; arbitrary path suffixes are not file identities. */
export function pdfCompanionDocumentIdentity(
  path: string,
  workspace: { rootPath?: string | null; rootName?: string; workspaceKey?: string | null },
): string | null {
  let normalized = normalizeWorkspacePath(path.trim());
  if (!normalized || normalized.split("/").some((part) => part === "..")) return null;
  const root = normalizeWorkspacePath(workspace.rootPath ?? "");
  const isAbsolute = (value: string) => /^[a-z]:\//i.test(value) || value.startsWith("/");
  const windowsRoot = /^[a-z]:\//i.test(root);
  if (isAbsolute(normalized)) {
    if (root && isAbsolute(root)) {
      const comparable = windowsRoot ? normalized.toLowerCase() : normalized;
      const comparableRoot = windowsRoot ? root.toLowerCase() : root;
      if (!comparable.startsWith(`${comparableRoot}/`)) return null;
    }
    return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
  }
  if (workspace.rootName && normalized.startsWith(`${workspace.rootName}/`)) {
    normalized = normalized.slice(workspace.rootName.length + 1);
  }
  if (root && isAbsolute(root)) {
    const absolute = `${root}/${normalized}`;
    return windowsRoot ? absolute.toLowerCase() : absolute;
  }
  return `${workspace.workspaceKey ?? workspace.rootName ?? "__workspace__"}:${normalized}`;
}

let operationSequence = 0;
const operationId = (kind: string) => `ai-pdf-${kind}-${Date.now()}-${++operationSequence}`;
const sameOperation = (left: PdfCompanionOperation | null, right: PdfCompanionOperation) => Boolean(left
  && left.kind === right.kind && left.requestId === right.requestId
  && left.fileIdentity === right.fileIdentity && left.consumerId === right.consumerId);

interface PendingTransientInjection {
  requestId: string;
  annotations: TransientPdfAnnotation[];
}

interface AiPdfCompanionState {
  transientAnnotations: TransientPdfAnnotation[];
  pendingInjection: PendingTransientInjection | null;
  clearRevision: number;
  error: string | null;
  savedAnnotations: Array<{ documentPath: string; annotation: AnnotationItem }>;
  pendingUndo: string | null;
  pendingUndoRequestId: string | null;
  operationClaim: (PdfCompanionOperation & { phase: "resolving" | "persisting" }) | null;
  operationRevision: number;
  claimOperation: (operation: PdfCompanionOperation) => boolean;
  beginOperationPersistence: (operation: PdfCompanionOperation) => boolean;
  releaseOperation: (operation: PdfCompanionOperation, settled?: boolean) => void;
  sourceMessageId: string | null;
  failInjection: (requestId: string, error: string) => void;
  requestUndo: (documentPath: string) => void;
  completeUndo: (requestId: string, ids: string[], error?: string) => void;
  setTransientAnnotations: (annotations: TransientPdfAnnotation[], sourceMessageId?: string) => void;
  requestInjection: (ids?: string[]) => void;
  completeInjection: (requestId: string, annotationIds: string[], saved?: Array<{ documentPath: string; annotation: AnnotationItem }>) => void;
  discard: (ids?: string[]) => void;
  clear: () => void;
}

function withoutIds(annotations: TransientPdfAnnotation[], ids?: string[]): TransientPdfAnnotation[] {
  if (!ids?.length) {
    return [];
  }
  const ignored = new Set(ids);
  return annotations.filter((annotation) => !ignored.has(annotation.id));
}

export const useAiPdfCompanionStore = create<AiPdfCompanionState>((set, get) => ({
  transientAnnotations: [],
  pendingInjection: null,
  clearRevision: 0,
  error: null,
  savedAnnotations: [],
  pendingUndo: null,
  pendingUndoRequestId: null,
  operationClaim: null,
  operationRevision: 0,
  claimOperation: (operation) => {
    const state = get();
    const activeRequest = operation.kind === "injection" ? state.pendingInjection?.requestId : state.pendingUndoRequestId;
    if (state.operationClaim || activeRequest !== operation.requestId) return false;
    set({ operationClaim: { ...operation, phase: "resolving" } });
    return true;
  },
  beginOperationPersistence: (operation) => {
    const state = get();
    const activeRequest = operation.kind === "injection" ? state.pendingInjection?.requestId : state.pendingUndoRequestId;
    if (!sameOperation(state.operationClaim, operation) || state.operationClaim?.phase !== "resolving" || activeRequest !== operation.requestId) return false;
    set({ operationClaim: { ...operation, phase: "persisting" } });
    return true;
  },
  releaseOperation: (operation, settled = false) => {
    const state = get();
    if (!sameOperation(state.operationClaim, operation) || (!settled && state.operationClaim?.phase === "persisting")) return;
    set({ operationClaim: null, operationRevision: state.operationRevision + 1 });
  },
  sourceMessageId: null,
  failInjection: (requestId, error) => {
    if (get().pendingInjection?.requestId === requestId) set({ pendingInjection: null, error });
  },
  requestUndo: (documentPath) => {
    if (get().pendingInjection || get().pendingUndo || get().operationClaim) return;
    set({ pendingUndo: documentPath, pendingUndoRequestId: operationId("undo"), error: null });
  },
  completeUndo: (requestId, ids, error) => {
    if (get().pendingUndoRequestId !== requestId) return;
    set((state) => ({
      savedAnnotations: state.savedAnnotations.filter((item) => !ids.includes(item.annotation.id)),
      pendingUndo: null,
      pendingUndoRequestId: null,
      error: error ?? null,
    }));
  },
  setTransientAnnotations: (annotations, sourceMessageId) => set({
    transientAnnotations: annotations,
    pendingInjection: null,
    error: null,
    savedAnnotations: [],
    pendingUndo: null,
    pendingUndoRequestId: null,
    operationClaim: get().operationClaim?.phase === "persisting" ? get().operationClaim : null,
    operationRevision: get().operationRevision + 1,
    sourceMessageId: sourceMessageId ?? null,
    clearRevision: get().clearRevision + 1,
  }),
  requestInjection: (ids) => {
    if (get().pendingInjection || get().pendingUndo || get().operationClaim) return;
    const annotations = ids?.length
      ? get().transientAnnotations.filter((annotation) => ids.includes(annotation.id))
      : get().transientAnnotations;
    if (annotations.length === 0) {
      return;
    }
    set({
      error: null,
      pendingInjection: {
        requestId: operationId("injection"),
        annotations,
      },
    });
  },
  completeInjection: (requestId, annotationIds, saved = []) => {
    if (get().pendingInjection?.requestId !== requestId) {
      return;
    }
    set((state) => ({
      transientAnnotations: withoutIds(state.transientAnnotations, annotationIds),
      pendingInjection: null,
      savedAnnotations: [...state.savedAnnotations, ...saved],
    }));
  },
  discard: (ids) => set((state) => ({
    transientAnnotations: withoutIds(state.transientAnnotations, ids),
    pendingInjection: null,
    operationClaim: state.operationClaim?.phase === "persisting" ? state.operationClaim : null,
    operationRevision: state.operationRevision + 1,
  })),
  clear: () => set((state) => ({
    transientAnnotations: [],
    pendingInjection: null,
    clearRevision: state.clearRevision + 1,
    error: null,
    savedAnnotations: [],
    pendingUndo: null,
    pendingUndoRequestId: null,
    operationClaim: state.operationClaim?.phase === "persisting" ? state.operationClaim : null,
    operationRevision: state.operationRevision + 1,
    sourceMessageId: null,
  })),
}));
