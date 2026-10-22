import type { CloudLibraryResource, CloudLibrarySourceProvider } from '@/lib/shared-library/source-provider';
import { can } from '@/lib/shared-library/permissions';
import type { ItemKind } from '@/lib/shared-library/domain';
import type { EvidenceRef } from '../types';
import { getAgentDocumentVersion } from '../document-source';
import { validateHarnessTextContent } from './tool-draft';

export interface CloudFileProposal {
  id: string; version: string; workspaceKey: string; providerScope?: string;
  resource: NonNullable<EvidenceRef['cloudIdentity']>; mode: 'create' | 'update';
  targetPath: string; fileName: string; kind: ItemKind; content: string; mimeType: string;
}
export interface CloudFileReviewApproval { proposalId: string; proposalVersion: string; workspaceKey: string; targetPath: string }
export async function cloudHarnessResourceVersion(resource: CloudLibraryResource, signal?: AbortSignal): Promise<string> {
  const content = resource.content;
  const file = new File([content ? content.kind === 'text' ? content.text : content.data : JSON.stringify([resource.id, resource.libraryId, resource.itemId, resource.name, resource.kind])], resource.name);
  return `${resource.versionId ?? 'unversioned'}|${await getAgentDocumentVersion(file, resource.id, signal)}`;
}
async function revision(proposal: Omit<CloudFileProposal, 'version'> | CloudFileProposal) {
  const { version: _version, ...content } = proposal as CloudFileProposal;
  return getAgentDocumentVersion(new File([JSON.stringify(content)], 'proposal.json'), 'cloud-file-proposal');
}
export async function prepareCloudFileProposal(input: {
  provider: CloudLibrarySourceProvider; resource: CloudLibraryResource; content: string; mode: 'create' | 'update'; fileName?: string; expectedVersion?: string;
  signal?: AbortSignal; isCurrent?: () => boolean;
}): Promise<CloudFileProposal> {
  const scope = input.provider.scope;
  const check = () => { input.signal?.throwIfAborted(); if (input.provider.scope !== scope || input.isCurrent && !input.isCurrent()) throw new Error('云库账号或权限范围已改变。'); };
  check();
  const current = await input.provider.read(input.resource.libraryId, input.resource.itemId, input.signal); check();
  const version = await cloudHarnessResourceVersion(current, input.signal);
  if (current.id !== input.resource.id || current.libraryId !== input.resource.libraryId || current.itemId !== input.resource.itemId ||
    current.role !== input.resource.role || version !== await cloudHarnessResourceVersion(input.resource, input.signal) || input.expectedVersion && input.expectedVersion !== version) throw new Error('云文件身份、权限或版本已改变。');
  if (!can(current.role, input.mode === 'update' ? 'item.update' : 'item.create')) throw new Error('当前云库角色没有文件写入权限。');
  const fileName = input.mode === 'update' ? current.name : input.fileName;
  if (!fileName || /[\\/\u0000-\u001f<>:"|?*]/u.test(fileName) || fileName.startsWith('.')) throw new Error('云文件必须使用有效的单个文件名。');
  validateHarnessTextContent(fileName, input.content);
  if (input.mode === 'update' && (!current.versionId || current.content?.kind !== 'text')) throw new Error('云文件更新需要原始文本和版本。');
  if (input.mode === 'create') {
    if (current.kind !== 'folder' || !input.provider.createItem) throw new Error('云文件创建需要已授权目录和文件创建接口。');
    const entries = await input.provider.list(current.libraryId, current.itemId, input.signal); check();
    if (entries.some(item => item.libraryId === current.libraryId && item.metadata.parentItemId === current.itemId && item.canonicalName === fileName && item.status !== 'trashed')) throw new Error('云目录已存在同名文件。');
  }
  const kind: ItemKind = /\.ipynb$/i.test(fileName) ? 'notebook' : /\.md$/i.test(fileName) ? 'markdown' : 'data';
  const proposal: Omit<CloudFileProposal, 'version'> = { id: crypto.randomUUID(), workspaceKey: `cloud:${current.libraryId}`, providerScope: scope,
    resource: { resourceId: current.id, libraryId: current.libraryId, itemId: current.itemId, versionId: current.versionId, version, role: current.role, name: current.name },
    mode: input.mode, targetPath: input.mode === 'update' ? current.id : `${current.id}#new=${encodeURIComponent(fileName)}`, fileName, kind, content: input.content,
    mimeType: input.mode === 'update' ? current.content!.mimeType : kind === 'markdown' ? 'text/markdown' : /\.(?:ipynb|json)$/i.test(fileName) ? 'application/json' : 'text/plain' };
  const proposedVersion = await revision(proposal); check();
  return { ...proposal, version: proposedVersion };
}
/** Review UI only. No Harness tool exposes approval construction or application. */
export function cloudFileProposalApproval(proposal: CloudFileProposal): CloudFileReviewApproval {
  return { proposalId: proposal.id, proposalVersion: proposal.version, workspaceKey: proposal.workspaceKey, targetPath: proposal.targetPath };
}
export async function applyReviewedCloudFileProposal(input: {
  provider: CloudLibrarySourceProvider | null; proposal: CloudFileProposal; approval: CloudFileReviewApproval; signal?: AbortSignal; isCurrent?: () => boolean;
}): Promise<{ libraryId: string; itemId: string }> {
  const { provider, proposal, approval } = input;
  const check = () => { input.signal?.throwIfAborted(); if (!provider || provider.scope !== proposal.providerScope || input.isCurrent && !input.isCurrent()) throw new Error('云库账号或权限范围已改变。'); };
  check();
  if (!provider) throw new Error('云库尚未连接。');
  if (approval.proposalId !== proposal.id || approval.proposalVersion !== proposal.version || approval.workspaceKey !== proposal.workspaceKey ||
    approval.targetPath !== proposal.targetPath || await revision(proposal) !== proposal.version) throw new Error('审查授权与具体云文件提案不匹配。');
  validateHarnessTextContent(proposal.fileName, proposal.content);
  const current = await provider.read(proposal.resource.libraryId, proposal.resource.itemId, input.signal); check();
  if (current.id !== proposal.resource.resourceId || current.libraryId !== proposal.resource.libraryId || current.itemId !== proposal.resource.itemId || current.role !== proposal.resource.role ||
    await cloudHarnessResourceVersion(current, input.signal) !== proposal.resource.version) throw new Error('云文件身份、权限或版本已改变，请重新审查。');
  if (!can(current.role, proposal.mode === 'update' ? 'item.update' : 'item.create')) throw new Error('云文件写入权限已撤销。');
  const content = { kind: 'text' as const, text: proposal.content, mimeType: proposal.mimeType, updatedAt: new Date().toISOString() };
  let itemId = current.itemId;
  if (proposal.mode === 'update') {
    if (!current.versionId || current.content?.kind !== 'text' || current.name !== proposal.fileName || proposal.targetPath !== current.id) throw new Error('云文件更新缺少原始文本或版本绑定。');
    check(); await provider.save(current.libraryId, current.itemId, content, input.signal, current.versionId);
  } else {
    if (current.kind !== 'folder' || !provider.createItem) throw new Error('云文件创建接口不可用。');
    const entries = await provider.list(current.libraryId, current.itemId, input.signal); check();
    if (entries.some(item => item.libraryId === current.libraryId && item.metadata.parentItemId === current.itemId && item.canonicalName === proposal.fileName && item.status !== 'trashed')) throw new Error('云目录已有同名文件，本次没有覆盖。');
    check(); itemId = (await provider.createItem({ libraryId: current.libraryId, parentItemId: current.itemId, name: proposal.fileName, kind: proposal.kind }, content, input.signal, proposal.resource.versionId)).id;
  }
  check();
  return { libraryId: current.libraryId, itemId };
}
