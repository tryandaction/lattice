"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Square } from "lucide-react";
import {
  canUseNativeVSCodeWorkbench,
  getNativeVSCodeWorkbenchStatus,
  openNativeVSCodeWorkbenchResource,
  startNativeVSCodeWorkbench,
  stopNativeVSCodeWorkbench,
  type NativeVSCodeWorkbenchSnapshot,
} from "@/lib/vscode-workbench/desktop";
import { useVSCodeWorkbenchStore } from "@/stores/vscode-workbench-store";

const STATUS_POLL_INTERVAL_MS = 250;
const RESOURCE_DISPATCH_INITIAL_RETRY_MS = 250;
const RESOURCE_DISPATCH_MAX_RETRY_MS = 1_000;

const STOPPED_SNAPSHOT: NativeVSCodeWorkbenchSnapshot = {
  status: "stopped",
  phase: "stopped",
  elapsedSeconds: 0,
  firstLaunch: false,
  workspacePath: null,
  url: null,
  detail: "VS Code Workbench has not started.",
  cliPath: null,
  bridgeStatus: "stopped",
  runtimeKind: null,
  runtimeVersion: null,
  codeOssVersion: null,
  profilePath: null,
  legacyFallback: false,
};

function toErrorSnapshot(error: unknown): NativeVSCodeWorkbenchSnapshot {
  return {
    ...STOPPED_SNAPSHOT,
    status: "error",
    phase: "error",
    bridgeStatus: "error",
    detail: error instanceof Error ? error.message : String(error),
  };
}

function isStartInvocationTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("desktop_start_vscode_workbench") &&
    message.includes("timed out")
  );
}

export function NativeVSCodeWorkbenchPane({
  workspacePath,
}: {
  workspacePath: string;
}) {
  const desktopAvailable = canUseNativeVSCodeWorkbench();
  const pendingResource = useVSCodeWorkbenchStore(
    (state) => state.pendingResource,
  );
  const dispatchingRequestId = useVSCodeWorkbenchStore(
    (state) => state.dispatchingRequestId,
  );
  const queue = useVSCodeWorkbenchStore((state) => state);
  const [snapshot, setSnapshot] =
    useState<NativeVSCodeWorkbenchSnapshot>(STOPPED_SNAPSHOT);
  const [busy, setBusy] = useState(false);
  const startedWorkspaceRef = useRef<string | null>(null);
  const dispatchRetryRef = useRef({
    attempts: 0,
    nextAttemptAt: 0,
    requestId: 0,
  });
  const dispatchRetryTimerRef = useRef<number | null>(null);
  const [, setDispatchRetryTick] = useState(0);

  useEffect(() => {
    return () => {
      if (dispatchRetryTimerRef.current !== null) {
        window.clearTimeout(dispatchRetryTimerRef.current);
      }
    };
  }, []);

  const start = useCallback(async () => {
    if (!desktopAvailable || busy) {
      return;
    }

    setBusy(true);
    startedWorkspaceRef.current = workspacePath;
    try {
      const next = await startNativeVSCodeWorkbench(workspacePath);
      setSnapshot(next);
    } catch (error) {
      if (isStartInvocationTimeout(error)) {
        setSnapshot({
          ...STOPPED_SNAPSHOT,
          status: "preparing",
          phase: "starting",
          workspacePath,
          detail: "Starting the local VS Code Workbench...",
          bridgeStatus: "waiting",
        });
      } else {
        setSnapshot(toErrorSnapshot(error));
      }
    } finally {
      setBusy(false);
    }
  }, [busy, desktopAvailable, workspacePath]);

  useEffect(() => {
    if (!desktopAvailable || startedWorkspaceRef.current === workspacePath) {
      return;
    }
    void start();
  }, [desktopAvailable, start, workspacePath]);

  useEffect(() => {
    const bridgeReady =
      snapshot.status === "ready" && snapshot.bridgeStatus === "ready";
    if (
      !desktopAvailable ||
      busy ||
      snapshot.status === "stopped" ||
      snapshot.status === "error" ||
      bridgeReady
    ) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const next = await getNativeVSCodeWorkbenchStatus();
        if (cancelled) {
          return;
        }
        setSnapshot(next);
        const terminal =
          next.status === "stopped" ||
          next.status === "error" ||
          (next.status === "ready" && next.bridgeStatus === "ready");
        if (!terminal) {
          timer = window.setTimeout(poll, STATUS_POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (!cancelled) {
          setSnapshot(toErrorSnapshot(error));
        }
      }
    };
    timer = window.setTimeout(poll, STATUS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [busy, desktopAvailable, snapshot.bridgeStatus, snapshot.status]);

  useEffect(() => {
    if (
      !pendingResource ||
      dispatchRetryRef.current.requestId !== pendingResource.requestId
    ) {
      if (dispatchRetryTimerRef.current !== null) {
        window.clearTimeout(dispatchRetryTimerRef.current);
        dispatchRetryTimerRef.current = null;
      }
      dispatchRetryRef.current = {
        attempts: 0,
        nextAttemptAt: 0,
        requestId: pendingResource?.requestId ?? 0,
      };
    }

    if (
      !snapshot.url ||
      snapshot.status === "stopped" ||
      snapshot.status === "error" ||
      !pendingResource ||
      dispatchingRequestId === pendingResource.requestId ||
      Date.now() < dispatchRetryRef.current.nextAttemptAt
    ) {
      return;
    }

    const request = pendingResource;
    queue.markDispatching(request.requestId);
    void openNativeVSCodeWorkbenchResource(request)
      .then((acknowledgement) => {
        if (
          acknowledgement.ok &&
          acknowledgement.requestId === request.requestId
        ) {
          dispatchRetryRef.current = {
            attempts: 0,
            nextAttemptAt: 0,
            requestId: 0,
          };
          queue.acknowledge(request.requestId);
        }
      })
      .catch((error: unknown) => {
        const attempts = dispatchRetryRef.current.attempts + 1;
        const delay = Math.min(
          RESOURCE_DISPATCH_INITIAL_RETRY_MS * 2 ** (attempts - 1),
          RESOURCE_DISPATCH_MAX_RETRY_MS,
        );
        dispatchRetryRef.current = {
          attempts,
          nextAttemptAt: Date.now() + delay,
          requestId: request.requestId,
        };
        queue.fail(
          request.requestId,
          error instanceof Error ? error.message : String(error),
        );
        dispatchRetryTimerRef.current = window.setTimeout(() => {
          dispatchRetryTimerRef.current = null;
          setDispatchRetryTick((value) => value + 1);
        }, delay);
      });
  }, [
    dispatchingRequestId,
    pendingResource,
    queue,
    snapshot.status,
    snapshot.url,
  ]);

  const retry = useCallback(() => {
    startedWorkspaceRef.current = null;
    void start();
  }, [start]);

  const stop = useCallback(async () => {
    if (busy || !desktopAvailable) {
      return;
    }

    setBusy(true);
    try {
      const next = await stopNativeVSCodeWorkbench();
      startedWorkspaceRef.current = null;
      setSnapshot(next);
    } catch (error) {
      setSnapshot(toErrorSnapshot(error));
    } finally {
      setBusy(false);
    }
  }, [busy, desktopAvailable]);

  if (!desktopAvailable) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        The real VS Code Workbench is available only in the Lattice desktop app.
      </div>
    );
  }

  const workbenchVisible = Boolean(snapshot.url);
  const preparing =
    snapshot.status === "preparing" || snapshot.status === "starting";

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      data-testid="native-vscode-workbench-pane"
    >
      {workbenchVisible ? (
        <iframe
          className="min-h-0 flex-1 border-0 bg-background"
          src={snapshot.url ?? undefined}
          title="VS Code Workbench"
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="max-w-md space-y-3 text-center">
            {preparing || busy ? (
              <Loader2 className="mx-auto h-6 w-6 animate-spin" />
            ) : null}
            {snapshot.status === "error" ? (
              <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
            ) : null}
            <p className="text-sm font-medium">{snapshot.phase}</p>
            <p className="text-sm text-muted-foreground">{snapshot.detail}</p>
            {snapshot.status === "error" || snapshot.status === "stopped" ? (
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted"
                onClick={retry}
                disabled={busy}
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </button>
            ) : null}
          </div>
        </div>
      )}
      {preparing || workbenchVisible ? (
        <div className="flex h-9 shrink-0 items-center justify-between border-t border-border px-3 text-xs text-muted-foreground">
          <span>{snapshot.detail}</span>
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded hover:bg-muted disabled:opacity-50"
            onClick={() => void stop()}
            disabled={busy}
            aria-label="Stop VS Code Workbench"
            title="Stop VS Code Workbench"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
