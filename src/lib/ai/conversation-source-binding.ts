import type { ChatMessage } from '@/stores/ai-chat-store';
import { parseCloudSourceSelections } from './cloud-source';
import { parseSourceSelections } from './source-index';
import { isDocumentFollowup, isTrivialQuery } from './request-intent';
import { isAgentDocumentPath } from './document-source';
import { latestConversationDocumentContext, messageDocumentContext } from './conversation-documents';
import { hasNamedDocumentReference, isCurrentDocumentReference, isPreviousDocumentReference, startsNewDocumentTopic, requestsIndependentAnswer, documentSourceReferenceQuery } from './document-reference-intent';
import { resolveResearchContinuation } from './conversation-task-context';

export interface ConversationSourceBinding { kind: 'local' | 'cloud'; workspaceKey: string; providerScope?: string; referentPaths?: readonly string[]; relocateReferents?: boolean; legacyWorkspaceKey?: string }

/** Select the request's storage boundary once; tab focus is only the explicit-current/default source. */
export function bindConversationSources(input: {
  query: string; messages: readonly ChatMessage[]; localWorkspaceKey: string;
  activeCloud: boolean; activeCloudLibraryId?: string; providerScope?: string;
  activeLocalPath?: string; activeCloudName?: string;
  legacyWorkspaceKey?: string;
}): ConversationSourceBinding {
  const active: ConversationSourceBinding = input.activeCloud
    ? { kind: 'cloud', workspaceKey: `cloud:${input.activeCloudLibraryId ?? 'unselected'}`, providerScope: input.providerScope }
    : { kind: 'local', workspaceKey: input.localWorkspaceKey };
  const cloudSelections = parseCloudSourceSelections(input.query);
  if (cloudSelections.length) return { kind: 'cloud', workspaceKey: `cloud:${cloudSelections[0].libraryId}`, providerScope: input.providerScope };
  if (parseSourceSelections(input.query).length) return { kind: 'local', workspaceKey: input.localWorkspaceKey };
  input = { ...input, query: documentSourceReferenceQuery(input.query) };
  // A pasted local path is a request to resolve that exact local source, not
  // a follow-up on whichever cloud document was previously discussed.
  if (/(?:^|[\s"'`“「《])(?:[a-z]:[\\/]|\/(?!\/)[\p{L}\p{N}_])/iu.test(input.query.replace(/\bhttps?:\/\/\S+/giu, ''))) return { kind: 'local', workspaceKey: input.localWorkspaceKey };
  const continuation = resolveResearchContinuation(input.query, input.messages);
  if ((!continuation && isTrivialQuery(input.query)) || startsNewDocumentTopic(input.query) || requestsIndependentAnswer(input.query)) return active;
  const current = isCurrentDocumentReference(input.query);
  if (current) return active;
  const activeName = input.activeCloud ? input.activeCloudName : input.activeLocalPath?.split(/[\\/]/u).at(-1);
  if (activeName && input.query.includes(activeName)) {
    const start = input.query.indexOf(activeName), before = input.query[start - 1] ?? '';
    if (!/[a-z0-9_./\\-]/iu.test(before)) return active;
  }
  const contexts = input.messages.map(message => ({ ...message, documentContext: messageDocumentContext(message, input.legacyWorkspaceKey ?? '') }))
    .reverse().filter(message => message.role === 'assistant' && message.documentContext?.paths.length);
  const prior = latestConversationDocumentContext(input.messages, input.legacyWorkspaceKey ?? '');
  if (!prior) return active;
  const fromContext = (context: NonNullable<ChatMessage['documentContext']>): ConversationSourceBinding => ({
    kind: context.workspaceKey.startsWith('cloud:') ? 'cloud' : 'local', workspaceKey: context.workspaceKey,
    providerScope: context.cloudSnapshots?.[0]?.providerScope, referentPaths: context.paths,
    ...(!context.workspaceKey.startsWith('cloud:') && !context.snapshots?.length ? { relocateReferents: true } : {}),
  });
  const filename = [...input.query.matchAll(/[\p{L}\p{N}_./\\%+()~-]+\.[a-z][a-z0-9]{0,9}(?![a-z0-9])/giu)].some(match => isAgentDocumentPath(match[0]));
  if (filename || hasNamedDocumentReference(input.query)) {
    const named = contexts.find(message => message.documentContext?.paths.some(path => {
      const cloudName = message.documentContext?.cloudSnapshots?.find(snapshot => snapshot.path === path)?.cloudIdentity.name;
      const name = cloudName ?? path.split(/[\\/]/u).at(-1)!;
      return input.query.includes(name);
    }));
    return named?.documentContext ? fromContext(named.documentContext) : active;
  }
  const latestQuestion = input.messages.findLastIndex(message => message.role === 'user' && !isTrivialQuery(message.content));
  if (latestQuestion >= 0 && !input.messages.slice(latestQuestion + 1).some(message => messageDocumentContext(message, input.legacyWorkspaceKey ?? '')?.paths.length)) return active;
  const referential = Boolean(continuation) || isPreviousDocumentReference(input.query)
    || isDocumentFollowup(input.query, { hasDocumentContext: true })
    || /^(?:请问\s*)?(?:为什么|为何|如何|多少|是否|能否|\b(?:why|how|what)\b)/iu.test(input.query);
  return referential ? fromContext(prior) : active;
}
