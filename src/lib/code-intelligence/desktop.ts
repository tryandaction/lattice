"use client";

import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";

export interface CodeIntelligenceProviderStatus {
  id: "typescript" | "python" | "rust";
  label: string;
  status: "ready" | "unavailable" | "error";
  detail: string;
}

export function canUseCodeIntelligenceStatus(): boolean {
  return isTauriHost();
}

export async function getCodeIntelligenceStatus(
  workspaceRootPath?: string | null,
): Promise<CodeIntelligenceProviderStatus[]> {
  return invokeTauriCommand<CodeIntelligenceProviderStatus[]>(
    "desktop_code_intelligence_status",
    {
      workspaceRootPath: workspaceRootPath ?? null,
    },
    { timeoutMs: 10000 },
  );
}
