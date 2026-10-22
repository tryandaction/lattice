"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  FileCode2,
  GitCommitHorizontal,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { createDesktopFileHandle } from "@/lib/desktop-file-system";
import {
  commitVSCodeSourceControlChanges,
  EMPTY_VSCODE_SOURCE_CONTROL_SNAPSHOT,
  getVSCodeSourceControlDiff,
  getVSCodeSourceControlStatus,
  stageAllVSCodeSourceControlChanges,
  stageVSCodeSourceControlPaths,
  unstageAllVSCodeSourceControlChanges,
  unstageVSCodeSourceControlPaths,
  type VSCodeSourceControlChange,
  type VSCodeSourceControlDiff,
  type VSCodeSourceControlSnapshot,
} from "@/lib/vscode-compat/source-control";
import { UI_LAYER_CLASS } from "@/lib/ui-layers";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";

type ChangeGroupKind = "conflict" | "staged" | "unstaged";

interface ChangeGroupProps {
  kind: ChangeGroupKind;
  title: string;
  changes: VSCodeSourceControlChange[];
  disabled: boolean;
  selectedDiff: VSCodeSourceControlDiff | null;
  diffLoadingKey: string | null;
  onOpen: (change: VSCodeSourceControlChange) => void;
  onDiff: (change: VSCodeSourceControlChange, staged: boolean) => void;
  onStage: (change: VSCodeSourceControlChange) => void;
  onUnstage: (change: VSCodeSourceControlChange) => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
}

function ChangeGroup({
  kind,
  title,
  changes,
  disabled,
  selectedDiff,
  diffLoadingKey,
  onOpen,
  onDiff,
  onStage,
  onUnstage,
  onStageAll,
  onUnstageAll,
}: ChangeGroupProps) {
  const { t } = useI18n();
  if (changes.length === 0) return null;
  const stagedView = kind === "staged";

  return (
    <section className="border-b border-border">
      <header className="flex h-8 items-center gap-1 bg-muted/30 px-2">
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase text-foreground">{title}</h3>
        <span className="text-[10px] text-muted-foreground">{changes.length}</span>
        {onStageAll ? (
          <button
            type="button"
            aria-label={t("vscode.scm.stageAll")}
            title={t("vscode.scm.stageAll")}
            disabled={disabled}
            onClick={onStageAll}
            className="flex h-6 w-6 items-center justify-center hover:bg-muted disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {onUnstageAll ? (
          <button
            type="button"
            aria-label={t("vscode.scm.unstageAll")}
            title={t("vscode.scm.unstageAll")}
            disabled={disabled}
            onClick={onUnstageAll}
            className="flex h-6 w-6 items-center justify-center hover:bg-muted disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </header>
      {changes.map((change) => {
        const diffKey = `${stagedView ? "staged" : "working"}:${change.path}`;
        const isSelected = selectedDiff?.path === change.path && selectedDiff.staged === stagedView;
        const isDiffLoading = diffLoadingKey === diffKey;
        return (
          <div key={`${kind}:${change.status}:${change.path}`} className="border-t border-border/50 first:border-t-0">
            <div className="group flex h-8 min-w-0 items-center gap-1 px-2">
              <button
                type="button"
                aria-label={t("vscode.scm.openFile", { path: change.path })}
                title={change.originalPath ? `${change.originalPath} -> ${change.path}` : change.path}
                onClick={() => onOpen(change)}
                className="flex h-7 min-w-0 flex-1 items-center gap-2 text-left hover:text-primary"
              >
                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs">{change.path}</span>
                <span className={cn(
                  "ml-auto shrink-0 font-mono text-[10px]",
                  change.conflict ? "text-destructive" : "text-muted-foreground",
                )}>
                  {change.status.trim() || change.status}
                </span>
              </button>
              <button
                type="button"
                aria-label={stagedView
                  ? t("vscode.scm.showStagedDiff", { path: change.path })
                  : t("vscode.scm.showDiff", { path: change.path })}
                title={stagedView ? t("vscode.scm.stagedDiff") : t("vscode.scm.workingDiff")}
                disabled={disabled || isDiffLoading}
                onClick={() => onDiff(change, stagedView)}
                className="flex h-6 w-6 shrink-0 items-center justify-center opacity-70 hover:bg-muted hover:opacity-100 disabled:opacity-40"
              >
                {isDiffLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileCode2 className="h-3.5 w-3.5" />}
              </button>
              {stagedView ? (
                <button
                  type="button"
                  aria-label={t("vscode.scm.unstagePath", { path: change.path })}
                  title={t("vscode.scm.unstage")}
                  disabled={disabled}
                  onClick={() => onUnstage(change)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center opacity-70 hover:bg-muted hover:opacity-100 disabled:opacity-40"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={t("vscode.scm.stagePath", { path: change.path })}
                  title={t("vscode.scm.stage")}
                  disabled={disabled}
                  onClick={() => onStage(change)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center opacity-70 hover:bg-muted hover:opacity-100 disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {isSelected ? <InlineDiff diff={selectedDiff} /> : null}
          </div>
        );
      })}
    </section>
  );
}

function InlineDiff({ diff }: { diff: VSCodeSourceControlDiff }) {
  const { t } = useI18n();
  if (diff.error) {
    return <div className="border-t border-border bg-destructive/5 px-3 py-2 text-[11px] text-destructive">{diff.error}</div>;
  }
  if (diff.binary) {
    return <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">{t("vscode.scm.binaryDiff")}</div>;
  }
  return (
    <div className="border-t border-border bg-muted/20">
      <pre className="max-h-56 overflow-auto p-3 font-mono text-[10px] leading-4 text-foreground">
        {diff.content || t("vscode.scm.emptyDiff")}
      </pre>
      {diff.truncated ? <div className="border-t border-border px-3 py-1 text-[10px] text-muted-foreground">{t("vscode.scm.diffTruncated")}</div> : null}
    </div>
  );
}

interface CommitConfirmDialogProps {
  message: string;
  stagedCount: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function CommitConfirmDialog({ message, stagedCount, busy, onCancel, onConfirm }: CommitConfirmDialogProps) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return createPortal(
    <div
      className={cn("fixed inset-0 flex items-center justify-center px-4", UI_LAYER_CLASS.dialog)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onCancel();
      }}
    >
      <button type="button" aria-label={t("common.cancel")} className="absolute inset-0 bg-black/45" onClick={onCancel} disabled={busy} />
      <div role="dialog" aria-modal="true" aria-label={t("vscode.scm.confirmCommit")} className="relative z-10 w-full max-w-md rounded-md border border-border bg-background p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <GitCommitHorizontal className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{t("vscode.scm.confirmCommit")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("vscode.scm.stagedFileCount", { count: stagedCount })}</p>
            <div className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted/30 p-3 text-xs">{message}</div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel} className="h-8 border border-border px-3 text-xs hover:bg-muted disabled:opacity-50">{t("common.cancel")}</button>
          <button type="button" disabled={busy} onClick={onConfirm} className="flex h-8 items-center gap-2 bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCommitHorizontal className="h-3.5 w-3.5" />}
            {t("vscode.scm.commit")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function VSCodeSourceControlPanel() {
  const { t } = useI18n();
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const openFileInActivePane = useWorkspaceStore((state) => state.openFileInActivePane);
  const [snapshot, setSnapshot] = useState<VSCodeSourceControlSnapshot>(EMPTY_VSCODE_SOURCE_CONTROL_SNAPSHOT);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [selectedDiff, setSelectedDiff] = useState<VSCodeSourceControlDiff | null>(null);
  const [diffLoadingKey, setDiffLoadingKey] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [showCommitConfirm, setShowCommitConfirm] = useState(false);

  const loadSnapshot = useCallback(async () => {
    setIsLoading(true);
    setOperationError(null);
    try {
      setSnapshot(await getVSCodeSourceControlStatus(workspaceRootPath));
    } catch (error) {
      setSnapshot({
        ...EMPTY_VSCODE_SOURCE_CONTROL_SNAPSHOT,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  }, [workspaceRootPath]);

  useEffect(() => {
    let cancelled = false;
    getVSCodeSourceControlStatus(workspaceRootPath).then(
      (next) => {
        if (!cancelled) setSnapshot(next);
      },
      (error) => {
        if (!cancelled) {
          setSnapshot({
            ...EMPTY_VSCODE_SOURCE_CONTROL_SNAPSHOT,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    ).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceRootPath]);

  const groups = useMemo(() => ({
    conflicts: snapshot.changes.filter((change) => change.conflict),
    staged: snapshot.changes.filter((change) => change.staged && !change.conflict),
    unstaged: snapshot.changes.filter((change) => change.unstaged && !change.conflict),
  }), [snapshot.changes]);

  const runMutation = useCallback(async (action: () => Promise<VSCodeSourceControlSnapshot>) => {
    if (isMutating) return false;
    setIsMutating(true);
    setOperationError(null);
    try {
      setSnapshot(await action());
      setSelectedDiff(null);
      return true;
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setIsMutating(false);
    }
  }, [isMutating]);

  const handleOpen = useCallback((change: VSCodeSourceControlChange) => {
    if (!snapshot.repositoryRoot) return;
    const absolutePath = `${snapshot.repositoryRoot.replace(/[\\/]+$/, "")}/${change.path.replace(/^[\\/]+/, "")}`;
    openFileInActivePane(createDesktopFileHandle(absolutePath), change.path);
  }, [openFileInActivePane, snapshot.repositoryRoot]);

  const handleDiff = useCallback(async (change: VSCodeSourceControlChange, staged: boolean) => {
    const key = `${staged ? "staged" : "working"}:${change.path}`;
    if (selectedDiff?.path === change.path && selectedDiff.staged === staged) {
      setSelectedDiff(null);
      return;
    }
    setDiffLoadingKey(key);
    setOperationError(null);
    try {
      setSelectedDiff(await getVSCodeSourceControlDiff(workspaceRootPath, change.path, staged));
    } catch (error) {
      setSelectedDiff({
        path: change.path,
        staged,
        content: "",
        binary: false,
        truncated: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDiffLoadingKey(null);
    }
  }, [selectedDiff, workspaceRootPath]);

  const hasConflicts = groups.conflicts.length > 0;
  const canCommit = groups.staged.length > 0 && commitMessage.trim().length > 0 && !hasConflicts && !isMutating;

  const confirmCommit = useCallback(async () => {
    const message = commitMessage.trim();
    const success = await runMutation(() => commitVSCodeSourceControlChanges(workspaceRootPath, message));
    if (success) {
      setCommitMessage("");
      setShowCommitConfirm(false);
    }
  }, [commitMessage, runMutation, workspaceRootPath]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-10 items-center gap-2 border-b border-border px-3">
        {snapshot.available ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{snapshot.branch || t("vscode.sidebar.sourceControl")}</div>
          <div className="flex gap-2 text-[10px] text-muted-foreground">
            {snapshot.ahead > 0 ? <span>{t("vscode.scm.ahead", { count: snapshot.ahead })}</span> : null}
            {snapshot.behind > 0 ? <span>{t("vscode.scm.behind", { count: snapshot.behind })}</span> : null}
          </div>
        </div>
        <button type="button" aria-label={t("vscode.sidebar.refreshSourceControl")} title={t("vscode.sidebar.refreshSourceControl")} onClick={() => void loadSnapshot()} disabled={isLoading || isMutating} className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-50">
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </button>
      </header>

      {snapshot.available ? (
        <div className="border-b border-border p-2">
          <textarea
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder={t("vscode.scm.commitMessage")}
            rows={2}
            className="w-full resize-none border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
          />
          <button type="button" aria-label={t("vscode.scm.commitStaged")} disabled={!canCommit} onClick={() => setShowCommitConfirm(true)} className="mt-1.5 flex h-7 w-full items-center justify-center gap-2 bg-primary text-xs text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40">
            <GitCommitHorizontal className="h-3.5 w-3.5" />
            {t("vscode.scm.commit")}
          </button>
          {hasConflicts ? <p className="mt-1.5 text-[10px] text-destructive">{t("vscode.scm.resolveConflicts")}</p> : null}
        </div>
      ) : null}

      {snapshot.error || operationError ? (
        <div className="flex items-start gap-2 border-b border-border px-3 py-3 text-[11px] text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{operationError || snapshot.error}</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {snapshot.available && snapshot.changes.length === 0 ? (
          <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
            <Check className="h-5 w-5 text-emerald-600" />
            {t("vscode.sidebar.sourceControlClean")}
          </div>
        ) : null}
        <ChangeGroup kind="conflict" title={t("vscode.scm.mergeChanges")} changes={groups.conflicts} disabled={isMutating} selectedDiff={selectedDiff} diffLoadingKey={diffLoadingKey} onOpen={handleOpen} onDiff={handleDiff} onStage={(change) => void runMutation(() => stageVSCodeSourceControlPaths(workspaceRootPath, [change.path]))} onUnstage={(change) => void runMutation(() => unstageVSCodeSourceControlPaths(workspaceRootPath, [change.path]))} />
        <ChangeGroup kind="staged" title={t("vscode.scm.stagedChanges")} changes={groups.staged} disabled={isMutating} selectedDiff={selectedDiff} diffLoadingKey={diffLoadingKey} onOpen={handleOpen} onDiff={handleDiff} onStage={(change) => void runMutation(() => stageVSCodeSourceControlPaths(workspaceRootPath, [change.path]))} onUnstage={(change) => void runMutation(() => unstageVSCodeSourceControlPaths(workspaceRootPath, [change.path]))} onUnstageAll={() => void runMutation(() => unstageAllVSCodeSourceControlChanges(workspaceRootPath))} />
        <ChangeGroup kind="unstaged" title={t("vscode.sidebar.changes")} changes={groups.unstaged} disabled={isMutating} selectedDiff={selectedDiff} diffLoadingKey={diffLoadingKey} onOpen={handleOpen} onDiff={handleDiff} onStage={(change) => void runMutation(() => stageVSCodeSourceControlPaths(workspaceRootPath, [change.path]))} onUnstage={(change) => void runMutation(() => unstageVSCodeSourceControlPaths(workspaceRootPath, [change.path]))} onStageAll={() => void runMutation(() => stageAllVSCodeSourceControlChanges(workspaceRootPath))} />
      </div>

      {showCommitConfirm ? <CommitConfirmDialog message={commitMessage.trim()} stagedCount={groups.staged.length} busy={isMutating} onCancel={() => setShowCommitConfirm(false)} onConfirm={() => void confirmCommit()} /> : null}
    </div>
  );
}
