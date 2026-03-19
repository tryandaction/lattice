export type AiStructuredSectionKind = 'conclusion' | 'evidence' | 'next_actions';

export interface AiStructuredSection {
  kind: AiStructuredSectionKind;
  title: string;
  content: string;
}

export interface AiStructuredResponse {
  sections: AiStructuredSection[];
}

const SECTION_MATCHERS: Array<{
  kind: AiStructuredSectionKind;
  title: string;
  headerPatterns: RegExp[];
  inlinePatterns: RegExp[];
}> = [
  {
    kind: 'conclusion',
    title: 'Conclusion',
    headerPatterns: [
      /^#{1,6}\s*(conclusion|summary|answer|结论|总结|回答)\s*$/i,
      /^(?:\*\*)?(conclusion|summary|answer|结论|总结|回答)(?:\*\*)?\s*[:：](?:\*\*)?\s*$/i,
    ],
    inlinePatterns: [
      /^(?:\*\*)?(?:conclusion|summary|answer|结论|总结|回答)(?:\*\*)?\s*[:：](?:\*\*)?\s*(.+)$/i,
    ],
  },
  {
    kind: 'evidence',
    title: 'Evidence',
    headerPatterns: [
      /^#{1,6}\s*(evidence|citations|references|证据|依据|引用)\s*$/i,
      /^(?:\*\*)?(evidence|citations|references|证据|依据|引用)(?:\*\*)?\s*[:：](?:\*\*)?\s*$/i,
    ],
    inlinePatterns: [
      /^(?:\*\*)?(?:evidence|citations|references|证据|依据|引用)(?:\*\*)?\s*[:：](?:\*\*)?\s*(.+)$/i,
    ],
  },
  {
    kind: 'next_actions',
    title: 'Next Actions',
    headerPatterns: [
      /^#{1,6}\s*(next actions|next steps|action items|后续动作|下一步|后续建议)\s*$/i,
      /^(?:\*\*)?(next actions|next steps|action items|后续动作|下一步|后续建议)(?:\*\*)?\s*[:：](?:\*\*)?\s*$/i,
    ],
    inlinePatterns: [
      /^(?:\*\*)?(?:next actions|next steps|action items|后续动作|下一步|后续建议)(?:\*\*)?\s*[:：](?:\*\*)?\s*(.+)$/i,
    ],
  },
];

function matchSection(
  line: string
): { kind: AiStructuredSectionKind; title: string; inlineContent?: string } | null {
  const trimmed = line.trim();
  for (const section of SECTION_MATCHERS) {
    const inlineMatch = section.inlinePatterns
      .map((pattern) => trimmed.match(pattern))
      .find((match): match is RegExpMatchArray => Boolean(match));

    if (inlineMatch) {
      return {
        kind: section.kind,
        title: section.title,
        inlineContent: inlineMatch[1]?.trim() || undefined,
      };
    }

    if (section.headerPatterns.some((pattern) => pattern.test(trimmed))) {
      return {
        kind: section.kind,
        title: section.title,
      };
    }
  }
  return null;
}

export function parseStructuredAiResponse(content: string): AiStructuredResponse | null {
  const normalized = content.trim();
  if (!normalized) {
    return null;
  }

  const lines = normalized.split(/\r?\n/);
  const sections: AiStructuredSection[] = [];

  let current: AiStructuredSection | null = null;
  let foundStructuredHeader = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const matchedSection = matchSection(line);

    if (matchedSection) {
      foundStructuredHeader = true;
      if (current && current.content.trim()) {
        sections.push({
          ...current,
          content: current.content.trim(),
        });
      }
      current = {
        kind: matchedSection.kind,
        title: matchedSection.title,
        content: matchedSection.inlineContent ? `${matchedSection.inlineContent}\n` : '',
      };
      continue;
    }

    if (!current) {
      continue;
    }

    current.content += `${line}\n`;
  }

  if (current && current.content.trim()) {
    sections.push({
      ...current,
      content: current.content.trim(),
    });
  }

  if (!foundStructuredHeader || sections.length === 0) {
    return null;
  }

  return {
    sections,
  };
}
