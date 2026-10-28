// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDocumentSource, AgentDocumentUnitResult } from '@/lib/ai/document-source';
import type { CloudLibraryResource, CloudLibrarySourceProvider } from '../source-provider';
import { captureTeamAiSource } from '../cloud-team-ai-source';

const extraction = vi.hoisted(() => ({ open: vi.fn(), version: vi.fn() }));
vi.mock('@/lib/ai/document-source', () => ({ openAgentDocumentSource: extraction.open, getAgentDocumentVersion: extraction.version, isAgentDocumentPath: () => true }));
beforeEach(() => {
  extraction.version.mockImplementation(async (file: File) => `${file.size}:${Buffer.from(await file.arrayBuffer()).toString('hex')}`);
});
afterEach(() => vi.clearAllMocks());
function fixture(name = 'paper.pdf', units: AgentDocumentUnitResult[] = [{ status: 'text', text: 'PDF source text' }]) {
  let resource: CloudLibraryResource = { id: 'resource:account:library:item', libraryId: 'library', itemId: 'item', versionId: 'version-1', name, kind: name.endsWith('.pdf') ? 'pdf' : 'docx', path: 'cloud://resource', role: 'viewer', content: { kind: 'binary', data: new TextEncoder().encode('document-bytes').buffer, mimeType: name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', updatedAt: '' } };
  const readUnit = vi.fn(async (unit: number): Promise<AgentDocumentUnitResult> => units[unit-1]); const close = vi.fn(async () => undefined);
  const opened: AgentDocumentSource = { path: name, kind: name.endsWith('.pdf') ? 'pdf' : 'text', version: 'parsed', totalUnits: units.length, unitLabel: name.endsWith('.pdf') ? 'page' : 'lines', readUnit, close };
  extraction.open.mockResolvedValue(opened);
  const provider: CloudLibrarySourceProvider & { scope: string } = { scope: 'account-scope', resourceIdentity: () => 'resource:account:library:item', read: vi.fn(async () => resource), list: vi.fn(async () => []), search: vi.fn(async () => ({ results: [] })), save: vi.fn(async () => undefined) };
  return { provider, opened, readUnit, close, setResource: (patch: Partial<CloudLibraryResource>) => { resource = { ...resource, ...patch }; }, input: { provider, libraryId: 'library', itemId: 'item', expectedVersionId: 'version-1' } };
}
describe('team AI explicit cloud document source', () => {
  it('reuses authorized PDF extraction and reads only the selected file without sending or modifying anything', async () => {
    const f = fixture('paper.pdf', [{ status: 'text', text: 'Page one' }, { status: 'text', text: 'Page two' }]);
    const result = await captureTeamAiSource(f.input);
    expect(result).toMatchObject({ name: 'paper.pdf', text: 'Page one\nPage two', versionId: 'version-1', truncated: false, readUnits: 2, totalUnits: 2 });
    expect(extraction.open).toHaveBeenCalledWith(expect.any(File), 'paper.pdf', undefined); expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.provider.list).not.toHaveBeenCalled(); expect(f.provider.search).not.toHaveBeenCalled(); expect(f.provider.save).not.toHaveBeenCalled();
  });
  it('uses the existing Word document extractor instead of interpreting docx binary as text', async () => {
    const f = fixture('review.docx', [{ status: 'text', text: 'Extracted Word paragraphs' }]);
    expect((await captureTeamAiSource(f.input)).text).toBe('Extracted Word paragraphs'); expect(extraction.open.mock.calls[0][1]).toBe('review.docx');
  });
  it('limits visible extracted UTF-8 text to 24 KB without splitting a character and reports truncation', async () => {
    const f = fixture('paper.pdf', [{ status: 'text', text: '你好🌌'.repeat(10000) }, { status: 'text', text: 'not read' }]);
    const result = await captureTeamAiSource(f.input); expect(new TextEncoder().encode(result.text).byteLength).toBeLessThanOrEqual(24000);
    expect(result.text).not.toContain('�'); expect(result.truncated).toBe(true); expect(f.readUnit).toHaveBeenCalledTimes(1); expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('rejects scanned or empty documents with an explicit OCR explanation', async () => {
    const f = fixture('scan.pdf', [{ status: 'empty', text: '' }, { status: 'empty', text: '' }]);
    await expect(captureTeamAiSource(f.input)).rejects.toThrow(/OCR/); expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('rejects provider resource identity, library and expected-version mismatches before extraction', async () => {
    for (const patch of [{ id: 'other-account' }, { libraryId: 'other-library' }, { itemId: 'other-item' }, { versionId: 'version-2' }]) {
      const f = fixture(); f.setResource(patch); await expect(captureTeamAiSource(f.input)).rejects.toThrow();
    }
    expect(extraction.open).not.toHaveBeenCalled();
  });
  it('rejects the version change between selection and the reusable capture read', async () => {
    const f = fixture(); const original = f.provider.read; let reads = 0;
    f.provider.read = async (...args) => { if (++reads === 2) f.setResource({ versionId: 'version-2' }); return original(...args); };
    await expect(captureTeamAiSource(f.input)).rejects.toThrow(); expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('re-verifies the source version after extraction before exposing text', async () => {
    const f = fixture(); f.readUnit.mockImplementation(async () => { f.setResource({ versionId: 'version-2' }); return { status: 'text', text: 'stale text' }; });
    await expect(captureTeamAiSource(f.input)).rejects.toThrow(); expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('rejects role or account scope changes during extraction and always closes the source', async () => {
    const f = fixture(); f.readUnit.mockImplementation(async () => { f.provider.scope = 'another-account'; return { status: 'text', text: 'private text' }; });
    await expect(captureTeamAiSource(f.input)).rejects.toThrow(); expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('does not expose partial text after an unreadable unit or a changed final role', async () => {
    const unreadable = fixture('paper.pdf', [{ status: 'text', text: 'partial text' }, { status: 'unreadable', text: '', reason: 'permission_changed' }]);
    await expect(captureTeamAiSource(unreadable.input)).rejects.toThrow(); expect(unreadable.close).toHaveBeenCalledTimes(1);
    const changed = fixture(); changed.readUnit.mockImplementation(async () => { changed.setResource({ role: 'editor' }); return { status: 'text', text: 'old-role source' }; });
    await expect(captureTeamAiSource(changed.input)).rejects.toThrow(); expect(changed.close).toHaveBeenCalledTimes(1);
  });
  it('checks the current selection again after the final authorized provider read', async () => {
    const f = fixture(); const original = f.provider.read; let reads = 0, current = true;
    f.provider.read = async (...args) => { if (++reads === 4) current = false; return original(...args); };
    await expect(captureTeamAiSource({ ...f.input, isCurrent: () => current })).rejects.toThrow(); expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('checks isCurrent after capture and preserves abort cancellation', async () => {
    const f = fixture(); let current = true; f.readUnit.mockImplementation(async () => { current = false; return { status: 'text', text: 'stale tab' }; });
    await expect(captureTeamAiSource({ ...f.input, isCurrent: () => current })).rejects.toThrow(); expect(f.close).toHaveBeenCalledTimes(1);
    vi.clearAllMocks(); const second = fixture(); const controller = new AbortController();
    second.readUnit.mockImplementation(async () => { controller.abort(); return { status: 'text', text: 'cancelled' }; });
    await expect(captureTeamAiSource({ ...second.input, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(second.close).toHaveBeenCalledTimes(1);
  });
});
