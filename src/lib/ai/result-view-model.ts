import type { ChatMessage } from '@/stores/ai-chat-store';
import type {
  AiFollowUpAction,
  AiPromptContext,
  EvidenceRef,
  SelectionAiOrigin,
} from './types';
import { parseStructuredAiResponse } from './structured-response';

export type AiResultSectionKind = 'conclusion' | 'evidence' | 'next_actions';

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
  promptContext: AiPromptContext | null;
  followUpActions: AiFollowUpAction[];
  origin: SelectionAiOrigin | undefined;
  evidenceCount: number;
  contextCount: number;
  summaryLabel: string;
  hasStructuredSections: boolean;
}

function firstNonEmptyLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? 'AI Response';
}

function buildSyntheticEvidenceSection(evidenceRefs: EvidenceRef[], context: AiPromptContext | undefined): AiResultSectionViewModel | null {
  const lines: string[] = [];

  if (evidenceRefs.length > 0) {
    lines.push(...evidenceRefs.map((ref) => `- ${ref.label} (${ref.locator})`));
  }

  const contextNodes = context?.nodes.filter((node) => !node.evidenceRef) ?? [];
  if (contextNodes.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(...contextNodes.slice(0, 6).map((node) => `- ${node.label}: ${node.content}`));
  }

  if (lines.length === 0) {
    return null;
  }

  return {
    kind: 'evidence',
    title: 'Evidence',
    content: lines.join('\n'),
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
  const structured = message.role === 'assistant' ? parseStructuredAiResponse(message.content) : null;
  const evidenceRefs = message.evidenceRefs ?? [];
  const promptContext = message.promptContext ?? null;
  const followUpActions = message.followUpActions ?? [];

  const sections: AiResultSectionViewModel[] = structured?.sections.map((section) => ({
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
    promptContext,
    followUpActions,
    origin: message.origin,
    evidenceCount: evidenceRefs.length,
    contextCount: promptContext?.nodes.length ?? 0,
    summaryLabel: firstNonEmptyLine(
      sections.find((section) => section.kind === 'conclusion')?.content ?? message.content,
    ).slice(0, 48),
    hasStructuredSections: Boolean(structured && structured.sections.length > 0),
  };
}
