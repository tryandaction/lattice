import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearWorkspaceSummaryCache,
  getCachedWorkspaceSummary,
  getOrBuildWorkspaceSummary,
} from '../ai/workspace-summary-cache';
import type { FileIndex, WorkspaceIndex } from '../ai/workspace-indexer';

function file(path: string, overrides: Partial<FileIndex> = {}): FileIndex {
  return {
    path,
    name: path.split('/').pop() ?? path,
    extension: '.md',
    size: 100,
    summary: `${path} summary`,
    lastModified: 100,
    ...overrides,
  };
}

function index(version: number, files: FileIndex[]): WorkspaceIndex {
  return {
    files: new Map(files.map((item) => [item.path, item])),
    lastFullIndex: 100,
    version,
  };
}

describe('workspace-summary-cache', () => {
  beforeEach(() => {
    clearWorkspaceSummaryCache();
  });

  it('builds and reuses a summary for the same workspace index version', () => {
    const workspaceIndex = index(3, [
      file('notes/alpha.md', { headings: ['Intro', 'Method'], lastModified: 50 }),
      file('src/tool.ts', { exports: ['runTool'], lastModified: 80 }),
    ]);

    const first = getOrBuildWorkspaceSummary(workspaceIndex, {
      workspaceKey: 'workspace-a',
      now: 200,
    });
    const second = getOrBuildWorkspaceSummary(workspaceIndex, {
      workspaceKey: 'workspace-a',
      now: 300,
    });

    expect(second).toBe(first);
    expect(first.summary).toContain('Indexed files: 2');
    expect(first.summary).toContain('notes/alpha.md');
    expect(first.sourcePaths).toContain('src/tool.ts');
    expect(getCachedWorkspaceSummary('workspace-a', 3)).toBe(first);
  });

  it('invalidates the cache when index version changes', () => {
    const first = getOrBuildWorkspaceSummary(index(1, [
      file('old.md'),
    ]), {
      workspaceKey: 'workspace-a',
      now: 100,
    });

    const second = getOrBuildWorkspaceSummary(index(2, [
      file('new.md'),
    ]), {
      workspaceKey: 'workspace-a',
      now: 200,
    });

    expect(second).not.toBe(first);
    expect(second.indexVersion).toBe(2);
    expect(second.sourcePaths).toEqual(['new.md']);
  });
});
