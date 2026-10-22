import { expect, it } from 'vitest';
import { prepareHarnessArtifactReviewDraft, assertHarnessArtifactReviewScope } from '../artifact-review';
import { SourceTestDirectory, SourceTestFile } from '../../__tests__/fixtures/source-workspace';
import type { HarnessConnection, HarnessConversationSession, HarnessEvent } from '../types';

it('prepares complete scratch content and exact existing target for concrete Workbench review without writing', async () => {
  const root = new SourceTestDirectory('root');
  const old = root.add(new SourceTestFile('note.md', '# Original'));
  const content = '# Revised\n\n|a|b|\n|---|---|\n|1|2|\n\n$$E=x^2$$';
  const artifact = { path: 'C:/scratch/note.md', fileName: 'note.md', content, byteLength: new TextEncoder().encode(content).length, revision: 'native-hash' };
  const draft = await prepareHarnessArtifactReviewDraft({ artifact, root: root.handle(), workspaceKey: 'A', targetPath: 'note.md', mode: 'update' });
  expect(draft).toMatchObject({ content, contentFormat: 'raw', fileChange: { expectedContent: '# Original', workspaceKey: 'A' } });
  expect(old.content).toBe('# Original'); expect(old.writes).toBe(0);
  await expect(prepareHarnessArtifactReviewDraft({ artifact, root: root.handle(), workspaceKey: 'A', targetPath: 'note.md', mode: 'create' })).rejects.toThrow(/存在/);
  await expect(prepareHarnessArtifactReviewDraft({ artifact, root: root.handle(), workspaceKey: 'A', targetPath: '../escape.md', mode: 'create' })).rejects.toThrow();
});
it('rejects scratch import from another workspace, conversation, turn or running session', () => {
  const connection = { connectionId: 'c', conversationId: 'a', workspace: 'C:/Workspace' } as HarnessConnection;
  const session = { connectionId: 'c', sessionId: 's', turnId: 't', status: 'completed' } as HarnessConversationSession;
  const event = { kind: 'file-change', connectionId: 'c', conversationId: 'a', sessionId: 's', turnId: 't', scratchPaths: ['C:/scratch/note.md'] } as HarnessEvent;
  const input = { connection, session, event, path: 'C:/scratch/note.md', workspacePath: 'c:/workspace' };
  expect(() => assertHarnessArtifactReviewScope(input)).not.toThrow();
  expect(() => assertHarnessArtifactReviewScope({ ...input, workspacePath: 'C:/Other' })).toThrow();
  expect(() => assertHarnessArtifactReviewScope({ ...input, event: { ...event, conversationId: 'b' } })).toThrow();
  expect(() => assertHarnessArtifactReviewScope({ ...input, session: { ...session, status: 'running' } })).toThrow();
});
