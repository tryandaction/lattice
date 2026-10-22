import type { CloudLibraryResource, CloudLibrarySourceProvider } from '@/lib/shared-library/source-provider';
import type { Item, ItemKind } from '@/lib/shared-library/domain';
import { can } from '@/lib/shared-library/permissions';
import type { SharedLibraryItemContent } from '@/lib/shared-library/content-store';
import { getAgentDocumentVersion } from '../document-source';
import { validatePdfChildContent } from './pdf-child-skill';
import type { PdfChildReviewApproval } from './pdf-child-skill';
import type { EvidenceRef, AiDraftSuggestion } from '../types';
import { verifyCloudAgentCitation, type CloudAgentSourceSnapshot } from '../cloud-source';
import { parsePdfMarkdownChildRequest } from '../task-outcome';

export interface CloudPdfChildProposal {
  id: string; version: string; workspaceKey: string; providerScope?: string; parent: NonNullable<EvidenceRef['cloudIdentity']>;
  fileName: string; kind: ItemKind; content: SharedLibraryItemContent; mode: 'create' | 'update';
  child?: { itemId: string; resourceId: string; versionId: string; version: string };
  targetPath: string; plannedWrites: Array<{ targetPath: string; mode: 'create' | 'update'; contentPreview: string }>;
}
export async function bindCloudPdfChildDraft(input: {
  provider: CloudLibrarySourceProvider; snapshot: CloudAgentSourceSnapshot; task: string;
  draft: AiDraftSuggestion; signal?: AbortSignal; isCurrent?: () => boolean;
}): Promise<AiDraftSuggestion> {
  const request = parsePdfMarkdownChildRequest(input.task);
  if (!request || input.snapshot.kind !== 'pdf') throw new Error('云 PDF 子文件缺少对应的显式请求或已读取来源。');
  if (input.provider.scope !== input.snapshot.providerScope) throw new Error('云库身份或权限范围已改变。');
  const parent = await verifyCloudAgentCitation({ provider: input.provider, identity: input.snapshot.cloudIdentity, signal: input.signal });
  const proposal = await prepareCloudPdfChildProposal({ provider: input.provider, parent, fileName: request.fileName ?? 'Reading Note.md',
    content: input.draft.content ?? '', mode: 'create', signal: input.signal, isCurrent: input.isCurrent });
  return { ...input.draft, pdfChildTarget: undefined, cloudPdfChildProposal: proposal, targetPath: proposal.targetPath, writeMode: 'create' };
}
function abort(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('Cloud PDF child cancelled', 'AbortError'); }
async function resourceVersion(resource: CloudLibraryResource, signal?: AbortSignal) {
  if (!resource.content) throw new Error('云文件没有可读取内容。');
  const file = new File([resource.content.kind === 'text' ? resource.content.text : resource.content.data], resource.name, { type: resource.content.mimeType });
  return getAgentDocumentVersion(file, resource.id, signal);
}
async function revision(proposal: Omit<CloudPdfChildProposal, 'version'> | CloudPdfChildProposal) {
  const text = proposal.content.kind === 'text' ? proposal.content.text : '';
  return getAgentDocumentVersion(new File([JSON.stringify([proposal.id, proposal.workspaceKey, proposal.providerScope, proposal.parent, proposal.fileName, proposal.kind,
    proposal.mode, proposal.child ?? null, proposal.targetPath, proposal.content.mimeType, text, proposal.plannedWrites])], 'proposal.json'), 'cloud-pdf-child-proposal');
}
export async function prepareCloudPdfChildProposal(input: {
  provider: CloudLibrarySourceProvider; parent: CloudLibraryResource; fileName: string; content: string;
  mode: 'create' | 'update'; childItemId?: string; signal?: AbortSignal; isCurrent?: () => boolean;
}): Promise<CloudPdfChildProposal> {
  const providerScope = input.provider.scope;
  const check = () => { abort(input.signal); if (input.provider.scope !== providerScope || input.isCurrent && !input.isCurrent()) throw new Error('云库身份或权限范围已改变。'); };
  check(); validatePdfChildContent(input.fileName, input.content);
  const requested = { id: input.parent.id, libraryId: input.parent.libraryId, itemId: input.parent.itemId, versionId: input.parent.versionId, version: await resourceVersion(input.parent, input.signal) };
  check();
  const parent = await input.provider.read(input.parent.libraryId, input.parent.itemId, input.signal);
  check();
  if (parent.id !== requested.id || parent.libraryId !== requested.libraryId || parent.itemId !== requested.itemId || parent.kind !== 'pdf'
    || !parent.versionId || parent.versionId !== requested.versionId || await resourceVersion(parent, input.signal) !== requested.version) throw new Error('云 PDF 身份或版本已改变，请重新读取后生成子文件。');
  check();
  if (!can(parent.role, input.mode === 'create' ? 'itemChild.create' : 'item.update')) throw new Error('当前云库角色没有子文件写入权限。');
  if (input.mode === 'create' && !input.provider.createChild) throw new Error('当前云服务没有版本保护的 PDF 子文件创建接口。');
  const children = await input.provider.list(parent.libraryId, parent.itemId, input.signal);
  check();
  let child: CloudPdfChildProposal['child'];
  if (input.mode === 'create' && children.some(item => item.canonicalName === input.fileName && item.status !== 'trashed')) throw new Error('云 PDF 已有同名子文件。');
  if (input.mode === 'update') {
    if (!input.childItemId || !children.some(item => item.id === input.childItemId && item.libraryId === parent.libraryId && item.status === 'active')) throw new Error('待更新云文件不属于此 PDF 或已删除。');
    const current = await input.provider.read(parent.libraryId, input.childItemId, input.signal);
    check();
    if (current.libraryId !== parent.libraryId || current.itemId !== input.childItemId || current.name !== input.fileName || !current.versionId) throw new Error('待更新云子文件名称或版本不匹配。');
    child = { itemId: current.itemId, resourceId: current.id, versionId: current.versionId, version: await resourceVersion(current, input.signal) };
  }
  const kind: ItemKind = /\.ipynb$/i.test(input.fileName) ? 'notebook' : /\.md$/i.test(input.fileName) ? 'markdown' : 'data';
  const mimeType = kind === 'markdown' ? 'text/markdown' : kind === 'notebook' || /\.json$/i.test(input.fileName) ? 'application/json' : /\.csv$/i.test(input.fileName) ? 'text/csv' : 'text/plain';
  const content: SharedLibraryItemContent = { kind: 'text', text: input.content, mimeType, updatedAt: new Date().toISOString() };
  // This is a display/review locator only and is never sent to a filesystem API.
  const targetPath = `/library?library=${encodeURIComponent(parent.libraryId)}&item=${encodeURIComponent(child?.itemId ?? parent.itemId)}#child=${encodeURIComponent(input.fileName)}`;
  const proposal: Omit<CloudPdfChildProposal, 'version'> = { id: crypto.randomUUID(), workspaceKey: `cloud:${parent.libraryId}`, providerScope: input.provider.scope,
    parent: { resourceId: parent.id, libraryId: parent.libraryId, itemId: parent.itemId, versionId: parent.versionId, version: await resourceVersion(parent, input.signal), role: parent.role, name: parent.name },
    fileName: input.fileName, kind, content, mode: input.mode, ...(child ? { child } : {}), targetPath,
    plannedWrites: [{ targetPath, mode: input.mode, contentPreview: input.content.slice(0, 2000) }] };
  const version = await revision(proposal);
  check();
  return { ...proposal, version };
}
export function cloudPdfChildProposalApproval(proposal: CloudPdfChildProposal): PdfChildReviewApproval {
  return { proposalId: proposal.id, proposalVersion: proposal.version, workspaceKey: proposal.workspaceKey, targetPath: proposal.targetPath };
}
export async function applyReviewedCloudPdfChildProposal(input: {
  provider: CloudLibrarySourceProvider | null; proposal: CloudPdfChildProposal; approval: PdfChildReviewApproval; signal?: AbortSignal;
  isCurrent?: () => boolean; onOpen?: (libraryId: string, itemId: string) => void | Promise<void>;
}): Promise<{ libraryId: string; itemId: string }> {
  const { provider, proposal, approval } = input;
  const check = () => { abort(input.signal); if (!provider || provider.scope !== proposal.providerScope || (input.isCurrent && !input.isCurrent())) throw new Error('云库身份或权限范围已改变。'); };
  check();
  if (!provider) throw new Error('云库已退出。');
  if (approval.proposalId !== proposal.id || approval.proposalVersion !== proposal.version || approval.workspaceKey !== proposal.workspaceKey
    || approval.targetPath !== proposal.targetPath || await revision(proposal) !== proposal.version) throw new Error('审查授权与具体云 PDF 子文件提案不匹配。');
  if (proposal.content.kind !== 'text') throw new Error('云 PDF 子文件只接受已审查文本内容。');
  validatePdfChildContent(proposal.fileName, proposal.content.text);
  const parent = await provider.read(proposal.parent.libraryId, proposal.parent.itemId, input.signal);
  check();
  if (parent.id !== proposal.parent.resourceId || parent.versionId !== proposal.parent.versionId || await resourceVersion(parent, input.signal) !== proposal.parent.version) throw new Error('父 PDF 身份或版本已改变，请重新读取并审查。');
  check();
  if (parent.kind !== 'pdf' || parent.libraryId !== proposal.parent.libraryId || parent.itemId !== proposal.parent.itemId) throw new Error('父 PDF 身份已改变。');
  if (!can(parent.role, proposal.mode === 'create' ? 'itemChild.create' : 'item.update') || parent.role !== proposal.parent.role) throw new Error('云库写入权限已改变。');
  let itemId: string;
  if (proposal.mode === 'create') {
    if (!provider.createChild || !proposal.parent.versionId) throw new Error('云服务不支持版本保护的子文件创建。');
    const children = await provider.list(parent.libraryId, parent.itemId, input.signal);
    check();
    if (children.some(item => item.canonicalName === proposal.fileName && item.status !== 'trashed')) throw new Error('云 PDF 已有同名子文件，本次没有覆盖。');
    check();
    const created: Item = await provider.createChild(parent.libraryId, parent.itemId, { name: proposal.fileName, kind: proposal.kind, content: proposal.content, expectedParentVersion: proposal.parent.versionId }, input.signal);
    itemId = created.id;
  } else {
    if (!proposal.child) throw new Error('云子文件更新缺少版本快照。');
    const children = await provider.list(parent.libraryId, parent.itemId, input.signal);
    check();
    if (!children.some(item => item.id === proposal.child?.itemId && item.libraryId === parent.libraryId && item.status === 'active')) throw new Error('云子文件已移动或删除。');
    const child = await provider.read(parent.libraryId, proposal.child.itemId, input.signal);
    check();
    if (child.id !== proposal.child.resourceId || child.libraryId !== parent.libraryId || child.itemId !== proposal.child.itemId
      || child.name !== proposal.fileName || child.versionId !== proposal.child.versionId || await resourceVersion(child, input.signal) !== proposal.child.version) throw new Error('云子文件版本已改变。');
    const latestParent = await provider.read(parent.libraryId, parent.itemId, input.signal);
    check();
    if (latestParent.id !== proposal.parent.resourceId || latestParent.role !== proposal.parent.role || latestParent.versionId !== proposal.parent.versionId
      || await resourceVersion(latestParent, input.signal) !== proposal.parent.version) throw new Error('父 PDF 身份、权限或版本已改变。');
    check();
    await provider.save(parent.libraryId, child.itemId, proposal.content, input.signal, proposal.child.versionId);
    itemId = child.itemId;
  }
  check();
  await input.onOpen?.(parent.libraryId, itemId);
  return { libraryId: parent.libraryId, itemId };
}
