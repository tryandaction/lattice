import type { HarnessConnection, HarnessConversationSession, HarnessEvent, HarnessScratchArtifact } from './types';
import type { AiDraftArtifact } from '../types';
import { normalizeWorkspaceWritePath } from '../workbench-actions';
import { resolveAuthorizedDocumentHandle } from '../document-source-capture';
import { validatePdfChildContent } from '../lattice-skills/pdf-child-skill';

export function assertHarnessArtifactReviewScope(input: {
  connection: HarnessConnection; session: HarnessConversationSession; event: HarnessEvent;
  path: string; workspacePath: string;
}) {
  const canonical = (path: string) => {
    const value = path.replace(/\\/g, '/').replace(/^\/\/\?\//, '').replace(/\/+$/, '');
    return /^[a-z]:\//i.test(value) || value.startsWith('//') ? value.toLowerCase() : value;
  };
  if (canonical(input.workspacePath) !== canonical(input.connection.workspace) ||
    input.session.connectionId !== input.connection.connectionId || input.event.connectionId !== input.connection.connectionId ||
    input.event.conversationId !== input.connection.conversationId || input.event.sessionId !== input.session.sessionId ||
    input.event.turnId !== input.session.turnId || input.event.kind !== 'file-change' || !input.event.scratchPaths?.includes(input.path) ||
    !['completed', 'interrupted', 'error'].includes(input.session.status)) {
    throw new Error('草稿不属于当前已结束的本机任务或当前工作区，请重新连接并核对文件。');
  }
}

export async function prepareHarnessArtifactReviewDraft(input: {
  artifact: HarnessScratchArtifact; root: FileSystemDirectoryHandle; workspaceKey: string;
  targetPath: string; mode: 'create' | 'update';
}): Promise<Omit<AiDraftArtifact, 'id' | 'createdAt' | 'status'>> {
  validatePdfChildContent(input.artifact.fileName, input.artifact.content);
  if (!input.artifact.revision || new TextEncoder().encode(input.artifact.content).byteLength !== input.artifact.byteLength) {
    throw new Error('本机草稿读取缺少有效版本或完整字节内容。');
  }
  const targetPath = normalizeWorkspaceWritePath(input.root, input.targetPath);
  validatePdfChildContent(targetPath.split('/').at(-1) ?? '', input.artifact.content);
  let original: string | undefined;
  try {
    const file = await (await resolveAuthorizedDocumentHandle(input.root, targetPath)).getFile();
    if (file.size > 1024 * 1024) throw new Error('更新目标超过审查内容预算，请缩小目标范围。');
    original = await file.text();
  }
  catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
  if (input.mode === 'create' && original !== undefined) throw new Error('目标文件已存在，请明确选择更新并审查差异。');
  if (input.mode === 'update' && original === undefined) throw new Error('更新目标不存在，请选择创建。');
  return { type: 'code_explainer', title: input.artifact.fileName, content: input.artifact.content, contentFormat: 'raw',
    sourceRefs: [], targetPath, writeMode: input.mode,
    fileChange: { targetPath, expectedContent: original, workspaceKey: input.workspaceKey } };
}
