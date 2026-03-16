import { parseNotebook } from '@/lib/notebook-utils';
import { estimateTokens } from './token-estimator';
import { searchIndex } from './workspace-indexer';
import type {
  AiContextNode,
  AiPromptContext,
  AiResearchContextInput,
  EvidenceRef,
} from './types';

function normalizePreview(text: string, length = 180): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, length);
}

function fileExtension(path?: string): string {
  if (!path) return '';
  const part = path.split('.').pop();
  return part ? `.${part.toLowerCase()}` : '';
}

function formatAnnotationLocation(annotation: NonNullable<AiResearchContextInput['annotations']>[number]): string {
  switch (annotation.target.type) {
    case 'pdf':
      return `Page ${annotation.target.page}`;
    case 'code_line':
      return `Line ${annotation.target.line}`;
    case 'image':
      return 'Image region';
    case 'text_anchor':
      return 'Text anchor';
    default:
      return 'Annotation';
  }
}

function formatAnnotationsSummary(input: NonNullable<AiResearchContextInput['annotations']>): string {
  return input
    .map((annotation) => {
      const parts = [formatAnnotationLocation(annotation)];
      if (annotation.content?.trim()) {
        parts.push(`"${annotation.content.trim()}"`);
      }
      if (annotation.comment?.trim()) {
        parts.push(`Note: ${annotation.comment.trim()}`);
      }
      return parts.join(' - ');
    })
    .join('\n');
}

function markdownHeadingNodes(path: string, content: string): AiContextNode[] {
  return [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].slice(0, 20).map((match, index) => ({
    id: `heading-${index}`,
    kind: 'heading',
    label: `Heading: ${match[1].trim()}`,
    content: match[0],
    priority: 75,
    evidenceRef: {
      kind: 'heading',
      label: `${path}#${match[1].trim()}`,
      locator: `${path}#${match[1].trim()}`,
      preview: normalizePreview(match[0]),
    },
  }));
}

function codeSymbolNodes(path: string, content: string): AiContextNode[] {
  return [...content.matchAll(/(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|const|type|interface|enum)\s+(\w+)/g)]
    .slice(0, 20)
    .map((match, index) => ({
      id: `symbol-${index}`,
      kind: 'code_symbol',
      label: `${match[1]} ${match[2]}`,
      content: match[0],
      priority: 70,
      evidenceRef: {
        kind: 'file',
        label: `${path}:${match[2]}`,
        locator: path,
        preview: normalizePreview(match[0]),
      },
    }));
}

function notebookNodes(path: string, content: string): AiContextNode[] {
  const parsed = parseNotebook(content);
  return parsed.cells.slice(0, 20).map((cell, index) => {
    const preview = normalizePreview(cell.source, 220);
    return {
      id: `notebook-cell-${cell.id}`,
      kind: 'notebook_cell',
      label: `Cell ${index + 1} (${cell.cell_type})`,
      content: preview,
      priority: cell.cell_type === 'code' ? 80 : 68,
      evidenceRef: {
        kind: 'notebook_cell',
        label: `${path}#cell=${cell.id}`,
        locator: `${path}#cell=${cell.id}`,
        preview,
      },
    };
  });
}

function annotationNodes(path: string, input: NonNullable<AiResearchContextInput['annotations']>): AiContextNode[] {
  const formatted = formatAnnotationsSummary(input);
  if (!formatted) return [];

  const summaryNode: AiContextNode = {
    id: `annotations-summary-${path}`,
    kind: 'annotation',
    label: `Annotations in ${path}`,
    content: formatted,
    priority: 88,
    evidenceRef: {
      kind: 'file',
      label: `${path} annotations`,
      locator: path,
      preview: normalizePreview(formatted, 220),
    },
  };

  const detailNodes = input.slice(0, 20).map((annotation) => {
    let evidence: EvidenceRef = {
      kind: 'file',
      label: `${path} annotation ${annotation.id}`,
      locator: path,
      preview: normalizePreview(annotation.comment || annotation.content || ''),
    };

    if (annotation.target.type === 'pdf' && annotation.target.page) {
      evidence = {
        kind: 'pdf_page',
        label: `${path} page ${annotation.target.page}`,
        locator: `${path}#page=${annotation.target.page}`,
        preview: normalizePreview(annotation.comment || annotation.content || ''),
      };
    } else if (annotation.target.type === 'code_line' && annotation.target.line) {
      evidence = {
        kind: 'code_line',
        label: `${path} line ${annotation.target.line}`,
        locator: `${path}#line=${annotation.target.line}`,
        preview: normalizePreview(annotation.comment || annotation.content || ''),
      };
    }

    return {
      id: `annotation-${annotation.id}`,
      kind: 'annotation',
      label: evidence.label,
      content: [annotation.content, annotation.comment].filter(Boolean).join('\n'),
      priority: 84,
      evidenceRef: evidence,
      } satisfies AiContextNode;
  });

  return [summaryNode, ...detailNodes];
}

function workspaceNodes(query?: string): AiContextNode[] {
  if (!query?.trim()) return [];
  const results = searchIndex(query, 4);
  return results.flatMap((file) => {
    const firstChunks = (file.chunks ?? []).slice(0, 2);
    if (firstChunks.length === 0) {
      return [{
        id: `workspace-${file.path}`,
        kind: 'workspace_chunk' as const,
        label: `Workspace: ${file.path}`,
        content: file.summary,
        priority: 35,
        evidenceRef: {
          kind: 'file',
          label: file.path,
          locator: file.path,
          preview: normalizePreview(file.summary),
        },
      } satisfies AiContextNode];
    }
    return firstChunks.map((chunk) => ({
      id: `workspace-${file.path}-${chunk.id}`,
      kind: 'workspace_chunk' as const,
      label: `${file.path} / ${chunk.label}`,
      content: chunk.content,
      priority: 35,
      evidenceRef: {
        kind: 'file' as const,
        label: file.path,
        locator: file.path,
        preview: normalizePreview(chunk.content),
      },
    } satisfies AiContextNode));
  });
}

function uniqEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.locator}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class AiContextGraph {
  resolveFocusContext(input: AiResearchContextInput): AiContextNode[] {
    const nodes: AiContextNode[] = [];
    const path = input.filePath ?? 'untitled';

    if (input.selection?.trim()) {
      nodes.push({
        id: 'selection',
        kind: 'selection',
        label: 'Current selection',
        content: input.selection.trim(),
        priority: 100,
        evidenceRef: {
          kind: 'file',
          label: `${path} selection`,
          locator: path,
          preview: normalizePreview(input.selection),
        },
      });
    }

    if (input.content?.trim()) {
      nodes.push({
        id: `file-${path}`,
        kind: 'file',
        label: `Current file: ${path}`,
        content: input.content,
        priority: 90,
        evidenceRef: {
          kind: 'file',
          label: path,
          locator: path,
          preview: normalizePreview(input.content),
        },
      });

      const ext = fileExtension(path);
      if (ext === '.md' || ext === '.mdx') {
        nodes.push(...markdownHeadingNodes(path, input.content));
      } else if (ext === '.ipynb') {
        nodes.push(...notebookNodes(path, input.content));
      } else {
        nodes.push(...codeSymbolNodes(path, input.content));
      }
    }

    if (input.references?.length) {
      nodes.push(...input.references.map((reference, index) => ({
        id: `reference-${index}`,
        kind: 'file' as const,
        label: `Referenced file: ${reference.path}`,
        content: reference.content,
        priority: 95,
        evidenceRef: {
          kind: 'file',
          label: reference.path,
          locator: reference.path,
          preview: normalizePreview(reference.content),
        },
      } satisfies AiContextNode)));
    }

    if (input.annotations?.length) {
      nodes.push(...annotationNodes(path, input.annotations));
    }

    nodes.push(...workspaceNodes(input.query));

    return nodes.sort((left, right) => right.priority - left.priority);
  }

  resolveEvidenceContext(input: AiResearchContextInput): EvidenceRef[] {
    const refs = this.resolveFocusContext(input)
      .flatMap((node) => node.evidenceRef ? [node.evidenceRef] : []);
    return uniqEvidence([...(input.explicitEvidenceRefs ?? []), ...refs]);
  }

  buildPromptContext(input: AiResearchContextInput, maxTokens = 12000): AiPromptContext {
    const nodes = this.resolveFocusContext(input);
    const evidenceRefs = this.resolveEvidenceContext(input);
    const sections: string[] = [];
    let consumed = 0;
    let truncated = false;

    for (const node of nodes) {
      const section = `## ${node.label}\n${node.content}`;
      const tokens = estimateTokens(section);
      if (consumed + tokens > maxTokens) {
        truncated = true;
        continue;
      }
      sections.push(section);
      consumed += tokens;
    }

    if (evidenceRefs.length > 0) {
      const evidenceSection = `## Evidence References\n${evidenceRefs
        .map((ref) => `- ${ref.label} -> ${ref.locator}${ref.preview ? ` | ${ref.preview}` : ''}`)
        .join('\n')}`;
      const evidenceTokens = estimateTokens(evidenceSection);
      if (consumed + evidenceTokens <= maxTokens) {
        sections.push(evidenceSection);
      } else {
        truncated = true;
      }
    }

    return {
      nodes,
      evidenceRefs,
      prompt: sections.join('\n\n'),
      truncated,
    };
  }
}

export const aiContextGraph = new AiContextGraph();
