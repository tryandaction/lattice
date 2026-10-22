import { expect, it } from 'vitest';
import { captureCloudAgentDocumentSources, validateCloudAgentSourceSnapshots } from '../cloud-source';
import { buildCitationContract, citationNavigationHref, classifyStrictAiLink } from '../citation-contract';
import type { CloudLibraryResource, CloudLibrarySourceProvider } from '@/lib/shared-library/source-provider';
const resource = (): CloudLibraryResource => ({ id: 'lattice-cloud:connection:user:library:item', libraryId: 'library', itemId: 'item', versionId: 'rev-1', name: 'note.md', kind: 'markdown',
  path: 'cloud://display-only/note.md', role: 'viewer', content: { kind: 'text', text: '# Note\n\nVerified source content.', mimeType: 'text/markdown', updatedAt: 'today' } });
function provider(current: CloudLibraryResource): CloudLibrarySourceProvider {
  return { read: async () => current, list: async () => [], search: async () => ({ results: [] }), save: async () => { throw new Error('No writes'); } };
}
it('captures a fresh authorized cloud revision and uses real library links without filesystem paths', async () => {
  const current = resource(); const captured = await captureCloudAgentDocumentSources({ provider: provider(current), resource: current });
  expect(captured.sources[0].path).toBe(current.id);
  const unit = await captured.sources[0].readUnit(2);
  expect(unit.text).toBe('Verified source content.');
  const ref = { kind: 'file' as const, label: current.name, locator: unit.locator!, cloudIdentity: captured.snapshots[0].cloudIdentity, anchor: { lineStart: 3, snippet: unit.text }, preview: unit.text };
  const citation = buildCitationContract(ref);
  expect(citation.navigationTarget).toBeNull();
  expect(citationNavigationHref(citation)).toBe('/library?library=library&item=item#line=3');
  expect(classifyStrictAiLink('citation:' + citation.stableId, [citation]).kind).toBe('citation');
  expect(citation.canonicalPath).toBe(current.id);
});
it('invalidates removed providers, changed versions, account identities and denied reads', async () => {
  const current = resource(), initial = provider(current);
  const captured = await captureCloudAgentDocumentSources({ provider: initial, resource: current });
  expect((await validateCloudAgentSourceSnapshots({ provider: null, snapshots: captured.snapshots })).invalid[0].reason).toBe('permission');
  current.versionId = 'rev-2';
  expect((await validateCloudAgentSourceSnapshots({ provider: initial, snapshots: captured.snapshots })).invalid[0].reason).toBe('changed');
  current.id = 'lattice-cloud:connection:another:library:item';
  expect((await validateCloudAgentSourceSnapshots({ provider: initial, snapshots: captured.snapshots })).invalid[0].reason).toBe('scope');
  initial.read = async () => { throw new Error('permission denied'); };
  expect((await validateCloudAgentSourceSnapshots({ provider: initial, snapshots: captured.snapshots })).invalid[0].reason).toBe('permission');
});
it('invalidates a provider scope change even when its resource ids stay the same', async () => {
  const current = resource(), first = { ...provider(current), scope: 'account-A' };
  const captured = await captureCloudAgentDocumentSources({ provider: first, resource: current });
  expect((await validateCloudAgentSourceSnapshots({ provider: { ...first, scope: 'account-B' }, snapshots: captured.snapshots })).invalid[0].reason).toBe('scope');
});
it('rejects scope mutation on the same provider before returning cached extracted text', async () => {
  const current = resource(), initial = { ...provider(current), scope: 'account-A' };
  const captured = await captureCloudAgentDocumentSources({ provider: initial, resource: current });
  initial.scope = 'account-B';
  await expect(captured.sources[0].readUnit(1)).rejects.toThrow(/scope/);
  await captured.sources[0].close();
});
