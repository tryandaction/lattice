import { ensurePdfItemWorkspace, getPdfItemManifestIndex, invalidatePdfItemManifestIndex, loadPdfItemManifest } from '@/lib/pdf-item';
import { generateFileId } from '@/lib/universal-annotation-storage';
import { resolveAuthorizedDocumentHandle, resolveAuthorizedDocumentLocation } from '../document-source-capture';
import { getAgentDocumentVersion } from '../document-source';
import { createWorkspaceWriteGuard } from '../workspace-write-guard';
import { normalizeWorkspaceWritePath } from '../workbench-actions';
import type { AiPlannedWrite, EvidenceRef } from '../types';
import type { AgentSourceSnapshot } from '../source-index';
import { validateLatticeTextContent } from './text-content-validation';

export interface PdfChildProposal {
  id: string; version: string; workspaceKey: string; parentItemId: string; parentPath: string; parentVersion: string;
  itemFolderPath: string; fileName: string; targetPath: string; mode: 'create' | 'update'; content: string;
  expectedContent?: string; sourceRefs: EvidenceRef[]; plannedWrites: AiPlannedWrite[];
}
export interface PdfChildReviewApproval { proposalId: string; proposalVersion: string; workspaceKey: string; targetPath: string }
const writeQueues = new WeakMap<FileSystemDirectoryHandle, Promise<unknown>>();
function abort(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('PDF child operation cancelled', 'AbortError'); }
async function permission(root: FileSystemDirectoryHandle, mode: 'read' | 'readwrite') {
  const query = (root as FileSystemDirectoryHandle & { queryPermission?: (options: { mode: 'read' | 'readwrite' }) => Promise<PermissionState> }).queryPermission;
  if (query && await query.call(root, { mode }) !== 'granted') throw new Error('PDF 工作区权限已撤销，请重新授权。');
}
export function validatePdfChildContent(fileName: string, content: string) {
  if (!fileName || /[\\/\u0000-\u001f<>:"|?*]/u.test(fileName) || fileName.startsWith('.')) throw new Error('PDF 子文件名无效。');
  validateLatticeTextContent(fileName, content);
}
async function revision(proposal: Omit<PdfChildProposal, 'version'> | PdfChildProposal): Promise<string> {
  const payload = JSON.stringify([proposal.id, proposal.workspaceKey, proposal.parentItemId, proposal.parentPath, proposal.parentVersion, proposal.itemFolderPath,
    proposal.targetPath, proposal.fileName, proposal.mode, proposal.content, proposal.expectedContent ?? null, proposal.sourceRefs, proposal.plannedWrites]);
  return getAgentDocumentVersion(new File([payload], 'proposal.json'), 'pdf-child-proposal');
}
async function existing(root: FileSystemDirectoryHandle, path: string): Promise<string | undefined> {
  try { return await (await (await resolveAuthorizedDocumentHandle(root, path)).getFile()).text(); }
  catch (error) { if (error instanceof DOMException && ['NotFoundError', 'TypeMismatchError'].includes(error.name)) return undefined; throw error; }
}
export async function preparePdfChildProposal(input: {
  root: FileSystemDirectoryHandle; workspaceKey: string; parentPath: string; parentItemId?: string;
  fileName: string; content: string; mode: 'create' | 'update'; sourceRefs?: EvidenceRef[]; sourceSnapshot?: AgentSourceSnapshot; signal?: AbortSignal;
  expectedParentVersion?: string; expectedContent?: string;
}): Promise<PdfChildProposal> {
  abort(input.signal); validatePdfChildContent(input.fileName, input.content); await permission(input.root, 'read');
  const parentLocation = await resolveAuthorizedDocumentLocation(input.root, input.parentPath), parentPath = parentLocation.path;
  if (!/\.pdf$/i.test(parentPath)) throw new Error('父文件必须是已授权 PDF。');
  if (input.parentItemId) {
    const known = (await getPdfItemManifestIndex(input.root)).byDocumentId.get(input.parentItemId);
    const matches = known && [known.pdfPath, ...known.knownPdfPaths].some(path => {
      try { return normalizeWorkspaceWritePath(input.root, path) === parentPath; } catch { return false; }
    });
    if ((known && !matches) || (!known && input.parentItemId !== generateFileId(parentPath))) throw new Error('PDF 路径与稳定文件身份不匹配。');
  }
  const manifest = await loadPdfItemManifest(input.root, generateFileId(parentPath), parentPath, input.parentItemId ? { documentId: input.parentItemId } : undefined);
  if (input.parentItemId && manifest.itemId !== input.parentItemId) throw new Error('PDF 稳定文件身份已改变，请重新读取并审查。');
  const parent = await parentLocation.handle.getFile();
  if (input.sourceSnapshot && (input.sourceSnapshot.workspaceKey !== input.workspaceKey || input.sourceSnapshot.kind !== 'pdf'
    || input.sourceSnapshot.cloudIdentity || input.sourceSnapshot.path !== parentPath
    || await getAgentDocumentVersion(parent, input.sourceSnapshot.path, input.signal) !== input.sourceSnapshot.version)) throw new Error('PDF 已读取源身份或版本已改变，请重新读取并生成提案。');
  const parentVersion = await getAgentDocumentVersion(parent, manifest.itemId, input.signal);
  if (input.expectedParentVersion !== undefined && parentVersion !== input.expectedParentVersion) throw new Error('PDF 在生成建议后已改变，请重新读取并审查。');
  const targetPath = `${manifest.itemFolderPath}/${input.fileName}`;
  const expectedContent = await existing(input.root, targetPath);
  if (input.mode === 'update' && input.expectedContent !== undefined && expectedContent !== input.expectedContent) throw new Error('子文件在生成建议后已改变，请重新读取并审查。');
  if (input.mode === 'create' && expectedContent !== undefined) throw new Error('子文件已存在，请选择更新或更换名称。');
  if (input.mode === 'update' && expectedContent === undefined) throw new Error('待更新子文件不存在。');
  const proposal = { id: globalThis.crypto.randomUUID(), workspaceKey: input.workspaceKey, parentItemId: manifest.itemId,
    parentPath, parentVersion, itemFolderPath: manifest.itemFolderPath, targetPath, fileName: input.fileName, mode: input.mode,
    content: input.content, ...(expectedContent !== undefined ? { expectedContent } : {}),
    sourceRefs: input.sourceRefs ?? [{ kind: 'file' as const, label: parentPath, locator: parentPath }],
    plannedWrites: [{ targetPath, mode: input.mode, contentPreview: input.content.slice(0, 2000) }] };
  abort(input.signal);
  return { ...proposal, version: await revision(proposal) };
}
/** Only the review surface should produce this approval after displaying the exact proposal. */
export function pdfChildProposalApproval(proposal: PdfChildProposal): PdfChildReviewApproval {
  return { proposalId: proposal.id, proposalVersion: proposal.version, workspaceKey: proposal.workspaceKey, targetPath: proposal.targetPath };
}
export async function applyReviewedPdfChildProposal(input: {
  root: FileSystemDirectoryHandle; workspaceKey: string; proposal: PdfChildProposal; approval: PdfChildReviewApproval;
  signal?: AbortSignal; onOpen?: (result: { path: string; handle: FileSystemFileHandle; parentItemId: string; parentPath: string }) => void | Promise<void>;
}): Promise<{ path: string; handle: FileSystemFileHandle; parentItemId: string; parentPath: string }> {
  const previous = writeQueues.get(input.root) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    const { proposal, approval, root } = input;
    abort(input.signal); validatePdfChildContent(proposal.fileName, proposal.content);
    if (input.workspaceKey !== proposal.workspaceKey || approval.workspaceKey !== proposal.workspaceKey
      || approval.proposalId !== proposal.id || approval.proposalVersion !== proposal.version || approval.targetPath !== proposal.targetPath
      || await revision(proposal) !== proposal.version) throw new Error('审查授权与具体 PDF 子文件提案不匹配，请重新审查。');
    await permission(root, 'readwrite');
    invalidatePdfItemManifestIndex(root);
    const current = (await getPdfItemManifestIndex(root)).byDocumentId.get(proposal.parentItemId);
    const parentPath = current?.pdfPath ?? proposal.parentPath;
    const binding = await loadPdfItemManifest(root, generateFileId(parentPath), parentPath, { documentId: proposal.parentItemId });
    if (binding.itemId !== proposal.parentItemId || binding.itemFolderPath !== proposal.itemFolderPath) throw new Error('PDF manifest 身份或子文件工作区已改变，请重新审查。');
    const parent = await (await resolveAuthorizedDocumentHandle(root, parentPath)).getFile();
    if (await getAgentDocumentVersion(parent, proposal.parentItemId, input.signal) !== proposal.parentVersion) throw new Error('PDF 在生成提案后已改变，请重新读取并审查。');
    if (current && current.itemFolderPath !== proposal.itemFolderPath) throw new Error('PDF 子文件工作区已改变，请重新审查目标位置。');
    const target = `${proposal.itemFolderPath}/${proposal.fileName}`;
    const original = await existing(root, target);
    if (proposal.mode === 'create' && original !== undefined) throw new Error('子文件已存在，本次没有覆盖。');
    if (proposal.mode === 'update' && original !== proposal.expectedContent) throw new Error('子文件在生成提案后已改变，本次没有写入。');
    const guard = createWorkspaceWriteGuard(root);
    guard.beforeWrite(target); abort(input.signal);
    // Manifest services choose the real stable item folder; initialization happens only after review.
    const manifest = await ensurePdfItemWorkspace(root, generateFileId(parentPath), parentPath, { documentId: proposal.parentItemId,
      knownPdfPaths: current?.knownPdfPaths, fileFingerprint: current?.fileFingerprint, versionFingerprint: current?.versionFingerprint });
    if (manifest.itemFolderPath !== proposal.itemFolderPath) throw new Error('PDF 目标位置已改变，请重新审查。');
    let folder = root;
    for (const segment of manifest.itemFolderPath.split('/')) folder = await folder.getDirectoryHandle(segment);
    guard.beforeWrite(target); await permission(root, 'readwrite'); abort(input.signal);
    if (await existing(root, target) !== original) throw new Error('子文件在审查应用期间已改变，本次没有写入。');
    const handle = await folder.getFileHandle(proposal.fileName, { create: proposal.mode === 'create' });
    const writable = await handle.createWritable();
    try {
      await writable.write(proposal.content);
      guard.beforeWrite(target); await permission(root, 'readwrite'); abort(input.signal);
      if (await getAgentDocumentVersion(await (await resolveAuthorizedDocumentHandle(root, parentPath)).getFile(), proposal.parentItemId, input.signal) !== proposal.parentVersion) throw new Error('PDF 在提交写入前已改变，本次没有写入。');
      if (proposal.mode === 'update' && await existing(root, target) !== proposal.expectedContent) throw new Error('子文件在提交写入前已改变，本次没有写入。');
      await writable.close();
    } catch (error) { await writable.abort().catch(() => undefined); throw error; }
    if (await (await handle.getFile()).text() !== proposal.content) throw new Error('子文件写入后回读不一致。');
    await guard.refresh(target, handle);
    const result = { path: target, handle, parentItemId: manifest.itemId, parentPath: manifest.pdfPath };
    await input.onOpen?.(result);
    return result;
  });
  writeQueues.set(input.root, operation);
  return operation;
}
