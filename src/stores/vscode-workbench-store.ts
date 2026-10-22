import { create } from "zustand";
import type { VSCodeWorkbenchResourceRequest } from "@/lib/vscode-workbench/desktop";

export type VSCodeWorkbenchQueuedResource = Omit<VSCodeWorkbenchResourceRequest, "requestId">;

interface VSCodeWorkbenchRequestState {
  requestSequence: number;
  pendingResource: VSCodeWorkbenchResourceRequest | null;
  dispatchingRequestId: number | null;
  lastAcknowledgedRequestId: number;
  lastError: string | null;
  queueResource: (resource: VSCodeWorkbenchQueuedResource) => VSCodeWorkbenchResourceRequest;
  markDispatching: (requestId: number) => void;
  acknowledge: (requestId: number) => void;
  fail: (requestId: number, error: string) => void;
  reset: () => void;
}

const initialState = {
  requestSequence: 0,
  pendingResource: null,
  dispatchingRequestId: null,
  lastAcknowledgedRequestId: 0,
  lastError: null,
} satisfies Pick<
  VSCodeWorkbenchRequestState,
  "requestSequence" | "pendingResource" | "dispatchingRequestId" | "lastAcknowledgedRequestId" | "lastError"
>;

export const useVSCodeWorkbenchStore = create<VSCodeWorkbenchRequestState>((set, get) => ({
  ...initialState,

  queueResource: (resource) => {
    const requestId = get().requestSequence + 1;
    const request: VSCodeWorkbenchResourceRequest = { ...resource, requestId };
    set({
      requestSequence: requestId,
      pendingResource: request,
      dispatchingRequestId: null,
      lastError: null,
    });
    return request;
  },

  markDispatching: (requestId) => {
    if (get().pendingResource?.requestId !== requestId) {
      return;
    }
    set({ dispatchingRequestId: requestId, lastError: null });
  },

  acknowledge: (requestId) => {
    if (get().pendingResource?.requestId !== requestId) {
      return;
    }
    set({
      pendingResource: null,
      dispatchingRequestId: null,
      lastAcknowledgedRequestId: requestId,
      lastError: null,
    });
  },

  fail: (requestId, error) => {
    if (get().pendingResource?.requestId !== requestId) {
      return;
    }
    set({ dispatchingRequestId: null, lastError: error });
  },

  reset: () => set(initialState),
}));
