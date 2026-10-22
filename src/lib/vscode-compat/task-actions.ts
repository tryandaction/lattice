import type { RunnerExecutionRequest } from "@/lib/runner/types";
import { openDesktopTerminalAtPath } from "@/lib/desktop-openers";
import { isTauriHost } from "@/lib/storage-adapter";
import type { CommandBarAction } from "@/types/layout";
import type { VSCodeLaunchConfiguration, VSCodeTask } from "./types";

export interface PythonDebugLaunchRequest {
  kind: "python";
  name: string;
  workspaceRootPath: string;
  python?: string;
  target: {
    kind: "program" | "module";
    value: string;
  };
  cwd: string;
  args: string[];
  env?: Record<string, string>;
  justMyCode: boolean;
  stopOnEntry: boolean;
  subProcess: boolean;
}

export type PythonDebugLaunchBuildResult =
  | { supported: true; request: PythonDebugLaunchRequest }
  | { supported: false; reason: string };

export interface NodeDebugLaunchRequest {
  kind: "node";
  name: string;
  workspaceRootPath: string;
  program: string;
  cwd: string;
  runtimeExecutable: string;
  runtimeArgs: string[];
  args: string[];
  env?: Record<string, string>;
  stopOnEntry: boolean;
  sourceMaps: boolean;
  smartStep: boolean;
  skipFiles: string[];
  outFiles: string[];
}

export type NodeDebugLaunchBuildResult =
  | { supported: true; request: NodeDebugLaunchRequest }
  | { supported: false; reason: string };

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const separator = normalized.lastIndexOf("/");
  return separator > 0 ? normalized.slice(0, separator) : normalized;
}

function resolveDebugLaunchValue(
  value: string,
  label: string,
  variables: Record<string, string | null | undefined>,
): { value: string } | { error: string } {
  let resolved = value;
  for (const [name, replacement] of Object.entries(variables)) {
    if (resolved.includes(name)) {
      if (!replacement) {
        return { error: `VS Code variable ${name} in ${label} requires an active workspace file.` };
      }
      resolved = resolved.replaceAll(name, replacement);
    }
  }
  if (/\$\{[^}]+\}/.test(resolved)) {
    return { error: `Unsupported or unresolved VS Code variable in ${label}: ${value}` };
  }
  return { value: resolved };
}

export function buildPythonDebugLaunchRequest(
  launch: VSCodeLaunchConfiguration,
  options: {
    workspaceRootPath?: string | null;
    activeFilePath?: string | null;
    defaultPythonPath?: string | null;
  } = {},
): PythonDebugLaunchBuildResult {
  const type = launch.type.trim().toLowerCase();
  if (type !== "python" && type !== "debugpy") {
    return {
      supported: false,
      reason: `Real debugging is not available yet for ${launch.type} launch configurations.`,
    };
  }
  if (launch.request.trim().toLowerCase() !== "launch") {
    return {
      supported: false,
      reason: "Python attach configurations are not supported yet.",
    };
  }

  const workspaceRootPath = options.workspaceRootPath?.trim();
  if (!workspaceRootPath) {
    return { supported: false, reason: "Python debugging requires an opened desktop workspace." };
  }
  if (Boolean(launch.program) === Boolean(launch.module)) {
    return {
      supported: false,
      reason: "Python debugging requires exactly one program or module target.",
    };
  }

  const activeFilePath = options.activeFilePath?.trim() || null;
  const variables = {
    "${workspaceFolder}": workspaceRootPath,
    "${file}": activeFilePath,
    "${fileDirname}": activeFilePath ? dirname(activeFilePath) : null,
  };
  const targetKind = launch.program ? "program" : "module";
  const rawTarget = launch.program ?? launch.module ?? "";
  const target = resolveDebugLaunchValue(rawTarget, targetKind, variables);
  if ("error" in target) {
    return { supported: false, reason: target.error };
  }
  const rawCwd = launch.cwd || workspaceRootPath;
  const cwd = resolveDebugLaunchValue(rawCwd, "cwd", variables);
  if ("error" in cwd) {
    return { supported: false, reason: cwd.error };
  }

  return {
    supported: true,
    request: {
      kind: "python",
      name: launch.name,
      workspaceRootPath,
      python: launch.python || options.defaultPythonPath || undefined,
      target: { kind: targetKind, value: target.value },
      cwd: cwd.value,
      args: launch.args,
      env: launch.env,
      justMyCode: launch.justMyCode ?? true,
      stopOnEntry: launch.stopOnEntry ?? false,
      subProcess: launch.subProcess ?? true,
    },
  };
}

function normalizeDebugPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function isPathInsideWorkspace(value: string, workspaceRootPath: string): boolean {
  const normalizedValue = normalizeDebugPath(value);
  const normalizedRoot = normalizeDebugPath(workspaceRootPath);
  const isAbsolute = /^[a-zA-Z]:\//.test(normalizedValue) || normalizedValue.startsWith("/");
  if (!isAbsolute) {
    return !normalizedValue.split("/").some((segment) => segment === "..");
  }
  const valueForComparison = /^[a-zA-Z]:\//.test(normalizedValue) ? normalizedValue.toLowerCase() : normalizedValue;
  const rootForComparison = /^[a-zA-Z]:\//.test(normalizedRoot) ? normalizedRoot.toLowerCase() : normalizedRoot;
  return valueForComparison === rootForComparison || valueForComparison.startsWith(`${rootForComparison}/`);
}

export function buildNodeDebugLaunchRequest(
  launch: VSCodeLaunchConfiguration,
  options: {
    workspaceRootPath?: string | null;
    activeFilePath?: string | null;
  } = {},
): NodeDebugLaunchBuildResult {
  const type = launch.type.trim().toLowerCase();
  if (type !== "node" && type !== "pwa-node") {
    return {
      supported: false,
      reason: `Real Node debugging is not available for ${launch.type} launch configurations.`,
    };
  }
  if (launch.request.trim().toLowerCase() !== "launch") {
    return { supported: false, reason: "Node attach configurations are not supported yet." };
  }
  if (launch.console && launch.console !== "internalConsole") {
    return { supported: false, reason: "Node debugging currently supports only the internal console." };
  }

  const workspaceRootPath = options.workspaceRootPath?.trim();
  if (!workspaceRootPath) {
    return { supported: false, reason: "Node debugging requires an opened desktop workspace." };
  }
  if (!launch.program?.trim()) {
    return { supported: false, reason: "Node debugging requires a program target." };
  }

  const activeFilePath = options.activeFilePath?.trim() || null;
  const variables = {
    "${workspaceFolder}": workspaceRootPath,
    "${file}": activeFilePath,
    "${fileDirname}": activeFilePath ? dirname(activeFilePath) : null,
  };
  const program = resolveDebugLaunchValue(launch.program, "program", variables);
  if ("error" in program) return { supported: false, reason: program.error };
  const cwd = resolveDebugLaunchValue(launch.cwd || workspaceRootPath, "cwd", variables);
  if ("error" in cwd) return { supported: false, reason: cwd.error };

  const outFiles: string[] = [];
  for (const rawOutFile of launch.outFiles ?? []) {
    const outFile = resolveDebugLaunchValue(rawOutFile, "outFiles", variables);
    if ("error" in outFile) return { supported: false, reason: outFile.error };
    if (!isPathInsideWorkspace(outFile.value, workspaceRootPath)) {
      return { supported: false, reason: "Node debug outFiles must stay inside the workspace." };
    }
    outFiles.push(outFile.value);
  }

  return {
    supported: true,
    request: {
      kind: "node",
      name: launch.name,
      workspaceRootPath,
      program: program.value,
      cwd: cwd.value,
      runtimeExecutable: launch.runtimeExecutable || "node",
      runtimeArgs: launch.runtimeArgs ?? [],
      args: launch.args,
      env: launch.env,
      stopOnEntry: launch.stopOnEntry ?? false,
      sourceMaps: launch.sourceMaps ?? true,
      smartStep: launch.smartStep ?? false,
      skipFiles: launch.skipFiles ?? ["<node_internals>/**"],
      outFiles,
    },
  };
}

function buildTaskCommandLabel(task: VSCodeTask): string {
  const args = task.args.length > 0 ? ` ${task.args.join(" ")}` : "";
  return `${task.command}${args}`;
}

function getShellCommandParts(commandLine: string): { command: string; args: string[] } {
  if (typeof navigator !== "undefined" && /win/i.test(navigator.platform)) {
    return { command: "cmd", args: ["/C", commandLine] };
  }
  return { command: "sh", args: ["-lc", commandLine] };
}

export function buildVSCodeTaskExecutionRequest(
  task: VSCodeTask,
  options: { workspaceRootPath?: string | null } = {},
): RunnerExecutionRequest {
  const commandLine = buildTaskCommandLabel(task);
  const shellTask = task.type === "shell";
  const commandParts = shellTask
    ? getShellCommandParts(commandLine)
    : { command: task.command, args: task.args };

  return {
    runnerType: "external-command",
    command: commandParts.command,
    args: commandParts.args,
    cwd: task.cwd || options.workspaceRootPath || undefined,
    env: task.env,
    mode: "file",
  };
}

export function buildVSCodeTaskActions(
  tasks: VSCodeTask[],
  options: {
    workspaceRootPath?: string | null;
    fallbackLabel?: string;
    onRunTask?: (task: VSCodeTask) => Promise<void> | void;
  } = {},
): CommandBarAction[] {
  if (tasks.length === 0) return [];

  return tasks.slice(0, 4).map((task, index) => {
    const label = task.label || options.fallbackLabel || `Task ${index + 1}`;
    const fullLabel = buildTaskCommandLabel(task);
    return {
      id: `vscode-task:${index}`,
      label,
      tooltip: `VS Code Task: ${fullLabel}`,
      icon: "play",
      priority: 60 + index,
      group: "secondary",
      disabled: !isTauriHost() && !options.onRunTask,
      onTrigger: async () => {
        if (options.onRunTask) {
          await options.onRunTask(task);
          return;
        }
        if (isTauriHost()) {
          await openDesktopTerminalAtPath(task.cwd || options.workspaceRootPath || ".");
          return;
        }
        if (typeof window !== "undefined") {
          window.alert(`Task: ${label}\n${fullLabel}`);
        }
      },
    };
  });
}

export function buildVSCodeLaunchExecutionRequest(
  launch: VSCodeLaunchConfiguration,
  options: {
    workspaceRootPath?: string | null;
    defaultPythonPath?: string | null;
  } = {},
): RunnerExecutionRequest | null {
  const cwd = launch.cwd || options.workspaceRootPath || undefined;
  const type = launch.type.toLowerCase();
  if ((type === "node" || type === "pwa-node") && launch.program) {
    return {
      runnerType: "external-command",
      command: "node",
      args: [launch.program, ...launch.args],
      cwd,
      env: launch.env,
      mode: "file",
    };
  }
  if ((type === "python" || type === "debugpy") && launch.program) {
    return {
      runnerType: "python-local",
      command: launch.python || options.defaultPythonPath || undefined,
      filePath: launch.program,
      args: launch.args,
      cwd,
      env: launch.env,
      mode: "file",
    };
  }
  if (type === "python" || type === "debugpy") {
    return {
      runnerType: "python-local",
      command: launch.python || options.defaultPythonPath || undefined,
      code: launch.module ? `import runpy; runpy.run_module("${launch.module}", run_name="__main__")` : undefined,
      args: launch.args,
      cwd,
      env: launch.env,
      mode: "inline",
    };
  }
  return null;
}

export function buildVSCodeLaunchActions(
  launches: VSCodeLaunchConfiguration[],
  options: {
    workspaceRootPath?: string | null;
    onRunLaunch?: (launch: VSCodeLaunchConfiguration) => Promise<void> | void;
  } = {},
): CommandBarAction[] {
  if (launches.length === 0) return [];
  return launches.slice(0, 4).map((launch, index) => ({
    id: `vscode-launch:${index}`,
    label: launch.name,
    tooltip: `VS Code Launch: ${launch.type} ${launch.request}`,
    icon: "play",
    priority: 66 + index,
    group: "secondary",
    disabled: !isTauriHost() && !options.onRunLaunch,
    onTrigger: async () => {
      if (options.onRunLaunch) {
        await options.onRunLaunch(launch);
        return;
      }
      if (isTauriHost()) {
        await openDesktopTerminalAtPath(launch.cwd || options.workspaceRootPath || ".");
      }
    },
  }));
}
