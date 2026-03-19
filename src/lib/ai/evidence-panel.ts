import type { AiContextNode, EvidenceRef } from './types';

export interface EvidencePanelInput {
  evidenceRefs?: EvidenceRef[];
  contextNodes?: AiContextNode[];
}

export interface EvidenceContextGroup {
  kind: AiContextNode['kind'];
  title: string;
  nodes: AiContextNode[];
}

export interface EvidenceTreeLeaf {
  id: string;
  kind: EvidenceRef['kind'];
  label: string;
  locator: string;
  preview?: string;
}

export interface EvidenceTreeGroup {
  path: string;
  title: string;
  leaves: EvidenceTreeLeaf[];
}

export interface EvidenceDraftSeed {
  title: string;
  content: string;
  refs: EvidenceRef[];
}

export interface EvidencePanelState {
  evidenceCount: number;
  contextCount: number;
  contextGroups: EvidenceContextGroup[];
  referenceGroups: EvidenceTreeGroup[];
}

const CONTEXT_KIND_ORDER: AiContextNode['kind'][] = [
  'selection',
  'file',
  'heading',
  'annotation',
  'code_symbol',
  'notebook_cell',
  'workspace_chunk',
];

const CONTEXT_KIND_TITLES: Record<AiContextNode['kind'], string> = {
  selection: 'Selection',
  file: 'Files',
  heading: 'Headings',
  annotation: 'Annotations',
  code_symbol: 'Code Symbols',
  notebook_cell: 'Notebook Cells',
  workspace_chunk: 'Workspace Chunks',
};

function locatorPath(locator: string): string {
  const [path] = locator.split('#', 2);
  return path || locator;
}

function titleFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

function collectReferenceLeaves(
  evidenceRefs: EvidenceRef[],
  contextNodes: AiContextNode[],
): EvidenceTreeLeaf[] {
  const seen = new Set<string>();
  const leaves: EvidenceTreeLeaf[] = [];

  const pushLeaf = (ref: EvidenceRef, id: string) => {
    const key = `${ref.kind}:${ref.locator}:${ref.label}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    leaves.push({
      id,
      kind: ref.kind,
      label: ref.label,
      locator: ref.locator,
      preview: ref.preview,
    });
  };

  evidenceRefs.forEach((ref, index) => pushLeaf(ref, `evidence-${index}`));
  contextNodes.forEach((node, index) => {
    if (node.evidenceRef) {
      pushLeaf(node.evidenceRef, `context-${index}`);
    }
  });

  return leaves;
}

function buildReferenceGroups(
  evidenceRefs: EvidenceRef[],
  contextNodes: AiContextNode[],
): EvidenceTreeGroup[] {
  const grouped = new Map<string, EvidenceTreeLeaf[]>();

  collectReferenceLeaves(evidenceRefs, contextNodes).forEach((leaf) => {
    const path = locatorPath(leaf.locator);
    const current = grouped.get(path) ?? [];
    grouped.set(path, [...current, leaf]);
  });

  return Array.from(grouped.entries())
    .map(([path, leaves]) => ({
      path,
      title: titleFromPath(path),
      leaves: leaves.sort((left, right) => left.label.localeCompare(right.label)),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function leafToEvidenceRef(leaf: EvidenceTreeLeaf): EvidenceRef {
  return {
    kind: leaf.kind,
    label: leaf.label,
    locator: leaf.locator,
    preview: leaf.preview,
  };
}

export function buildEvidenceRefsFromLeaves(leaves: EvidenceTreeLeaf[]): EvidenceRef[] {
  return leaves.map(leafToEvidenceRef);
}

export function buildEvidenceDraftSeedForLeaf(leaf: EvidenceTreeLeaf): EvidenceDraftSeed {
  const refs = [leafToEvidenceRef(leaf)];
  return {
    title: `Evidence - ${leaf.label}`,
    refs,
    content: [
      `Focused evidence selection for ${leaf.label}.`,
      '',
      `- Locator: ${leaf.locator}`,
      leaf.preview ? `- Preview: ${leaf.preview}` : null,
    ].filter(Boolean).join('\n'),
  };
}

export function buildEvidenceDraftSeedForGroup(group: EvidenceTreeGroup): EvidenceDraftSeed {
  const refs = buildEvidenceRefsFromLeaves(group.leaves);
  return {
    title: `Evidence - ${group.title}`,
    refs,
    content: [
      `Collected evidence from ${group.path}.`,
      '',
      ...group.leaves.map((leaf) => [
        `- ${leaf.label}`,
        `  - Locator: ${leaf.locator}`,
        leaf.preview ? `  - Preview: ${leaf.preview}` : null,
      ].filter(Boolean).join('\n')),
    ].join('\n'),
  };
}

export function buildEvidenceProposalPrompt(group: EvidenceTreeGroup): string {
  return [
    `Organize the evidence from ${group.path} into a concrete research task plan.`,
    '',
    ...group.leaves.map((leaf) => [
      `- ${leaf.label}`,
      `  - Locator: ${leaf.locator}`,
      leaf.preview ? `  - Preview: ${leaf.preview}` : null,
    ].filter(Boolean).join('\n')),
  ].join('\n');
}

export function buildEvidenceDraftSeedForSelection(leaves: EvidenceTreeLeaf[]): EvidenceDraftSeed {
  const refs = buildEvidenceRefsFromLeaves(leaves);
  const title = leaves.length === 1
    ? `Evidence - ${leaves[0].label}`
    : `Evidence Selection (${leaves.length})`;

  return {
    title,
    refs,
    content: [
      `Collected evidence from ${leaves.length} selected references.`,
      '',
      ...leaves.map((leaf) => [
        `- ${leaf.label}`,
        `  - Locator: ${leaf.locator}`,
        leaf.preview ? `  - Preview: ${leaf.preview}` : null,
      ].filter(Boolean).join('\n')),
    ].join('\n'),
  };
}

export function buildEvidenceProposalPromptForSelection(leaves: EvidenceTreeLeaf[]): string {
  return [
    `Organize the selected evidence (${leaves.length} refs) into a concrete research task plan.`,
    '',
    ...leaves.map((leaf) => [
      `- ${leaf.label}`,
      `  - Locator: ${leaf.locator}`,
      leaf.preview ? `  - Preview: ${leaf.preview}` : null,
    ].filter(Boolean).join('\n')),
  ].join('\n');
}

export function buildEvidencePanelState(input: EvidencePanelInput): EvidencePanelState {
  const evidenceRefs = input.evidenceRefs ?? [];
  const contextNodes = input.contextNodes ?? [];

  const grouped = new Map<AiContextNode['kind'], AiContextNode[]>();
  contextNodes.forEach((node) => {
    const current = grouped.get(node.kind) ?? [];
    grouped.set(node.kind, [...current, node]);
  });

  const contextGroups = CONTEXT_KIND_ORDER
    .filter((kind) => grouped.has(kind))
    .map((kind) => ({
      kind,
      title: CONTEXT_KIND_TITLES[kind],
      nodes: (grouped.get(kind) ?? []).filter((node) => !node.evidenceRef),
    }))
    .filter((group) => group.nodes.length > 0);

  return {
    evidenceCount: evidenceRefs.length,
    contextCount: contextNodes.length,
    contextGroups,
    referenceGroups: buildReferenceGroups(evidenceRefs, contextNodes),
  };
}
