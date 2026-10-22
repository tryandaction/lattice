import type { AgentSourceSnapshot } from './source-index';
import type { CloudAgentSourceSnapshot } from './cloud-source';
import type { EvidenceRef } from './types';
import { canonicalCitationPath } from './citation-contract';
import { isAgentDocumentPath, isWorkspaceInstructionPath } from './document-source';
import { isDocumentFollowup, isTrivialQuery } from './request-intent';
import { hasNamedDocumentReference, isCurrentDocumentReference, isPreviousDocumentReference, startsNewDocumentTopic, requestsIndependentAnswer } from './document-reference-intent';

export interface ConversationDocumentContext {
  workspaceKey: string;
  paths: string[];
  snapshots?: AgentSourceSnapshot[];
  cloudSnapshots?: CloudAgentSourceSnapshot[];
}

interface DocumentIdentityMessage {
  role?: string; content?: string; documentContext?: ConversationDocumentContext; isStreaming?: boolean;
  error?: string; isInterrupted?: boolean; evidenceRefs?: EvidenceRef[]; promptContext?: { evidenceRefs: EvidenceRef[] };
  legacySourceWorkspaceKey?: string | null;
}

/** Historical structured references provide identities only; no historical prose/quote becomes evidence. */
export function messageDocumentContext(message: DocumentIdentityMessage, legacyWorkspaceKey: string): ConversationDocumentContext | undefined {
  if (message.isStreaming || message.error || message.isInterrupted) return undefined;
  if (message.documentContext?.paths.length) return message.documentContext;
  const sourceWorkspaceKey = message.legacySourceWorkspaceKey !== undefined ? message.legacySourceWorkspaceKey : legacyWorkspaceKey;
  if (!sourceWorkspaceKey || sourceWorkspaceKey.startsWith('cloud:')) return undefined;
  const paths = [...(message.evidenceRefs ?? []), ...(message.promptContext?.evidenceRefs ?? [])].flatMap(ref => {
    if (ref.cloudIdentity || !['file', 'pdf_page', 'pdf_annotation', 'code_line', 'notebook_cell'].includes(ref.kind)
      || /^(?!file:)[a-z][a-z\d+.-]*:/iu.test(ref.locator) && !/^[a-z]:[\\/]/iu.test(ref.locator)) return [];
    const path = canonicalCitationPath(ref.locator);
    return path && isAgentDocumentPath(path) && !isWorkspaceInstructionPath(path) && !/[\u0000-\u001f]/u.test(path) ? [path] : [];
  });
  return paths.length ? { workspaceKey: sourceWorkspaceKey, paths: [...new Set(paths)] } : undefined;
}

/** Stop at the latest substantive answered topic rather than resurrecting a document from an older topic. */
export function latestConversationDocumentContext(messages: readonly DocumentIdentityMessage[], legacyWorkspaceKey: string): ConversationDocumentContext | undefined {
  let subject: ConversationDocumentContext | undefined;
  let question = '';
  for (const message of messages) {
    if (message.role === 'user') { question = message.content ?? ''; continue; }
    if (message.role !== 'assistant' || message.isStreaming || message.error || message.isInterrupted || isTrivialQuery(question)) continue;
    const current = isCurrentDocumentReference(question);
    if (requestsIndependentAnswer(question)) { subject = undefined; continue; }
    const named = hasNamedDocumentReference(question);
    const newTopic = startsNewDocumentTopic(question);
    if (newTopic && !current && !named) { subject = undefined; continue; }
    const followup = !current && !named && !newTopic && subject && (isPreviousDocumentReference(question)
      || isDocumentFollowup(question, { hasDocumentContext: true })
      || /^(?:请问\s*)?(?:为什么|为何|如何|多少|是否|能否|\b(?:why|how|what)\b)/iu.test(question));
    // Tools may retrieve secondary notes/rules; their output must not silently replace the requested subject.
    if (!followup) subject = messageDocumentContext(message, legacyWorkspaceKey);
  }
  return subject;
}

export function conversationDocumentPaths(
  messages: ReadonlyArray<DocumentIdentityMessage>,
  workspaceKey: string | null | undefined,
  activePath?: string,
  legacyWorkspaceKey = '',
): string[] {
  const paths = [...messages].reverse().map(message => messageDocumentContext(message, legacyWorkspaceKey))
    .filter(context => context?.workspaceKey === (workspaceKey ?? ''))
    .flatMap(context => context?.paths ?? [])
    .filter(path => typeof path === 'string' && path.trim() && !/[\u0000-\u001f]/u.test(path));
  if (activePath) paths.push(activePath);
  return [...new Set(paths)];
}

export function availableDocumentNotice(paths?: string[]): string {
  if (!paths?.length) return '';
  return 'Conversation document identities for re-location (file identity only, not quotation evidence or verified current access): '
    + JSON.stringify(paths)
    + '. Re-locate the requested source inside the authorized workspace and read its current bytes before making claims. If the source is unavailable, report that limitation. Answer only the latest user request. A greeting does not ask you to resume a previous failed task.';
}
