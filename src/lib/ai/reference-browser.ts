import type { MentionSuggestion } from './mention-resolver';
import type { AiContextNode, EvidenceRef } from './types';

export type ReferenceBrowserNodeKind =
  | 'group'
  | 'selection'
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
}

function locatorPath(locator: string): string {
  const [path] = locator.split('#', 2);
  return path || locator;
}

function titleFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
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
    kind: item.type === 'selection' ? 'selection' : item.type === 'file' ? 'file' : item.type,
    label: item.label,
    description: item.description,
    value: item.value,
  }));
}

export function buildReferenceBrowserNodesFromEvidence(
  evidenceRefs: EvidenceRef[] = [],
  contextNodes: AiContextNode[] = [],
): ReferenceBrowserNode[] {
  const grouped = new Map<string, ReferenceBrowserNode[]>();
  const seen = new Set<string>();

  const pushLeaf = (ref: EvidenceRef) => {
    const key = `${ref.kind}:${ref.locator}:${ref.label}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const path = locatorPath(ref.locator);
    const leaves = grouped.get(path) ?? [];
    leaves.push({
      id: key,
      kind: nodeKindFromEvidenceKind(ref.kind),
      label: ref.label,
      description: ref.locator,
      locator: ref.locator,
      preview: ref.preview,
      evidenceRef: ref,
      selectable: true,
    });
    grouped.set(path, leaves);
  };

  evidenceRefs.forEach(pushLeaf);
  contextNodes.forEach((node) => {
    if (node.evidenceRef) {
      pushLeaf(node.evidenceRef);
    }
  });

  return Array.from(grouped.entries())
    .map(([path, children]) => ({
      id: `group:${path}`,
      kind: 'group' as const,
      label: titleFromPath(path),
      description: path,
      locator: path,
      children: children.sort((left, right) => left.label.localeCompare(right.label)),
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
