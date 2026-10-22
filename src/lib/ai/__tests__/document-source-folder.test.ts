import { expect, it } from 'vitest';
import { captureAgentDocumentSources, snapshotAgentDocumentSources } from '../document-source-capture';
import { SourceTestDirectory, SourceTestFile } from './fixtures/source-workspace';
it('captures every explicit nested folder source for the real document research reader', async () => {
  const root = new SourceTestDirectory('workspace'), notes = root.add(new SourceTestDirectory('notes'));
  for (let i = 0; i < 12; i++) notes.add(new SourceTestDirectory(`topic-${i}`)).add(new SourceTestFile('same.txt', `result-${i}`));
  notes.add(new SourceTestFile('image.png', 'not evidence'));
  const sources = await captureAgentDocumentSources({ activeTab: null, rootHandle: root.handle(), query: '综合 @folder:notes 的结果' });
  expect(sources).toHaveLength(12);
  expect((await sources[11].readUnit(1)).text).toBe('result-11');
  expect(snapshotAgentDocumentSources(sources, 'A')[11]).toMatchObject({ workspaceKey: 'A', path: 'notes/topic-11/same.txt', kind: 'text' });
  await Promise.all(sources.map(source => source.close()));
});
it('refuses to present an oversized selected folder as fully captured', async () => {
  const root = new SourceTestDirectory('workspace');
  for (let i = 0; i < 3; i++) root.add(new SourceTestFile(`${i}.txt`, 'text'));
  await expect(captureAgentDocumentSources({ activeTab: null, rootHandle: root.handle(), query: '@folder:.', maxFiles: 2 })).rejects.toThrow(/预算|budget/);
});
it('never routes cloud mentions through the local filesystem and tolerates incomplete encoded mentions', async () => {
  const root = new SourceTestDirectory('workspace'); root.add(new SourceTestFile('local.md', '# Local'));
  const sources = await captureAgentDocumentSources({ activeTab: null, rootHandle: root.handle(), query: 'read @cloud:lib:item.md @bad%ZZ.md @local.md' });
  expect(sources.map(source => source.path)).toEqual(['local.md']);
  await Promise.all(sources.map(source => source.close()));
});
