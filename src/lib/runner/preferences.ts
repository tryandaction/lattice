import { getStorageAdapter, isTauriHost } from "@/lib/storage-adapter";
import { getRunnerDefinition, normalizeRunnerLanguage, type RunnerDefinition } from "@/lib/runner/extension-map";
import { runnerManager } from "@/lib/runner/runner-manager";
import type {
  CommandAvailability,
  ExecutionDiagnostic,
  ExecutionMode,
  ExecutionOrigin,
  PythonEnvironmentInfo,
  RunnerExecutionRequest,
  RunnerType,
  WorkspaceRunnerPreferences,
} from "@/lib/runner/types";

const STORAGE_PREFIX = "lattice-workspace-runner-preferences:";

function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

export function normalizeWorkspacePath(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }
  const normalized = trimTrailingSeparators(path.replace(/\\/g, "/"));
  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized[0].toLowerCase() + normalized.slice(1);
  }
  return normalized;
}

export function getWorkspaceRunnerPreferencesStorageKey(workspaceRootPath: string | null | undefined): string | null {
  const normalized = normalizeWorkspacePath(workspaceRootPath);
  return normalized ? `${STORAGE_PREFIX}${normalized}` : null;
}

export function createRunnerPreferenceDefaults(): WorkspaceRunnerPreferences {
  return {
    defaultPythonPath: null,
    defaultLanguageRunners: {},
    recentRunByFile: {},
  };
}

export async function loadWorkspaceRunnerPreferences(
  workspaceRootPath: string | null | undefined,
): Promise<WorkspaceRunnerPreferences> {
  const key = getWorkspaceRunnerPreferencesStorageKey(workspaceRootPath);
  if (!key) {
    return createRunnerPreferenceDefaults();
  }

  const storage = getStorageAdapter();
  const stored = await storage.get<WorkspaceRunnerPreferences>(key);
  return {
    ...createRunnerPreferenceDefaults(),
    ...(stored ?? {}),
    defaultLanguageRunners: { ...(stored?.defaultLanguageRunners ?? {}) },
    recentRunByFile: { ...(stored?.recentRunByFile ?? {}) },
  };
}

export async function saveWorkspaceRunnerPreferences(
  workspaceRootPath: string | null | undefined,
  preferences: WorkspaceRunnerPreferences,
): Promise<void> {
  const key = getWorkspaceRunnerPreferencesStorageKey(workspaceRootPath);
  if (!key) {
    return;
  }
  const storage = getStorageAdapter();
  await storage.set(key, preferences);
}

export function getExecutionSourceLabel(runnerType: RunnerType): string {
  switch (runnerType) {
    case "python-local":
      return "本地解释器";
    case "python-pyodide":
      return "浏览器回退";
    case "external-command":
      return "外部命令";
    default:
      return "运行器";
  }
}

export function getExecutionOrigin(request: Pick<RunnerExecutionRequest, "runnerType" | "mode" | "command">): ExecutionOrigin {
  const sourceLabel = getExecutionSourceLabel(request.runnerType);
  const detailLabel =
    request.runnerType === "python-local"
      ? request.command || "Python"
      : request.runnerType === "python-pyodide"
        ? "Pyodide"
        : request.command || "Command";

  return {
    runnerType: request.runnerType,
    mode: request.mode,
    sourceLabel,
    detailLabel,
  };
}

export function getRecentRunKey(filePath: string, blockIndex?: number, language?: string | null): string {
  if (typeof blockIndex === "number") {
    const normalizedLanguage = normalizeRunnerLanguage(language) ?? "text";
    return `${filePath}#block:${blockIndex}:${normalizedLanguage}`;
  }
  return filePath;
}

export function getPreferredPythonEnvironment(
  environments: PythonEnvironmentInfo[],
  preferences: WorkspaceRunnerPreferences,
  fileKey?: string,
): PythonEnvironmentInfo | null {
  const recent = fileKey ? preferences.recentRunByFile[fileKey] : undefined;
  const recentCommand = recent?.runnerType === "python-local" ? recent.command : undefined;

  if (recentCommand) {
    const recentMatch = environments.find((env) => env.path === recentCommand);
    if (recentMatch) {
      return recentMatch;
    }
  }

  if (preferences.defaultPythonPath) {
    const defaultMatch = environments.find((env) => env.path === preferences.defaultPythonPath);
    if (defaultMatch) {
      return defaultMatch;
    }
  }

  return environments[0] ?? null;
}

export interface PreferredRunnerResolution {
  runnerType: RunnerType;
  command?: string;
  diagnostics: ExecutionDiagnostic[];
  origin: ExecutionOrigin;
}

interface ResolveRunnerExecutionRequestOptions {
  runnerDefinition: RunnerDefinition;
  mode: ExecutionMode;
  code?: string;
  cwd?: string;
  absoluteFilePath?: string;
  fileKey: string;
  language: string;
  preferences: WorkspaceRunnerPreferences;
}

function buildMissingCommandDiagnostic(command: string, availability: CommandAvailability): ExecutionDiagnostic {
  return {
    severity: "error",
    title: `未找到命令 ${command}`,
    message: availability.error || `当前环境无法执行 ${command}。`,
    hint: "请安装对应运行时，或修正 PATH / 工作区解释器配置后再试。",
  };
}

function resolvePreferredRunnerType(
  runnerDefinition: RunnerDefinition,
  preferences: WorkspaceRunnerPreferences,
  fileKey: string,
  language: string,
): RunnerType {
  const recent = preferences.recentRunByFile[fileKey];
  if (recent?.runnerType) {
    return recent.runnerType;
  }

  const normalizedLanguage = normalizeRunnerLanguage(language) ?? language.toLowerCase();
  const defaultRunner = preferences.defaultLanguageRunners[normalizedLanguage];
  if (defaultRunner) {
    return defaultRunner;
  }

  if (!isTauriHost() && runnerDefinition.runnerType === "python-local") {
    return "python-pyodide";
  }

  return runnerDefinition.runnerType;
}

export async function resolveRunnerExecutionRequest(
  options: ResolveRunnerExecutionRequestOptions,
): Promise<{
  request: RunnerExecutionRequest | null;
  meta: PreferredRunnerResolution;
}> {
  const { runnerDefinition, mode, code, cwd, absoluteFilePath, fileKey, language, preferences } = options;
  const diagnostics: ExecutionDiagnostic[] = [];
  const runnerType = resolvePreferredRunnerType(runnerDefinition, preferences, fileKey, language);
  const recent = preferences.recentRunByFile[fileKey];

  let command =
    recent?.runnerType === runnerType && recent.command
      ? recent.command
      : runnerType === "python-local"
        ? preferences.defaultPythonPath ?? runnerDefinition.command
        : runnerType === "external-command"
          ? runnerDefinition.command
          : undefined;

  if (runnerType === "python-local" && isTauriHost()) {
    const environments = await runnerManager.detectPythonEnvironments(cwd);
    const preferredEnvironment = getPreferredPythonEnvironment(environments, preferences, fileKey);
    command = preferredEnvironment?.path ?? command;

    if (!preferredEnvironment && environments.length === 0) {
      diagnostics.push({
        severity: "error",
        title: "未检测到本地 Python",
        message: "当前工作区没有探测到可用的本地 Python 解释器。",
        hint: "请安装 Python，或在工作区中选择一个有效解释器后再运行。",
      });
      return {
        request: null,
        meta: {
          runnerType,
          command,
          diagnostics,
          origin: getExecutionOrigin({
            runnerType,
            mode,
            command,
          }),
        },
      };
    }
  }

  if (runnerType === "external-command" && command) {
    const availability = await runnerManager.probeCommandAvailability(command);
    if (!availability.available) {
      diagnostics.push(buildMissingCommandDiagnostic(command, availability));
      return {
        request: null,
        meta: {
          runnerType,
          command,
          diagnostics,
          origin: getExecutionOrigin({
            runnerType,
            mode,
            command,
          }),
        },
      };
    }
  }

  const shouldUseInlineCode =
    runnerType === "python-pyodide" || mode === "selection" || mode === "inline" || !absoluteFilePath;

  let request: RunnerExecutionRequest | null = null;

  if (!shouldUseInlineCode && absoluteFilePath) {
    request = {
      runnerType,
      command,
      filePath: absoluteFilePath,
      cwd,
      args: runnerDefinition.buildArgs({
        filePath: absoluteFilePath,
        mode,
      }),
      mode,
      allowPyodideFallback: false,
    };
  } else if (code?.trim()) {
    const effectiveMode: ExecutionMode = mode === "file" ? "inline" : mode;
    request = {
      runnerType,
      command,
      cwd,
      code,
      args: runnerDefinition.buildArgs({
        code,
        mode: effectiveMode,
      }),
      mode: effectiveMode,
      allowPyodideFallback: false,
    };
  }

  if (!request) {
    diagnostics.push({
      severity: "warning",
      title: "当前内容不可执行",
      message: "没有可运行的文件路径或内联代码。",
    });
  }

  return {
    request,
    meta: {
      runnerType,
      command,
      diagnostics,
      origin: getExecutionOrigin({
        runnerType,
        mode: request?.mode ?? mode,
        command,
      }),
    },
  };
}

export function buildNotebookRuntimeMessage(
  isDesktopHost: boolean,
  environments: PythonEnvironmentInfo[],
  preferences: WorkspaceRunnerPreferences,
  fileKey: string,
): string | null {
  if (!isDesktopHost) {
    return null;
  }

  if (environments.length === 0) {
    return "当前桌面会话未检测到本地 Python 解释器。请安装 Python，或修复 PATH / 虚拟环境后重试。";
  }

  const recent = preferences.recentRunByFile[fileKey];
  if (recent?.runnerType === "python-local" && recent.command && !environments.some((env) => env.path === recent.command)) {
    return "该 Notebook 上次选择的本地解释器已不可用，已自动切回当前可检测到的解释器。";
  }

  if (preferences.defaultPythonPath && !environments.some((env) => env.path === preferences.defaultPythonPath)) {
    return "工作区默认 Python 解释器已不可用，当前已切回本机可检测到的解释器。";
  }

  return null;
}

export function getNotebookKernelPreferenceOrigin(
  environments: PythonEnvironmentInfo[],
  preferences: WorkspaceRunnerPreferences,
  fileKey: string,
): PythonEnvironmentInfo | null {
  return getPreferredPythonEnvironment(environments, preferences, fileKey);
}

export function getLanguagePreferenceKey(language: string): string {
  return normalizeRunnerLanguage(language) ?? language.toLowerCase();
}

export function getRunnerDefinitionForLanguage(language: string): RunnerDefinition | null {
  const normalized = normalizeRunnerLanguage(language);
  return normalized ? getRunnerDefinition(normalized) : null;
}

export interface RunnerPreferenceCommitPayload {
  fileKey: string;
  language: string;
  request: Pick<RunnerExecutionRequest, "runnerType" | "command" | "args">;
  preferences: WorkspaceRunnerPreferences;
}

export interface RunnerPreferenceCommit {
  fileKey: string;
  recentRunConfig: WorkspaceRunnerPreferences["recentRunByFile"][string];
  preferences: Partial<WorkspaceRunnerPreferences>;
}

export function buildRunnerPreferenceCommit({
  fileKey,
  language,
  request,
  preferences,
}: RunnerPreferenceCommitPayload): RunnerPreferenceCommit {
  return {
    fileKey,
    recentRunConfig: {
      runnerType: request.runnerType,
      command: request.command,
      args: request.args,
    },
    preferences: {
      defaultLanguageRunners: {
        [getLanguagePreferenceKey(language)]: request.runnerType,
      },
      defaultPythonPath:
        request.runnerType === "python-local"
          ? request.command ?? preferences.defaultPythonPath
          : preferences.defaultPythonPath,
    },
  };
}
