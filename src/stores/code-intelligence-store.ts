"use client";

import { create } from "zustand";
import {
  canUseCodeIntelligenceStatus,
  getCodeIntelligenceStatus,
  type CodeIntelligenceProviderStatus,
} from "@/lib/code-intelligence/desktop";

interface CodeIntelligenceState {
  providers: CodeIntelligenceProviderStatus[];
  refresh: (workspaceRootPath?: string | null) => Promise<void>;
}

export const useCodeIntelligenceStore = create<CodeIntelligenceState>((set) => ({
  providers: [],
  refresh: async (workspaceRootPath) => {
    if (!canUseCodeIntelligenceStatus()) {
      set({ providers: [] });
      return;
    }
    const providers = await getCodeIntelligenceStatus(workspaceRootPath);
    set({ providers });
  },
}));
