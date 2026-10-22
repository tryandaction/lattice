import { parseNotebook } from '@/lib/notebook-utils';
import { estimateTokens } from './token-estimator';
import { searchIndex } from './workspace-indexer';
import { isTrivialQuery } from './request-intent';
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

const PDF_PAGE_MARKER_PATTERN = /^--- Page (\d+) ---\s*$/gim;

function boundedPdfPageText(text: string, maxChars = 8000): string {
  const normalized = text.trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trimEnd()}\n[Page text truncated]`;
}

function queryTerms(query: string | undefined): string[] {
  return Array.from(new Set(
    (query?.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((term) => term.length > 1 || /^\d+$/u.test(term)),
  ));
}

function pdfPageNodes(path: string, content: string, query?: string, basePriority = 90): AiContextNode[] {
  const markers = Array.from(content.matchAll(PDF_PAGE_MARKER_PATTERN));
  if (markers.length === 0) return [];
  const terms = queryTerms(query);

  const coverage = content.match(/^\[PDF (?:text extracted|extraction limited|extraction truncated)[^\n]*\]$/gm) ?? [];
  const pages = markers.map((marker, index) => {
    const page = Number(marker[1]);
    const start = (marker.index ?? 0) + marker[0].length;
    const end = markers[index + 1]?.index ?? content.length;
    const pageText = boundedPdfPageText(content.slice(start, end)
      .replace(/^\[PDF (?:extraction limited|extraction truncated)[^\n]*\]$/gm, ''));
    const lowerText = pageText.toLowerCase();
    const matchCount = terms.reduce((count, term) => count + (lowerText.includes(term) ? 1 : 0), 0);
    return {
      id: `pdf-page-${path}-${page}`,
      kind: 'pdf_page' as const,
      label: `${path} / Page ${page}`,
      content: pageText,
      priority: basePriority + Math.min(99 - basePriority, matchCount),
      evidenceRef: {
        kind: 'pdf_page' as const,
        label: `${path} page ${page}`,
        locator: `${path}#page=${page}`,
        preview: pageText,
        anchor: { page },
      },
    } satisfies AiContextNode;
  });
  return coverage.length > 0 ? [{
    id: `pdf-coverage-${path}`,
    kind: 'file',
    label: `PDF context coverage: ${path}`,
    content: 'Local extraction metadata, not model reading coverage. Only the excerpts actually supplied below are available:\n' + coverage.join('\n'),
    priority: 101,
  }, ...pages] : pages;
}

function pdfNodeSource(node: AiContextNode): string {
  return node.evidenceRef?.locator.replace(/#page=\d+$/, '') ?? node.id;
}

function interleavePdfSources(nodes: AiContextNode[]): AiContextNode[] {
  const sources = new Map<string, AiContextNode[]>();
  for (const node of nodes) {
    if (node.kind !== 'pdf_page') continue;
    const source = pdfNodeSource(node);
    const pages = sources.get(source) ?? [];
    pages.push(node);
    sources.set(source, pages);
  }
  if (sources.size < 2) return nodes;
  const groups = Array.from(sources.values());
  const pages: AiContextNode[] = [];
  for (let index = 0; index < Math.max(...groups.map((group) => group.length)); index += 1) {
    for (const group of groups) if (group[index]) pages.push(group[index]);
  }
  let pageIndex = 0;
  return nodes.map((node) => node.kind === 'pdf_page' ? pages[pageIndex++] : node);
}

function truncateContextNode(node: AiContextNode, tokenBudget: number): string {
  const header = `## ${node.label}\n`;
  const suffix = '\n[Context chunk truncated]';
  let low = 0;
  let high = node.content.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTokens(`${header}${node.content.slice(0, middle)}${suffix}`) <= tokenBudget) low = middle;
    else high = middle - 1;
  }
  return low >= 120 ? node.content.slice(0, low).trimEnd() : '';
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
  };

  const detailNodes = input.slice(0, 20).map((annotation) => {
    let evidence: EvidenceRef = {
      kind: 'file',
      label: `${path} annotation ${annotation.id}`,
      locator: path,
      preview: annotation.content?.trim() ?? '',
    };

    if (annotation.target.type === 'pdf' && annotation.target.page) {
      const snippet = annotation.content?.trim() ?? '';
      evidence = {
        kind: 'pdf_page',
        label: `${path} page ${annotation.target.page}`,
        locator: `${path}#page=${annotation.target.page}`,
        preview: snippet,
        anchor: {
          page: annotation.target.page,
          ...(snippet ? { snippet } : {}),
        },
      };
    } else if (annotation.target.type === 'code_line' && annotation.target.line) {
      evidence = {
        kind: 'code_line',
        label: `${path} line ${annotation.target.line}`,
        locator: `${path}#line=${annotation.target.line}`,
        preview: annotation.content?.trim() ?? '',
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
  const terms = queryTerms(query);
  return results.flatMap((file) => {
    const relevantChunks = (file.chunks ?? []).map((chunk, index) => {
      const text = `${chunk.label}\n${chunk.content}`.toLocaleLowerCase();
      return { chunk, index, score: terms.reduce((score, term) => score + Number(text.includes(term)), 0) };
    }).sort((left, right) => right.score - left.score || left.index - right.index).slice(0, 2).map(item => item.chunk);
    if (relevantChunks.length === 0) {
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
          preview: file.summary,
        },
      } satisfies AiContextNode];
    }
    return relevantChunks.map((chunk) => ({
      id: `workspace-${file.path}-${chunk.id}`,
      kind: 'workspace_chunk' as const,
      label: `${file.path} / ${chunk.label}`,
      content: chunk.content,
      priority: 35,
      evidenceRef: {
        kind: 'file' as const,
        label: file.path,
        locator: file.path,
        preview: chunk.content,
      },
    } satisfies AiContextNode));
  });
}

function uniqEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.locator}:${JSON.stringify(ref.anchor ?? {})}:${ref.kind === 'file' ? ref.preview ?? '' : ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function keyEvidenceRefs(explicitEvidenceRefs: EvidenceRef[] | undefined, nodes: AiContextNode[]): EvidenceRef[] {
  return uniqEvidence([
    ...(explicitEvidenceRefs ?? []),
    ...nodes.flatMap((node) => node.evidenceRef ? [node.evidenceRef] : []),
  ]);
}

export class AiContextGraph {
  resolveFocusContext(input: AiResearchContextInput): AiContextNode[] {
    const nodes: AiContextNode[] = [];
    const path = input.filePath ?? '';

    if (input.selection?.trim()) {
      nodes.push({
        id: 'selection',
        kind: 'selection',
        label: 'Current selection',
        content: input.selection.trim(),
        priority: 100,
        evidenceRef: input.filePath ? {
          kind: 'file',
          label: `${path} selection`,
          locator: path,
          preview: input.selection.trim(),
        } : undefined,
      });
    }

    if (input.content?.trim()) {
      const ext = fileExtension(path);
      const pdfNodes = ext === '.pdf' && !isTrivialQuery(input.query)
        ? pdfPageNodes(path, input.content, input.query)
        : [];
      if (pdfNodes.length > 0) {
        nodes.push(...pdfNodes);
      } else if (ext !== '.pdf') {
        nodes.push({
          id: path ? `file-${path}` : 'supplied-content',
          kind: 'file',
          label: input.filePath ? `Current file: ${path}` : 'Supplied text (no file identity)',
          content: input.content,
          priority: 90,
          evidenceRef: input.filePath ? {
            kind: 'file',
            label: path,
            locator: path,
            preview: input.content,
          } : undefined,
        });
      }

      if (ext === '.md' || ext === '.mdx') {
        nodes.push(...markdownHeadingNodes(path, input.content));
      } else if (ext === '.ipynb') {
        nodes.push(...notebookNodes(path, input.content));
      } else if (input.filePath && ext !== '.pdf') {
        nodes.push(...codeSymbolNodes(path, input.content));
      }
    }

    if (input.filePath && !input.content?.trim() && !input.selection?.trim()) {
      nodes.push({
        id: `active-file-${input.filePath}`,
        kind: 'file',
        label: `Current file: ${input.filePath}`,
        content: `This is the source captured for this request; no text was selected or supplied in the initial context. This identity alone is not content evidence. Use any actual source excerpts supplied below to support content claims.`,
        priority: 60,
      });
    }

    if (input.references?.length) {
      nodes.push(...input.references.flatMap((reference, index) => {
        const pages = fileExtension(reference.path) === '.pdf'
          ? pdfPageNodes(reference.path, reference.content, input.query, 95)
          : [];
        if (pages.length > 0) return pages;
        return [{
          id: `reference-${index}`,
          kind: 'file' as const,
          label: `Referenced file: ${reference.path}`,
          content: reference.content,
          priority: 95,
          evidenceRef: {
            kind: 'file',
            label: reference.path,
            locator: reference.path,
            preview: reference.content,
          },
        } satisfies AiContextNode];
      }));
    }

    if (input.annotations?.length) {
      nodes.push(...annotationNodes(path, input.annotations));
    }

    if (input.includeWorkspaceContext !== false) nodes.push(...workspaceNodes(input.query));

    return interleavePdfSources(nodes.sort((left, right) => right.priority - left.priority));
  }

  resolveEvidenceContext(input: AiResearchContextInput): EvidenceRef[] {
    const refs = this.resolveFocusContext(input)
      .flatMap((node) => node.evidenceRef ? [node.evidenceRef] : []);
    return uniqEvidence([...(input.explicitEvidenceRefs ?? []), ...refs]);
  }

  buildPromptContext(input: AiResearchContextInput, maxTokens = 12000): AiPromptContext {
    const nodes = this.resolveFocusContext(input);
    const sections: string[] = [];
    const includedNodes: AiContextNode[] = [];
    let consumed = 0;
    let truncated = false;
    const pendingPdfSources = new Set(nodes.filter((node) => node.kind === 'pdf_page').map(pdfNodeSource));

    for (const node of nodes) {
      const section = `## ${node.label}\n${node.content}`;
      const tokens = estimateTokens(section);
      let nodeBudget = Math.max(0, maxTokens - consumed);
      if (node.kind === 'pdf_page' && pendingPdfSources.has(pdfNodeSource(node))) {
        // Supply one real excerpt per source before a long first page consumes the budget.
        nodeBudget = Math.floor(nodeBudget / pendingPdfSources.size);
        pendingPdfSources.delete(pdfNodeSource(node));
      }
      if (tokens > nodeBudget) {
        truncated = true;
        if (nodeBudget >= 40) {
          const header = `## ${node.label}\n`;
          const suppliedContent = truncateContextNode(node, nodeBudget);
          if (suppliedContent) {
            const suppliedSection = `${header}${suppliedContent}\n[Context chunk truncated]`;
            sections.push(suppliedSection);
            includedNodes.push({
              ...node,
              content: suppliedContent,
              ...(node.evidenceRef && (node.evidenceRef.preview === node.content || node.evidenceRef.preview?.startsWith(suppliedContent)) ? {
                evidenceRef: {
                  ...node.evidenceRef,
                  preview: suppliedContent,
                  ...(node.evidenceRef.anchor?.snippet?.startsWith(suppliedContent) ? {
                    anchor: { ...node.evidenceRef.anchor, snippet: suppliedContent },
                  } : {}),
                },
              } : {}),
            });
            consumed += estimateTokens(suppliedSection);
          }
        }
        continue;
      }
      sections.push(section);
      includedNodes.push(node);
      consumed += tokens;
    }

    const evidenceRefs = keyEvidenceRefs(input.explicitEvidenceRefs, includedNodes);

    if (truncated) {
      sections.push('[Context budget limit: only the supplied page excerpts are available. Do not infer content of omitted pages.]');
    }

    if (evidenceRefs.length > 0) {
      const evidenceSection = `## Evidence References\n${evidenceRefs
        .map((ref) => {
          const previewAlreadySupplied = includedNodes.some((node) =>
            node.evidenceRef?.locator === ref.locator && node.content.includes(ref.preview ?? ''),
          );
          return `- ${ref.label} -> ${ref.locator}${ref.preview && !previewAlreadySupplied ? ` | ${ref.preview}` : ''}`;
        })
        .join('\n')}`;
      const evidenceTokens = estimateTokens(evidenceSection);
      if (consumed + evidenceTokens <= maxTokens) {
        sections.push(evidenceSection);
      } else {
        truncated = true;
      }
    }

    return {
      nodes: includedNodes,
      evidenceRefs,
      prompt: sections.join('\n\n'),
      truncated,
    };
  }
}

export const aiContextGraph = new AiContextGraph();
