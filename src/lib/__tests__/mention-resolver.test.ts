import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceStore } from '@/stores/workspace-store';
import {
  getMentionFragmentSuggestions,
  getAvailableFiles,
  parseMentions,
  resolveWorkspaceFilePath,
  resolveMentions,
  stripMentions,
} from '../ai/mention-resolver';

function createFileNode(path: string) {
  const parts = path.split('/');
  return {
    kind: 'file' as const,
    path,
    name: parts[parts.length - 1],
    extension: `.${parts[parts.length - 1].split('.').pop() ?? ''}`,
    handle: {} as FileSystemFileHandle,
  };
}

describe('mention-resolver', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      fileTree: {
        root: {
          kind: 'directory',
          name: 'workspace',
          path: 'workspace',
          isExpanded: true,
          handle: {} as FileSystemDirectoryHandle,
          children: [
            createFileNode('notes/paper.md'),
            createFileNode('src/main.py'),
            createFileNode('analysis.ipynb'),
            createFileNode('papers/demo.pdf'),
          ],
        },
      },
    });
  });

  it('parses file, selection, and fragment mentions', () => {
    const mentions = parseMentions(
      'Compare @notes/paper.md#Method with @src/main.py#line=12 and @selection',
    );

    expect(mentions).toEqual([
      expect.objectContaining({
        type: 'file',
        path: 'notes/paper.md',
        fragment: 'Method',
      }),
      expect.objectContaining({
        type: 'file',
        path: 'src/main.py',
        fragment: 'line=12',
      }),
      expect.objectContaining({
        type: 'selection',
        target: 'selection',
      }),
    ]);
  });

  it('uses workspace file tree instead of only open tabs for autocomplete candidates', () => {
    const files = getAvailableFiles();

    expect(files.map((file) => file.path)).toEqual([
      'analysis.ipynb',
      'notes/paper.md',
      'papers/demo.pdf',
      'src/main.py',
    ]);
  });

  it('resolves workspace file paths by exact path and suffix', () => {
    expect(resolveWorkspaceFilePath('notes/paper.md')).toBe('notes/paper.md');
    expect(resolveWorkspaceFilePath('paper.md')).toBe('notes/paper.md');
  });

  it('builds heading fragment suggestions for markdown files', async () => {
    const suggestions = await getMentionFragmentSuggestions('notes/paper.md', {
      readFile: async () => '# Intro\n## Method\n### Details\n## Results',
    });

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'heading',
          value: '@notes/paper.md#Method',
        }),
        expect.objectContaining({
          type: 'heading',
          value: '@notes/paper.md#Details',
        }),
      ]),
    );
  });

  it('builds notebook cell fragment suggestions', async () => {
    const suggestions = await getMentionFragmentSuggestions('analysis.ipynb', {
      readFile: async () => JSON.stringify({
        cells: [
          { cell_type: 'markdown', source: '# Intro' },
          { cell_type: 'code', source: 'print("alpha")' },
        ],
      }),
    });

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'notebook_cell',
          value: '@analysis.ipynb#cell%3D2',
        }),
      ]),
    );
  });

  it('builds code line fragment suggestions', async () => {
    const suggestions = await getMentionFragmentSuggestions('src/main.py', {
      readFile: async () => 'import os\n\nprint("alpha")\nvalue = 2',
    });

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'code_line',
          value: '@src/main.py#line%3D1',
        }),
        expect.objectContaining({
          type: 'code_line',
          value: '@src/main.py#line%3D3',
        }),
      ]),
    );
  });

  it('builds pdf page and annotation fragment suggestions', async () => {
    const suggestions = await getMentionFragmentSuggestions('papers/demo.pdf', {
      pdfPageCandidates: [7, 2, 7],
      pdfAnnotationCandidates: ['ann-3'],
    });

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'pdf_page',
          value: '@papers/demo.pdf#page%3D2',
        }),
        expect.objectContaining({
          type: 'pdf_annotation',
          value: '@papers/demo.pdf#ann-3',
        }),
      ]),
    );
  });

  it('resolves markdown heading mentions to section content and heading evidence', async () => {
    const [resolved] = await resolveMentions(parseMentions('@notes/paper.md#Method'), {
      readFile: async (path) => {
        if (path !== 'notes/paper.md') {
          throw new Error('unexpected path');
        }
        return '# Intro\nAlpha\n## Method\nDetailed section\n### Step\nMore\n## Result\nDone';
      },
    });

    expect(resolved.resolved).toContain('## Method');
    expect(resolved.resolved).toContain('Detailed section');
    expect(resolved.resolved).not.toContain('## Result');
    expect(resolved.evidenceRef).toEqual(
      expect.objectContaining({
        kind: 'heading',
        locator: 'notes/paper.md#Method',
      }),
    );
  });

  it('resolves code line mentions to nearby line context and code-line evidence', async () => {
    const [resolved] = await resolveMentions(parseMentions('@src/main.py#line=3'), {
      readFile: async () => 'line1\nline2\nline3\nline4\nline5\nline6',
    });

    expect(resolved.resolved).toContain('   3 | line3');
    expect(resolved.resolved).toContain('   1 | line1');
    expect(resolved.evidenceRef).toEqual(
      expect.objectContaining({
        kind: 'code_line',
        locator: 'src/main.py#line=3',
      }),
    );
  });

  it('resolves notebook cell mentions with numeric cell fragments', async () => {
    const [resolved] = await resolveMentions(parseMentions('@analysis.ipynb#cell=2'), {
      readFile: async () => JSON.stringify({
        cells: [
          { cell_type: 'markdown', source: '# Intro' },
          { cell_type: 'code', source: 'print("alpha")' },
        ],
      }),
    });

    expect(resolved.resolved).toContain('Cell 2 (code)');
    expect(resolved.resolved).toContain('print("alpha")');
    expect(resolved.evidenceRef).toEqual(
      expect.objectContaining({
        kind: 'notebook_cell',
        locator: 'analysis.ipynb#cell=2',
      }),
    );
  });

  it('resolves binary pdf page mentions without reading raw binary text', async () => {
    const readFile = vi.fn();
    const [resolved] = await resolveMentions(parseMentions('@papers/demo.pdf#page=12'), {
      readFile,
    });

    expect(readFile).not.toHaveBeenCalled();
    expect(resolved.resolved).toContain('page 12');
    expect(resolved.evidenceRef).toEqual(
      expect.objectContaining({
        kind: 'pdf_page',
        locator: 'papers/demo.pdf#page=12',
      }),
    );
  });

  it('strips file and fragment mentions from text', () => {
    expect(stripMentions('Ask @notes/paper.md#Method about @selection please')).toBe('Ask  about  please');
  });
});
