import { expect, it, vi } from 'vitest';
import { prepareCloudPdfChildProposal, applyReviewedCloudPdfChildProposal, cloudPdfChildProposalApproval, bindCloudPdfChildDraft } from '../lattice-skills/cloud-pdf-child-skill';
import { getAgentDocumentVersion } from '../document-source';
import type { CloudLibraryResource, CloudLibrarySourceProvider } from '@/lib/shared-library/source-provider';
import type { Item } from '@/lib/shared-library/domain';
it('applies only a concrete reviewed cloud child via version-protected provider.createChild', async () => {
  const parent: CloudLibraryResource = { id: 'lattice-cloud:account:library:parent', libraryId: 'library', itemId: 'parent', versionId: 'parent-v1', role: 'editor', kind: 'pdf', name: 'paper.pdf', path: 'cloud://display', content: { kind: 'binary', data: new TextEncoder().encode('%PDF').buffer, mimeType: 'application/pdf', updatedAt: 'now' } };
  const creates: unknown[] = [];
  const provider: CloudLibrarySourceProvider = { scope: 'account-A', read: async () => parent, list: async () => [], search: async () => ({ results: [] }), save: async () => {},
    createChild: async (library, item, input) => { creates.push({ library, item, input }); return { id: 'child', libraryId: library, canonicalName: input.name, kind: input.kind } as Item; } };
  const proposal = await prepareCloudPdfChildProposal({ provider, parent, fileName: 'note.md', content: '# Source-grounded note', mode: 'create' });
  expect(creates).toHaveLength(0);
  await expect(applyReviewedCloudPdfChildProposal({ provider, proposal, approval: { ...cloudPdfChildProposalApproval(proposal), proposalId: 'other' } })).rejects.toThrow(/审查/);
  parent.versionId = 'parent-v2';
  await expect(applyReviewedCloudPdfChildProposal({ provider, proposal, approval: cloudPdfChildProposalApproval(proposal) })).rejects.toThrow(/版本/);
  expect(creates).toHaveLength(0);
  parent.versionId = 'parent-v1';
  await applyReviewedCloudPdfChildProposal({ provider, proposal, approval: cloudPdfChildProposalApproval(proposal) });
  expect(creates).toEqual([{ library: 'library', item: 'parent', input: expect.objectContaining({ expectedParentVersion: 'parent-v1', name: 'note.md', kind: 'markdown' }) }]);
});

function cloudFixture() {
  const parent: CloudLibraryResource = { id: 'cloud:lib:parent', libraryId: 'lib', itemId: 'parent', versionId: 'p1', name: 'same.pdf', path: 'cloud://display', role: 'editor', kind: 'pdf', content: { kind: 'text', text: '%PDF source', mimeType: 'application/pdf', updatedAt: 'now' } };
  const child: CloudLibraryResource = { ...parent, id: 'cloud:lib:child', itemId: 'child', versionId: 'c1', name: 'data.csv', kind: 'data', content: { kind: 'text', text: 'value\n0', mimeType: 'text/csv', updatedAt: 'now' } };
  const item: Item = { id: child.itemId, libraryId: 'lib', kind: 'data', canonicalName: child.name, status: 'active' } as Item;
  const save = vi.fn(async () => {}), createChild = vi.fn(async () => item);
  const provider: CloudLibrarySourceProvider = { scope: 'account-A', read: async (_library, id) => id === parent.itemId ? parent : child, list: async () => [item], search: async () => ({ results: [] }), save, createChild };
  return { parent, child, item, provider, save, createChild };
}
it('binds chat delivery to the cloud PDF actually read and rejects stale or downgraded sources', async () => {
  const { parent, provider, createChild } = cloudFixture();
  provider.list = async () => [];
  const hash = await getAgentDocumentVersion(new File(['%PDF source'], parent.name, { type: 'application/pdf' }), parent.id);
  const identity = { resourceId: parent.id, libraryId: parent.libraryId, itemId: parent.itemId, versionId: parent.versionId, version: `${parent.versionId}|${hash}`, role: parent.role, name: parent.name };
  const snapshot = { workspaceKey: 'cloud:lib', sourceId: parent.id, path: parent.id, version: identity.version, kind: 'pdf' as const, unitLabel: 'page' as const, totalUnits: 1, permissionScope: 'role:editor', providerScope: provider.scope, cloudIdentity: identity };
  const input = { provider, snapshot, task: '在当前 PDF 下创建 note.md 子文件，内容包含讲解', draft: { type: 'paper_note' as const, title: 'Note', content: '# Actual grounded answer' } };
  const bound = await bindCloudPdfChildDraft(input);
  expect(bound.pdfChildTarget).toBeUndefined();
  expect(bound.cloudPdfChildProposal).toMatchObject({ fileName: 'note.md', parent: { resourceId: parent.id, versionId: 'p1' } });
  expect(bound.targetPath).toContain('/library?');
  expect(createChild).not.toHaveBeenCalled();
  parent.versionId = 'p2';
  await expect(bindCloudPdfChildDraft(input)).rejects.toThrow(/版本/);
  parent.versionId = 'p1'; parent.role = 'viewer';
  await expect(bindCloudPdfChildDraft(input)).rejects.toThrow(/权限/);
});
it('requires the parent revision actually supplied to the proposal and preserves provider scope', async () => {
  const { parent, provider } = cloudFixture();
  const stale = { ...parent };
  parent.versionId = 'p2';
  await expect(prepareCloudPdfChildProposal({ provider, parent: stale, fileName: 'note.md', content: '# Content', mode: 'create' })).rejects.toThrow(/版本/);
});
it('updates a reviewed data child with expected child version and refuses moved or stale children', async () => {
  const { parent, child, provider, save, item } = cloudFixture();
  const proposal = await prepareCloudPdfChildProposal({ provider, parent, fileName: 'data.csv', content: 'value\n1', mode: 'update', childItemId: 'child' });
  expect(save).not.toHaveBeenCalled();
  const approval = cloudPdfChildProposalApproval(proposal);
  child.versionId = 'c2';
  await expect(applyReviewedCloudPdfChildProposal({ provider, proposal, approval })).rejects.toThrow(/版本/);
  child.versionId = 'c1'; item.status = 'trashed';
  await expect(applyReviewedCloudPdfChildProposal({ provider, proposal, approval })).rejects.toThrow(/移动|删除/);
  item.status = 'active';
  const result = await applyReviewedCloudPdfChildProposal({ provider, proposal, approval });
  expect(result).toEqual({ libraryId: 'lib', itemId: 'child' });
  expect(save).toHaveBeenCalledExactlyOnceWith('lib', 'child', proposal.content, undefined, 'c1');
});
it('refuses cloud logout, role downgrade, scope replacement and tampered content before saves', async () => {
  const { parent, provider, save } = cloudFixture();
  const proposal = await prepareCloudPdfChildProposal({ provider, parent, fileName: 'data.csv', content: 'value\n1', mode: 'update', childItemId: 'child' });
  const approval = cloudPdfChildProposalApproval(proposal);
  await expect(applyReviewedCloudPdfChildProposal({ provider: null, proposal, approval })).rejects.toThrow(/权限|身份/);
  await expect(applyReviewedCloudPdfChildProposal({ provider: { ...provider, scope: 'account-B' }, proposal, approval })).rejects.toThrow(/权限|身份/);
  await expect(applyReviewedCloudPdfChildProposal({ provider, proposal: { ...proposal, content: { kind: 'text', text: 'other', mimeType: 'text/csv', updatedAt: 'now' } }, approval })).rejects.toThrow(/审查/);
  parent.role = 'viewer';
  await expect(applyReviewedCloudPdfChildProposal({ provider, proposal, approval })).rejects.toThrow(/权限/);
  expect(save).not.toHaveBeenCalled();
});
