import type { ChatMessage } from '@/stores/ai-chat-store';
import type {
  AiFollowUpAction,
  AiPromptContext,
  EvidenceRef,
  SelectionAiOrigin,
} from './types';
import { parseStructuredAiResponse } from './structured-response';
import { buildAgentResultSections } from './agent-result-view-model';
import {
  buildCitationContracts,
  groupCitationContracts,
  type CitationContract,
  type CitationSourceGroup,
} from './citation-contract';

export type AiResultSectionKind =
  | 'conclusion'
  | 'concept'
  | 'steps'
  | 'example'
  | 'evidence'
  | 'next_question'
  | 'next_actions'
  | 'run'
  | 'plan';

export interface AiResultSectionViewModel {
  kind: AiResultSectionKind;
  title: string;
  content: string;
  synthetic?: boolean;
}

export interface AiResultViewModel {
  messageId: string;
  role: ChatMessage['role'];
  content: string;
  sections: AiResultSectionViewModel[];
  evidenceRefs: EvidenceRef[];
  citationContracts: CitationContract[];
  sourceGroups: CitationSourceGroup[];
  promptContext: AiPromptContext | null;
  followUpActions: AiFollowUpAction[];
  origin: SelectionAiOrigin | undefined;
  evidenceCount: number;
  sourceCount: number;
  contextCount: number;
  summaryLabel: string;
  hasStructuredSections: boolean;
}

function firstNonEmptyLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? 'AI Response';
}

function buildSyntheticEvidenceSection(evidenceRefs: EvidenceRef[], context: AiPromptContext | undefined): AiResultSectionViewModel | null {
  const citations = buildCitationContracts(evidenceRefs.length > 0 ? evidenceRefs : (context?.evidenceRefs ?? []));
  const sourceCount = groupCitationContracts(citations).length;
  const passageCount = citations.length;
  if (passageCount === 0) {
    return null;
  }

  return {
    kind: 'evidence',
    title: 'Evidence',
    content: `${sourceCount} source${sourceCount === 1 ? '' : 's'} · ${passageCount} passage${passageCount === 1 ? '' : 's'} available. Open Evidence to inspect citations.`,
    synthetic: true,
  };
}

function buildSyntheticNextActionsSection(actions: AiFollowUpAction[]): AiResultSectionViewModel | null {
  if (actions.length === 0) {
    return null;
  }

  return {
    kind: 'next_actions',
    title: 'Next Actions',
    content: actions.map((action) => `- ${action.label}`).join('\n'),
    synthetic: true,
  };
}

export function buildAiResultViewModel(message: ChatMessage): AiResultViewModel {
  const structured = message.role === 'assistant' && message.editedAt === undefined
    ? parseStructuredAiResponse(message.content)
    : null;
  const evidenceRefs = dedupeEvidenceRefs(message.evidenceRefs ?? []);
  const citationContracts = buildCitationContracts(evidenceRefs);
  const sourceGroups = groupCitationContracts(citationContracts);
  const promptContext = message.promptContext ?? null;
  const followUpActions = message.followUpActions ?? [];
  // User-edited Markdown is a complete document, including any thematic breaks.
  // Keep execution/evidence metadata separately without reconstructing its body.
  const agentSections = message.editedAt === undefined ? buildAgentResultSections(message) : null;

  const sections: AiResultSectionViewModel[] = agentSections ?? structured?.sections.map((section) => ({
    kind: section.kind,
    title: section.title,
    content: section.content,
  })) ?? [
    {
      kind: 'conclusion',
      title: 'Conclusion',
      content: message.content,
      synthetic: true,
    },
  ];

  if (!sections.some((section) => section.kind === 'conclusion')) {
    sections.unshift({
      kind: 'conclusion',
      title: 'Conclusion',
      content: '未返回可展示的直接回答。请重试，或检查模型与上下文设置。',
      synthetic: true,
    });
  }

  if (!sections.some((section) => section.kind === 'evidence')) {
    const evidenceSection = buildSyntheticEvidenceSection(evidenceRefs, promptContext ?? undefined);
    if (evidenceSection) {
      sections.push(evidenceSection);
    }
  }

  if (!sections.some((section) => section.kind === 'next_actions')) {
    const actionsSection = buildSyntheticNextActionsSection(followUpActions);
    if (actionsSection) {
      sections.push(actionsSection);
    }
  }

  return {
    messageId: message.id,
    role: message.role,
    content: message.content,
    sections,
    evidenceRefs,
    citationContracts,
    sourceGroups,
    promptContext,
    followUpActions,
    origin: message.origin,
    evidenceCount: evidenceRefs.length,
    sourceCount: sourceGroups.length,
    contextCount: promptContext?.nodes.length ?? 0,
    summaryLabel: firstNonEmptyLine(
      sections.find((section) => section.kind === 'conclusion')?.content ?? message.content,
    ).slice(0, 48),
    hasStructuredSections: Boolean(agentSections || (structured && structured.sections.length > 0)),
  };
}

export function dedupeEvidenceRefs(refs: EvidenceRef[]): EvidenceRef[] {
  return buildCitationContracts(refs).map((citation) => citation.evidenceRef);
}

export function evidenceDisplayLabel(ref: EvidenceRef): string {
  const raw = ref.label || ref.locator;
  const normalized = raw.replaceAll('\\', '/');
  const locatorPath = ref.locator.replaceAll('\\', '/').split('#', 1)[0] || normalized;
  const basename = locatorPath.split('/').at(-1) || locatorPath;
  if (ref.kind === 'pdf_page') {
    const page = ref.anchor?.page ?? (Number(ref.locator.match(/#page=(\d+)/i)?.[1] || 0) || undefined);
    const quote = (ref.anchor?.snippet || ref.preview || '').replace(/\s+/g, ' ').trim();
    return [basename, page ? `p.${page}` : null, quote || null]
      .filter((part): part is string => Boolean(part))
      .join(' · ');
  }
  const basenameWithFragment = normalized.split('/').at(-1) || normalized;
  return basenameWithFragment.length > 34 ? `${basenameWithFragment.slice(0, 31)}...` : basenameWithFragment;
}
