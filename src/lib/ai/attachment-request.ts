import { captureChatAttachments, chatAttachmentDocumentPath, type ChatAttachmentRef, type CapturedChatAttachments } from './chat-attachments';
import type { ChatMessage } from '@/stores/ai-chat-store';
import { isTrivialQuery, isDocumentFollowup } from './request-intent';
import type { AgentDocumentSource } from './document-source';
import type { AgentSourceRead } from './source-index';
import { LATTICE_HARNESS_TOOLS, validateLatticeHarnessArgs } from './harness/lattice-tool-definitions';
import { evaluateBoundedMath } from './harness/bounded-math';
import { latestConversationDocumentContext } from './conversation-documents';
import { isCurrentDocumentReference, startsNewDocumentTopic } from './document-reference-intent';

export function requestAttachmentIds(query: string, available: readonly ChatAttachmentRef[], messages: readonly ChatMessage[]): string[] {
  const pending = available.filter(ref => ref.status === 'pending');
  if (pending.length) return pending.map(ref => ref.id);
  if (isTrivialQuery(query)) return [];
  const latestRequest = messages.findLast(message => message.role === 'user');
  if (latestRequest?.content === query && latestRequest.attachments?.length) return latestRequest.attachments.map(ref => ref.id);
  // A concrete workspace identity takes precedence over a basename shared by an upload.
  if (/@(?:folder:)?|[a-z]:[\\/]|(?:^|\s|["'`“「《])[\p{L}\p{N}_-]+[\\/][\p{L}\p{N}_ .-]+/iu.test(query)) return [];
  const named = available.filter(ref => query.includes(ref.name) || query.includes(chatAttachmentDocumentPath(ref)));
  if (named.length) return named.map(ref => ref.id);
  // A new explicitly named file is resolved by the workspace, not a past upload.
  if (/\.[a-z][a-z0-9]{0,9}(?![a-z0-9])/iu.test(query)) return [];
  if (isCurrentDocumentReference(query) || startsNewDocumentTopic(query)) return [];
  const latestContext = latestConversationDocumentContext(messages, '');
  if (latestContext?.paths.length && !latestContext.paths.some(path => path.startsWith('attachments/')) && !/附件|上传|图中|这(?:张|幅)图|\b(?:attachment|uploaded|image|picture)\b/iu.test(query)) return [];
  const attachmentRequest = messages.findLast(message => message.role === 'user' && message.attachments?.length);
  const explicitAttachment = /附件|上传|图中|这(?:张|幅)图|\b(?:attachment|uploaded|image|picture)\b/iu.test(query);
  const latestAnswerIndex = messages.findLastIndex(message => message.role === 'assistant' && !message.error && !message.isInterrupted && !message.isStreaming);
  const latestAnsweredQuestion = messages.slice(0, latestAnswerIndex).findLast(message => message.role === 'user' && !isTrivialQuery(message.content));
  if (!latestContext && latestAnsweredQuestion && attachmentRequest && latestAnsweredQuestion.id !== attachmentRequest.id && !explicitAttachment) return [];
  if (attachmentRequest && (!latestContext || latestContext.paths.some(path => path.startsWith('attachments/')))
    && /^(?:请問|请问|请)?(?:为什么|为何|如何|多少|是否|能否|解释|讲解|详细|\b(?:why|how|what|explain)\b)/iu.test(query)) {
    return attachmentRequest.attachments!.map(ref => ref.id);
  }
  if (!/附件|上传|图片|图中|这(?:张|幅)图|本文|这篇|它|继续|刚才|上面|详细解释|第.{0,4}点|\b(?:attachment|image|picture|it|its|continue|above)\b/iu.test(query)
    && !isDocumentFollowup(query, { hasDocumentContext: messages.some(message => message.attachments?.length) })) return [];
  return messages.findLast(message => message.role === 'user' && message.attachments?.length)?.attachments?.map(ref => ref.id) ?? [];
}

export async function captureRequestAttachments(input: {
  query: string; conversationId: string; available: readonly ChatAttachmentRef[]; messages: readonly ChatMessage[];
  signal: AbortSignal; isCurrent: () => boolean;
}): Promise<CapturedChatAttachments | null> {
  const ids = requestAttachmentIds(input.query, input.available, input.messages);
  return ids.length ? captureChatAttachments({ conversationId: input.conversationId, attachmentIds: ids, signal: input.signal, isCurrent: input.isCurrent }) : null;
}

async function readSource(source: AgentDocumentSource, args: Record<string, unknown>, workspaceKey: string, signal?: AbortSignal): Promise<AgentSourceRead> {
  if (args.expectedVersion && args.expectedVersion !== source.version) throw new Error('附件版本已改变，请重新读取。');
  const units = args.units as number[] | undefined ?? Array.from({ length: source.totalUnits }, (_, i) => i + 1);
  const maxChars = Math.min(Number(args.maxChars ?? 60000), 1000000), maxUnits = Math.min(Number(args.maxUnits ?? 512), 4096);
  const chunks: AgentSourceRead['chunks'] = [], readUnits: number[] = [], unreadableUnits: AgentSourceRead['unreadableUnits'] = [];
  let scannedChars = 0;
  for (const unit of [...new Set(units)].slice(0, maxUnits)) {
    signal?.throwIfAborted();
    if (scannedChars >= maxChars) break;
    const value = await source.readUnit(unit, signal);
    signal?.throwIfAborted();
    if (value.status === 'unreadable') { unreadableUnits.push({ unit, reason: value.reason ?? 'unreadable' }); continue; }
    const startOffset = (args.offsets as Record<string, number> | undefined)?.[String(unit)] ?? 0;
    if (startOffset > value.text.length) throw new Error('附件读取位置无效。');
    const text = value.text.slice(startOffset, startOffset + maxChars - scannedChars), completeUnit = startOffset === 0 && text.length === value.text.length;
    scannedChars += text.length;
    if (completeUnit) readUnits.push(unit);
    if (text) chunks.push({ sourceId: source.path, path: source.path, version: source.version, unit,
      locator: value.locator ?? `${source.path}#${source.unitLabel}=${unit}`, text, startOffset, endOffset: startOffset + text.length, completeUnit });
  }
  const pendingUnits = Array.from({ length: source.totalUnits }, (_, i) => i + 1).filter(unit => !readUnits.includes(unit));
  return { snapshot: { workspaceKey, path: source.path, sourceId: source.path, version: source.version, kind: source.kind, unitLabel: source.unitLabel, totalUnits: source.totalUnits },
    chunks, complete: !pendingUnits.length, readUnits, unreadableUnits, pendingUnits, scannedChars };
}

/** Uploaded bytes are scoped to this conversation; they never become arbitrary filesystem paths. */
export function withAttachmentTools(input: {
  runtime?: { tools?: readonly typeof LATTICE_HARNESS_TOOLS[number][]; execute(name: string, args: unknown, signal?: AbortSignal): Promise<unknown> } | null;
  sources: readonly AgentDocumentSource[]; workspaceKey: string; isCurrent: () => boolean;
}) {
  const files = new Map(input.sources.map(source => [source.path, source]));
  const tools = input.runtime?.tools ?? LATTICE_HARNESS_TOOLS.filter(tool => ['lattice.sources.list', 'lattice.sources.read', 'lattice.sources.active', 'lattice.sources.search', 'lattice.compute.evaluate'].includes(tool.name));
  return { tools, async execute(name: string, value: unknown, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    if (!input.isCurrent()) throw new Error('附件或来源会话已改变。');
    const args = validateLatticeHarnessArgs(name, value);
    const source = name === 'lattice.sources.active' ? input.sources[0] : files.get(args.path as string);
    if (source && ['lattice.sources.read', 'lattice.sources.active'].includes(name)) return readSource(source, args, input.workspaceKey, signal);
    if (input.runtime) return input.runtime.execute(name, value, signal);
    if (name === 'lattice.compute.evaluate') return evaluateBoundedMath(args.expression as string);
    if (name === 'lattice.sources.list') {
      const cursor = Number(args.cursor ?? 0), limit = Math.min(Number(args.limit ?? 100), 500), entries = input.sources.slice(cursor, cursor + limit)
        .map(source => ({ path: source.path, name: source.path.split('/').at(-1)!, sourceId: source.path, supported: true }));
      return { entries, complete: cursor + entries.length >= input.sources.length, ...(cursor + entries.length < input.sources.length ? { nextCursor: cursor + entries.length } : {}) };
    }
    if (name === 'lattice.sources.search') {
      const reads: AgentSourceRead[] = [];
      let remaining = Math.min(Number(args.maxChars ?? 180000), 1000000);
      let remainingUnits = Math.min(Number(args.maxUnits ?? 512), 4096);
      for (const source of input.sources.slice(Number(args.cursor ?? 0), Number(args.cursor ?? 0) + Math.min(Number(args.maxFiles ?? 32), 500))) {
        if (remaining < 1 || remainingUnits < 1) break;
        const result = await readSource(source, { maxChars: remaining, maxUnits: remainingUnits }, input.workspaceKey, signal);
        reads.push(result); remaining -= result.scannedChars;
        remainingUnits -= result.readUnits.length + result.unreadableUnits.length + result.chunks.filter(chunk => !chunk.completeUnit).length;
      }
      return { reads, hits: reads.flatMap(read => read.chunks.filter(chunk => chunk.text.toLocaleLowerCase().includes((args.query as string).toLocaleLowerCase()))),
        invalid: [], complete: reads.length === input.sources.length && reads.every(read => read.complete), scannedFiles: reads.length, scannedChars: reads.reduce((total, read) => total + read.scannedChars, 0) };
    }
    throw new Error('该工具需要已打开的工作区；附件仍保留在本次会话中。');
  } };
}
