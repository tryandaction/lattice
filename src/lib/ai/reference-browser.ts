import type { MentionSuggestion } from './mention-resolver';
import type { AiContextNode, EvidenceRef } from './types';
import {
  buildCitationContracts,
  groupCitationContracts,
  type CitationContract,
} from './citation-contract';

export type ReferenceBrowserNodeKind =
  | 'group'
  | 'selection'
  | 'folder'
  | 'file'
  | 'heading'
  | 'code_line'
  | 'notebook_cell'
  | 'pdf_page'
  | 'pdf_annotation'
  | 'context';

export interface ReferenceBrowserNode {
  id: string;
  kind: ReferenceBrowserNodeKind;
  label: string;
  description?: string;
  value?: string;
  locator?: string;
  preview?: string;
  selectable?: boolean;
  children?: ReferenceBrowserNode[];
  evidenceRef?: EvidenceRef;
  passageCount?: number;
}

function locatorPath(locator: string): string {
  const [path] = locator.split('#', 2);
  return path || locator;
}

function titleFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

function compactEvidenceLabel(ref: EvidenceRef): string {
  const path = locatorPath(ref.locator);
  const basename = titleFromPath(path);
  const label = ref.label?.trim();
  if (!label || label === path || label.startsWith(`${path}#`) || label.startsWith(`${path} `)) {
    const suffix = label?.slice(path.length).trim();
    return suffix ? `${basename} ${suffix}` : basename;
  }
  return label;
}

function compactCitationLabel(citation: CitationContract): string {
  const location = citation.location;
  const prefix = location.page
    ? `p.${location.page}`
    : location.line
      ? `line ${location.line}`
      : location.cell
        ? `cell ${location.cell}`
        : location.heading
          ? location.heading
          : location.annotation
            ? `annotation ${location.annotation}`
            : null;
  if (citation.sourceKind === 'pdf_page' || citation.sourceKind === 'pdf_annotation') {
    return [prefix, citation.boundedQuote].filter(Boolean).join(' · ') || citation.basename;
  }
  return prefix || compactEvidenceLabel(citation.evidenceRef);
}

function nodeKindFromEvidenceKind(kind: EvidenceRef['kind']): ReferenceBrowserNodeKind {
  switch (kind) {
    case 'heading':
      return 'heading';
    case 'code_line':
      return 'code_line';
    case 'notebook_cell':
      return 'notebook_cell';
    case 'pdf_page':
      return 'pdf_page';
    case 'pdf_annotation':
      return 'pdf_annotation';
    default:
      return 'file';
  }
}

export function buildReferenceBrowserNodesFromMentionSuggestions(
  suggestions: MentionSuggestion[],
): ReferenceBrowserNode[] {
  return suggestions.map((item) => ({
    id: item.value,
    kind: item.type === 'selection' ? 'selection' : item.type,
    label: item.label,
    description: item.description,
    value: item.value,
  }));
}

export function buildReferenceBrowserNodesFromEvidence(
  evidenceRefs: EvidenceRef[] = [],
  contextNodes: AiContextNode[] = [],
): ReferenceBrowserNode[] {
  const citations = buildCitationContracts([
    ...evidenceRefs,
    ...contextNodes.flatMap((node) => node.evidenceRef ? [node.evidenceRef] : []),
  ]);

  return groupCitationContracts(citations)
    .map((group) => ({
      id: group.sourceGroupId,
      kind: 'group' as const,
      label: group.displayTitle,
      description: group.canonicalPath,
      locator: group.canonicalPath,
      passageCount: group.passageCount,
      children: group.passages.map((citation) => ({
        id: citation.stableId,
        kind: nodeKindFromEvidenceKind(citation.sourceKind),
        label: compactCitationLabel(citation),
        description: citation.evidenceRef.locator,
        locator: citation.evidenceRef.locator,
        preview: citation.preview,
        evidenceRef: citation.evidenceRef,
        selectable: true,
      })),
    }))
    .sort((left, right) => (left.locator ?? '').localeCompare(right.locator ?? ''));
}

export function collectReferenceBrowserLeaves(nodes: ReferenceBrowserNode[]): ReferenceBrowserNode[] {
  const leaves: ReferenceBrowserNode[] = [];

  const walk = (node: ReferenceBrowserNode) => {
    if (node.children?.length) {
      node.children.forEach(walk);
      return;
    }
    if (node.evidenceRef) {
      leaves.push(node);
    }
  };

  nodes.forEach(walk);
  return leaves;
}
