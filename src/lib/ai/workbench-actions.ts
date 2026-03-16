import { generateUniqueName, sanitizeFileName } from '@/lib/file-operations';
import { normalizeWorkspacePath } from '@/lib/link-router/path-utils';
import type {
  AiDraftArtifact,
  AiDraftWriteMode,
  AiPlannedWrite,
  AiTaskProposal,
  EvidenceRef,
} from './types';

const AI_DRAFTS_DIRECTORY = 'AI Drafts';
const APPEND_SEPARATOR = '\n\n---\n\n';

function formatEvidenceRefs(refs: EvidenceRef[]): string {
  if (refs.length === 0) {
    return '_No evidence references attached._';
  }

  return refs
    .map((ref) => {
      const preview = ref.preview ? `\n  - Preview: ${ref.preview}` : '';
      return `- ${ref.label} (${ref.kind})\n  - Locator: ${ref.locator}${preview}`;
    })
    .join('\n');
}

export function formatDraftArtifactMarkdown(
  draft: Pick<AiDraftArtifact, 'title' | 'content' | 'sourceRefs' | 'createdAt' | 'type'>,
  options: { headingLevel?: 1 | 2 | 3 } = {}
): string {
  const createdAt = new Date(draft.createdAt).toISOString();
  const headingLevel = options.headingLevel ?? 1;
  const headingPrefix = '#'.repeat(headingLevel);
  const contentHeadingPrefix = '#'.repeat(Math.min(headingLevel + 1, 6));

  return [
    `${headingPrefix} ${draft.title}`,
    '',
    `- Type: ${draft.type}`,
    `- Created: ${createdAt}`,
    '',
    `${contentHeadingPrefix} Content`,
    '',
    draft.content.trim() || '_Empty draft content._',
    '',
    `${contentHeadingPrefix} Evidence`,
    '',
    formatEvidenceRefs(draft.sourceRefs),
    '',
  ].join('\n');
}

export function buildDraftArtifactDefaultPath(
  draft: Pick<AiDraftArtifact, 'title'>
): string {
  const fileName = `${sanitizeFileName(draft.title) || 'AI Draft'}.md`;
  return `${AI_DRAFTS_DIRECTORY}/${fileName}`;
}

export function formatTaskProposalDraftContent(
  proposal: Pick<
    AiTaskProposal,
    'summary' | 'steps' | 'requiredApprovals' | 'plannedWrites' | 'status' | 'confirmedApprovals' | 'approvedWrites'
  >,
): string {
  const steps = proposal.steps.length > 0
    ? proposal.steps.map((step, index) => `${index + 1}. ${step.title}\n   ${step.description}`).join('\n')
    : '1. Review context\n   Inspect the evidence and confirm the write targets.';

  const approvals = proposal.requiredApprovals.length > 0
    ? proposal.requiredApprovals.map((approval) => {
      const checked = proposal.confirmedApprovals.includes(approval) ? 'x' : ' ';
      return `- [${checked}] ${approval}`;
    }).join('\n')
    : '- [x] No additional approvals required.';

  const plannedWrites = proposal.plannedWrites.length > 0
    ? proposal.plannedWrites.map((write) => {
      const checked = proposal.approvedWrites.includes(write.targetPath) ? 'x' : ' ';
      return [
        `- [${checked}] ${write.targetPath} (${write.mode})`,
        write.contentPreview ? `  - Preview: ${write.contentPreview}` : null,
      ].filter(Boolean).join('\n');
    }).join('\n')
    : '_No planned writes._';

  return [
    `Status: ${proposal.status}`,
    '',
    '## Summary',
    '',
    proposal.summary,
    '',
    '## Steps',
    '',
    steps,
    '',
    '## Required Approvals',
    '',
    approvals,
    '',
    '## Planned Writes',
    '',
    plannedWrites,
    '',
  ].join('\n');
}

function titleFromTargetPath(targetPath: string, fallback: string): string {
  const fileName = targetPath.split('/').pop() ?? '';
  const withoutExtension = fileName.replace(/\.[^.]+$/, '').trim();
  if (!withoutExtension) {
    return fallback;
  }
  return withoutExtension.replace(/[-_]+/g, ' ').trim();
}

function writeModeForDraft(write: AiPlannedWrite): AiDraftWriteMode {
  if (write.mode === 'append') {
    return 'append';
  }
  if (write.mode === 'update') {
    return 'append';
  }
  return 'create';
}

function contentForPlannedWrite(
  proposal: Pick<AiTaskProposal, 'summary' | 'steps'>,
  write: AiPlannedWrite,
): string {
  const lines: string[] = [];

  if (write.mode === 'update') {
    lines.push(`Review note: the original proposal suggested updating \`${write.targetPath}\`. This draft defaults to append mode for safety.`);
    lines.push('');
  }

  if (write.contentPreview.trim()) {
    lines.push(write.contentPreview.trim());
  } else {
    lines.push(`Draft generated from proposal: ${proposal.summary}`);
  }

  if (proposal.steps.length > 0) {
    lines.push('');
    lines.push('Plan context:');
    proposal.steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step.title} - ${step.description}`);
    });
  }

  return lines.join('\n');
}

export function buildDraftArtifactsFromProposal(
  proposal: Pick<
    AiTaskProposal,
    'summary' | 'steps' | 'sourceRefs' | 'plannedWrites' | 'approvedWrites' | 'generatedDraftTargets'
  >,
): Array<Pick<AiDraftArtifact, 'type' | 'title' | 'sourceRefs' | 'content' | 'targetPath' | 'writeMode'>> {
  const allowedTargets = new Set(proposal.approvedWrites);
  const existingTargets = new Set(proposal.generatedDraftTargets);

  return proposal.plannedWrites
    .filter((write) => allowedTargets.has(write.targetPath) && !existingTargets.has(write.targetPath))
    .map((write) => ({
      type: 'task_plan' as const,
      title: `${titleFromTargetPath(write.targetPath, proposal.summary)} Draft`,
      sourceRefs: proposal.sourceRefs,
      content: contentForPlannedWrite(proposal, write),
      targetPath: write.targetPath,
      writeMode: writeModeForDraft(write),
    }));
}

export interface ProposalTargetDraftSummary {
  total: number;
  ready: number;
  applied: number;
  discarded: number;
  blocked: number;
}

export function getProposalTargetDrafts(
  proposal: Pick<AiTaskProposal, 'generatedDraftTargets'>,
  drafts: AiDraftArtifact[],
): AiDraftArtifact[] {
  const targets = new Set(proposal.generatedDraftTargets);
  return drafts.filter((draft) => draft.targetPath && targets.has(draft.targetPath));
}

export function summarizeProposalTargetDrafts(
  proposal: Pick<AiTaskProposal, 'generatedDraftTargets'>,
  drafts: AiDraftArtifact[],
): ProposalTargetDraftSummary {
  const targetDrafts = getProposalTargetDrafts(proposal, drafts);

  return {
    total: targetDrafts.length,
    ready: targetDrafts.filter((draft) => draft.status === 'draft' && isDraftReadyForWriteback(draft)).length,
    applied: targetDrafts.filter((draft) => draft.status === 'applied').length,
    discarded: targetDrafts.filter((draft) => draft.status === 'discarded').length,
    blocked: targetDrafts.filter((draft) => draft.status === 'draft' && !isDraftReadyForWriteback(draft)).length,
  };
}

function isDraftReadyForWriteback(draft: Pick<AiDraftArtifact, 'writeMode' | 'targetPath' | 'status'>): boolean {
  if (draft.status !== 'draft') {
    return false;
  }
  if ((draft.writeMode ?? 'create') === 'append') {
    return Boolean(draft.targetPath?.trim());
  }
  return true;
}

export interface BatchDraftWriteResult {
  draftId: string;
  path?: string;
  writeMode: AiDraftWriteMode;
  ok: boolean;
  error?: string;
  handle?: FileSystemFileHandle;
}

export async function applyDraftArtifactsToWorkspace(
  rootHandle: FileSystemDirectoryHandle,
  drafts: AiDraftArtifact[],
): Promise<BatchDraftWriteResult[]> {
  const results: BatchDraftWriteResult[] = [];

  for (const draft of drafts) {
    if (!isDraftReadyForWriteback(draft)) {
      results.push({
        draftId: draft.id,
        writeMode: draft.writeMode ?? 'create',
        ok: false,
        error: 'Draft is not ready for writeback.',
      });
      continue;
    }

    try {
      const writeMode = draft.writeMode ?? 'create';
      const targetPath = draft.targetPath?.trim() || undefined;
      const result = await writeDraftArtifactToTarget(rootHandle, draft, {
        targetPath,
        writeMode,
      });
      results.push({
        draftId: draft.id,
        writeMode,
        ok: true,
        path: result.path,
        handle: result.handle,
      });
    } catch (error) {
      results.push({
        draftId: draft.id,
        writeMode: draft.writeMode ?? 'create',
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown writeback error',
      });
    }
  }

  return results;
}

function trimWorkspacePrefix(path: string, rootName: string): string {
  const normalized = normalizeWorkspacePath(path.trim());
  if (!normalized) {
    return '';
  }

  const rootPrefix = `${normalizeWorkspacePath(rootName)}/`;
  if (normalized === normalizeWorkspacePath(rootName)) {
    return '';
  }
  if (normalized.startsWith(rootPrefix)) {
    return normalized.slice(rootPrefix.length);
  }

  return normalized;
}

async function ensureDirectoryHandle(
  rootHandle: FileSystemDirectoryHandle,
  directoryPath: string,
): Promise<FileSystemDirectoryHandle> {
  const parts = normalizeWorkspacePath(directoryPath).split('/').filter(Boolean);
  let current = rootHandle;

  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }

  return current;
}

async function fileExists(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<boolean> {
  try {
    await directoryHandle.getFileHandle(fileName);
    return true;
  } catch {
    return false;
  }
}

async function readExistingFile(
  fileHandle: FileSystemFileHandle,
): Promise<string> {
  const file = await fileHandle.getFile();
  return file.text();
}

function buildAppendMarkdown(
  draft: Pick<AiDraftArtifact, 'title' | 'content' | 'sourceRefs' | 'createdAt' | 'type'>
): string {
  return formatDraftArtifactMarkdown(draft, { headingLevel: 2 });
}

function normalizeTargetInput(
  rootHandle: FileSystemDirectoryHandle,
  targetPath: string | undefined,
  draft: Pick<AiDraftArtifact, 'title'>
): { relativePath: string; explicitPath: boolean } {
  if (!targetPath || !targetPath.trim()) {
    return {
      relativePath: buildDraftArtifactDefaultPath(draft),
      explicitPath: false,
    };
  }

  return {
    relativePath: trimWorkspacePrefix(targetPath, rootHandle.name),
    explicitPath: true,
  };
}

function splitTargetPath(relativePath: string): { directoryPath: string; fileName: string } {
  const normalized = normalizeWorkspacePath(relativePath);
  const parts = normalized.split('/').filter(Boolean);
  const fileName = parts.pop() ?? '';
  return {
    directoryPath: parts.join('/'),
    fileName,
  };
}

async function writeFileContent(
  fileHandle: FileSystemFileHandle,
  content: string,
): Promise<void> {
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

function normalizeAnnotationId(value: string): string {
  if (value.startsWith('ann-')) {
    return value;
  }
  return `ann-${value}`;
}

export function toEvidenceNavigationTarget(ref: EvidenceRef): string {
  if (ref.kind !== 'pdf_annotation') {
    return ref.locator;
  }

  const [pathPart, fragment = ''] = ref.locator.split('#', 2);
  if (!fragment) {
    return ref.locator;
  }

  if (fragment.startsWith('ann-')) {
    return `${pathPart}#${fragment}`;
  }

  const params = new URLSearchParams(fragment);
  const annotationId = params.get('annotation') ?? params.get('ann');
  if (!annotationId) {
    return ref.locator;
  }

  return `${pathPart}#${normalizeAnnotationId(annotationId)}`;
}

export async function writeDraftArtifactToWorkspace(
  rootHandle: FileSystemDirectoryHandle,
  draft: Pick<AiDraftArtifact, 'title' | 'content' | 'sourceRefs' | 'createdAt' | 'type'>
): Promise<{ handle: FileSystemFileHandle; path: string }> {
  return writeDraftArtifactToTarget(rootHandle, draft);
}

export async function writeDraftArtifactToTarget(
  rootHandle: FileSystemDirectoryHandle,
  draft: Pick<AiDraftArtifact, 'title' | 'content' | 'sourceRefs' | 'createdAt' | 'type'>,
  options: {
    targetPath?: string;
    writeMode?: AiDraftWriteMode;
  } = {}
): Promise<{ handle: FileSystemFileHandle; path: string }> {
  const writeMode = options.writeMode ?? 'create';
  const { relativePath, explicitPath } = normalizeTargetInput(rootHandle, options.targetPath, draft);
  const { directoryPath, fileName } = splitTargetPath(relativePath);

  if (!fileName) {
    throw new Error('目标路径缺少文件名。');
  }

  const targetDirectory = await ensureDirectoryHandle(rootHandle, directoryPath);

  if (writeMode === 'append') {
    if (!explicitPath) {
      throw new Error('追加写入需要明确指定现有 Markdown 目标路径。');
    }
    if (!fileName.toLowerCase().endsWith('.md')) {
      throw new Error('追加写入仅支持 Markdown 文件。');
    }

    const fileHandle = await targetDirectory.getFileHandle(fileName);
    const existingContent = await readExistingFile(fileHandle);
    const nextContent = `${existingContent.trimEnd()}${APPEND_SEPARATOR}${buildAppendMarkdown(draft)}`;
    await writeFileContent(fileHandle, nextContent);

    return {
      handle: fileHandle,
      path: `${rootHandle.name}/${relativePath}`,
    };
  }

  let resolvedFileName = fileName;
  if (!explicitPath) {
    const baseName = sanitizeFileName(draft.title) || 'AI Draft';
    resolvedFileName = await generateUniqueName(targetDirectory, baseName, '.md');
  } else if (await fileExists(targetDirectory, fileName)) {
    throw new Error('目标文件已存在，请改用追加模式或更换路径。');
  }

  const fileHandle = await targetDirectory.getFileHandle(resolvedFileName, { create: true });
  await writeFileContent(fileHandle, formatDraftArtifactMarkdown(draft));

  const resolvedRelativePath = directoryPath
    ? `${directoryPath}/${resolvedFileName}`
    : resolvedFileName;

  return {
    handle: fileHandle,
    path: `${rootHandle.name}/${resolvedRelativePath}`,
  };
}
