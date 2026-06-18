import type { AiTaskProposal } from './types';

export interface CodingProposalQaView {
  allowed: string[];
  suggested: string[];
  rejected: string[];
  executionBoundary: string[];
}

export interface CodingProposalViewModel {
  targetFiles: string[];
  patchPreview: string[];
  risks: string[];
  approvalPath: string[];
  qa: CodingProposalQaView;
  hasRejectedQaCommands: boolean;
}

const CODE_PATH_PATTERN = /^(?:src|scripts|docs|tests|app|components|lib|packages|plugins|public)\/.+\.(?:[cm]?[jt]sx?|tsx?|py|rs|go|java|kt|kts|cs|cpp|cc|cxx|c|h|hpp|swift|rb|php|vue|svelte|astro|css|scss|sass|less|json|ya?ml|toml|ini|sh|ps1|mjs|cjs|mdx?)$/i;
const CODING_MARKER_PATTERN = /\b(?:Coding proposal|Target files|Patch preview|Allowed QA commands|Rejected \/ deferred commands|code-change-plan|coding-change-review)\b/i;

const TOP_LEVEL_SECTIONS = [
  'Target files',
  'Patch preview',
  'Review steps',
  'Risks',
  'Test plan',
  'Evidence',
  'Approval path',
];

const QA_SECTIONS = [
  'Allowed QA commands',
  'Suggested QA commands',
  'Rejected / deferred commands',
  'Execution boundary',
];

function previewText(proposal: AiTaskProposal): string {
  return proposal.plannedWrites
    .map((write) => write.contentPreview)
    .filter(Boolean)
    .join('\n\n');
}

function isSectionHeading(line: string, labels: string[]): boolean {
  const normalized = line.trim().replace(/:$/, '').toLowerCase();
  return labels.some((label) => normalized === label.toLowerCase());
}

function extractSection(text: string, label: string, labels: string[]): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => isSectionHeading(line, [label]));
  if (start < 0) {
    return [];
  }

  const collected: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (isSectionHeading(line, labels)) {
      break;
    }
    collected.push(line);
  }
  return collected;
}

function topLevelBullets(lines: string[]): string[] {
  return unique(lines.flatMap((line) => {
    const match = line.match(/^-\s+(.+)$/);
    if (!match) {
      return [];
    }
    const value = match[1].trim();
    if (!value || /^No\s+/i.test(value)) {
      return [];
    }
    return [value];
  }));
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function targetFilesFromProposal(proposal: AiTaskProposal, text: string): string[] {
  const targetSection = topLevelBullets(extractSection(text, 'Target files', TOP_LEVEL_SECTIONS));
  const plannedWriteTargets = proposal.plannedWrites
    .map((write) => write.targetPath)
    .filter((targetPath) => CODE_PATH_PATTERN.test(targetPath));

  return unique([...targetSection, ...plannedWriteTargets]).slice(0, 12);
}

function deriveQaView(testPlanLines: string[]): CodingProposalQaView {
  const testPlan = testPlanLines.join('\n');
  return {
    allowed: topLevelBullets(extractSection(testPlan, 'Allowed QA commands', QA_SECTIONS)),
    suggested: topLevelBullets(extractSection(testPlan, 'Suggested QA commands', QA_SECTIONS)),
    rejected: topLevelBullets(extractSection(testPlan, 'Rejected / deferred commands', QA_SECTIONS)),
    executionBoundary: topLevelBullets(extractSection(testPlan, 'Execution boundary', QA_SECTIONS)),
  };
}

function hasCodingShape(proposal: AiTaskProposal, text: string): boolean {
  if (CODING_MARKER_PATTERN.test(text) || CODING_MARKER_PATTERN.test(proposal.summary)) {
    return true;
  }

  return proposal.plannedWrites.some((write) =>
    write.mode === 'update' && CODE_PATH_PATTERN.test(write.targetPath)
  );
}

export function buildCodingProposalViewModel(proposal: AiTaskProposal): CodingProposalViewModel | null {
  const text = previewText(proposal);
  if (!hasCodingShape(proposal, text)) {
    return null;
  }

  const testPlanLines = extractSection(text, 'Test plan', TOP_LEVEL_SECTIONS);
  const qa = deriveQaView(testPlanLines);
  const targetFiles = targetFilesFromProposal(proposal, text);
  const patchPreview = topLevelBullets(extractSection(text, 'Patch preview', TOP_LEVEL_SECTIONS));
  const risks = topLevelBullets(extractSection(text, 'Risks', TOP_LEVEL_SECTIONS));
  const approvalPath = topLevelBullets(extractSection(text, 'Approval path', TOP_LEVEL_SECTIONS));

  return {
    targetFiles,
    patchPreview: patchPreview.length > 0
      ? patchPreview
      : unique(proposal.plannedWrites.map((write) => write.contentPreview).filter(Boolean)).slice(0, 4),
    risks,
    approvalPath,
    qa,
    hasRejectedQaCommands: qa.rejected.length > 0,
  };
}
