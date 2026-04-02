import type { PaneId } from "@/types/layout";

export interface ExecutionScopeInput {
  paneId: PaneId;
  tabId: string;
}

export function buildExecutionScopeId({ paneId, tabId }: ExecutionScopeInput): string {
  return `${paneId}::${tabId}`;
}

