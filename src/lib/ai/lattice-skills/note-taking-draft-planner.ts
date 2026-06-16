import type { ResearchAgentRunResult } from '../research-agent';
import type { AiDraftSuggestion, EvidenceRef } from '../types';
import { buildDraftArtifactDefaultPath } from '../workbench-actions';
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

function formatDraftEvidenceSection(refs: EvidenceRef[]): string {
  if (refs.length === 0) {
    return '- No explicit evidence refs resolved yet. Review sources before writeback.';
  }

  return refs
    .slice(0, 12)
    .map((ref, index) => {
      const preview = ref.preview ? ` - ${normalizeDraftTitlePart(ref.preview, 160)}` : '';
      return `${index + 1}. ${ref.label} (${ref.locator})${preview}`;
    })
    .join('\n');
}

function extractWorkflowOutput(answer: string): string {
  const marker = 'Workflow output:';
  const index = answer.indexOf(marker);
  if (index < 0) {
    return answer.trim();
  }
  return answer.slice(index).trim();
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
  const workflowTitle = input.workflow?.title ?? input.result.workflowTitle ?? 'Markdown Research';
  const sections = input.noteConfig.sections.length > 0
    ? input.noteConfig.sections
    : ['Summary', 'Evidence', 'Open questions'];
  const evidence = formatDraftEvidenceSection(input.result.promptContext.evidenceRefs);
  const workflowOutput = extractWorkflowOutput(input.result.answer);
  const sectionScaffold = sections
    .map((section) => `### ${section}\n\n- Review and refine this section against the evidence above.`)
    .join('\n\n');

  return [
    `> Workflow: ${workflowTitle}`,
    `> Note style: ${input.noteConfig.noteStyle}`,
    `> Quote policy: ${input.noteConfig.quotePolicy}`,
    `> Annotation policy: ${input.noteConfig.annotationPolicy}`,
    `> Approval mode: ${input.noteConfig.approvalMode}`,
    '',
    '## Evidence-backed draft',
    '',
    workflowOutput || input.result.answer.trim() || '_No draft content generated._',
    '',
    '## Evidence',
    '',
    evidence,
    '',
    '## Configured Sections',
    '',
    sectionScaffold,
  ].join('\n');
}

export function buildNoteTakingDraftSuggestion(
  input: NoteTakingDraftPlanInput,
): AiDraftSuggestion | undefined {
  const workflowId = input.workflow?.id ?? input.result.workflowId ?? 'markdown-research';
  const title = buildNoteTakingDraftTitle(input);
  const shared = {
    title,
    content: buildNoteTakingDraftContent(input),
    targetPath: buildNoteTakingDraftTargetPath({
      title,
      noteConfig: input.noteConfig,
      result: input.result,
    }),
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

    case 'teaching-explain':
    case 'knowledge-organization':
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
