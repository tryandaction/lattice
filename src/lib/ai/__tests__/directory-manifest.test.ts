import { describe, expect, it, vi } from 'vitest';
import { SourceTestDirectory, SourceTestFile } from './fixtures/source-workspace';
import { discoverDirectoryManifest, type DirectoryManifestCheckpoint, type DiscoverDirectoryManifestInput } from '../directory-manifest';

function input(root: SourceTestDirectory, extra: Partial<DiscoverDirectoryManifestInput> = {}): DiscoverDirectoryManifestInput {
  return { rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'folder', path: '.' }], onCheckpoint: async () => {}, ...extra };
}

describe('durable directory discovery', () => {
  it('enumerates more than 100 files across bounded durable directory windows', async () => {
    const implementation = await import('../directory-manifest').catch(() => null);
    expect(implementation?.discoverDirectoryManifest).toBeTypeOf('function');
    if (!implementation) return;
    const root = new SourceTestDirectory('workspace');
    const papers = root.add(new SourceTestDirectory('papers'));
    for (let i = 0; i < 101; i++) papers.add(new SourceTestDirectory(`part-${i}`)).add(new SourceTestFile('same.md', `Synthetic ${i}`));
    let checkpoint: DirectoryManifestCheckpoint | undefined;
    for (let i = 0; i < 60; i++) {
      checkpoint = await implementation.discoverDirectoryManifest({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'folder', path: 'papers' }], checkpoint,
        maxDirectoriesPerRun: 2, onCheckpoint: async () => {} });
      if (checkpoint.complete) break;
    }
    expect(checkpoint?.complete).toBe(true);
    expect(checkpoint?.files).toHaveLength(101);
    expect(checkpoint?.files.some(file => file.path === 'papers/part-100/same.md')).toBe(true);
  });

  it('rechecks completed paths after JSON restoration and detects additions, deletion, rename and metadata changes despite listing order', async () => {
    const root = new SourceTestDirectory('workspace');
    const papers = root.add(new SourceTestDirectory('papers'));
    const first = papers.add(new SourceTestDirectory('a'));
    first.add(new SourceTestFile('old.md', 'old'));
    const keep = papers.add(new SourceTestFile('keep.md', 'same', 1));
    const options = input(root, { selections: [{ kind: 'folder', path: 'papers' }] });
    const checkpoint = JSON.parse(JSON.stringify(await discoverDirectoryManifest(options))) as DirectoryManifestCheckpoint;
    papers.entries.delete('a');
    papers.add(new SourceTestDirectory('new')).add(new SourceTestFile('tail.md', 'last'));
    papers.entries.delete('keep.md'); keep.name = 'renamed.md'; papers.add(keep);
    papers.entries = new Map([...papers.entries].reverse());
    // Revalidation and new discovery now both consume this two-directory window.
    const next = await discoverDirectoryManifest({ ...options, checkpoint, maxDirectoriesPerRun: 2 });
    expect(next.complete).toBe(true);
    expect(next.files.map(file => file.path)).toEqual(['papers/new/tail.md', 'papers/renamed.md']);
    expect(next.removedPaths).toEqual(['papers/a/old.md', 'papers/keep.md']);
    expect(next.changedPaths).toEqual(['papers/new/tail.md', 'papers/renamed.md']);
    keep.lastModified = 2;
    const changed = await discoverDirectoryManifest({ ...options, checkpoint: next });
    expect(changed.changedPaths).toEqual(['papers/renamed.md']);
    const stable = await discoverDirectoryManifest({ ...options, checkpoint: changed });
    expect(stable.changedPaths).toEqual([]);
    expect(stable.removedPaths).toEqual([]);
  });

  it('does not preserve complete when a new unvisited subdirectory appears', async () => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestFile('a.md', 'a'));
    const checkpoint = await discoverDirectoryManifest(input(root));
    const first = root.add(new SourceTestDirectory('new'));
    first.add(new SourceTestDirectory('deeper')).add(new SourceTestFile('last.md', 'last'));
    const next = await discoverDirectoryManifest(input(root, { checkpoint, maxDirectoriesPerRun: 1 }));
    expect(next.complete).toBe(false);
    expect(next.pendingDirectories).toEqual(['new']);
    const middle = await discoverDirectoryManifest(input(root, { checkpoint: next, maxDirectoriesPerRun: 1 }));
    expect(middle.pendingDirectories).toEqual(['new/deeper']);
    expect(middle.complete).toBe(false);
    const completed = await discoverDirectoryManifest(input(root, { checkpoint: middle, maxDirectoriesPerRun: 1 }));
    expect(completed.complete).toBe(true);
    expect(completed.files.map(file => file.path)).toContain('new/deeper/last.md');
  });

  it('does not persist complete while old child directories still await revalidation', async () => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestDirectory('papers')).add(new SourceTestFile('old.md', 'old'));
    const first = await discoverDirectoryManifest(input(root));
    const commits: DirectoryManifestCheckpoint[] = [];
    const abort = new AbortController();
    await expect(discoverDirectoryManifest(input(root, { checkpoint: first, signal: abort.signal, onCheckpoint: async state => {
      commits.push(state); abort.abort();
    } }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(commits).toHaveLength(1);
    expect(commits[0].complete).toBe(false);
  });

  it('deduplicates overlapping roots and uses sorted original selection identity on resume', async () => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestDirectory('papers')).add(new SourceTestFile('a.md', 'a'));
    const selections = [{ kind: 'folder' as const, path: 'papers' }, { kind: 'folder' as const, path: '.' }];
    const first = await discoverDirectoryManifest(input(root, { selections }));
    const next = await discoverDirectoryManifest(input(root, { selections: selections.slice().reverse(), checkpoint: first }));
    expect(next.files.map(file => file.path)).toEqual(['papers/a.md']);
    expect(next.directories.map(dir => dir.path)).toEqual(['', 'papers']);
  });

  it('rejects changed workspace, changed selections and forged out-of-scope pending paths before persisting', async () => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestDirectory('papers')).add(new SourceTestFile('a.md', 'a'));
    root.add(new SourceTestDirectory('private'));
    const first = await discoverDirectoryManifest(input(root, { selections: [{ kind: 'folder', path: 'papers' }] }));
    const onCheckpoint = vi.fn();
    await expect(discoverDirectoryManifest(input(root, { selections: first.selections, checkpoint: first, workspaceKey: 'B', onCheckpoint }))).rejects.toThrow(/scope/);
    await expect(discoverDirectoryManifest(input(root, { checkpoint: first, onCheckpoint }))).rejects.toThrow(/scope/);
    await expect(discoverDirectoryManifest(input(root, { selections: first.selections, checkpoint: { ...first, pendingDirectories: ['private'] }, onCheckpoint }))).rejects.toThrow(/checkpoint/);
    expect(onCheckpoint).not.toHaveBeenCalled();
  });

  it('rejects traversal, cloud URL and same-root-name ambiguities without enumerating the wrong folder', async () => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestDirectory('papers'));
    root.add(new SourceTestDirectory('workspace')).add(new SourceTestDirectory('papers'));
    for (const path of ['../private', 'https://example.test/private', 'workspace/papers', 'workspace']) {
      await expect(discoverDirectoryManifest(input(root, { selections: [{ kind: 'folder', path }] }))).rejects.toThrow(/path|ambiguous/);
    }
  });

  it('excludes implicit workspace instructions, credentials and generated folders, but retains unsupported ordinary files', async () => {
    const root = new SourceTestDirectory('workspace');
    const omitted = [root.add(new SourceTestFile('AGENTS.md', 'rules')), root.add(new SourceTestFile('.env', 'secret')),
      root.add(new SourceTestFile('api-token.txt', 'secret')),
      root.add(new SourceTestDirectory('node_modules')).add(new SourceTestFile('code.js', 'generated')),
      root.add(new SourceTestDirectory('secrets')).add(new SourceTestFile('secret.txt', 'secret'))];
    root.add(new SourceTestFile('a.md', 'a'));
    root.add(new SourceTestFile('image.png', 'binary'));
    const result = await discoverDirectoryManifest(input(root));
    expect(result.files).toEqual([expect.objectContaining({ path: 'a.md', supported: true }), expect.objectContaining({ path: 'image.png', supported: false })]);
    expect(omitted.map(file => file.reads)).toEqual([0, 0, 0, 0, 0]);
    const explicit = await discoverDirectoryManifest(input(root, { selections: [{ kind: 'file', path: 'AGENTS.md' }] }));
    expect(explicit.files[0].path).toBe('AGENTS.md');
    await expect(discoverDirectoryManifest(input(root, { selections: [{ kind: 'folder', path: 'secrets' }] }))).rejects.toThrow(/excluded/);
  });

  it('does not impose a combined byte limit and never reads file text or bytes for metadata', async () => {
    const root = new SourceTestDirectory('workspace');
    const text = vi.fn(), bytes = vi.fn();
    for (let i = 0; i < 3; i++) {
      const file = root.add(new SourceTestFile(`${i}.pdf`, ''));
      file.getFile = async () => ({ size: 20_000_000, lastModified: 1, text, arrayBuffer: bytes }) as unknown as File;
    }
    const result = await discoverDirectoryManifest(input(root));
    expect(result.files.reduce((sum, file) => sum + file.size, 0)).toBe(60_000_000);
    expect(result.complete).toBe(true);
    expect(text).not.toHaveBeenCalled(); expect(bytes).not.toHaveBeenCalled();
  });

  it('awaits checkpoint persistence and never starts the next directory after a rejected write', async () => {
    const root = new SourceTestDirectory('workspace');
    const nested = root.add(new SourceTestDirectory('papers'));
    const values = vi.spyOn(nested, 'values');
    let commits = 0;
    await expect(discoverDirectoryManifest(input(root, { onCheckpoint: async () => { if (++commits === 2) throw new Error('disk full'); } }))).rejects.toThrow('disk full');
    expect(values).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'revoke', 'scope'] as const)('does not advance after %s during a commit', async mode => {
    const root = new SourceTestDirectory('workspace');
    const nested = root.add(new SourceTestDirectory('papers'));
    const values = vi.spyOn(nested, 'values');
    const controller = new AbortController(); let current = true; let commits = 0;
    await expect(discoverDirectoryManifest(input(root, { signal: controller.signal, isCurrent: () => current, onCheckpoint: async () => {
      if (++commits !== 2) return;
      if (mode === 'cancel') controller.abort(); else if (mode === 'revoke') root.permission = 'denied'; else current = false;
    } }))).rejects.toThrow();
    expect(values).not.toHaveBeenCalled();
  });

  it('retains an ordinary metadata failure as a visible file and stops on permission failure', async () => {
    const root = new SourceTestDirectory('workspace');
    const broken = root.add(new SourceTestFile('broken.pdf', 'broken'));
    root.add(new SourceTestFile('good.md', 'good'));
    broken.getFile = async () => { throw new Error('synthetic metadata failure'); };
    const result = await discoverDirectoryManifest(input(root));
    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toMatchObject({ path: 'broken.pdf', metadataError: 'Error' });
    broken.getFile = async () => { throw new DOMException('synthetic denial', 'NotAllowedError'); };
    await expect(discoverDirectoryManifest(input(root, { checkpoint: result }))).rejects.toMatchObject({ name: 'NotAllowedError' });
  });

  it('does not treat native permission errors without a DOMException as recoverable file metadata failures', async () => {
    const root = new SourceTestDirectory('workspace');
    const denied = root.add(new SourceTestFile('a.pdf', 'a'));
    const later = root.add(new SourceTestFile('later.md', 'later'));
    denied.getFile = async () => { throw new Error('File access denied by workspace authorization'); };
    await expect(discoverDirectoryManifest(input(root))).rejects.toThrow(/denied|authorization/);
    expect(later.reads).toBe(0);
  });

  it('persists fair verification paths when every recovery is interrupted after two directory scans', async () => {
    const root = new SourceTestDirectory('workspace');
    const visited: string[] = [];
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      const child = root.add(new SourceTestDirectory(name)); child.add(new SourceTestFile('paper.md', name));
      const values = child.values.bind(child);
      child.values = async function* () { visited.push(name); yield* values(); };
    }
    const values = root.values.bind(root);
    root.values = async function* () { visited.push(''); yield* values(); };
    let checkpoint = await discoverDirectoryManifest(input(root, { maxDirectoriesPerRun: 3 }));
    expect(checkpoint.pendingDirectories).toEqual(['c', 'd', 'e']);
    visited.length = 0;
    for (let round = 0; round < 3; round++) {
      const startingScans = visited.length;
      try {
        checkpoint = await discoverDirectoryManifest(input(root, { checkpoint, refresh: round === 0, maxDirectoriesPerRun: 2, onCheckpoint: async state => {
          checkpoint = JSON.parse(JSON.stringify(state));
          if (visited.length - startingScans >= 2) throw new Error('synthetic time budget');
        } }));
      } catch (error) { expect((error as Error).message).toBe('synthetic time budget'); }
    }
    expect(checkpoint.files.map(file => file.path)).toEqual(['a/paper.md', 'b/paper.md', 'c/paper.md', 'd/paper.md', 'e/paper.md']);
    expect(visited.filter(path => path === '')).toHaveLength(1);
    expect(checkpoint.complete).toBe(true);
  });

  it('counts old verification scans against each window and returns pending state at a cooperative deadline', async () => {
    const root = new SourceTestDirectory('workspace');
    for (const name of ['a', 'b', 'c']) root.add(new SourceTestDirectory(name)).add(new SourceTestFile('paper.md', name));
    const first = await discoverDirectoryManifest(input(root));
    let scans = 0;
    for (const folder of [root, ...[...root.entries.values()].filter((entry): entry is SourceTestDirectory => entry.kind === 'directory')]) {
      const values = folder.values.bind(folder);
      folder.values = async function* () { scans++; yield* values(); };
    }
    const next = await discoverDirectoryManifest(input(root, { checkpoint: first, refresh: true, maxDirectoriesPerRun: 2, shouldContinue: () => scans < 1 }));
    expect(scans).toBe(1);
    expect(next.complete).toBe(false);
    expect(next.verification?.pendingPaths).toEqual(['a', 'b', 'c']);
    const resumed = await discoverDirectoryManifest(input(root, { checkpoint: JSON.parse(JSON.stringify(next)), maxDirectoriesPerRun: 1 }));
    expect(scans).toBe(2);
    expect(resumed.verification?.pendingPaths).toEqual(['b', 'c']);
    expect(resumed.complete).toBe(false);
  });

  it('rechecks actual parent reachability before resuming a pending descendant from a removed directory', async () => {
    const root = new SourceTestDirectory('workspace');
    const parent = root.add(new SourceTestDirectory('a'));
    parent.add(new SourceTestFile('obsolete.md', 'old'));
    parent.add(new SourceTestDirectory('deep')).add(new SourceTestFile('never.md', 'never'));
    const first = await discoverDirectoryManifest(input(root, { maxDirectoriesPerRun: 2 }));
    expect(first.pendingDirectories).toEqual(['a/deep']);
    root.entries.delete('a');
    const next = await discoverDirectoryManifest(input(root, { checkpoint: first, maxDirectoriesPerRun: 1 }));
    expect(next.files).toEqual([]);
    expect(next.directories.map(record => record.path)).toEqual(['']);
    expect(next.removedPaths).toEqual(['a/obsolete.md']);
    expect(next.complete).toBe(true);
  });

  it('migrates a legacy v1 manifest once and preserves the new path queue across subsequent windows', async () => {
    const root = new SourceTestDirectory('workspace');
    for (const name of ['a', 'b', 'c']) root.add(new SourceTestDirectory(name)).add(new SourceTestFile('paper.md', name));
    const complete = await discoverDirectoryManifest(input(root));
    const legacy = JSON.parse(JSON.stringify(complete)) as DirectoryManifestCheckpoint;
    delete legacy.verification;
    legacy.complete = false;
    const first = await discoverDirectoryManifest(input(root, { checkpoint: legacy, maxDirectoriesPerRun: 1 }));
    expect(first.verification).toEqual({ generation: 1, pendingPaths: ['a', 'b', 'c'], next: 'discover' });
    const next = await discoverDirectoryManifest(input(root, { checkpoint: JSON.parse(JSON.stringify(first)), maxDirectoriesPerRun: 1 }));
    expect(next.verification).toEqual({ generation: 1, pendingPaths: ['b', 'c'], next: 'discover' });
    expect(next.complete).toBe(false);
    const last = await discoverDirectoryManifest(input(root, { checkpoint: next, maxDirectoriesPerRun: 2 }));
    expect(last.complete).toBe(true);
    expect(last.verification?.generation).toBe(1);
  });

  it('rejects a forged out-of-scope verification path before starting traversal', async () => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestDirectory('papers'));
    const first = await discoverDirectoryManifest(input(root, { selections: [{ kind: 'folder', path: 'papers' }] }));
    first.verification = { generation: 1, pendingPaths: ['../private'], next: 'verify' };
    await expect(discoverDirectoryManifest(input(root, { selections: first.selections, checkpoint: first }))).rejects.toThrow(/checkpoint/);
  });
});
