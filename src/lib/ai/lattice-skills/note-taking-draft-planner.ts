import type { ResearchAgentRunResult } from '../research-agent';
import type { AiDraftSuggestion } from '../types';
import { buildDraftArtifactDefaultPath } from '../workbench-actions';
import { buildCitationContracts, classifyStrictAiLink } from '../citation-contract';
import { requestsMarkdownDocument, parsePdfMarkdownChildRequest } from '../task-outcome';
import { preparePdfAnnotationProposal } from '../pdf-annotation-agent';
import { getDefaultPdfItemFolderPath } from '@/lib/pdf-item';
import type {
  NoteTakingSkillConfig,
  ResearchAgentWorkflowPreset,
} from '../research-agent-workflows';

export interface NoteTakingDraftPlanInput {
  workflow: ResearchAgentWorkflowPreset | null;
  result: ResearchAgentRunResult;
  noteConfig: NoteTakingSkillConfig;
}

function normalizeDraftTitlePart(value: string | undefined | null, maxLength = 80): string {
  return (value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s._-]/gu, '')
    .trim()
    .slice(0, maxLength)
    .trim();
}

function buildNoteTakingDraftTitle(input: NoteTakingDraftPlanInput): string {
  const workflowTitle = input.workflow?.title ?? input.result.workflowTitle ?? 'Research';
  const queryTitle = normalizeDraftTitlePart(
    input.result.session.task ||
    input.result.session.title ||
    input.result.promptContext.nodes[0]?.label,
  );
  return queryTitle ? `${workflowTitle}: ${queryTitle}` : workflowTitle;
}

function titleFromPathLike(value: string | undefined | null): string {
  if (!value) {
    return '';
  }
  const withoutFragment = value.split('#', 1)[0]?.split('?', 1)[0] ?? value;
  const fileName = withoutFragment.split(/[\\/]/).filter(Boolean).pop() ?? withoutFragment;
  return normalizeDraftTitlePart(fileName.replace(/\.pdf$/i, ''));
}

function findPdfSourceTitle(result: ResearchAgentRunResult): string {
  const evidenceRefs = result.promptContext.evidenceRefs;
  const pdfRef = evidenceRefs.find((ref) => ref.kind === 'pdf_page' || ref.kind === 'pdf_annotation') ??
    evidenceRefs.find((ref) => /\.pdf(?:$|[?#])/i.test(ref.locator) || /\.pdf(?:$|[?#])/i.test(ref.label));
  const fromLocator = titleFromPathLike(pdfRef?.locator);
  if (fromLocator) {
    return fromLocator;
  }
  const fromLabel = titleFromPathLike(pdfRef?.label);
  if (fromLabel) {
    return fromLabel;
  }

  const pdfNode = result.promptContext.nodes.find((node) =>
    /\.pdf(?:$|[?#])/i.test(node.evidenceRef?.locator ?? '') ||
    /\.pdf(?:$|[?#])/i.test(node.label),
  );
  return titleFromPathLike(pdfNode?.evidenceRef?.locator) || titleFromPathLike(pdfNode?.label);
}

function buildNoteTakingDraftTargetPath(input: {
  title: string;
  noteConfig: NoteTakingSkillConfig;
  result: ResearchAgentRunResult;
}): string {
  if (requestsMarkdownDocument(input.result.session.task)) {
    const source = input.result.promptContext.evidenceRefs.find(ref => ref.kind === 'pdf_page' || ref.kind === 'pdf_annotation');
    const path = source?.locator.split('#', 1)[0]?.split('?', 1)[0];
    // Derive the location from supplied evidence, never a model-invented directory.
    if (path && /\.pdf$/i.test(path) && !/^(?:[a-z]+:|\/)/i.test(path) && !path.split(/[\\/]/).some(part => part === '..' || part === '.')) {
      return path.replace(/\.pdf$/i, ' Reading Note.md');
    }
  }
  if (input.noteConfig.fileNaming === 'date-title') {
    const createdAt = input.result.contextPack.createdAt || input.result.session.createdAt || Date.now();
    const date = new Date(createdAt).toISOString().slice(0, 10);
    return buildDraftArtifactDefaultPath({ title: `${date} ${input.title}` });
  }

  if (input.noteConfig.fileNaming === 'pdf-title') {
    const pdfTitle = findPdfSourceTitle(input.result);
    if (pdfTitle) {
      return buildDraftArtifactDefaultPath({ title: `${pdfTitle} Reading Note` });
    }
  }

  return buildDraftArtifactDefaultPath({ title: input.title });
}

function buildNoteTakingDraftContent(input: NoteTakingDraftPlanInput): string {
  const contracts = buildCitationContracts(input.result.promptContext.evidenceRefs);
  // Root-qualified workspace links remain valid if the user moves the draft or changes its target.
  return input.result.answer.trim().replace(
    /(`{3,}[\s\S]*?`{3,}|~{3,}[\s\S]*?~{3,}|`[^`\n]*`)|\[([^\]\n]+)\]\((citation:[^)\s]+)\)/g,
    (original, code: string | undefined, label: string, token: string) => {
      if (code) return original;
      const link = classifyStrictAiLink(token, contracts);
      if (link.kind !== 'citation') return label;
      return `[${label}](/${link.href.replace(/^\/+/, '')})`;
    },
  );
}

function directoryPdfParent(result: ResearchAgentRunResult, citedPaths: readonly string[]): string | undefined {
  const reading = result.session.documentResearch;
  const directory = reading?.directory;
  if (!directory || directory.version !== 2 || !directory.workspaceKey || !directory.manifest?.complete || !Array.isArray(directory.files)
    || directory.files.some(file => !file || typeof file.path !== 'string')
    || (reading?.workspaceKey && reading.workspaceKey !== directory.workspaceKey)) return undefined;
  // A bounded citation menu is not the task's complete source set. Count failed
  // and unopened PDFs too, so a partially read multi-PDF task cannot narrow itself.
  const pdfs = directory.files.filter(file => file && (/\.pdf$/i.test(file.path) || file.snapshot?.kind === 'pdf'
    || Array.isArray(file.checkpoint?.coverage) && file.checkpoint.coverage.some(coverage => coverage?.kind === 'pdf')));
  if (pdfs.length !== 1) return undefined;
  const file = pdfs[0], snapshot = file.snapshot, checkpoint = file.checkpoint;
  const path = file.path;
  if (typeof path !== 'string' || !/\.pdf$/i.test(path) || /^(?:[a-z][a-z\d+.-]*:|\/)|[\\\u0000-\u001f]/iu.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..')
    || citedPaths.some(cited => cited !== path)
    || !snapshot || snapshot.path !== path || snapshot.kind !== 'pdf' || snapshot.unitLabel !== 'page' || snapshot.cloudIdentity
    || snapshot.workspaceKey !== directory.workspaceKey || !snapshot.sourceId || typeof snapshot.version !== 'string' || !snapshot.version.trim()
    || !Number.isSafeInteger(snapshot.totalUnits) || snapshot.totalUnits < 1
    || !checkpoint || checkpoint.version !== 1 || !Array.isArray(checkpoint.sources) || checkpoint.sources.length !== 1
    || !Array.isArray(checkpoint.coverage) || checkpoint.coverage.length !== 1 || !Array.isArray(checkpoint.summaries)
    || !Number.isSafeInteger(checkpoint.completedBatches) || checkpoint.completedBatches < 1 || checkpoint.completedBatches !== checkpoint.summaries.length
    || checkpoint.summaries.some(summary => typeof summary !== 'string' || !summary.trim())) return undefined;
  const source = checkpoint.sources[0], coverage = checkpoint.coverage[0];
  const validUnit = (unit: number) => Number.isSafeInteger(unit) && unit >= 1 && unit <= snapshot.totalUnits;
  if (!source || source.path !== path || source.version !== snapshot.version || source.totalUnits !== snapshot.totalUnits
    || !coverage || coverage.path !== path || coverage.kind !== 'pdf' || coverage.unitLabel !== 'page' || coverage.totalUnits !== snapshot.totalUnits
    || !Array.isArray(coverage.readUnits) || !Array.isArray(source.completedUnits) || !source.offsets || typeof source.offsets !== 'object' || Array.isArray(source.offsets)
    || coverage.readUnits.some(unit => !validUnit(unit)) || source.completedUnits.length !== coverage.readUnits.length
    || !source.completedUnits.every(unit => coverage.readUnits.includes(unit))) return undefined;
  const readFragment = Object.entries(source.offsets).some(([unit, offset]) => validUnit(Number(unit)) && Number.isSafeInteger(offset) && offset > 0);
  return coverage.readUnits.length || readFragment ? path : undefined;
}

function pdfChildTargetForRequest(result: ResearchAgentRunResult): AiDraftSuggestion['pdfChildTarget'] {
  const task = result.session.task;
  const request = parsePdfMarkdownChildRequest(task);
  if (!request) return undefined;
  const paths = [...new Set(buildCitationContracts(result.promptContext.evidenceRefs)
    .filter(ref => ref.evidenceRef.kind === 'pdf_page' || ref.evidenceRef.kind === 'pdf_annotation')
    .map(ref => ref.canonicalPath))];
  const directory = result.session.documentResearch?.directory;
  const sourcePath = directory ? directoryPdfParent(result, paths) : paths.length === 1 ? paths[0] : undefined;
  if (!sourcePath || !/\.pdf$/i.test(sourcePath)) return undefined;
  const fileName = request.fileName ?? `${titleFromPathLike(sourcePath) || 'PDF'} Reading Note.md`;
  return {
    sourcePath,
    suggestedTargetPath: `${getDefaultPdfItemFolderPath(sourcePath)}/${fileName}`,
    workspaceKey: directory?.workspaceKey ?? result.session.documentResearch?.workspaceKey ?? result.workspaceSummary?.workspaceKey,
  };
}

export function buildNoteTakingDraftSuggestion(
  input: NoteTakingDraftPlanInput,
): AiDraftSuggestion | undefined {
  const workflowId = input.workflow?.id ?? input.result.workflowId ?? 'markdown-research';
  if (workflowId === 'pdf-annotation' && requestsMarkdownDocument(input.result.session.task)) {
    input = { ...input, result: { ...input.result, answer: preparePdfAnnotationProposal(input.result.answer, input.result.promptContext.evidenceRefs).text } };
  }
  if (!input.result.answer.trim() || input.result.session.status === 'failed'
    || input.result.session.status === 'cancelled'
    || /^(?:Task:|Question:|仅完成上下文收集)/.test(input.result.answer.trim())) return undefined;
  const title = buildNoteTakingDraftTitle(input);
  const pdfChildTarget = pdfChildTargetForRequest(input.result);
  const shared = {
    title,
    content: buildNoteTakingDraftContent(input),
    targetPath: pdfChildTarget?.suggestedTargetPath ?? buildNoteTakingDraftTargetPath({
      title,
      noteConfig: input.noteConfig,
      result: input.result,
    }),
    ...(pdfChildTarget ? { pdfChildTarget } : {}),
    writeMode: 'create' as const,
  };

  switch (workflowId) {
    case 'reading-note':
    case 'paper-reading':
      return {
        type: 'paper_note',
        templateId: 'reading-note',
        ...shared,
      };

    case 'notebook-analysis':
    case 'notebook-from-paper':
      return {
        type: 'code_explainer',
        templateId: 'code-note',
        ...shared,
      };

    case 'literature-matrix':
      return {
        type: 'comparison_summary',
        templateId: 'comparison-summary',
        ...shared,
      };

    case 'pdf-annotation':
      return requestsMarkdownDocument(input.result.session.task)
        ? { type: 'paper_note', templateId: 'reading-note', ...shared }
        : undefined;
    case 'teaching-explain':
    case 'knowledge-organization':
    case 'code-change-plan':
      return undefined;

    case 'markdown-research':
    default:
      return {
        type: 'research_summary',
        templateId: 'research-summary',
        ...shared,
      };
  }
}
