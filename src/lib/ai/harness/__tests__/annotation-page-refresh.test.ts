import { beforeEach, expect, it, vi } from 'vitest';
import { createLatticeHarnessToolRuntime } from '../lattice-source-tools';
import { createAuthorizedSourceIndex } from '../../source-index';
import { SourceTestDirectory, SourceTestFile } from '../../__tests__/fixtures/source-workspace';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { AgentSourceRead } from '../../source-index';
import type { CloudLibraryResource, CloudLibrarySourceProvider } from '@/lib/shared-library/source-provider';

const pdfText = vi.hoisted(() => vi.fn(async (_pdf: unknown, page: number) =>
  page === 12 ? 'A verified core method on page twelve.' : page === 15 ? 'The verified conclusion on page fifteen.' : `Synthetic page ${page}.`));
vi.mock('@/lib/pdf-js-document-loader', () => ({ loadPdfJsDocument: async () => ({ numPages: 15, destroy: async () => {} }) }));
vi.mock('@/lib/pdf-page-text-cache', () => ({ getPdfPageSearchText: pdfText }));

beforeEach(() => { useWorkspaceStore.setState({ rootHandle: null }); pdfText.mockClear(); });
function local() {
  const root = new SourceTestDirectory('workspace');
  const file = root.add(new SourceTestFile('paper.pdf', '%PDF synthetic'));
  root.add(new SourceTestFile('outside.pdf', '%PDF outside'));
  const onDraft = vi.fn(() => 'annotation-review');
  const runtime = createLatticeHarnessToolRuntime({ kind: 'local', root: root.handle(), workspaceKey: 'annotation-test',
    index: createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'annotation-test', selections: [{ kind: 'file', path: 'paper.pdf' }] }), onDraft });
  return { root, file, onDraft, runtime };
}
const annotations = [
  { page: 12, quote: 'A verified core method on page twelve.', type: 'highlight' },
  { page: 15, quote: 'The verified conclusion on page fifteen.', type: 'underline' },
];

it('revalidates target PDF pages in a fresh runtime instead of trusting or requiring a previous chat read ledger', async () => {
  const { root, onDraft, runtime } = local();
  const result = await runtime.execute('lattice.pdf.proposeAnnotations', { parentPath: 'paper.pdf', annotations });
  expect(result).toMatchObject({ status: 'pending-review' });
  expect(onDraft).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(onDraft.mock.calls)).toContain('A verified core method on page twelve.');
  expect(JSON.stringify(onDraft.mock.calls)).toContain('The verified conclusion on page fifteen.');
  expect(pdfText.mock.calls.map(call => call[1])).toEqual(expect.arrayContaining([12, 15]));
  expect(root.entries.has('.lattice')).toBe(false);
});

it('refreshes annotation pages after an opening excerpt without rereading all fifteen pages', async () => {
  const { runtime, onDraft } = local();
  await runtime.execute('lattice.sources.read', { path: 'paper.pdf', maxChars: 4, maxUnits: 1 });
  pdfText.mockClear();
  await runtime.execute('lattice.pdf.proposeAnnotations', { parentPath: 'paper.pdf', annotations });
  const pages = pdfText.mock.calls.map(call => call[1]);
  expect(pages).toContain(12); expect(pages).toContain(15); expect(pages).not.toContain(2);
  expect(onDraft).toHaveBeenCalledTimes(1);
});

it('does not silently refresh across a previously captured PDF revision', async () => {
  const { file, runtime, onDraft } = local();
  await runtime.execute('lattice.sources.read', { path: 'paper.pdf' });
  file.content += ' edited'; file.lastModified += 1;
  await expect(runtime.execute('lattice.pdf.proposeAnnotations', { parentPath: 'paper.pdf', annotations })).rejects.toThrow(/revision|version|版本|改变|changed/i);
  expect(onDraft).not.toHaveBeenCalled();
});

it('still rejects invented text, wrong page, out-of-range page and unauthorized PDF paths without a draft', async () => {
  const { runtime, onDraft } = local();
  for (const invalid of [{ page: 12, quote: annotations[1].quote, type: 'highlight' },
    { page: 15, quote: 'An invented paraphrase.', type: 'highlight' }, { page: 16, quote: annotations[0].quote, type: 'highlight' }]) {
    await expect(runtime.execute('lattice.pdf.proposeAnnotations', { parentPath: 'paper.pdf', annotations: [invalid] })).rejects.toThrow();
  }
  await expect(runtime.execute('lattice.pdf.proposeAnnotations', { parentPath: 'outside.pdf', annotations })).rejects.toThrow();
  expect(onDraft).not.toHaveBeenCalled();
});

it('refreshes exact cloud PDF pages before review while retaining provider identity and avoiding writes', async () => {
  const parent: CloudLibraryResource = { id: 'cloud:verified:pdf', libraryId: 'lib', itemId: 'pdf', name: 'paper.pdf', kind: 'pdf',
    role: 'editor', versionId: 'v1', path: 'cloud://display', content: { kind: 'binary', data: new TextEncoder().encode('%PDF synthetic').buffer, mimeType: 'application/pdf', updatedAt: 'now' } };
  const onDraft = vi.fn(() => 'cloud-review'), save = vi.fn(), createChild = vi.fn();
  const provider: CloudLibrarySourceProvider = { scope: 'account-A', read: async () => parent, list: async () => [],
    search: async () => ({ results: [] }), save, createChild };
  const runtime = createLatticeHarnessToolRuntime({ kind: 'cloud', getProvider: () => provider,
    selections: [{ kind: 'file', libraryId: 'lib', itemId: 'pdf' }], getActiveResource: () => parent, onDraft });
  await runtime.execute('lattice.pdf.proposeAnnotations', { parentPath: parent.id, annotations });
  expect(onDraft).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(onDraft.mock.calls)).toContain('cloud:verified:pdf');
  expect(pdfText.mock.calls.map(call => call[1])).toEqual(expect.arrayContaining([12, 15]));
  expect(save).not.toHaveBeenCalled(); expect(createChild).not.toHaveBeenCalled();
});

it('retains expectedVersion rejection before re-reading annotation pages', async () => {
  const { runtime, onDraft } = local();
  const read = await runtime.execute('lattice.sources.read', { path: 'paper.pdf', maxUnits: 1 }) as AgentSourceRead;
  await expect(runtime.execute('lattice.pdf.proposeAnnotations', { parentPath: 'paper.pdf', expectedVersion: read.snapshot.version + '-stale', annotations })).rejects.toThrow();
  expect(onDraft).not.toHaveBeenCalled();
});
