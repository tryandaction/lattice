import { describe, expect, it } from 'vitest';
import { validateChatSources } from '../chat-source-validation';
import { getAgentDocumentVersion } from '../document-source';
import type { ChatConversation } from '@/stores/ai-chat-store';
import type { TabState } from '@/types/layout';
import { SourceTestDirectory } from './fixtures/source-workspace';

describe('saved source revalidation', () => {
  it('rejects source-bearing legacy history without a revision rather than claiming it was reread', async () => {
    const conversation: ChatConversation = { id: 'c', title: 'c', createdAt: 1, messages: [{ id: 'a', role: 'assistant', timestamp: 1, content: 'old', documentContext: { workspaceKey: 'w', paths: ['a.md'] } }] };
    expect(await validateChatSources({ conversation, workspaceKey: 'w', rootHandle: null, activeTab: null })).toMatchObject({ valid: false });
  });
  it('silently excludes unverifiable legacy and other-workspace turns while a new current source is read normally', async () => {
    const conversation: ChatConversation = { id: 'c', title: 'c', createdAt: 1, messages: [
      { id: 'old-other', role: 'assistant', timestamp: 1, content: 'Old source answer', documentContext: { workspaceKey: 'other', paths: ['old.md'] } },
      { id: 'old-legacy', role: 'assistant', timestamp: 2, content: 'Legacy answer', documentContext: { workspaceKey: 'w', paths: ['paper.pdf'] } },
    ] };
    expect(await validateChatSources({ conversation, workspaceKey: 'w', rootHandle: null, activeTab: null })).toEqual({ valid: false, validMessageIds: [], notice: null });
  });

  it('reuses only the explicitly authorized file at the same revision and refuses a same-name tab', async () => {
    const file = new File(['# Verified\n\nOriginal passage'], 'a.md');
    const version = await getAgentDocumentVersion(file, 'nested/a.md');
    const conversation: ChatConversation = { id: 'c', title: 'c', createdAt: 1, messages: [{ id: 'a', role: 'assistant', timestamp: 1, content: 'old', documentContext: { workspaceKey: 'w', paths: ['nested/a.md'], snapshots: [{ workspaceKey: 'w', path: 'nested/a.md', version, sourceId: 's', kind: 'markdown', totalUnits: 1, unitLabel: 'section' }] } }] };
    const tab = { id: 't', kind: 'file', fileName: 'a.md', filePath: 'nested/a.md', fileHandle: { getFile: async () => file, queryPermission: async () => 'granted' }, isDirty: false, scrollPosition: 0 } as unknown as TabState;
    expect(await validateChatSources({ conversation, workspaceKey: 'w', rootHandle: null, activeTab: tab })).toMatchObject({ valid: true });
    expect(await validateChatSources({ conversation, workspaceKey: 'w', rootHandle: null, activeTab: { ...tab, filePath: 'other/a.md' } as TabState })).toMatchObject({ valid: false });
    expect(await validateChatSources({ conversation, workspaceKey: 'w', rootHandle: null, activeTab: { ...tab, filePath: 'other/a.md' } as TabState, openTabs: [tab] })).toMatchObject({ valid: true });
    const changed = { ...tab, fileHandle: { getFile: async () => new File(['modified'], 'a.md') } } as unknown as TabState;
    expect(await validateChatSources({ conversation, workspaceKey: 'w', rootHandle: null, activeTab: changed })).toMatchObject({ valid: false });
  });
  it('revalidates an explicitly open external file even when a different workspace root is present', async () => {
    const root = new SourceTestDirectory('workspace').handle();
    Object.assign(root, { fullPath: 'C:/workspace' });
    const file = new File(['# External authorized paper'], 'paper.md');
    const path = 'C:/separate/paper.md';
    const version = await getAgentDocumentVersion(file, path);
    const tab = { id: 'external', kind: 'file', filePath: path, fileName: 'paper.md', fileHandle: { getFile: async () => file, queryPermission: async () => 'granted' } } as unknown as TabState;
    const conversation: ChatConversation = { id: 'c', title: 'c', createdAt: 1, messages: [{ id: 'a', role: 'assistant', timestamp: 1, content: 'External discussion', documentContext: { workspaceKey: 'w', paths: [path], snapshots: [{ workspaceKey: 'w', path, version, sourceId: 'external-source', kind: 'markdown', unitLabel: 'section', totalUnits: 1 }] } }] };
    expect(await validateChatSources({ conversation, workspaceKey: 'w', rootHandle: root, activeTab: null, openTabs: [tab] })).toMatchObject({ valid: true });
    expect(await validateChatSources({ conversation, workspaceKey: 'w', rootHandle: root, activeTab: null, openTabs: [] })).toMatchObject({ valid: false });
  });
});
