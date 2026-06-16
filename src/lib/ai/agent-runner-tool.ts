"use client";

import { getRunnerDefinitionForLanguage } from "@/lib/runner/preferences";
import {
  runnerEventToTextOutputs,
  runnerManager,
} from "@/lib/runner/runner-manager";
import type {
  ExecutionOutput,
  ExecutionRunResult,
  RunnerExecutionRequest,
} from "@/lib/runner/types";

export interface RunCodeToolArgs {
  language: "javascript" | "python" | string;
  code: string;
}

export function executionOutputsToText(outputs: ExecutionOutput[], result: ExecutionRunResult): string {
  const renderedOutputs = outputs
    .map((output) => {
      switch (output.type) {
        case "text":
          return output.content;
        case "error":
          return output.content;
        case "image":
          return "[image output]";
        case "html":
          return "[html output]";
        case "svg":
          return "[svg output]";
      }
    })
    .filter((value): value is string => Boolean(value?.trim()));

  if (renderedOutputs.length > 0) {
    return renderedOutputs.join("\n").trim();
  }

  return result.success
    ? `Execution completed. Exit code: ${result.exitCode ?? 0}`
    : `Execution failed. Exit code: ${result.exitCode ?? "unknown"}`;
}

export async function runCodeWithWorkspaceRunner(args: RunCodeToolArgs): Promise<{ output: string }> {
  const runnerDefinition = getRunnerDefinitionForLanguage(args.language);
  if (!runnerDefinition) {
    throw new Error(`No runner is configured for language: ${args.language}`);
  }

  const request: RunnerExecutionRequest = {
    runnerType: runnerDefinition.runnerType,
    command: runnerDefinition.command,
    code: args.code,
    args: runnerDefinition.buildArgs({
      code: args.code,
      mode: "inline",
    }),
    mode: "inline",
    allowPyodideFallback: true,
  };

  const session = runnerManager.createSession();
  const outputs: ExecutionOutput[] = [];
  const unsubscribe = session.onEvent((event) => {
    outputs.push(...runnerEventToTextOutputs(event));
  });

  try {
    const result = await session.run(request);
    const output = executionOutputsToText(outputs, result);
    if (!result.success) {
      throw new Error(output);
    }
    return { output };
  } finally {
    unsubscribe();
    session.dispose();
  }
}
