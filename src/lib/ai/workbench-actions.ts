import { generateUniqueName, sanitizeFileName } from '@/lib/file-operations';
import { normalizeWorkspacePath } from '@/lib/link-router/path-utils';
import { resolveAuthorizedDocumentHandle } from './document-source-capture';
import { getDesktopHandlePath } from '@/lib/desktop-file-system';
import { isLatticeTextDocumentPath } from './lattice-skills/text-content-validation';
import type {
  AiDraftArtifact,
  AiDraftTemplateId,
  AiDraftWriteMode,
  AiPlannedWrite,
  AiTaskProposal,
  EvidenceRef,
} from './types';

const AI_DRAFTS_DIRECTORY = 'AI Drafts';
const APPEND_SEPARATOR = '\n\n---\n\n';

const DRAFT_TEMPLATE_LABELS: Record<AiDraftTemplateId, string> = {
  'reading-note': 'Reading Note',
  'comparison-summary': 'Comparison Summary',
  'code-note': 'Code Note',
  'research-summary': 'Research Summary',
  'task-plan': 'Task Plan',
};

function resolveDraftTemplateId(
  draft: Pick<AiDraftArtifact, 'type'> & Partial<Pick<AiDraftArtifact, 'templateId'>>
): AiDraftTemplateId {
  if (draft.templateId) {
    return draft.templateId;
  }

  switch (draft.type) {
    case 'comparison_summary':
      return 'comparison-summary';
    case 'code_explainer':
      return 'code-note';
    case 'research_summary':
      return 'research-summary';
    case 'task_plan':
      return 'task-plan';
    default:
      return 'reading-note';
  }
}

export function formatDraftArtifactMarkdown(
  draft: Pick<AiDraftArtifact, 'title' | 'content' | 'sourceRefs' | 'createdAt' | 'type'> & Partial<Pick<AiDraftArtifact, 'templateId' | 'originMessageId' | 'originProposalId'>>,
  options: { headingLevel?: 1 | 2 | 3 } = {}
): string {
  const createdAt = new Date(draft.createdAt).toISOString();
  const headingLevel = options.headingLevel ?? 1;
  const headingPrefix = '#'.repeat(headingLevel);
  const contentHeadingPrefix = '#'.repeat(Math.min(headingLevel + 1, 6));
  const templateId = resolveDraftTemplateId(draft);
  const templateLabel = DRAFT_TEMPLATE_LABELS[templateId];
  const contentHeadingTitle = templateId === 'task-plan'
    ? 'Plan'
    : templateId === 'code-note'
      ? 'Code Notes'
      : templateId === 'comparison-summary'
        ? 'Comparison'
        : 'Content';

  return [
    `${headingPrefix} ${draft.title}`,
    '',
    `- Type: ${draft.type}`,
    `- Template: ${templateLabel}`,
    `- Created: ${createdAt}`,
    draft.originMessageId ? `- Origin Message: ${draft.originMessageId}` : null,
    draft.originProposalId ? `- Origin Proposal: ${draft.originProposalId}` : null,
    '',
    `${contentHeadingPrefix} ${contentHeadingTitle}`,
    '',
    draft.content.trim() || '_Empty draft content._',
    '',
  ].filter(Boolean).join('\n');
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
  return write.mode;
}

function contentForPlannedWrite(
  proposal: Pick<AiTaskProposal, 'summary' | 'steps'>,
  write: AiPlannedWrite,
): string {
  const lines: string[] = [];

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
    'id' | 'summary' | 'steps' | 'sourceRefs' | 'plannedWrites' | 'approvedWrites' | 'generatedDraftTargets'
  >,
): Array<Pick<AiDraftArtifact, 'type' | 'title' | 'sourceRefs' | 'content' | 'targetPath' | 'writeMode' | 'templateId' | 'originProposalId'>> {
  const allowedTargets = new Set(proposal.approvedWrites);
  const existingTargets = new Set(proposal.generatedDraftTargets);

  return proposal.plannedWrites
    .filter((write) => allowedTargets.has(write.targetPath) && !existingTargets.has(write.targetPath))
    .map((write) => ({
      type: 'task_plan' as const,
      templateId: 'task-plan' as const,
      title: `${titleFromTargetPath(write.targetPath, proposal.summary)} Draft`,
      sourceRefs: proposal.sourceRefs,
      content: contentForPlannedWrite(proposal, write),
      targetPath: write.targetPath,
      writeMode: writeModeForDraft(write),
      originProposalId: proposal.id,
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

function isDraftReadyForWriteback(draft: Pick<AiDraftArtifact, 'writeMode' | 'targetPath' | 'status' | 'fileChange'>): boolean {
  if (draft.status !== 'draft') {
    return false;
  }
  if ((draft.writeMode ?? 'create') === 'append') {
    return Boolean(draft.targetPath?.trim());
  }
  if (draft.writeMode === 'update') {
    return Boolean(draft.targetPath?.trim() && typeof draft.fileChange?.expectedContent === 'string');
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
  parentPdfPath?: string;
}

export async function applyDraftArtifactsToWorkspace(
  rootHandle: FileSystemDirectoryHandle,
  drafts: AiDraftArtifact[],
  options: { workspaceKey?: string; beforeWrite?: (relativePath: string) => void } = {},
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
        workspaceKey: options.workspaceKey,
        beforeWrite: options.beforeWrite,
      });
      results.push({
        draftId: draft.id,
        writeMode,
        ok: true,
        path: result.path,
        handle: result.handle,
        ...(result.parentPdfPath ? { parentPdfPath: result.parentPdfPath } : {}),
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
    relativePath: normalizeWorkspaceWritePath(rootHandle, targetPath),
    explicitPath: true,
  };
}

/** Validate before normalization so dot segments cannot escape the workspace. */
export function normalizeWorkspaceWritePath(rootHandle: FileSystemDirectoryHandle, target: string): string {
  let path = target.trim().replace(/\\/g, '/');
  if (!path || /[\u0000-\u001f?#]/u.test(path) || path.split('/').some(part => part === '.' || part === '..')) throw new Error('目标文件路径无效。');
  const desktopRoot = getDesktopHandlePath(rootHandle)?.replace(/\\/g, '/').replace(/\/$/, '');
  if (/^[a-z]:\//i.test(path) || path.startsWith('/')) {
    if (!desktopRoot || !path.toLowerCase().startsWith(desktopRoot.toLowerCase() + '/')) throw new Error('目标文件不在当前工作区。');
    path = path.slice(desktopRoot.length + 1);
  }
  const relative = trimWorkspacePrefix(path, rootHandle.name);
  const pdfChildNote = /^\.lattice\/items\/[^/]+\/[^/]+$/i.test(relative) && isLatticeTextDocumentPath(relative);
  if (!relative || relative.split('/').some(part => part === '.git' || (part === '.lattice' && !pdfChildNote))) throw new Error('不能写入工作区内部配置目录。');
  return relative;
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
  draft: Pick<AiDraftArtifact, 'title' | 'content' | 'sourceRefs' | 'createdAt' | 'type'> & Partial<Pick<AiDraftArtifact, 'pdfChildTarget' | 'cloudPdfChildProposal' | 'cloudFileProposal' | 'targetPath' | 'contentFormat' | 'fileChange'>>,
  options: {
    targetPath?: string;
    writeMode?: AiDraftWriteMode;
    workspaceKey?: string;
    beforeWrite?: (relativePath: string) => void;
  } = {}
): Promise<{ handle: FileSystemFileHandle; path: string; parentPdfPath?: string }> {
  if (draft.cloudPdfChildProposal || draft.cloudFileProposal || draft.sourceRefs.some(ref => ref.cloudIdentity) && /^\/?(?:library\?|cloud:)/i.test(options.targetPath ?? draft.targetPath ?? '')) throw new Error('云文件提案必须通过已授权云 provider 审查应用，不能写入本地文件系统。');
  const writeMode = options.writeMode ?? 'create';
  const child = draft.pdfChildTarget;
  const requestedPath = options.targetPath ?? draft.targetPath;
  if (child && (writeMode === 'create' || writeMode === 'update') && (!requestedPath?.trim()
    || splitTargetPath(trimWorkspacePrefix(requestedPath, rootHandle.name)).directoryPath === splitTargetPath(trimWorkspacePrefix(child.suggestedTargetPath, rootHandle.name)).directoryPath)) {
    const desktopPath = getDesktopHandlePath(rootHandle)?.replace(/\\/g, '/').replace(/\/$/, '');
    const workspaceKey = options.workspaceKey ?? (desktopPath ? `desktop:${desktopPath}` : rootHandle.name);
    if (child.workspaceKey && child.workspaceKey !== workspaceKey) throw new Error('请回到原 PDF 所在工作区后保存子文档。');
    const sourcePath = normalizeWorkspaceWritePath(rootHandle, child.sourcePath);
    if (!draft.sourceRefs.some(ref => (ref.kind === 'pdf_page' || ref.kind === 'pdf_annotation' || (draft.contentFormat === 'raw' && ref.kind === 'file'))
      && normalizeWorkspaceWritePath(rootHandle, ref.locator.split('#', 1)[0].split('?', 1)[0]) === sourcePath)) {
      throw new Error('子文档缺少原 PDF 的已核实来源。');
    }
    const { getPdfItemManifestIndex } = await import('@/lib/pdf-item');
    const index = await getPdfItemManifestIndex(rootHandle);
    const known = (child.parentItemId ? index.byDocumentId.get(child.parentItemId) : undefined) ?? index.byKnownPdfPath.get(normalizeWorkspacePath(sourcePath))
      ?? index.byKnownPdfPath.get(trimWorkspacePrefix(sourcePath, rootHandle.name));
    if (child.parentItemId && known && ![known.pdfPath, ...known.knownPdfPaths].some(path => {
      try { return normalizeWorkspaceWritePath(rootHandle, path) === sourcePath; } catch { return false; }
    })) throw new Error('PDF 来源路径与稳定文件身份不匹配。');
    const parentPath = known?.pdfPath ?? sourcePath;
    // Check the authorized original (or its manifest-recorded move) before any write.
    const parentHandle = await resolveAuthorizedDocumentHandle(rootHandle, parentPath);
    const parentFile = await parentHandle.getFile();
    if (!child.parentVersion || !child.parentItemId) throw new Error('PDF 子文件草稿缺少父文件版本，请重新读取 PDF 并生成建议。');
    const { getAgentDocumentVersion } = await import('./document-source');
    if (await getAgentDocumentVersion(parentFile, child.parentItemId) !== child.parentVersion) throw new Error('PDF 在生成建议后已改变，本次没有写入；请重新读取并生成。');
    const relativeParentPath = trimWorkspacePrefix(desktopPath && parentPath.toLowerCase().startsWith(`${desktopPath.toLowerCase()}/`)
      ? parentPath.slice(desktopPath.length + 1) : parentPath, rootHandle.name);
    const fileName = splitTargetPath(requestedPath?.trim() || child.suggestedTargetPath).fileName;
    if (writeMode === 'update') {
      if (!draft.fileChange || typeof draft.fileChange.expectedContent !== 'string') throw new Error('更新 PDF 子文件需要原文件版本快照，请重新生成。');
      const actual = await resolveAuthorizedDocumentHandle(rootHandle, draft.fileChange.targetPath);
      if (await (await actual.getFile()).text() !== draft.fileChange.expectedContent) throw new Error('子文件在生成建议后已改变，本次没有写入。');
    }
    const { preparePdfChildProposal, applyReviewedPdfChildProposal, pdfChildProposalApproval } = await import('./lattice-skills/pdf-child-skill');
    const proposal = await preparePdfChildProposal({ root: rootHandle, workspaceKey, parentPath: relativeParentPath,
      parentItemId: child.parentItemId, fileName, content: draft.contentFormat === 'raw' ? draft.content : formatDraftArtifactMarkdown(draft),
      mode: writeMode, sourceRefs: draft.sourceRefs, expectedParentVersion: child.parentVersion,
      ...(writeMode === 'update' ? { expectedContent: draft.fileChange?.expectedContent } : {}) });
    options.beforeWrite?.(proposal.targetPath);
    const saved = await applyReviewedPdfChildProposal({ root: rootHandle, workspaceKey, proposal, approval: pdfChildProposalApproval(proposal) });
    return { handle: saved.handle, path: `${rootHandle.name}/${saved.path}`, parentPdfPath: `${rootHandle.name}/${trimWorkspacePrefix(saved.parentPath, rootHandle.name)}` };
  }
  const { relativePath, explicitPath } = normalizeTargetInput(rootHandle, requestedPath, draft);
  const { directoryPath, fileName } = splitTargetPath(relativePath);

  if (!fileName) {
    throw new Error('目标路径缺少文件名。');
  }

  const desktopRoot = getDesktopHandlePath(rootHandle)?.replace(/\\/g, '/').replace(/\/$/, '');
  const workspaceKey = options.workspaceKey ?? (desktopRoot ? `desktop:${desktopRoot}` : rootHandle.name);
  if (draft.fileChange?.workspaceKey && draft.fileChange.workspaceKey !== workspaceKey) throw new Error('请回到此文件所属工作区后应用更改。');
  if (draft.contentFormat === 'raw' && /\.(?:pdf|png|jpe?g|docx?|xlsx?|pptx?|exe|dll)$/i.test(fileName)) throw new Error('文件编辑仅支持文本文件；二进制文件需要对应的文档工具。');
  if (writeMode === 'update') {
    if (!explicitPath || !draft.fileChange || typeof draft.fileChange.expectedContent !== 'string') throw new Error('修改现有文件需要读取原文件并保留版本快照，请重新生成编辑建议。');
    if (normalizeWorkspaceWritePath(rootHandle, draft.fileChange.targetPath) !== relativePath) throw new Error('编辑建议绑定原文件，不能直接改为另一文件；请重新生成建议。');
    const handle = await resolveAuthorizedDocumentHandle(rootHandle, relativePath);
    if (await readExistingFile(handle) !== draft.fileChange.expectedContent) throw new Error('文件在生成建议后已改变，本次没有写入；请基于最新内容重新生成。');
    options.beforeWrite?.(relativePath);
    await writeFileContent(handle, draft.contentFormat === 'raw' ? draft.content : formatDraftArtifactMarkdown(draft));
    const expected = draft.contentFormat === 'raw' ? draft.content : formatDraftArtifactMarkdown(draft);
    if (await readExistingFile(handle) !== expected) throw new Error('写入后回读不一致，请检查文件。');
    return { handle, path: `${rootHandle.name}/${relativePath}` };
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
    const nextContent = draft.contentFormat === 'raw' ? existingContent + draft.content : `${existingContent.trimEnd()}${APPEND_SEPARATOR}${buildAppendMarkdown(draft)}`;
    options.beforeWrite?.(relativePath);
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

  options.beforeWrite?.(directoryPath ? directoryPath + "/" + resolvedFileName : resolvedFileName);
  const fileHandle = await targetDirectory.getFileHandle(resolvedFileName, { create: true });
  const fileContent = draft.contentFormat === 'raw' ? draft.content : formatDraftArtifactMarkdown(draft);
  await writeFileContent(fileHandle, fileContent);
  if (await readExistingFile(fileHandle) !== fileContent) throw new Error('写入后回读不一致，请检查文件。');

  const resolvedRelativePath = directoryPath
    ? `${directoryPath}/${resolvedFileName}`
    : resolvedFileName;

  return {
    handle: fileHandle,
    path: `${rootHandle.name}/${resolvedRelativePath}`,
  };
}
