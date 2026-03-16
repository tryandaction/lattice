"use client";

import { useEffect, useState, useCallback } from "react";
import {
  runnerEventToTextOutputs,
  runnerManager,
} from "@/lib/runner/runner-manager";
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
  isReady: boolean;
  isRunning: boolean;
  isLoading: boolean;
  run: (request: RunnerExecutionRequest) => Promise<ExecutionRunResult>;
  terminate: () => Promise<void>;
  clearOutputs: () => void;
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

export function useExecutionRunner(): UseExecutionRunnerReturn {
  const [status, setStatus] = useState<RunnerStatus>("idle");
  const [outputs, setOutputs] = useState<ExecutionOutput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ExecutionSummary>(EMPTY_SUMMARY);
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
  }, []);

  const run = useCallback(async (request: RunnerExecutionRequest) => {
    setLastRequest(request);
    setOutputs([]);
    setError(null);
    setSummary(EMPTY_SUMMARY);
    return session.run(request);
  }, [session]);

  const terminate = useCallback(async () => {
    await session.terminate();
  }, [session]);

  return {
    status,
    outputs,
    error,
    summary,
    isReady: status === "ready",
    isRunning: status === "running",
    isLoading: status === "loading",
    run,
    terminate,
    clearOutputs,
    lastRequest,
  };
}
