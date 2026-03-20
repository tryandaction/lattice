import type { RunnerExecutionRequest, RunnerType } from "@/lib/runner/types";

export interface RunnerDefinition {
  runnerType: RunnerType;
  command?: string;
  displayName: string;
  supportsInlineCode: boolean;
  buildArgs: (params: { code?: string; filePath?: string; mode: RunnerExecutionRequest["mode"] }) => string[];
}

const FILE_ARG = (filePath?: string) => (filePath ? [filePath] : []);

const RUNNER_ALIASES: Record<string, string> = {
  python: "py",
  py: "py",
  javascript: "js",
  js: "js",
  node: "js",
  julia: "jl",
  jl: "jl",
  r: "r",
};

export const RUNNER_DEFINITIONS: Record<string, RunnerDefinition> = {
  py: {
    runnerType: "python-local",
    displayName: "Python",
    supportsInlineCode: true,
    buildArgs: () => [],
  },
  js: {
    runnerType: "external-command",
    command: "node",
    displayName: "Node.js",
    supportsInlineCode: true,
    buildArgs: ({ code, filePath, mode }) => (mode === "file" ? FILE_ARG(filePath) : code ? ["-e", code] : []),
  },
  mjs: {
    runnerType: "external-command",
    command: "node",
    displayName: "Node.js",
    supportsInlineCode: true,
    buildArgs: ({ code, filePath, mode }) => (mode === "file" ? FILE_ARG(filePath) : code ? ["-e", code] : []),
  },
  cjs: {
    runnerType: "external-command",
    command: "node",
    displayName: "Node.js",
    supportsInlineCode: true,
    buildArgs: ({ code, filePath, mode }) => (mode === "file" ? FILE_ARG(filePath) : code ? ["-e", code] : []),
  },
  jl: {
    runnerType: "external-command",
    command: "julia",
    displayName: "Julia",
    supportsInlineCode: true,
    buildArgs: ({ code, filePath, mode }) => (mode === "file" ? FILE_ARG(filePath) : code ? ["-e", code] : []),
  },
  r: {
    runnerType: "external-command",
    command: "Rscript",
    displayName: "Rscript",
    supportsInlineCode: true,
    buildArgs: ({ code, filePath, mode }) => (mode === "file" ? FILE_ARG(filePath) : code ? ["-e", code] : []),
  },
};

export function getRunnerDefinition(extension: string): RunnerDefinition | null {
  const normalized = normalizeRunnerLanguage(extension);
  return normalized ? RUNNER_DEFINITIONS[normalized] ?? null : null;
}

export function normalizeRunnerLanguage(language: string | null | undefined): string | null {
  if (!language) {
    return null;
  }
  const normalized = language.trim().toLowerCase();
  return RUNNER_ALIASES[normalized] ?? normalized;
}
