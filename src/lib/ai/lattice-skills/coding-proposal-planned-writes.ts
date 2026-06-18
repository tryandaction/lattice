import type { AiPlannedWrite, AiTaskProposalStep, EvidenceRef } from '../types';
import { buildDraftArtifactDefaultPath } from '../workbench-actions';
import {
  buildCodingQaCommandPlan,
  formatCodingQaCommandPlan,
} from './coding-qa-command-plan';

export interface RawCodingPlannedWrite {
  targetPath?: string;
  mode?: 'create' | 'append' | 'update';
  contentPreview?: string;
}

export interface LatticeCodingProposalPlannedWritesInput {
  requestedWrites?: RawCodingPlannedWrite[];
  prompt: string;
  summary: string;
  steps: AiTaskProposalStep[];
  evidenceRefs: EvidenceRef[];
  filePath?: string;
}

const CODE_PATH_PATTERN = /(?:^|[\s`"'([{])((?:[\w.-]+\/)+[\w.-]+\.(?:[cm]?[jt]sx?|tsx?|py|rs|go|java|kt|kts|cs|cpp|cc|cxx|c|h|hpp|swift|rb|php|vue|svelte|astro|css|scss|sass|less|json|ya?ml|toml|ini|sh|ps1|mjs|cjs))(?:$|[\s`"'),\]}:])/gi;
const CODE_FILE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?|tsx?|py|rs|go|java|kt|kts|cs|cpp|cc|cxx|c|h|hpp|swift|rb|php|vue|svelte|astro|css|scss|sass|less|json|ya?ml|toml|ini|sh|ps1|mjs|cjs)$/i;
const QA_COMMAND_LINE_PATTERN = /\b(?:npm run|npx vitest|\.\/node_modules\/\.bin\/vitest\.cmd|git|curl|wget|npm install|pnpm install|yarn add|rm|del|erase|rmdir)\b/i;

function normalizeTitle(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s._-]/gu, '')
    .trim()
    .slice(0, 90)
    .trim() || 'Code Change';
}

function normalizeTargetPath(path: string | undefined): string | null {
  const normalized = (path ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .trim();

  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split('/').some((part) => part === '..')
  ) {
    return null;
  }

  return normalized;
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      return [];
    }
    seen.add(trimmed);
    return [trimmed];
  });
}

function extractCodePaths(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(CODE_PATH_PATTERN)) {
    const normalized = normalizeTargetPath(match[1]);
    if (normalized) {
      paths.push(normalized);
    }
  }
  return unique(paths).slice(0, 8);
}

function buildTargetFiles(input: LatticeCodingProposalPlannedWritesInput): string[] {
  return unique([
    normalizeTargetPath(input.filePath),
    ...input.evidenceRefs.map((ref) => normalizeTargetPath(ref.locator.split('#', 1)[0])),
    ...extractCodePaths(`${input.summary}\n${input.prompt}`),
    ...(input.requestedWrites ?? []).map((write) => normalizeTargetPath(write.targetPath)),
  ]).slice(0, 10);
}

function formatSteps(steps: AiTaskProposalStep[]): string {
  if (steps.length === 0) {
    return '1. Inspect target files - Review the cited code context before preparing any patch.';
  }

  return steps
    .slice(0, 8)
    .map((step, index) => `${index + 1}. ${step.title} - ${step.description}`)
    .join('\n');
}

function formatEvidence(evidenceRefs: EvidenceRef[]): string {
  if (evidenceRefs.length === 0) {
    return '- No explicit code evidence refs resolved yet. Review target files before writeback.';
  }

  return evidenceRefs
    .slice(0, 8)
    .map((ref) => `- ${ref.label} (${ref.locator})${ref.preview ? ` - ${ref.preview.slice(0, 180)}` : ''}`)
    .join('\n');
}

function extractRequestedQaCommands(input: LatticeCodingProposalPlannedWritesInput): string[] {
  const text = [
    input.prompt,
    input.summary,
    ...(input.requestedWrites ?? []).map((write) => write.contentPreview ?? ''),
  ].join('\n');

  return unique(text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s>*-]+/, '').trim())
    .filter((line) => QA_COMMAND_LINE_PATTERN.test(line))
    .map((line) => {
      const commandStart = line.search(QA_COMMAND_LINE_PATTERN);
      return commandStart >= 0 ? line.slice(commandStart).trim() : line;
    }));
}

function buildCodingContentPreview(input: LatticeCodingProposalPlannedWritesInput): string {
  const targetFiles = buildTargetFiles(input);
  const targetBlock = targetFiles.length > 0
    ? targetFiles.map((path) => `- ${path}`).join('\n')
    : '- Target files must be selected from cited workspace evidence before implementation.';
  const qaPlan = buildCodingQaCommandPlan({
    targetFiles,
    requestedCommands: extractRequestedQaCommands(input),
  });

  return [
    `Coding proposal: ${input.summary}`,
    '',
    'Target files:',
    targetBlock,
    '',
    'Patch preview:',
    '- Draft a minimal diff against the target files above. Keep this as a proposal until reviewed.',
    '- Include function/component names and changed behavior in the final patch draft.',
    '',
    'Review steps:',
    formatSteps(input.steps),
    '',
    'Risks:',
    '- Verify no direct source write, shell command, network call, package manager action, or git operation has been executed by the agent.',
    '- Check for API contract changes, UI regression risk, path safety, and stale tests.',
    '',
    'Test plan:',
    formatCodingQaCommandPlan(qaPlan),
    '',
    'Evidence:',
    formatEvidence(input.evidenceRefs),
    '',
    'Approval path:',
    '- Review this Workbench proposal.',
    '- Approve planned writes only after checking target files, patch preview, risks, and test plan.',
    '- Generate target drafts from approved proposal writes before applying workspace writeback.',
  ].join('\n');
}

function normalizeRequestedCodingWrites(input: LatticeCodingProposalPlannedWritesInput): AiPlannedWrite[] {
  return (input.requestedWrites ?? []).flatMap((write) => {
    const targetPath = normalizeTargetPath(write.targetPath);
    if (!targetPath || !write.mode) {
      return [];
    }

    return [{
      targetPath,
      mode: write.mode,
      contentPreview: write.contentPreview?.trim() || buildCodingContentPreview(input),
    }];
  });
}

export function buildLatticeCodingProposalPlannedWrites(
  input: LatticeCodingProposalPlannedWritesInput,
): AiPlannedWrite[] {
  const normalized = normalizeRequestedCodingWrites(input);
  if (normalized.length > 0) {
    return normalized;
  }

  const title = normalizeTitle(input.summary || input.prompt);
  return [{
    targetPath: buildDraftArtifactDefaultPath({ title: `${title} Code Review Plan` }),
    mode: 'create',
    contentPreview: buildCodingContentPreview(input),
  }];
}

export function isLikelyCodingProposal(input: Pick<LatticeCodingProposalPlannedWritesInput, 'prompt' | 'summary' | 'filePath'>): boolean {
  const text = [input.prompt, input.summary, input.filePath].filter(Boolean).join('\n').toLowerCase();
  const filePath = normalizeTargetPath(input.filePath);
  return (
    text.includes('code-change-plan') ||
    text.includes('workflow: code change plan') ||
    /\bcode review\b/.test(text) ||
    /\bpatch\b/.test(text) ||
    /\bdiff\b/.test(text) ||
    /\btypecheck\b/.test(text) ||
    /\bunit test\b/.test(text) ||
    /代码审查|代码评审|代码变更|变更计划|补丁|测试计划/.test(text) ||
    Boolean(filePath && CODE_FILE_EXTENSION_PATTERN.test(filePath))
  );
}
