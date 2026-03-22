"use client";

import { useEffect, useState, useCallback } from "react";
import {
  runnerEventToTextOutputs,
  runnerManager,
} from "@/lib/runner/runner-manager";
import type { ExecutionDiagnostic, ExecutionOrigin, ExecutionPanelMeta } from "@/lib/runner/types";
import { getExecutionOrigin } from "@/lib/runner/preferences";
import type {
  ExecutionOutput,
  ExecutionRunResult,
  RunnerEvent,
  RunnerExecutionRequest,
  RunnerStatus,
} from "@/lib/runner/types";

export interface ExecutionSummary {
  sessionId: string | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  exitCode: number | null;
  terminated: boolean;
}

export interface UseExecutionRunnerReturn {
  status: RunnerStatus;
  outputs: ExecutionOutput[];
  error: string | null;
  summary: ExecutionSummary;
  panelMeta: ExecutionPanelMeta;
  isReady: boolean;
  isRunning: boolean;
  isLoading: boolean;
  run: (request: RunnerExecutionRequest) => Promise<ExecutionRunResult>;
  terminate: () => Promise<void>;
  clearOutputs: () => void;
  setPanelMeta: (meta: ExecutionPanelMeta) => void;
  setDiagnostics: (diagnostics: ExecutionDiagnostic[], origin?: ExecutionOrigin | null) => void;
  lastRequest: RunnerExecutionRequest | null;
}

const EMPTY_SUMMARY: ExecutionSummary = {
  sessionId: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
  exitCode: null,
  terminated: false,
};

const EMPTY_PANEL_META: ExecutionPanelMeta = {
  origin: null,
  diagnostics: [],
  context: null,
};

export function useExecutionRunner(): UseExecutionRunnerReturn {
  const [status, setStatus] = useState<RunnerStatus>("idle");
  const [outputs, setOutputs] = useState<ExecutionOutput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ExecutionSummary>(EMPTY_SUMMARY);
  const [panelMeta, setPanelMetaState] = useState<ExecutionPanelMeta>(EMPTY_PANEL_META);
  const [session] = useState(() => runnerManager.createSession());
  const [lastRequest, setLastRequest] = useState<RunnerExecutionRequest | null>(null);

  useEffect(() => {
    const unsubscribeStatus = session.onStatusChange((nextStatus, nextError) => {
      setStatus(nextStatus);
      if (nextError) {
        setError(nextError);
      }
    });
    const unsubscribeEvents = session.onEvent((event: RunnerEvent) => {
      if (event.type === "started") {
        const startedAt = Date.now();
        setSummary({
          sessionId: event.sessionId,
          startedAt,
          completedAt: null,
          durationMs: null,
          exitCode: null,
          terminated: false,
        });
      }

      if (event.type === "error") {
        setError(event.payload.message);
      }

      const newOutputs = runnerEventToTextOutputs(event);
      if (newOutputs.length > 0) {
        setOutputs((previous) => [...previous, ...newOutputs]);
      }

      if (event.type === "completed" || event.type === "terminated") {
        const completedAt = Date.now();
        setSummary((previous) => ({
          sessionId: event.sessionId,
          startedAt: previous.startedAt,
          completedAt,
          durationMs: previous.startedAt ? completedAt - previous.startedAt : null,
          exitCode: event.payload.exitCode,
          terminated: event.type === "terminated" || Boolean(event.payload.terminated),
        }));
      }
    });

    return () => {
      unsubscribeStatus();
      unsubscribeEvents();
      session.dispose();
    };
  }, [session]);

  const clearOutputs = useCallback(() => {
    setOutputs([]);
    setError(null);
    setSummary(EMPTY_SUMMARY);
    setPanelMetaState(EMPTY_PANEL_META);
  }, []);

  const run = useCallback(async (request: RunnerExecutionRequest) => {
    setLastRequest(request);
    setOutputs([]);
    setError(null);
    setSummary(EMPTY_SUMMARY);
    setPanelMetaState((previous) => ({
      origin: previous.origin ?? getExecutionOrigin(request),
      diagnostics: previous.diagnostics,
      context: previous.context ?? null,
    }));
    return session.run(request);
  }, [session]);

  const terminate = useCallback(async () => {
    await session.terminate();
  }, [session]);

  const setPanelMeta = useCallback((meta: ExecutionPanelMeta) => {
    setPanelMetaState(meta);
  }, []);

  const setDiagnostics = useCallback((diagnostics: ExecutionDiagnostic[], origin?: ExecutionOrigin | null) => {
    setPanelMetaState((previous) => ({
      origin: origin ?? previous.origin,
      diagnostics,
    }));
  }, []);

  return {
    status,
    outputs,
    error,
    summary,
    panelMeta,
    isReady: status === "ready",
    isRunning: status === "running",
    isLoading: status === "loading",
    run,
    terminate,
    clearOutputs,
    setPanelMeta,
    setDiagnostics,
    lastRequest,
  };
}
