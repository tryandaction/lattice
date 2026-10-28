import { describe, expect, it } from 'vitest';
import { bindConversationSources } from '../conversation-source-binding';
import type { ChatMessage } from '@/stores/ai-chat-store';

const local = { workspaceKey: 'local', paths: ['first.md'] };
const cloud = { workspaceKey: 'cloud:lib', paths: ['opaque-cloud'], cloudSnapshots: [{ path: 'opaque-cloud', providerScope: 'original-account', cloudIdentity: { name: 'cloud.md' } }] } as ChatMessage['documentContext'];
function bind(query: string, prior = cloud, activeCloud = false) {
  return bindConversationSources({ query, messages: [{ id: 'a', role: 'assistant', content: 'previous result', timestamp: 1, documentContext: prior }], localWorkspaceKey: 'local', activeCloud, activeCloudLibraryId: activeCloud ? 'lib' : undefined, providerScope: 'current-account' });
}
describe('conversation request source binding', () => {
  it('keeps an explicit cloud draft bound to its original account after connection switching', () => {
    expect(bindConversationSources({ query: '@cloud:lib:paper Explain it', messages: [], localWorkspaceKey: 'local', activeCloud: false,
      providerScope: 'account-b', conversationWorkspace: { workspaceKey: 'cloud:lib', libraryId: 'lib', permissionScope: 'account-a' } }))
      .toEqual({ kind: 'cloud', workspaceKey: 'cloud:lib', providerScope: 'account-a' });
  });

  it('keeps an independent explanation in the current storage instead of a prior cloud source', () => {
    expect(bind('不结合这篇论文，为什么会出现这种相变？')).toEqual({ kind: 'local', workspaceKey: 'local' });
  });
  it('binds a legacy prompt source identity while leaving historical text unverified', () => {
    const messages: ChatMessage[] = [{ id: 'u', role: 'user', content: 'Explain Senoo 2026', timestamp: 1 },
      { id: 'a', role: 'assistant', content: 'OLD ANSWER', timestamp: 2, promptContext: { nodes: [], prompt: '', truncated: false,
        evidenceRefs: [{ kind: 'pdf_page', label: 'Senoo 2026', locator: 'papers/Senoo%202026.pdf#page=61' }] } }];
    expect(bindConversationSources({ query: '本文单比特门详细讲解', messages, legacyWorkspaceKey: 'A', localWorkspaceKey: 'A', activeCloud: false, activeLocalPath: 'AGENTS.md' }))
      .toEqual({ kind: 'local', workspaceKey: 'A', providerScope: undefined, referentPaths: ['papers/Senoo 2026.pdf'], relocateReferents: true });
    expect(messages[1].documentContext).toBeUndefined();
  });
  it.each(['本文中的“单比特门”详细讲解', '本文当前方法的局限是什么？', 'Explain the current limitations of this paper'])('retains a cloud subject for quoted terms and current scientific attributes: %s', query => {
    expect(bind(query)).toMatchObject({ kind: 'cloud', workspaceKey: 'cloud:lib', providerScope: 'original-account' });
  });
  it.each(['换个话题，分析另一篇论文', 'Now explain a different paper'])('resets the prior storage subject for a different paper: %s', query => {
    expect(bind(query)).toEqual({ kind: 'local', workspaceKey: 'local' });
  });
  it('keeps both directions tied to the discussed document instead of the active storage', () => {
    expect(bind('它的结果是什么？')).toMatchObject({ kind: 'cloud', workspaceKey: 'cloud:lib', providerScope: 'original-account' });
    expect(bind('它的结果是什么？', local, true)).toMatchObject({ kind: 'local', workspaceKey: 'local' });
  });
  it('uses explicit current-file and named other-file requests in the active storage', () => {
    expect(bind('解释当前文件')).toMatchObject({ kind: 'local' });
    expect(bind('解释当前文件', local, true)).toMatchObject({ kind: 'cloud', providerScope: 'current-account' });
    expect(bind('总结 second.md')).toMatchObject({ kind: 'local' });
    expect(bind('总结 other.md', local, true)).toMatchObject({ kind: 'cloud' });
  });
  it('recognizes named prior files and explicit source mentions across the storage boundary', () => {
    expect(bind('总结 cloud.md')).toMatchObject({ kind: 'cloud', providerScope: 'original-account' });
    expect(bind('总结 first.md', local, true)).toMatchObject({ kind: 'local' });
    expect(bind('@first.md 解释它', cloud, true)).toMatchObject({ kind: 'local' });
    expect(bind('@cloud:lib:id 解释它', local)).toMatchObject({ kind: 'cloud', providerScope: 'current-account' });
  });
  it('does not recover an older document across a new unrelated topic', () => {
    const messages: ChatMessage[] = [ { id: 'a', role: 'assistant', content: 'paper', timestamp: 1, documentContext: cloud }, { id: 'u', role: 'user', content: '解释 Python 装饰器', timestamp: 2 }, { id: 'b', role: 'assistant', content: 'decorators', timestamp: 3 } ];
    expect(bindConversationSources({ query: '继续详细解释', messages, localWorkspaceKey: 'local', activeCloud: false })).toMatchObject({ kind: 'local' });
  });
});
