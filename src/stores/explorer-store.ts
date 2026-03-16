"use client";

import { create } from "zustand";
import type { EntryKind } from "@/lib/file-operations";

export interface ExplorerClipboardEntry {
  mode: "copy" | "cut";
  path: string;
  kind: EntryKind;
}

interface ExplorerState {
  selectedPath: string | null;
  selectedKind: EntryKind | null;
  renamingPath: string | null;
  clipboard: ExplorerClipboardEntry | null;
  dragOverPath: string | null;
  setSelection: (path: string | null, kind: EntryKind | null) => void;
  startRenaming: (path: string) => void;
  stopRenaming: () => void;
  setClipboard: (entry: ExplorerClipboardEntry | null) => void;
  clearClipboard: () => void;
  setDragOverPath: (path: string | null) => void;
}

export const useExplorerStore = create<ExplorerState>((set) => ({
  selectedPath: null,
  selectedKind: null,
  renamingPath: null,
  clipboard: null,
  dragOverPath: null,
  setSelection: (path, kind) => set({ selectedPath: path, selectedKind: kind }),
  startRenaming: (path) => set({ renamingPath: path }),
  stopRenaming: () => set({ renamingPath: null }),
  setClipboard: (entry) => set({ clipboard: entry }),
  clearClipboard: () => set({ clipboard: null }),
  setDragOverPath: (path) => set({ dragOverPath: path }),
}));
