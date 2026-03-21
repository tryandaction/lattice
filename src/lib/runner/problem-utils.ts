import type {
  ExecutionContextRef,
  ExecutionDiagnostic,
  ExecutionOutput,
  ExecutionProblem,
  RunnerHealthIssue,
} from "@/lib/runner/types";

function buildProblemId(prefix: string, title: string, message: string, context?: ExecutionContextRef | null): string {
  return [
    prefix,
    title,
    message,
    context?.kind ?? "",
    context?.filePath ?? "",
    context?.blockKey ?? "",
    context?.cellId ?? "",
    context?.line ?? "",
  ].join(":");
}

function cloneContext(
  context?: ExecutionContextRef | null,
  nextValues?: Partial<ExecutionContextRef>,
): ExecutionContextRef | null {
  if (!context && !nextValues) {
    return null;
  }
  return {
    ...(context ?? { kind: "file" }),
    ...(nextValues ?? {}),
  };
}

function parseTracebackLocation(
  traceback: string[] = [],
  context?: ExecutionContextRef | null,
): Partial<ExecutionContextRef> | null {
  for (const line of traceback) {
    const match = line.match(/File "([^"]+)", line (\d+)/);
    if (!match) {
      continue;
    }

    const lineNumber = Number(match[2]);
    if (!Number.isFinite(lineNumber)) {
      continue;
    }

    const fileInTrace = match[1];
    if (context?.kind === "markdown-block" && context.range?.startLine) {
      return {
        filePath: context.filePath,
        line: context.range.startLine + lineNumber,
      };
    }

    if (context?.kind === "notebook-cell") {
      return {
        line: lineNumber,
      };
    }

    if (!context?.filePath || fileInTrace === context.filePath || fileInTrace.startsWith("<lattice-")) {
      return {
        filePath: context?.filePath ?? fileInTrace,
        line: lineNumber,
      };
    }
  }

  return null;
}

export function diagnosticsToExecutionProblems(
  diagnostics: ExecutionDiagnostic[],
  source: ExecutionProblem["source"],
  context?: ExecutionContextRef | null,
): ExecutionProblem[] {
  return diagnostics.map((diagnostic) => ({
    id: buildProblemId(source, diagnostic.title, diagnostic.message, context),
    source,
    severity: diagnostic.severity,
    title: diagnostic.title,
    message: diagnostic.message,
    hint: diagnostic.hint,
    context: context ?? null,
  }));
}

export function outputsToExecutionProblems(
  outputs: ExecutionOutput[],
  context?: ExecutionContextRef | null,
): ExecutionProblem[] {
  return outputs.flatMap((output, index) => {
    if (output.type !== "error") {
      return [];
    }

    const location = parseTracebackLocation(output.traceback, context);
    const resolvedContext = cloneContext(context, location ?? undefined);
    const title = output.errorName ?? "运行失败";
    const message = output.errorValue ?? output.content;

    return [
      {
        id: buildProblemId("runtime", title, `${message}:${index}`, resolvedContext),
        source: "runtime",
        severity: "error",
        title,
        message,
        errorName: output.errorName,
        errorValue: output.errorValue,
        traceback: output.traceback,
        context: resolvedContext,
      },
    ];
  });
}

export function runnerHealthIssuesToExecutionProblems(
  issues: RunnerHealthIssue[],
  context?: ExecutionContextRef | null,
): ExecutionProblem[] {
  return issues.map((issue) => ({
    id: buildProblemId("health", issue.title, issue.message, context),
    source: "health",
    severity: issue.severity,
    title: issue.title,
    message: issue.message,
    hint: issue.hint,
    code: issue.code,
    actions: issue.actions,
    context: context ?? null,
  }));
}

export function mergeExecutionProblems(...problemGroups: Array<ExecutionProblem[] | null | undefined>): ExecutionProblem[] {
  const merged = new Map<string, ExecutionProblem>();
  for (const problems of problemGroups) {
    if (!problems?.length) {
      continue;
    }
    for (const problem of problems) {
      if (!merged.has(problem.id)) {
        merged.set(problem.id, problem);
      }
    }
  }
  return Array.from(merged.values());
}
