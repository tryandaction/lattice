import type { AiDraftArtifact } from '../types';
export { validateLatticeTextContent as validateHarnessTextContent } from '../lattice-skills/text-content-validation';
export type HarnessReviewDraft = Omit<AiDraftArtifact, 'id' | 'createdAt' | 'status'>;
export type HarnessDraftHandler = (draft: HarnessReviewDraft) => string | void | Promise<string | void>;
export async function publishHarnessDraft(onDraft: HarnessDraftHandler | undefined, draft: HarnessReviewDraft, signal?: AbortSignal) {
  if (!onDraft) throw new Error('Workbench review surface is unavailable; no write proposal was created.');
  signal?.throwIfAborted();
  const artifactId = await onDraft(draft);
  return { status: 'pending-review' as const, ...(artifactId ? { artifactId } : {}), draft,
    plannedWrites: [{ targetPath: draft.targetPath, mode: draft.writeMode, contentPreview: draft.content.slice(0, 2000) }] };
}
