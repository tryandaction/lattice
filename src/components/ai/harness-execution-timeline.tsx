'use client';

import { useState } from 'react';
import { useAiChatStore } from '@/stores/ai-chat-store';
import { useAiHarnessStore } from '@/stores/ai-harness-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useAiWorkbenchStore } from '@/stores/ai-workbench-store';
import { assertHarnessArtifactReviewScope, prepareHarnessArtifactReviewDraft } from '@/lib/ai/harness/artifact-review';
import type { HarnessEvent } from '@/lib/ai/harness/types';

const eventLabels: Record<HarnessEvent['kind'], string> = {
  connected: '已连接', session: '会话已恢复／建立', started: '开始执行', delta: '回答片段', message: '回答完成', commentary: '工作进度', 'tool-start': '工具开始', 'tool-complete': '工具完成', 'tool-call': 'Lattice 工具请求', 'file-change': '文件改动', approval: '等待审查', 'approval-resolved': '审查已回复', completed: '完成', interrupted: '已停止', error: '失败', disconnected: '已断开', notice: '执行说明',
};

export function HarnessExecutionTimeline() {
  const conversationId = useAiChatStore(state => state.activeConversationId);
  const session = useAiHarnessStore(state => conversationId ? state.sessions[conversationId] ?? null : null);
  const saved = useAiHarnessStore(state => conversationId ? state.saved[conversationId] ?? null : null);
  const approve = useAiHarnessStore(state => state.approve);
  const [artifactPath, setArtifactPath] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [writeMode, setWriteMode] = useState<'create' | 'update'>('create');
  const [reviewNotice, setReviewNotice] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  if ((!session && !saved?.events?.length) || !conversationId) return null;
  const events = session?.events ?? saved?.events ?? [];
  const visibleEvents = events.filter(event => event.kind !== 'delta' && event.kind !== 'message');
  const artifactEvents = session && ['completed', 'interrupted', 'error'].includes(session.status)
    ? events.filter(event => event.kind === 'file-change' && event.connectionId === session.connectionId && event.turnId === session.turnId && event.scratchPaths?.length)
    : [];
  const artifactPaths = [...new Set(artifactEvents.flatMap(event => event.scratchPaths ?? []))];
  const replyApproval = async (requestId: string, decision: 'accept' | 'decline' | 'cancel') => {
    setReviewNotice('');
    try { await approve(conversationId, requestId, decision); }
    catch (error) { setReviewNotice(error instanceof Error ? error.message : String(error)); }
  };
  const reviewArtifact = async () => {
    setReviewBusy(true); setReviewNotice('');
    try {
      const harness = useAiHarnessStore.getState();
      const connection = harness.connections[conversationId];
      const current = harness.sessions[conversationId];
      const workspace = useWorkspaceStore.getState();
      const path = artifactPath || artifactPaths[0];
      const event = artifactEvents.find(event => event.scratchPaths?.includes(path));
      if (!connection || !current || !workspace.rootHandle || !workspace.workspaceRootPath || !event) throw new Error('请回到草稿所属的本机任务与工作区。');
      assertHarnessArtifactReviewScope({ connection, session: current, event, path, workspacePath: workspace.workspaceRootPath });
      const artifact = await harness.readScratch(conversationId, path);
      if (useAiChatStore.getState().activeConversationId !== conversationId || useWorkspaceStore.getState().rootHandle !== workspace.rootHandle ||
        useAiHarnessStore.getState().connections[conversationId] !== connection) throw new Error('会话或工作区已变化，本次未生成审查草稿。');
      const draft = await prepareHarnessArtifactReviewDraft({ artifact, root: workspace.rootHandle,
        workspaceKey: workspace.workspaceIdentity?.workspaceKey ?? workspace.workspaceRootPath ?? workspace.rootHandle.name,
        targetPath: targetPath.trim() || 'AI Drafts/' + artifact.fileName, mode: writeMode });
      const latest = useAiHarnessStore.getState().sessions[conversationId];
      if (!latest || useAiChatStore.getState().activeConversationId !== conversationId || useWorkspaceStore.getState().rootHandle !== workspace.rootHandle) throw new Error('会话或工作区已变化，本次未生成审查草稿。');
      assertHarnessArtifactReviewScope({ connection, session: latest, event, path, workspacePath: useWorkspaceStore.getState().workspaceRootPath ?? '' });
      useAiWorkbenchStore.getState().createDraft(draft);
      setReviewNotice('完整草稿已进入 AI 工作台，尚未写入正式工作区；请展开检查器审查内容或差异后应用。');
    } catch (error) { setReviewNotice(error instanceof Error ? error.message : String(error)); }
    finally { setReviewBusy(false); }
  };
  return <div className="max-h-48 overflow-y-auto border-t border-border px-3 py-2 text-[11px]" data-testid="harness-execution-timeline">
    <details open={session?.status === 'waiting-approval'}>
      <summary className="cursor-pointer">本机执行 · {session?.status ?? '已保存的历史记录'} · {visibleEvents.length} 项事件</summary>
      <p className="my-1 text-muted-foreground">以下为实际运行事件与公开摘要；工具未提供推理摘要时不展示内部思考。</p>
      <ol className="max-h-40 space-y-1 overflow-y-auto">{visibleEvents.map(event => <li key={`${event.connectionId}:${event.sequence}`} className="break-words" data-event-kind={event.kind}>
        <time className="mr-2 text-muted-foreground">{new Date(event.timestamp).toLocaleTimeString('zh-CN')}</time>{eventLabels[event.kind]}{event.toolCall?.tool ? ` · ${event.toolCall.tool}` : ''}{event.text ? `：${event.text}` : ''}{event.itemId ? <span className="ml-1 text-muted-foreground">[{event.itemId}]</span> : null}
      </li>)}</ol>
    </details>
    {artifactPaths.length > 0 && <details className="mt-2 space-y-1" data-testid="harness-artifact-review">
      <summary className="cursor-pointer">审查隔离草稿 · {artifactPaths.length} 个文件</summary>
      <label>本机隔离草稿<select className="ml-1 max-w-full rounded border" value={artifactPath || artifactPaths[0]} onChange={event => setArtifactPath(event.target.value)}>
        {artifactPaths.map(path => <option key={path} value={path}>{path}</option>)}
      </select></label>
      <label className="block">工作区目标<input className="ml-1 rounded border px-1" aria-label="草稿工作区目标" value={targetPath} onChange={event => setTargetPath(event.target.value)} placeholder="AI Drafts/文件名" /></label>
      <select aria-label="草稿写入方式" value={writeMode} onChange={event => setWriteMode(event.target.value as 'create' | 'update')}><option value="create">创建</option><option value="update">更新并审查差异</option></select>
      <button className="ml-2 rounded border px-2 py-1" disabled={reviewBusy} onClick={() => void reviewArtifact()}>读取完整草稿并进入审查</button>
    </details>}
    {reviewNotice && <p role="status" className="mt-1">{reviewNotice}</p>}
    {(session?.approvals ?? []).map(approval => <div key={approval.requestId} className="mt-2 rounded border border-amber-500/40 p-2" data-testid="harness-approval">
      <p className="font-medium">审查具体操作：{approval.action}</p>
      <p className="break-all">{approval.paths.join('、')}</p>
      {approval.diff ? <pre className="my-1 max-h-40 overflow-auto whitespace-pre-wrap">{approval.diff}</pre> : null}
      {!approval.canAccept ? <p>此操作超出草稿写入边界，不能批准。</p> : null}
      <div className="mt-2 flex gap-2">
        {approval.canAccept ? <button type="button" className="rounded border px-2 py-1" onClick={() => void replyApproval(approval.requestId, 'accept')}>允许写入隔离草稿</button> : null}
        <button type="button" className="rounded border px-2 py-1" onClick={() => void replyApproval(approval.requestId, 'decline')}>拒绝</button>
        <button type="button" className="rounded border px-2 py-1" onClick={() => void replyApproval(approval.requestId, 'cancel')}>取消任务</button>
      </div>
    </div>)}
    {session?.error ? <p role="alert" className="mt-1 text-destructive">{session.error}</p> : null}
  </div>;
}
