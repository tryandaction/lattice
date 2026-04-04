import { getStorageAdapter, isTauriHost } from "@/lib/storage-adapter";
import { getRunnerDefinition, normalizeRunnerLanguage, type RunnerDefinition } from "@/lib/runner/extension-map";
import { runnerManager } from "@/lib/runner/runner-manager";
import { normalizeExecutionText } from "@/lib/runner/text-utils";
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

interface WorkspacePreferenceScopeInput {
  workspaceKey?: string | null;
  workspaceRootPath?: string | null;
}

function normalizeWorkspacePreferenceScope(input: WorkspacePreferenceScopeInput | string | null | undefined): string | null {
  if (typeof input === "string" || input == null) {
    return normalizeWorkspacePath(input);
  }

  const workspaceKey = input.workspaceKey?.trim();
  if (workspaceKey) {
    return workspaceKey;
  }

  return normalizeWorkspacePath(input.workspaceRootPath);
}

function getLegacyWorkspaceRunnerPreferencesStorageKey(
  workspaceScope: WorkspacePreferenceScopeInput | string | null | undefined,
): string | null {
  if (typeof workspaceScope === "string" || workspaceScope == null) {
    const normalized = normalizeWorkspacePath(workspaceScope);
    return normalized ? `${STORAGE_PREFIX}${normalized}` : null;
  }

  const normalized = normalizeWorkspacePath(workspaceScope.workspaceRootPath);
  return normalized ? `${STORAGE_PREFIX}${normalized}` : null;
}

export function getWorkspaceRunnerPreferencesStorageKey(
  workspaceScope: WorkspacePreferenceScopeInput | string | null | undefined,
): string | null {
  const normalized = normalizeWorkspacePreferenceScope(workspaceScope);
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
  workspaceScope: WorkspacePreferenceScopeInput | string | null | undefined,
): Promise<WorkspaceRunnerPreferences> {
  const key = getWorkspaceRunnerPreferencesStorageKey(workspaceScope);
  if (!key) {
    return createRunnerPreferenceDefaults();
  }

  const storage = getStorageAdapter();
  let stored = await storage.get<WorkspaceRunnerPreferences>(key);
  if (!stored) {
    const legacyKey = getLegacyWorkspaceRunnerPreferencesStorageKey(workspaceScope);
    if (legacyKey && legacyKey !== key) {
      stored = await storage.get<WorkspaceRunnerPreferences>(legacyKey);
      if (stored) {
        await storage.set(key, stored);
      }
    }
  }
  return {
    ...createRunnerPreferenceDefaults(),
    ...(stored ?? {}),
    defaultLanguageRunners: { ...(stored?.defaultLanguageRunners ?? {}) },
    recentRunByFile: { ...(stored?.recentRunByFile ?? {}) },
  };
}

export async function saveWorkspaceRunnerPreferences(
  workspaceScope: WorkspacePreferenceScopeInput | string | null | undefined,
  preferences: WorkspaceRunnerPreferences,
): Promise<void> {
  const key = getWorkspaceRunnerPreferencesStorageKey(workspaceScope);
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

type RunnerSelectionSource =
  | "current-entry"
  | "workspace-default"
  | "language-default"
  | "detected"
  | "fallback";

interface RunnerSelectionMeta {
  source: RunnerSelectionSource;
  label: string;
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

function resolveRunnerSelectionMeta(
  runnerDefinition: RunnerDefinition,
  runnerType: RunnerType,
  preferences: WorkspaceRunnerPreferences,
  fileKey: string,
  language: string,
  command?: string,
): RunnerSelectionMeta {
  const recent = preferences.recentRunByFile[fileKey];
  if (
    recent?.runnerType === runnerType &&
    (
      runnerType !== "python-local" ||
      !command ||
      !recent.command ||
      recent.command === command
    )
  ) {
    return {
      source: "current-entry",
      label: "当前入口选择",
    };
  }

  if (runnerType === "python-local" && preferences.defaultPythonPath && command === preferences.defaultPythonPath) {
    return {
      source: "workspace-default",
      label: "工作区默认",
    };
  }

  const normalizedLanguage = normalizeRunnerLanguage(language) ?? language.toLowerCase();
  if (preferences.defaultLanguageRunners[normalizedLanguage] === runnerType) {
    return {
      source: "language-default",
      label: "语言默认",
    };
  }

  if (!isTauriHost() && runnerDefinition.runnerType === "python-local" && runnerType === "python-pyodide") {
    return {
      source: "fallback",
      label: "浏览器回退",
    };
  }

  if (runnerType === "python-pyodide") {
    return {
      source: "fallback",
      label: "Pyodide 回退",
    };
  }

  return {
    source: "detected",
    label: runnerType === "python-local" ? "自动探测" : "运行器默认",
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
  const normalizedCode = typeof code === "string" ? normalizeExecutionText(code) : code;
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
  } else if (normalizedCode?.trim()) {
    const effectiveMode: ExecutionMode = mode === "file" ? "inline" : mode;
    request = {
      runnerType,
      command,
      cwd,
      code: normalizedCode,
      args: runnerDefinition.buildArgs({
        code: normalizedCode,
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

  const selectionMeta = resolveRunnerSelectionMeta(
    runnerDefinition,
    runnerType,
    preferences,
    fileKey,
    language,
    command,
  );

  return {
    request,
    meta: {
      runnerType,
      command,
      diagnostics,
      origin: {
        ...getExecutionOrigin({
          runnerType,
          mode: request?.mode ?? mode,
          command,
        }),
        selectionLabel: selectionMeta.label,
      },
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
