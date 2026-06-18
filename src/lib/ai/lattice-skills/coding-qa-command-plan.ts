export type CodingQaCommandStatus = 'allowed' | 'rejected' | 'suggested';

export interface CodingQaCommandPlanItem {
  command: string;
  status: CodingQaCommandStatus;
  reason: string;
  risk: string;
  approval: 'required';
}

export interface CodingQaCommandPlanInput {
  targetFiles: string[];
  requestedCommands?: string[];
  touchedSharedContracts?: boolean;
  touchedDocs?: boolean;
}

export interface CodingQaCommandPlan {
  allowed: CodingQaCommandPlanItem[];
  rejected: CodingQaCommandPlanItem[];
  suggested: CodingQaCommandPlanItem[];
}

const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/i;
const SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?|tsx?|py|rs|go|java|kt|kts|cs|cpp|cc|cxx|c|h|hpp|vue|svelte|astro)$/i;
const DOC_FILE_PATTERN = /\.(?:md|mdx|markdown)$/i;
const SHARED_CONTRACT_PATTERN = /(?:^|\/)(?:types|schema|schemas|contracts|agent-policy|agent-tool-broker|research-agent-workflows|operation-contract|skill-registry)\b/i;
const DANGEROUS_COMMAND_PATTERN = /(?:^|\s)(?:git|rm|del|erase|rmdir|curl|wget|ssh|scp|npm\s+(?:install|update|audit|publish)|pnpm\s+(?:install|update|publish)|yarn\s+(?:add|install|upgrade|publish)|npx\s+wrangler|tauri\s+build)\b|[;&|<>`]/i;

function normalizePath(path: string): string | null {
  const normalized = path
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

function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, ' ').trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function commandItem(
  command: string,
  status: CodingQaCommandStatus,
  reason: string,
  risk: string,
): CodingQaCommandPlanItem {
  return {
    command,
    status,
    reason,
    risk,
    approval: 'required',
  };
}

function isAllowedCommand(command: string): boolean {
  if (DANGEROUS_COMMAND_PATTERN.test(command)) {
    return false;
  }

  return (
    command === 'npm run typecheck' ||
    command === 'npm run test:docs' ||
    command === 'npm run qa:agent-smoke -- --unit-only' ||
    /^npx vitest run "(?:src\/[^"]+\.(?:test|spec)\.[cm]?[jt]sx?)"(?: "(?:src\/[^"]+\.(?:test|spec)\.[cm]?[jt]sx?)")* --maxWorkers=[12]$/.test(command) ||
    /^\.\/node_modules\/\.bin\/vitest\.cmd run "(?:src\/[^"]+\.(?:test|spec)\.[cm]?[jt]sx?)"(?: "(?:src\/[^"]+\.(?:test|spec)\.[cm]?[jt]sx?)")* --maxWorkers=[12]$/.test(command)
  );
}

function buildFocusedVitestCommand(targetFiles: string[]): string | null {
  const testFiles = targetFiles
    .filter((path) => TEST_FILE_PATTERN.test(path) && path.startsWith('src/'))
    .slice(0, 4);

  if (testFiles.length === 0) {
    return null;
  }

  return `npx vitest run ${testFiles.map((path) => `"${path}"`).join(' ')} --maxWorkers=1`;
}

function buildSuggestedCommands(input: CodingQaCommandPlanInput, targetFiles: string[]): string[] {
  const suggestions: string[] = [];
  const focusedVitest = buildFocusedVitestCommand(targetFiles);
  const touchesSource = targetFiles.some((path) => SOURCE_FILE_PATTERN.test(path));
  const touchesDocs = input.touchedDocs ?? targetFiles.some((path) => DOC_FILE_PATTERN.test(path));
  const touchesSharedContracts = input.touchedSharedContracts ?? targetFiles.some((path) => SHARED_CONTRACT_PATTERN.test(path));

  if (focusedVitest) {
    suggestions.push(focusedVitest);
  }
  if (touchesSharedContracts || touchesSource) {
    suggestions.push('npm run typecheck');
  }
  if (touchesDocs) {
    suggestions.push('npm run test:docs');
  }
  if (targetFiles.some((path) => path.includes('/ai/') || path.includes('/__tests__/ai-'))) {
    suggestions.push('npm run qa:agent-smoke -- --unit-only');
  }

  if (suggestions.length === 0) {
    suggestions.push('npm run typecheck');
  }

  return unique(suggestions);
}

export function buildCodingQaCommandPlan(input: CodingQaCommandPlanInput): CodingQaCommandPlan {
  const targetFiles = unique(input.targetFiles.flatMap((path) => {
    const normalized = normalizePath(path);
    return normalized ? [normalized] : [];
  }));

  const requested = unique((input.requestedCommands ?? [])
    .map(normalizeCommand)
    .filter(Boolean));

  const allowedRequested = requested
    .filter(isAllowedCommand)
    .map((command) => commandItem(
      command,
      'allowed',
      'Requested command matches the coding QA allowlist and still requires user approval before execution.',
      'May take time or fail due to unrelated workspace state; review output before applying writes.',
    ));

  const rejected = requested
    .filter((command) => !isAllowedCommand(command))
    .map((command) => commandItem(
      command,
      'rejected',
      'Command is outside the coding QA allowlist or contains shell chaining, network, package manager, git, destructive, or release operations.',
      'Do not execute from the agent proposal. Create a separate reviewed task if this command is truly needed.',
    ));

  const alreadyAllowed = new Set(allowedRequested.map((item) => item.command));
  const suggested = buildSuggestedCommands(input, targetFiles)
    .filter((command) => !alreadyAllowed.has(command))
    .map((command) => commandItem(
      command,
      'suggested',
      'Suggested by Lattice from target files and workflow scope; it is a plan item only.',
      'Requires user approval and may be blocked by unrelated project state.',
    ));

  return {
    allowed: allowedRequested,
    rejected,
    suggested,
  };
}

export function formatCodingQaCommandPlan(plan: CodingQaCommandPlan): string {
  const formatItems = (items: CodingQaCommandPlanItem[], empty: string) =>
    items.length > 0
      ? items.map((item) => [
          `- ${item.command}`,
          `  - Status: ${item.status}`,
          `  - Approval: ${item.approval}`,
          `  - Reason: ${item.reason}`,
          `  - Risk: ${item.risk}`,
        ].join('\n')).join('\n')
      : empty;

  return [
    'Allowed QA commands:',
    formatItems(plan.allowed, '- No user-requested QA commands matched the allowlist.'),
    '',
    'Suggested QA commands:',
    formatItems(plan.suggested, '- No additional QA commands suggested.'),
    '',
    'Rejected / deferred commands:',
    formatItems(plan.rejected, '- No rejected commands.'),
    '',
    'Execution boundary:',
    '- These are approval-gated command plans only; the Research Agent has not executed shell, git, network, package manager, release, or destructive commands.',
  ].join('\n');
}
