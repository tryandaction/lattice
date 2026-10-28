import { expect, it, vi } from 'vitest';
import { createLatticeHarnessToolRuntime } from '../lattice-source-tools';
import { createAuthorizedSourceIndex } from '../../source-index';
import { SourceTestDirectory, SourceTestFile } from '../../__tests__/fixtures/source-workspace';
vi.mock('@/lib/pdf-js-document-loader', () => ({ loadPdfJsDocument: async () => ({ numPages: 2, destroy: async () => {} }) }));
vi.mock('@/lib/pdf-page-text-cache', () => ({ getPdfPageSearchText: async (_pdf: unknown, page: number) => page === 1 ? 'A verified original finding.' : 'The actual second-page conclusion.' }));
it('retains a validated annotation draft when another quote is rejected and marks partial coverage', async () => {
  const root = new SourceTestDirectory('synthetic'); root.add(new SourceTestFile('paper.pdf', '%PDF synthetic'));
  const onDraft = vi.fn(() => 'review');
  const runtime = createLatticeHarnessToolRuntime({ kind: 'local', root: root.handle(), workspaceKey: 'batch-runtime',
    index: createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'batch-runtime', selections: [{ kind: 'file', path: 'paper.pdf' }] }), onDraft });
  const result = await runtime.execute('lattice.pdf.proposeAnnotations', { parentPath: 'paper.pdf', annotations: [
    { page: 1, quote: 'A verified original finding.', type: 'highlight' },
    { page: 2, quote: 'An invented interpretation.', type: 'highlight' },
  ] });
  expect(result).toMatchObject({ status: 'pending-review', complete: false, annotationValidation: { acceptedCount: 1, rejectedCount: 1 } });
  expect(onDraft).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(onDraft.mock.calls)).toContain('A verified original finding.');
  expect(JSON.stringify(onDraft.mock.calls)).not.toContain('An invented interpretation.');
  expect(root.entries.has('.lattice')).toBe(false);
});
