import { beforeEach, expect, it } from 'vitest';
import { preparePdfChildProposal, applyReviewedPdfChildProposal, pdfChildProposalApproval } from '../lattice-skills/pdf-child-skill';
import { SourceTestDirectory, SourceTestFile } from './fixtures/source-workspace';
import { getPdfItemManifestIndex, invalidatePdfItemManifestIndex, movePdfItemWorkspace } from '@/lib/pdf-item';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { prepareWorkspaceFileTask, resolvePdfChildTargetRevision } from '../workspace-file-task';
import { getAgentDocumentVersion } from '../document-source';
import { writeDraftArtifactToTarget } from '../workbench-actions';

function fixture() {
  const root = new SourceTestDirectory('workspace'), papers = root.add(new SourceTestDirectory('papers'));
  const pdf = papers.add(new SourceTestFile('same.pdf', '%PDF parent'));
  const item = root.add(new SourceTestDirectory('.lattice')).add(new SourceTestDirectory('items')).add(new SourceTestDirectory('stable-item'));
  item.add(new SourceTestFile('manifest.json', JSON.stringify({ version: 4, itemId: 'stable-id', pdfPath: 'papers/same.pdf', itemFolderPath: '.lattice/items/stable-item',
    annotationIndexPath: null, fileFingerprint: null, versionFingerprint: null, knownPdfPaths: ['papers/same.pdf'], createdAt: 1, updatedAt: 1 })));
  useWorkspaceStore.setState({ rootHandle: root.handle() });
  return { root, papers, item, pdf };
}
beforeEach(() => useWorkspaceStore.setState({ rootHandle: null }));
it('prepares a manifest-bound planned write without touching disk then applies only its concrete review', async () => {
  const { root, item } = fixture();
  const proposal = await preparePdfChildProposal({ root: root.handle(), workspaceKey: 'A', parentPath: 'papers/same.pdf', fileName: 'note.md', content: '# Verified explanation', mode: 'create' });
  expect(proposal.parentItemId).toBe('stable-id');
  expect(proposal.plannedWrites[0].targetPath).toBe('.lattice/items/stable-item/note.md');
  expect(item.entries.has('note.md')).toBe(false);
  await expect(applyReviewedPdfChildProposal({ root: root.handle(), workspaceKey: 'A', proposal, approval: { ...pdfChildProposalApproval(proposal), proposalId: 'another' } })).rejects.toThrow(/审查/);
  const saved = await applyReviewedPdfChildProposal({ root: root.handle(), workspaceKey: 'A', proposal, approval: pdfChildProposalApproval(proposal) });
  expect(saved.parentItemId).toBe('stable-id');
  expect(await (await saved.handle.getFile()).text()).toBe('# Verified explanation');
});
it('reopens a renamed PDF through its stable manifest identity and preserves the child workspace', async () => {
  const { root, papers, item, pdf } = fixture();
  const proposal = await preparePdfChildProposal({ root: root.handle(), workspaceKey: 'A', parentPath: 'papers/same.pdf', fileName: 'results.csv', content: 'value\n1', mode: 'create' });
  papers.entries.delete('same.pdf'); pdf.name = 'renamed.pdf'; papers.add(pdf);
  await movePdfItemWorkspace(root.handle(), 'papers/same.pdf', 'papers/renamed.pdf');
  invalidatePdfItemManifestIndex(root.handle());
  const result = await applyReviewedPdfChildProposal({ root: root.handle(), workspaceKey: 'A', proposal, approval: pdfChildProposalApproval(proposal) });
  expect(result.parentPath).toBe('papers/renamed.pdf');
  expect(item.entries.has('results.csv')).toBe(true);
  expect((await getPdfItemManifestIndex(root.handle())).byDocumentId.get('stable-id')?.itemFolderPath).toBe('.lattice/items/stable-item');
});
it('rejects stale parent, edited proposals and changed child content before writes', async () => {
  const { root, item, pdf } = fixture(); item.add(new SourceTestFile('note.md', 'old'));
  const proposal = await preparePdfChildProposal({ root: root.handle(), workspaceKey: 'A', parentPath: 'papers/same.pdf', fileName: 'note.md', content: 'new', mode: 'update' });
  const approval = pdfChildProposalApproval(proposal);
  await expect(applyReviewedPdfChildProposal({ root: root.handle(), workspaceKey: 'A', proposal: { ...proposal, content: 'other' }, approval })).rejects.toThrow(/审查/);
  (item.entries.get('note.md') as SourceTestFile).content = 'external';
  await expect(applyReviewedPdfChildProposal({ root: root.handle(), workspaceKey: 'A', proposal, approval })).rejects.toThrow(/改变/);
  pdf.content = '%PDF changed';
  await expect(applyReviewedPdfChildProposal({ root: root.handle(), workspaceKey: 'A', proposal, approval })).rejects.toThrow(/PDF.*改变/);
  expect((item.entries.get('note.md') as SourceTestFile).writes).toBe(0);
});
it('validates Notebook JSON and rejects escaping filenames before proposing anything', async () => {
  const { root } = fixture();
  for (const [fileName, content] of [['../note.md', 'content'], ['lab.ipynb', '{broken']]) {
    await expect(preparePdfChildProposal({ root: root.handle(), workspaceKey: 'A', parentPath: 'papers/same.pdf', fileName, content, mode: 'create' })).rejects.toThrow();
  }
});
it('enforces the captured parent revision in the existing Chat to Workbench apply path', async () => {
  const { root, pdf, item } = fixture();
  const prepared = await prepareWorkspaceFileTask({ root: root.handle(), workspaceKey: 'A', task: 'create a note',
    request: { operation: 'create', targetPath: 'chat.md', pdfParent: 'papers/same.pdf', empty: true }, generate: async () => ({ text: '' }) });
  pdf.content = '%PDF changed after generation';
  await expect(writeDraftArtifactToTarget(root.handle(), { ...prepared, createdAt: 1 }, { workspaceKey: 'A', targetPath: prepared.targetPath })).rejects.toThrow(/PDF.*改变/);
  expect(item.entries.has('chat.md')).toBe(false);
});
it('does not rebind a reviewed chat draft to a parent changed between preflight and proposal preparation', async () => {
  const { root, pdf, item } = fixture();
  const prepared = await prepareWorkspaceFileTask({ root: root.handle(), workspaceKey: 'A', task: 'create note', request: { operation: 'create', targetPath: 'race.md', pdfParent: 'papers/same.pdf', empty: true }, generate: async () => ({ text: '' }) });
  const originalRead = pdf.getFile.bind(pdf);
  pdf.reads = 0;
  pdf.getFile = async () => { const value = await originalRead(); if (pdf.reads === 1) pdf.content = '%PDF changed during preflight'; return value; };
  await expect(writeDraftArtifactToTarget(root.handle(), { ...prepared, createdAt: 1 }, { workspaceKey: 'A' })).rejects.toThrow(/PDF.*改变/);
  expect(item.entries.has('race.md')).toBe(false);
});
it('binds a research draft to only the exact source revision that was read', async () => {
  const { root, pdf } = fixture();
  const snapshot = { workspaceKey: 'A', sourceId: 'source', path: 'papers/same.pdf', version: await getAgentDocumentVersion(await pdf.getFile(), 'papers/same.pdf'), kind: 'pdf' as const, totalUnits: 1, unitLabel: 'page' as const };
  const child = { sourcePath: 'papers/same.pdf', suggestedTargetPath: 'invented/note.md' };
  expect(await resolvePdfChildTargetRevision({ root: root.handle(), child, snapshot })).toMatchObject({ parentItemId: 'stable-id', suggestedTargetPath: '.lattice/items/stable-item/note.md' });
  pdf.content = '%PDF different';
  await expect(resolvePdfChildTargetRevision({ root: root.handle(), child, snapshot })).rejects.toThrow(/PDF.*改变/);
});
it('rejects a stable item id belonging to another same-name PDF even when the contents match', async () => {
  const { root } = fixture();
  root.add(new SourceTestDirectory('other')).add(new SourceTestFile('same.pdf', '%PDF parent'));
  await expect(preparePdfChildProposal({ root: root.handle(), workspaceKey: 'A', parentPath: 'other/same.pdf', parentItemId: 'stable-id',
    fileName: 'wrong.md', content: '# Content', mode: 'create' })).rejects.toThrow(/身份|identity/);
});
it('binds review approval to the exact parent path and rejects a replaced manifest identity', async () => {
  const { root, item } = fixture();
  const proposal = await preparePdfChildProposal({ root: root.handle(), workspaceKey: 'A', parentPath: 'papers/same.pdf', fileName: 'note.md', content: '# Original', mode: 'create' });
  await expect(applyReviewedPdfChildProposal({ root: root.handle(), workspaceKey: 'A', proposal: { ...proposal, parentPath: 'other/same.pdf' }, approval: pdfChildProposalApproval(proposal) })).rejects.toThrow(/审查/);
  const manifest = item.entries.get('manifest.json') as SourceTestFile;
  manifest.content = manifest.content.replace('stable-id', 'replaced-id');
  invalidatePdfItemManifestIndex(root.handle());
  await expect(applyReviewedPdfChildProposal({ root: root.handle(), workspaceKey: 'A', proposal, approval: pdfChildProposalApproval(proposal) })).rejects.toThrow(/身份|manifest|改变/);
  expect(item.entries.has('note.md')).toBe(false);
});
it('retains external edits when an existing data child changes while its writable is open', async () => {
  const { root, item } = fixture(), data = item.add(new SourceTestFile('data.csv', 'value\n0'));
  const proposal = await preparePdfChildProposal({ root: root.handle(), workspaceKey: 'A', parentPath: 'papers/same.pdf', fileName: 'data.csv', content: 'value\n1', mode: 'update' });
  const originalWritable = data.createWritable.bind(data);
  data.createWritable = async () => { const writable = await originalWritable(); const write = writable.write; writable.write = async value => { await write(value); data.content = 'value\nexternal'; }; return writable; };
  await expect(applyReviewedPdfChildProposal({ root: root.handle(), workspaceKey: 'A', proposal, approval: pdfChildProposalApproval(proposal) })).rejects.toThrow(/子文件.*改变/);
  expect(data.content).toBe('value\nexternal'); expect(data.writes).toBe(0);
});
