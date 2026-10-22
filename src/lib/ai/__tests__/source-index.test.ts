import { describe, expect, it, vi } from 'vitest';
import { createAuthorizedSourceIndex, parseSourceSelections, buildSourceSelectionMention, invalidSourceSelectionMentions } from '../source-index';
import { SourceTestDirectory, SourceTestFile } from './fixtures/source-workspace';

vi.mock('@/lib/pdf-js-document-loader', () => ({ loadPdfJsDocument: async ({data}: { data: ArrayBuffer }) => {
  const pages = new TextDecoder().decode(data).split('\f');
  return { numPages: pages.length, pages, destroy: async () => {} };
} }));
vi.mock('@/lib/pdf-page-text-cache', () => ({ getPdfPageSearchText: async (document: { pages: string[] }, page: number) => document.pages[page - 1] ?? '' }));

function fixture() {
  const root = new SourceTestDirectory('workspace');
  const notes = root.add(new SourceTestDirectory('notes'));
  const files = Array.from({ length: 12 }, (_, i) => notes.add(new SourceTestDirectory(`topic-${i}`)).add(new SourceTestFile('same.md', `# Topic ${i}\n\nneedle-${i}\n`)));
  notes.add(new SourceTestFile('image.png', 'untrusted binary'));
  return { root, notes, files, index: createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'folder', path: 'notes' }] }) };
}
describe('authorized source index', () => {
  it('excludes workspace rules from folder research discovery but permits explicitly selected rules', async () => {
    const root = new SourceTestDirectory('workspace');
    const rules = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'].map(name => root.add(new SourceTestFile(name, 'Workspace instructions, never paper evidence.')));
    root.add(new SourceTestFile('paper.md', '# Paper\n\nActual measurement.'));
    const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'folder', path: '.' }] });
    expect((await index.list()).entries.map(entry => entry.path)).toEqual(['paper.md']);
    expect((await index.search({ query: 'measurement' })).reads.map(read => read.snapshot.path)).toEqual(['paper.md']);
    expect(rules.map(rule => rule.reads)).toEqual([0, 0, 0]);
    await expect(index.read({ path: 'AGENTS.md' })).rejects.toThrow(/规则|explicit|research/i);
    const explicit = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'file', path: 'AGENTS.md' }] });
    expect((await explicit.read({ path: 'AGENTS.md' })).chunks[0].text).toContain('Workspace instructions');
  });
  it('lists a nested folder lazily without reading document contents or collapsing duplicate names', async () => {
    const { index, files } = fixture();
    const first = await index.list({ limit: 4 });
    expect(first.entries).toHaveLength(4);
    expect(files.reduce((n, file) => n + file.reads, 0)).toBe(4);
    const rest = await index.list({ cursor: first.nextCursor, limit: 100 });
    expect([...first.entries, ...rest.entries].filter(entry => entry.supported)).toHaveLength(12);
    expect(rest.entries.some(entry => entry.path === 'notes/topic-11/same.md')).toBe(true);
    expect(rest.entries.find(entry => entry.path.endsWith('image.png'))?.supported).toBe(false);
  });
  it('searches real units beyond old previews and returns exact revision-bound readable ranges', async () => {
    const { index } = fixture();
    const found = await index.search({ query: 'needle-11', maxFiles: 20 });
    expect(found.hits).toHaveLength(1);
    expect(found.hits[0]).toMatchObject({ path: 'notes/topic-11/same.md', text: 'needle-11\n', locator: 'notes/topic-11/same.md#line=3', completeUnit: true });
    expect(found.hits[0].version).toBeTruthy();
    expect(found.hits[0].sourceId).toContain('notes%2Ftopic-11%2Fsame.md');
  });
  it('invalidates changed same-size files, deletion, moves and revoked permission', async () => {
    const { index, files, notes, root } = fixture();
    const read = await index.read({ path: 'notes/topic-0/same.md' });
    files[0].content = files[0].content.replace('needle', 'change');
    expect((await index.validateSnapshots([read.snapshot])).invalid[0].reason).toBe('changed');
    notes.entries.delete('topic-0');
    expect((await index.validateSnapshots([read.snapshot])).invalid[0].reason).toBe('missing');
    root.permission = 'denied';
    expect((await index.validateSnapshots([read.snapshot])).invalid[0].reason).toBe('permission');
    await expect(index.read({ path: 'notes/topic-1/same.md' })).rejects.toThrow(/permission/i);
  });
  it('reports bounded partial reads honestly and refuses stale or outside selection reads', async () => {
    const { index } = fixture();
    const read = await index.read({ path: 'notes/topic-0/same.md', maxChars: 4 });
    expect(read.chunks.map(chunk => chunk.text).join('')).toHaveLength(4);
    expect(read.complete).toBe(false);
    expect(read.chunks[0].completeUnit).toBe(false);
    await expect(index.read({ path: 'notes/topic-0/same.md', expectedVersion: 'old' })).rejects.toThrow(/changed/i);
    await expect(index.read({ path: 'elsewhere.md' })).rejects.toThrow(/selection/i);
    await expect(index.read({ path: '../private.md' })).rejects.toThrow(/path/i);
  });
  it('stops after cancellation and prevents an invalidated index from reusing stale reads', async () => {
    const { index } = fixture();
    const abort = new AbortController(); abort.abort();
    await expect(index.search({ query: 'needle', signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    index.invalidate();
    await expect(index.list()).rejects.toThrow(/invalidated/);
  });
  it('parses explicit folder mentions with encoded whitespace and keeps file mentions separate', () => {
    expect(buildSourceSelectionMention({ kind: 'folder', path: 'papers/Quantum Notes' })).toBe('@folder:papers/Quantum%20Notes');
    expect(parseSourceSelections('read @folder:papers/Quantum%20Notes and @notes.md')).toEqual([{ kind: 'folder', path: 'papers/Quantum Notes' }, { kind: 'file', path: 'notes.md' }]);
    expect(buildSourceSelectionMention({ kind: 'folder', path: 'papers/100% Notes' })).toBe('@folder:papers/100%25%20Notes');
    expect(parseSourceSelections('@folder:papers/100%25%20Notes')).toEqual([{ kind: 'folder', path: 'papers/100% Notes' }]);
    expect(parseSourceSelections('@folder:./')).toEqual([{ kind: 'folder', path: '.' }]);
    expect(invalidSourceSelectionMentions('@folder:papers/../private')).toEqual(['@folder:papers/../private']);
  });
  it('skips incomplete encoded selections without swallowing valid mentions or treating cloud ids as files', () => {
    const query = 'read @folder:unfinished% @bad%ZZ.md @notes.md @cloud:library:item.md @cloud-folder:lib:folder.md';
    expect(parseSourceSelections(query)).toEqual([{ kind: 'file', path: 'notes.md' }]);
    expect(invalidSourceSelectionMentions(query + ' @folder:')).toEqual(['@folder:unfinished%', '@bad%ZZ.md', '@folder:']);
    expect(query).toContain('@folder:unfinished%');
  });
  it('respects the total search budget when it is smaller than read concurrency', async () => {
    const { index } = fixture();
    const result = await index.search({ query: 'Topic', maxChars: 2, maxUnits: 1, concurrency: 4 });
    expect(result.scannedChars).toBeLessThanOrEqual(2);
    expect(result.reads).toHaveLength(0);
    expect(result.coverage).toHaveLength(1);
    expect(result.complete).toBe(false);
  });
  it('resolves folder authorization once without granting the alternate same-root-name directory', async () => {
    const root = new SourceTestDirectory('workspace'), nested = root.add(new SourceTestDirectory('workspace')).add(new SourceTestDirectory('notes'));
    nested.add(new SourceTestFile('allowed.txt', 'allowed'));
    root.add(new SourceTestDirectory('notes')).add(new SourceTestFile('private.txt', 'private'));
    const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'folder', path: 'workspace/notes' }] });
    await expect(index.read({ path: 'notes/private.txt' })).rejects.toThrow(/ambiguous|selection/);
  });
  it('bounds discovery through empty local directories', async () => {
    const root = new SourceTestDirectory('workspace');
    for (let i = 0; i < 8; i++) root.add(new SourceTestDirectory(`empty-${i}`));
    const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'folder', path: '.' }], maxDirectories: 3 });
    await expect(index.list()).rejects.toThrow(/budget|预算/);
  });
  it('restores the remaining valid file snapshots when another explicitly selected file was deleted', async () => {
    const root = new SourceTestDirectory('workspace'); root.add(new SourceTestFile('keep.txt', 'keep')); root.add(new SourceTestFile('gone.txt', 'gone'));
    const selections = [{ kind: 'file' as const, path: 'keep.txt' }, { kind: 'file' as const, path: 'gone.txt' }];
    const first = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections });
    const snapshots = [(await first.read({ path: 'keep.txt' })).snapshot, (await first.read({ path: 'gone.txt' })).snapshot];
    root.entries.delete('gone.txt');
    const restored = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections });
    const result = await restored.validateSnapshots(snapshots);
    expect(result.valid.map(snapshot => snapshot.path)).toEqual(['keep.txt']);
    expect(result.invalid).toEqual([expect.objectContaining({ path: 'gone.txt', reason: 'missing' })]);
    expect((await restored.read({ path: 'keep.txt' })).chunks[0].text).toBe('keep');
  });
  it('can read the tail of a budget-clipped semantic unit by explicit offset without claiming the skipped prefix', async () => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestFile('long.md', '# Heading\n' + 'x'.repeat(8000) + ' actual-tail'));
    const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'file', path: 'long.md' }] });
    const first = await index.read({ path: 'long.md', maxChars: 4000 });
    const tail = await index.read({ path: 'long.md', expectedVersion: first.snapshot.version, units: [1], offsets: { '1': 8000 }, maxChars: 1000 });
    expect(tail.chunks[0].text).toContain('actual-tail');
    expect(tail.chunks[0].startOffset).toBe(8000);
    expect(tail.chunks[0].completeUnit).toBe(false);
    expect(tail.complete).toBe(false);
  });
  it('bounds simultaneous reads and rejects a result if cancellation arrives while extraction is pending', async () => {
    const root = new SourceTestDirectory('workspace');
    let active = 0, maximum = 0;
    for (let i = 0; i < 8; i++) {
      const entry = root.add(new SourceTestFile(`${i}.txt`, 'needle'));
      const original = entry.getFile.bind(entry);
      entry.getFile = async () => {
        const file = await original(), text = file.text.bind(file);
        file.text = async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return text(); };
        return file;
      };
    }
    const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'folder', path: '' }] });
    const result = await index.search({ query: 'needle', concurrency: 2 });
    expect(result.hits).toHaveLength(8);
    expect(maximum).toBeLessThanOrEqual(2);
    expect(maximum).toBeGreaterThan(0);
    const cancelled = new AbortController();
    const pending = index.read({ path: '0.txt', signal: cancelled.signal });
    setTimeout(() => cancelled.abort(), 1);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('finds a unique term on a late PDF page using bounded continuation scans', async () => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestFile('paper.pdf', Array.from({ length: 42 }, (_, i) => 'Page ' + (i + 1) + ': ' + (i === 41 ? 'LATEPAGE_QUASAR_91' : 'synthetic background text '.repeat(8))).join('\f')));
    const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'file', path: 'paper.pdf' }] });
    let cursor: number | undefined, found: Awaited<ReturnType<typeof index.search>> | undefined, calls = 0;
    do {
      const result = await index.search({ query: 'LATEPAGE_QUASAR_91', cursor, maxChars: 700, maxScanChars: 30_000, maxUnits: 8, maxFiles: 1, maxResults: 4, snippetChars: 100 });
      calls++; cursor = result.nextCursor; found ??= result.hits.length ? result : undefined;
      if (result.hits.length) found = result;
    } while (!found && cursor && calls < 20);
    expect(found?.hits).toHaveLength(1);
    expect(found?.hits[0]).toMatchObject({ unit: 42, locator: 'paper.pdf#page=42' });
    expect(found?.coverage[0]).toMatchObject({ scannedUnits: expect.arrayContaining(Array.from({ length: 42 }, (_, i) => i + 1)), complete: true });
    expect(calls).toBeGreaterThan(1);
  });
  it('continues inside a long text unit and returns only a bounded matching excerpt', async () => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestFile('long.md', '# Synthetic\n' + 'irrelevant prefix words. '.repeat(900) + 'DEEPTERM_ORBIT_61 follows a bounded match context.'));
    const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'file', path: 'long.md' }] });
    let cursor: number | undefined, result: Awaited<ReturnType<typeof index.search>> | undefined;
    for (let i = 0; i < 40 && !result?.hits.length; i++) {
      result = await index.search({ query: 'DEEPTERM_ORBIT_61', cursor, maxChars: 1000, maxScanChars: 30_000, maxUnits: 1, snippetChars: 120 });
      cursor = result.nextCursor;
    }
    expect(result?.hits[0]?.text).toContain('DEEPTERM_ORBIT_61');
    expect(result?.hits[0]?.text.length).toBeLessThanOrEqual(120);
    expect(result?.hits[0]).toMatchObject({ matchStartOffset: expect.any(Number), matchEndOffset: expect.any(Number), completeUnit: false });
    expect(result?.reads[0]?.readUnits).toEqual([]);
    expect(result?.coverage[0]?.scannedUnits).toContain(1);
    expect(result?.scannedChars).toBeLessThanOrEqual(1000);
  });
  it('matches a term that crosses a scan-budget continuation boundary', async () => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestFile('boundary.txt', 'x'.repeat(2043) + 'BOUNDARY_TERM_73'));
    const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'file', path: 'boundary.txt' }] });
    const first = await index.search({ query: 'BOUNDARY_TERM_73', maxChars: 2048, maxScanChars: 4000, maxUnits: 1 });
    expect(first.hits).toEqual([]);
    expect(first.nextCursor).toBeGreaterThan(0);
    const next = await index.search({ query: 'BOUNDARY_TERM_73', cursor: first.nextCursor, maxChars: 100, maxScanChars: 4000, maxUnits: 1 });
    expect(next.hits).toHaveLength(1);
    expect(next.hits[0].matchStartOffset).toBe(2043);
  });
  it('does not advance past an incomplete file to a later matching file', async () => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestFile('a-long.txt', 'x'.repeat(5000) + 'FIRST_DEEP_MATCH_14'));
    root.add(new SourceTestFile('b-later.txt', 'SECOND_DEEP_MATCH_28'));
    const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'folder', path: '.' }] });
    let cursor: number | undefined, paths: string[] = [];
    for (let i = 0; i < 20 && paths.length < 2; i++) {
      const result = await index.search({ query: 'DEEP_MATCH', cursor, maxChars: 500, maxScanChars: 8000, maxFiles: 2, maxUnits: 2 });
      cursor = result.nextCursor; paths.push(...result.hits.map(hit => hit.path));
    }
    expect(paths).toContain('a-long.txt');
    expect(paths).toContain('b-later.txt');
  });
  it('binds continuations to the original query and source revision', async () => {
    const root = new SourceTestDirectory('workspace'), file = root.add(new SourceTestFile('long.txt', 'x'.repeat(1000) + 'TERM'));
    const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'file', path: 'long.txt' }] });
    const first = await index.search({ query: 'TERM', maxChars: 100, maxScanChars: 2000 });
    expect(first.nextCursor).toBeGreaterThan(0);
    await expect(index.search({ query: 'OTHER', cursor: first.nextCursor })).rejects.toThrow(/query|continuation/i);
    const changed = await index.search({ query: 'TERM', maxChars: 100, maxScanChars: 2000 });
    file.content = 'changed'.repeat(500);
    await expect(index.search({ query: 'TERM', cursor: changed.nextCursor })).rejects.toThrow(/changed|revision|restart/i);
    await expect(index.search({ query: 'TERM', cursor: 987654 })).rejects.toThrow(/cursor|continuation|expired/i);
  });
  it('excludes credential files and directories from discovery, search, and explicit reads', async () => {
    const root = new SourceTestDirectory('workspace'), secrets = root.add(new SourceTestDirectory('secrets'));
    const env = root.add(new SourceTestFile('.env.local', 'SYNTHETIC_SECRET=do-not-read'));
    const pem = root.add(new SourceTestFile('client.pem', 'SYNTHETIC_PRIVATE_KEY'));
    const token = secrets.add(new SourceTestFile('api-token.txt', 'SYNTHETIC_TOKEN'));
    root.add(new SourceTestFile('paper.md', 'safe article'));
    const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'folder', path: '.' }] });
    expect((await index.list({ limit: 20 })).entries.map(entry => entry.path)).toEqual(['paper.md']);
    expect((await index.search({ query: 'SYNTHETIC', maxFiles: 20 })).coverage.map(item => item.path)).toEqual(['paper.md']);
    for (const path of ['.env.local', 'client.pem', 'secrets/api-token.txt']) await expect(index.read({ path })).rejects.toThrow(/credential|secret|sensitive|credential/i);
    expect([env.reads, pem.reads, token.reads]).toEqual([0, 0, 0]);
  });
  it('targets a chosen source without listing or extracting unrelated root files', async () => {
    const root = new SourceTestDirectory('workspace'), unrelated = root.add(new SourceTestFile('first.txt', 'unrelated'));
    root.add(new SourceTestFile('target.md', 'Precise TARGET_TERM_12 evidence.'));
    root.values = async function* () { throw new Error('targeted search must not list root'); };
    const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'folder', path: '.' }] });
    const result = await index.search({ query: 'TARGET_TERM_12', paths: ['target.md'], maxFiles: 1 });
    expect(result.hits[0].path).toBe('target.md'); expect(unrelated.reads).toBe(0);
    await expect(index.search({ query: 'x', paths: ['../outside.md'] })).rejects.toThrow(/path|outside/i);
  });
  it('does not discard later occurrences when maxResults pauses inside a single unit', async () => {
    const root = new SourceTestDirectory('workspace'); root.add(new SourceTestFile('many.txt', 'MATCH one MATCH two MATCH three'));
    const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'file', path: 'many.txt' }] });
    let cursor: number | undefined; const offsets: number[] = [];
    for (let i=0;i<4;i++) { const result = await index.search({ query:'MATCH',cursor,maxResults:1 });offsets.push(...result.hits.map(hit=>hit.matchStartOffset!));cursor=result.nextCursor;if(!cursor)break; }
    expect(offsets).toEqual([0,10,20]);
  });
  it('extracts literal question terms to find relevant later text rather than matching a whole question sentence', async () => {
    const root = new SourceTestDirectory('workspace'); root.add(new SourceTestFile('paper.txt','ordinary introduction\n'+'background '.repeat(1000)+'The QUBIT_PROTOCOL_84 result has fidelity 0.997.'));
    const index = createAuthorizedSourceIndex({rootHandle:root.handle(),workspaceKey:'A',selections:[{kind:'file',path:'paper.txt'}]});
    const result = await index.search({query:'What does QUBIT_PROTOCOL_84 mean in this paper?',maxChars:20000});
    expect(result.hits.some(hit=>hit.text.includes('QUBIT_PROTOCOL_84'))).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(10000);
  });
  it('extracts a literal Chinese concept from a question without inventing translation terms',async()=>{
    const root=new SourceTestDirectory('workspace');root.add(new SourceTestFile('paper.txt','前言。\n'+'合成背景。'.repeat(1200)+'里德堡阻塞产生有效相互作用。'));
    const index=createAuthorizedSourceIndex({rootHandle:root.handle(),workspaceKey:'A',selections:[{kind:'file',path:'paper.txt'}]});const result=await index.search({query:'请解释本文中的里德堡阻塞是什么？',maxChars:12000});
    expect(result.hits.some(hit=>hit.text.includes('里德堡阻塞产生有效相互作用'))).toBe(true);expect(result.queryTerms).toContain('里德堡阻塞');
  });
  it('rejects explicitly selected credential files before metadata or content is read', async () => {
    const root = new SourceTestDirectory('workspace'), secret = root.add(new SourceTestFile('api-token.txt','SYNTHETIC_SECRET'));
    const index = createAuthorizedSourceIndex({rootHandle:root.handle(),workspaceKey:'A',selections:[{kind:'file',path:'api-token.txt'}]});
    await expect(index.list()).rejects.toThrow(/secret|credential/i);await expect(index.search({query:'SYNTHETIC'})).rejects.toThrow(/secret|credential/i);await expect(index.read({path:'api-token.txt'})).rejects.toThrow(/secret|credential/i);expect(secret.reads).toBe(0);
  });
  it('binds completed-file continuation pages to their revisions as well as target paths', async () => {
    const root=new SourceTestDirectory('workspace'),first=root.add(new SourceTestFile('first.txt','first'));root.add(new SourceTestFile('second.txt','SECOND'));
    const index=createAuthorizedSourceIndex({rootHandle:root.handle(),workspaceKey:'A',selections:[{kind:'folder',path:'.'}]});
    const page=await index.search({query:'SECOND',paths:['first.txt','second.txt'],maxFiles:1});expect(page.nextCursor).toBeGreaterThan(0);
    await expect(index.search({query:'SECOND',paths:['second.txt','first.txt'],cursor:page.nextCursor})).rejects.toThrow(/paths|query/i);
    first.content='changed';await expect(index.search({query:'SECOND',paths:['first.txt','second.txt'],cursor:page.nextCursor})).rejects.toThrow(/changed|restart/i);
  });
  it('keeps unreadable/empty units bounded and discloses extraction work separately from scanned characters', async () => {
    const root=new SourceTestDirectory('workspace');root.add(new SourceTestFile('long.txt','x'.repeat(10000)+'TERM'));
    const index=createAuthorizedSourceIndex({rootHandle:root.handle(),workspaceKey:'A',selections:[{kind:'file',path:'long.txt'}]});const result=await index.search({query:'TERM',maxChars:20,maxUnits:1});
    expect(result.scannedChars).toBe(20);expect(result.extractedChars).toBe(10004);expect(result.extractedUnits).toBe(1);expect(result.coverage[0].partialUnit).toMatchObject({endOffset:20,totalChars:10004});
  });
  it('bounds independent continuation state and rejects an evicted cursor instead of restarting silently', async()=>{
    const root=new SourceTestDirectory('workspace');root.add(new SourceTestFile('long.txt','x'.repeat(1000)));
    const index=createAuthorizedSourceIndex({rootHandle:root.handle(),workspaceKey:'A',selections:[{kind:'file',path:'long.txt'}]});
    const first=await index.search({query:'never',maxChars:1});for(let i=0;i<65;i++)await index.search({query:'never-'+i,maxChars:1});
    await expect(index.search({query:'never',cursor:first.nextCursor,maxChars:1})).rejects.toThrow(/expired|unknown|cursor/i);
  });
  it('caps search evidence output and does not repeat the entire long unit through reads',async()=>{
    const root=new SourceTestDirectory('workspace');root.add(new SourceTestFile('many.txt',('TAG '+ 'x'.repeat(4000)+'\n').repeat(100)));
    const index=createAuthorizedSourceIndex({rootHandle:root.handle(),workspaceKey:'A',selections:[{kind:'file',path:'many.txt'}]});
    const result=await index.search({query:'TAG',maxChars:1000000,maxScanChars:1000000,maxResults:100,snippetChars:4000});
    expect(result.hits.reduce((count,hit)=>count+hit.text.length,0)).toBeLessThanOrEqual(60000);expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(1024*1024);expect(result.nextCursor).toBeGreaterThan(0);
  });
  it('keeps each hit match inside its returned excerpt when the global output budget is almost exhausted',async()=>{
    const root=new SourceTestDirectory('workspace');root.add(new SourceTestFile('long.txt',('x'.repeat(4500)+'needle'+'y'.repeat(4500)+'\n').repeat(25)));
    const index=createAuthorizedSourceIndex({rootHandle:root.handle(),workspaceKey:'A',selections:[{kind:'folder',path:'.'}]});
    const result=await index.search({query:'needle',paths:['long.txt'],maxChars:400000,maxResults:100,snippetChars:3999,maxUnits:100});
    expect(result.hits.every(hit=>hit.text.includes('needle')&&hit.matchStartOffset!>=hit.startOffset&&hit.matchEndOffset!<=hit.endOffset)).toBe(true);
  });
  it('claims one continuation atomically when two searches race for the same cursor',async()=>{
    const root=new SourceTestDirectory('workspace');root.add(new SourceTestFile('long.txt','x'.repeat(1000)));
    const index=createAuthorizedSourceIndex({rootHandle:root.handle(),workspaceKey:'A',selections:[{kind:'file',path:'long.txt'}]});const first=await index.search({query:'needle',maxChars:20});
    const results=await Promise.allSettled([index.search({query:'needle',cursor:first.nextCursor,maxChars:20}),index.search({query:'needle',cursor:first.nextCursor,maxChars:20})]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  });
  it('continues through every path accepted by the 100-path schema',async()=>{
    const root=new SourceTestDirectory('workspace');const paths=Array.from({length:65},(_,i)=>root.add(new SourceTestFile('p-'+i+'.txt',i===64?'needle':'background')).name);
    const index=createAuthorizedSourceIndex({rootHandle:root.handle(),workspaceKey:'A',selections:[{kind:'folder',path:'.'}]});const first=await index.search({query:'needle',paths,maxFiles:64,maxChars:10000});
    const last=await index.search({query:'needle',paths,cursor:first.nextCursor,maxFiles:64,maxChars:10000});expect(last.hits[0].path).toBe(paths[64]);
  });
});
