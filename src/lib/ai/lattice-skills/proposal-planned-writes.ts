import type { AiPlannedWrite, AiTaskProposalStep, EvidenceRef } from '../types';
import { buildDraftArtifactDefaultPath } from '../workbench-actions';

export interface RawPlannedWrite {
  targetPath?: string;
  mode?: 'create' | 'append' | 'update';
  contentPreview?: string;
}

export interface LatticeProposalPlannedWritesInput {
  requestedWrites?: RawPlannedWrite[];
  prompt: string;
  summary: string;
  steps: AiTaskProposalStep[];
  evidenceRefs: EvidenceRef[];
}

function normalizeTitle(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s._-]/gu, '')
    .trim()
    .slice(0, 90)
    .trim() || 'Lattice Proposal';
}

function isUnsafeTargetPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').trim();
  return (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split('/').some((part) => part === '..')
  );
}

function normalizeTargetPath(path: string): string | null {
  const normalized = path
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .trim();

  if (isUnsafeTargetPath(normalized)) {
    return null;
  }

  return normalized;
}

function defaultContentPreview(input: LatticeProposalPlannedWritesInput): string {
  const evidence = input.evidenceRefs.length > 0
    ? input.evidenceRefs.slice(0, 6).map((ref) => `- ${ref.label} (${ref.locator})`).join('\n')
    : '- No explicit evidence refs resolved yet. Review sources before writeback.';
  const steps = input.steps.length > 0
    ? input.steps.map((step, index) => `${index + 1}. ${step.title} - ${step.description}`).join('\n')
    : '1. Review context - Inspect the evidence and decide the right write targets.';

  return [
    `Proposal: ${input.summary}`,
    '',
    'Planned review steps:',
    steps,
    '',
    'Evidence:',
    evidence,
  ].join('\n');
}

function normalizeRequestedWrites(input: LatticeProposalPlannedWritesInput): AiPlannedWrite[] {
  return (input.requestedWrites ?? []).flatMap((write) => {
    if (!write.targetPath || !write.mode) {
      return [];
    }

    const targetPath = normalizeTargetPath(write.targetPath);
    if (!targetPath) {
      return [];
    }

    return [{
      targetPath,
      mode: write.mode,
      contentPreview: write.contentPreview?.trim() || defaultContentPreview(input),
    }];
  });
}

export function buildLatticeProposalPlannedWrites(
  input: LatticeProposalPlannedWritesInput,
): AiPlannedWrite[] {
  const normalized = normalizeRequestedWrites(input);
  if (normalized.length > 0) {
    return normalized;
  }

  const title = normalizeTitle(input.summary || input.prompt);
  return [{
    targetPath: buildDraftArtifactDefaultPath({ title: `${title} Plan` }),
    mode: 'create',
    contentPreview: defaultContentPreview(input),
  }];
}

export function getApprovedPlannedWriteTargets(writes: AiPlannedWrite[]): string[] {
  return writes.map((write) => write.targetPath);
}
