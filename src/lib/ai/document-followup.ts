import type { AgentSession } from './agent-session';
import type { AgentDocumentSource } from './document-source';
import type { DocumentResearchCheckpoint } from './document-research';
import { isDocumentFollowup } from './request-intent';

export function checkpointObjective(checkpoint: DocumentResearchCheckpoint): { task: string; query: string } | undefined {
  try {
    const value: unknown = JSON.parse(checkpoint.queryKey);
    if (Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'string')) return { task: value[0], query: value[1] };
  } catch { /* A corrupt checkpoint must not be reused. */ }
  return undefined;
}

/** Reuse verified reading only for a follow-up on the same authorized byte versions. */
export function reusableDocumentReading(question: string, sessions: readonly AgentSession[], sources: readonly Pick<AgentDocumentSource, 'path' | 'version'>[], workspaceKey?: string) {
  if (!isDocumentFollowup(question, { hasDocumentContext: sources.length > 0 })) return null;
  for (const session of sessions) {
    const reading = session.documentResearch;
    if (!['completed', 'failed', 'cancelled'].includes(session.status) || reading?.status !== 'ready' || reading.workflowId !== 'paper-reading'
      || (reading.workspaceKey ?? '') !== (workspaceKey ?? '') || !sources.length) continue;
    const saved = reading.checkpoint;
    if (saved.evidenceIssues?.length) continue;
    if (saved.sources.length !== sources.length || !saved.sources.every(item => sources.some(source => source.path === item.path && source.version === item.version))
      || !saved.coverage.every(item => item.readUnits.length === item.totalUnits && !item.pendingUnits.length && !item.unreadableUnits.length)) continue;
    const objective = checkpointObjective(saved);
    if (objective) return { state: { ...reading, checkpoint: structuredClone(saved) }, objective };
  }
  return null;
}
