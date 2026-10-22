/**
 * Shared Library sync status store.
 *
 * UI-facing sync state (the coarse `SyncStatus` the shell and the sync status
 * indicator render). The fine-grained engine state lives in the sync engine;
 * this store only mirrors what the UI needs so components never read engine
 * internals.
 */

import { create } from "zustand";
import type { SyncStatus } from "@/lib/shared-library/domain";

interface SharedLibrarySyncState {
  status: SyncStatus;
  pendingCount: number;
  lastError: string | null;
}

interface SharedLibrarySyncActions {
  setStatus: (status: SyncStatus) => void;
  setPendingCount: (pendingCount: number) => void;
  setLastError: (lastError: string | null) => void;
  markOffline: () => void;
  markSynced: () => void;
}

export type SharedLibrarySyncStore = SharedLibrarySyncState & SharedLibrarySyncActions;

export const useSharedLibrarySyncStore = create<SharedLibrarySyncStore>((set) => ({
  status: "local_only",
  pendingCount: 0,
  lastError: null,
  setStatus: (status) => set({ status }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setLastError: (lastError) => set({ lastError }),
  markOffline: () => set({ status: "offline" }),
  markSynced: () => set({ status: "synced", pendingCount: 0, lastError: null }),
}));
