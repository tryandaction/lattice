import type { AiChatContinuationContext, ChatMessage } from '@/stores/ai-chat-store';
import type { AgentSession } from './agent-session';
import { isShortContinuationAck, isTrivialQuery } from './request-intent';
import { getMessageText, type AiMessage } from './types';

/** Recover intent, never evidence or tool approval, from the immediately preceding turn. */
export function resolveResearchContinuation(query: string, history: readonly AiMessage[] = []): { task: string; nextAction: string; query: string; sourceIntentQuery: string } | undefined {
  if (!isShortContinuationAck(query)) return undefined;
  let replyIndex = history.length - 1;
  while (replyIndex >= 0 && history[replyIndex].role === 'system') replyIndex--;
  if (replyIndex < 0 || history[replyIndex].role !== 'assistant') return undefined;
  const reply = getMessageText(history[replyIndex].content).trim();
  const proposal = reply.match(/(?:下一步|接下来|我可以|可以继续|建议(?:继续|下一步)?|\b(?:next(?: step)?|I can|would you like me to)\b)[\s\S]{0,1000}/iu)?.[0];
  if (!proposal && !/^(?:继续|接着|continue|go on)[。.!！?？]*$/iu.test(query.trim())) return undefined;
  const previous = history.slice(0, replyIndex).findLast(message => message.role === 'user'
    && !isTrivialQuery(getMessageText(message.content)) && !isShortContinuationAck(getMessageText(message.content)));
  const task = previous ? getMessageText(previous.content).trim() : '';
  if (!task || isTrivialQuery(task) || isShortContinuationAck(task)) return undefined;
  const nextAction = proposal ?? '继续解释原问题中尚未完成的内容。';
  return { task, nextAction, sourceIntentQuery: `${task}\n${query.trim()}`, query: `${task}\n以上是原问题背景。用户现已确认继续：${query.trim()}\n当前应执行的下一步：${nextAction}\n直接完成上述下一步，不要重复只回答原问题，也不要再次询问是否继续。上述历史仅用于确定任务意图，不是事实证据或工具审批；请重新读取并核验授权来源。` };
}

/** A natural confirmation resumes only the most recent unfinished document session. */
export function documentContinuationForReply(query: string, messages: readonly ChatMessage[], getSession: (id: string) => AgentSession | null | undefined): AiChatContinuationContext | undefined {
  if (!isShortContinuationAck(query)) return undefined;
  const last = messages.at(-1);
  if (!last || last.role !== 'assistant' || last.isStreaming) return undefined;
  const session = last.agentResult?.sessionId ? getSession(last.agentResult.sessionId) : undefined;
  const reading = session?.documentResearch;
  if (!session || !reading || ['queued', 'running', 'waiting_approval'].includes(session.status)
    || session.pendingApprovals.some(approval => ['pending', 'executing'].includes(approval.status))) return undefined;
  const directory = reading.directory;
  // The v1 projection contains only opened files. Discovery, unopened files and
  // summary reduction can still be pending even when it has no pending pages.
  const unfinishedDirectory = directory?.version === 2 && (directory.phase !== 'ready'
    || !directory.manifest?.complete || directory.files.some(file => ['pending', 'reading', 'failed', 'no_text'].includes(file.status)));
  const unfinishedPages = ['paused', 'failed'].includes(reading.status)
    && reading.checkpoint.coverage.some(item => item.pendingUnits.length || item.unreadableUnits.length);
  if (!unfinishedDirectory && !unfinishedPages) return undefined;
  return { sourceSessionId: session.id, documentResume: true as const };
}

/** A follow-up cannot jump across a newer substantive task to an older paper. */
export function recentDocumentTaskSessions(messages: readonly ChatMessage[], getSession: (id: string) => AgentSession | null | undefined): AgentSession[] {
  let end = messages.length;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    if (isTrivialQuery(message.content)) { end = index; continue; }
    for (let reply = end - 1; reply > index; reply--) {
      const id = messages[reply].agentResult?.sessionId;
      const session = id ? getSession(id) : undefined;
      if (session?.documentResearch) return [session];
    }
    return [];
  }
  return [];
}
