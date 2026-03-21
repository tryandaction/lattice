import { isTauriHost } from "@/lib/storage-adapter";
import { RUNNER_DEFINITIONS } from "@/lib/runner/extension-map";
import { runnerManager } from "@/lib/runner/runner-manager";
import { getPreferredPythonEnvironment } from "@/lib/runner/preferences";
import type {
  ExecutionOutput,
  RunnerHealthIssue,
  RunnerHealthSnapshot,
  WorkspaceRunnerPreferences,
} from "@/lib/runner/types";

interface CollectRunnerHealthSnapshotOptions {
  cwd?: string;
  fileKey?: string;
  preferences: WorkspaceRunnerPreferences;
  commands?: string[];
  runtimeIssues?: RunnerHealthIssue[];
}

function uniqueCommands(commands: string[] = []): string[] {
  const known = Object.values(RUNNER_DEFINITIONS)
    .map((definition) => definition.command)
    .filter((command): command is string => Boolean(command));
  return Array.from(new Set([...known, ...commands]));
}

function mergeIssues(baseIssues: RunnerHealthIssue[], extraIssues: RunnerHealthIssue[]): RunnerHealthIssue[] {
  const merged = new Map<string, RunnerHealthIssue>();
  for (const issue of [...baseIssues, ...extraIssues]) {
    const key = `${issue.code}:${issue.title}:${issue.message}`;
    if (!merged.has(key)) {
      merged.set(key, issue);
    }
  }
  return Array.from(merged.values());
}

export function createEmptyRunnerHealthSnapshot(): RunnerHealthSnapshot {
  return {
    hostKind: isTauriHost() ? "desktop" : "web",
    pythonEnvironments: [],
    commandAvailabilityByName: {},
    preferredPythonPath: null,
    selectedPythonPath: null,
    issues: [],
    checkedAt: 0,
  };
}

export function parseMissingPythonModule(errorValue?: string | null, traceback: string[] = []): string | null {
  const haystacks = [errorValue ?? "", ...traceback];
  for (const text of haystacks) {
    const match = text.match(/No module named ['"]([^'"]+)['"]/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export function buildRuntimeRunnerHealthIssues(
  outputs: ExecutionOutput[],
  selectedPythonPath?: string | null,
): RunnerHealthIssue[] {
  const issues: RunnerHealthIssue[] = [];

  for (const output of outputs) {
    if (output.type !== "error") {
      continue;
    }

    const missingModule = parseMissingPythonModule(output.errorValue, output.traceback);
    if (missingModule) {
      issues.push({
        code: "missing_dependency",
        severity: "error",
        title: `缺少 Python 依赖：${missingModule}`,
        message: `当前解释器缺少模块 ${missingModule}，执行无法继续。`,
        hint: selectedPythonPath
          ? `建议在 ${selectedPythonPath} 对应环境中执行：pip install ${missingModule}`
          : `建议安装缺失依赖：pip install ${missingModule}`,
        actions: [
          {
            kind: "command",
            label: `pip install ${missingModule}`,
            command: `pip install ${missingModule}`,
          },
        ],
      });
      continue;
    }

    issues.push({
      code: "runtime_execution_error",
      severity: "error",
      title: output.errorName ?? "运行失败",
      message: output.errorValue ?? output.content,
      hint: "请检查 traceback、当前解释器和依赖环境后重试。",
      actions: [
        {
          kind: "refresh",
          label: "刷新运行器健康状态",
        },
      ],
    });
  }

  return issues;
}

export async function collectRunnerHealthSnapshot({
  cwd,
  fileKey,
  preferences,
  commands = [],
  runtimeIssues = [],
}: CollectRunnerHealthSnapshotOptions): Promise<RunnerHealthSnapshot> {
  const desktopHost = isTauriHost();
  const checkedAt = Date.now();
  const hostKind: RunnerHealthSnapshot["hostKind"] = desktopHost ? "desktop" : "web";

  const pythonEnvironments = desktopHost
    ? await runnerManager.detectPythonEnvironments(cwd)
    : [];

  const commandAvailabilityEntries = await Promise.all(
    uniqueCommands(commands).map(async (command) => {
      if (!desktopHost) {
        return [
          command,
          {
            command,
            available: false,
            error: "仅桌面端支持外部命令探测",
          },
        ] as const;
      }

      return [command, await runnerManager.probeCommandAvailability(command)] as const;
    }),
  );

  const commandAvailabilityByName: RunnerHealthSnapshot["commandAvailabilityByName"] =
    Object.fromEntries(commandAvailabilityEntries);
  const preferredPythonPath = preferences.defaultPythonPath;
  const selectedPythonPath =
    getPreferredPythonEnvironment(pythonEnvironments, preferences, fileKey)?.path ??
    preferredPythonPath ??
    null;

  const issues: RunnerHealthIssue[] = [];

  if (!desktopHost) {
    issues.push({
      code: "web_fallback_only",
      severity: "info",
      title: "当前为网页运行时",
      message: "网页环境下仅提供 Pyodide 浏览器内核，不支持本地解释器和外部命令探测。",
      hint: "如需本地解释器、外部命令和更完整诊断，请切换到桌面端。",
    });
  }

  if (desktopHost && pythonEnvironments.length === 0) {
    issues.push({
      code: "python_not_found",
      severity: "error",
      title: "未检测到本地 Python",
      message: "当前工作区没有探测到可用的本地 Python 解释器。",
      hint: "请安装 Python，或在项目目录中创建并激活 .venv / conda 环境。",
      actions: [
        {
          kind: "refresh",
          label: "刷新解释器列表",
        },
      ],
    });
  }

  if (
    desktopHost &&
    preferredPythonPath &&
    !pythonEnvironments.some((environment) => environment.path === preferredPythonPath)
  ) {
    issues.push({
      code: "preferred_python_missing",
      severity: "warning",
      title: "工作区默认解释器已失效",
      message: `保存的默认解释器已不可用：${preferredPythonPath}`,
      hint: pythonEnvironments.length > 0
        ? "请切换到当前可用解释器，或恢复自动选择。"
        : "请先恢复本地 Python 环境，然后重新选择默认解释器。",
      actions: [
        ...(pythonEnvironments[0]
          ? [
              {
                kind: "select-python" as const,
                label: "切到当前首个可用解释器",
                pythonPath: pythonEnvironments[0].path,
              },
            ]
          : []),
        {
          kind: "reset-python-selection",
          label: "恢复自动选择",
        },
      ],
    });
  }

  for (const availability of Object.values(commandAvailabilityByName)) {
    if (availability.available) {
      continue;
    }
    issues.push({
      code: "command_not_found",
      severity: "warning",
      title: `未找到命令 ${availability.command}`,
      message: availability.error || `当前环境无法执行 ${availability.command}。`,
      hint: "请安装对应运行时，或修复 PATH 后刷新运行器健康状态。",
      actions: [
        {
          kind: "refresh",
          label: "刷新命令探测",
        },
      ],
    });
  }

  return {
    hostKind,
    pythonEnvironments,
    commandAvailabilityByName,
    preferredPythonPath,
    selectedPythonPath,
    issues: mergeIssues(issues, runtimeIssues),
    checkedAt,
  };
}

export function appendRunnerHealthIssues(
  snapshot: RunnerHealthSnapshot,
  runtimeIssues: RunnerHealthIssue[],
): RunnerHealthSnapshot {
  return {
    ...snapshot,
    issues: mergeIssues(snapshot.issues, runtimeIssues),
    checkedAt: Date.now(),
  };
}
