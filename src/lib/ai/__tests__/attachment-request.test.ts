import { expect, it, vi } from 'vitest';
import { requestAttachmentIds, withAttachmentTools } from '../attachment-request';
import type { ChatAttachmentRef } from '../chat-attachments';
import type { ChatMessage } from '@/stores/ai-chat-store';
const ref: ChatAttachmentRef = { id: 'uploaded', conversationId: 'conversation', name: 'paper.pdf', kind: 'document', status: 'sent', mimeType: 'application/pdf', size: 10, createdAt: 1, lastModified: 1 };
const path = 'attachments/uploaded/paper.pdf';
const messages: ChatMessage[] = [
  { id: 'user', role: 'user', timestamp: 1, content: '分析这篇', attachments: [ref] },
  { id: 'answer', role: 'assistant', timestamp: 2, content: '第一点假设', documentContext: { workspaceKey: '', paths: [path] } },
];
it('retains attachments for retries and scientific follow-up questions while exact workspace identities take precedence', () => {
  expect(requestAttachmentIds('分析这篇', [ref], messages)).toEqual(['uploaded']);
  expect(requestAttachmentIds('为什么需要这个假设？', [ref], messages)).toEqual(['uploaded']);
  expect(requestAttachmentIds('请详细解释第二点', [ref], messages)).toEqual(['uploaded']);
  expect(requestAttachmentIds('总结 @papers/paper.pdf', [ref], messages)).toEqual([]);
  expect(requestAttachmentIds('总结 C:/library/paper.pdf', [ref], messages)).toEqual([]);
  expect(requestAttachmentIds('hi', [ref], messages)).toEqual([]);
});
it('retains both document and image inputs for a mixed-upload follow-up', () => {
  const image: ChatAttachmentRef = { ...ref, id: 'figure', name: 'figure.png', kind: 'image', mimeType: 'image/png' };
  const history = [{ ...messages[0], attachments: [ref, image] }, messages[1]];
  expect(requestAttachmentIds('为什么需要这个假设？', [ref, image], history)).toEqual(['uploaded', 'figure']);
  expect(requestAttachmentIds('为什么？', [image], [{ ...messages[0], attachments: [image] }, { ...messages[1], documentContext: undefined }])).toEqual(['figure']);
});
it.each(['本文单比特门实现方案详细整理讲解', '继续详细解释', '解释当前打开的文件'])('does not resurrect an earlier upload after a workspace paper became the subject: %s', query => {
  const history: ChatMessage[] = [...messages, { id: 'new-user', role: 'user', timestamp: 3, content: '阅读 workspace.md' },
    { id: 'new-answer', role: 'assistant', timestamp: 4, content: 'Current paper', documentContext: { workspaceKey: 'A', paths: ['workspace.md'] } }];
  expect(requestAttachmentIds(query, [ref], history)).toEqual([]);
});
it('does not resurrect uploads across a newer general topic', () => {
  const history: ChatMessage[] = [...messages, { id: 'new-user', role: 'user', timestamp: 3, content: '换个话题，解释 Python 装饰器' },
    { id: 'new-answer', role: 'assistant', timestamp: 4, content: 'Decorator explanation' }];
  expect(requestAttachmentIds('继续详细解释', [ref], history)).toEqual([]);
});
it('reads uploaded evidence without a workspace and refuses an unrelated filesystem path', async () => {
  const source = { path, version: 'v1', kind: 'pdf' as const, unitLabel: 'page' as const, totalUnits: 2,
    readUnit: vi.fn(async (unit: number) => ({ status: 'text' as const, text: `Synthetic page ${unit}`, locator: `${path}#page=${unit}` })), close: async () => {} };
  const tools = withAttachmentTools({ sources: [source], workspaceKey: '', isCurrent: () => true });
  const result = await tools.execute('lattice.sources.read', { path, maxUnits: 1 });
  expect(result).toMatchObject({ chunks: [{ locator: `${path}#page=1` }], pendingUnits: [2], complete: false });
  await expect(tools.execute('lattice.sources.read', { path: 'private.txt' })).rejects.toThrow(/工作区/u);
});
it('requires exact current conversation scope before reading attachments', async () => {
  const tools = withAttachmentTools({ sources: [], workspaceKey: '', isCurrent: () => false });
  await expect(tools.execute('lattice.sources.list', {})).rejects.toThrow(/会话/u);
});
