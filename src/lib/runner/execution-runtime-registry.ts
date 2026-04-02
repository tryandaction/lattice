"use client";

import { runnerManager, type ExecutionSession, type PersistentPythonSession } from "@/lib/runner/runner-manager";
import { registerExecutionScopeCleanup } from "@/stores/execution-session-store";
import type { ExecutionSessionScope, RunnerEvent, RunnerStatus } from "@/lib/runner/types";
import type { KernelOption } from "@/components/notebook/kernel-selector";

interface LegacyKernel {
  initialize?: () => Promise<void>;
  execute: (code: string, options?: Record<string, unknown>) => Promise<{
    outputs: unknown[];
    executionCount?: number;
    status?: string;
    executionTime?: number;
  }>;
  interrupt: () => Promise<void>;
  restart: () => Promise<void>;
  shutdown?: () => Promise<void>;
}

interface CodeRuntimeResource {
  session: ExecutionSession;
  unsubscribeStatus: () => void;
  unsubscribeEvents: () => void;
}

interface NotebookRuntimeResource {
  activeKernel: KernelOption | LegacyKernel | null;
  activeSession: ExecutionSession | null;
  notebookSession: PersistentPythonSession | null;
  sessionCleanup: (() => void) | null;
  executionCount: number;
  interrupted: boolean;
  expectedPersistentShutdown: boolean;
  supportsNotebook: boolean;
}

const codeRuntimeRegistry = new Map<string, CodeRuntimeResource>();
const notebookRuntimeRegistry = new Map<string, NotebookRuntimeResource>();

export function ensureCodeRuntimeResource(
  scope: ExecutionSessionScope,
  listeners: {
    onStatusChange: (status: RunnerStatus, error?: string | null) => void;
    onEvent: (event: RunnerEvent) => void;
  },
): CodeRuntimeResource {
  const existing = codeRuntimeRegistry.get(scope.scopeId);
  if (existing) {
    return existing;
  }

  const session = runnerManager.createSession();
  const resource: CodeRuntimeResource = {
    session,
    unsubscribeStatus: session.onStatusChange(listeners.onStatusChange),
    unsubscribeEvents: session.onEvent(listeners.onEvent),
  };

  codeRuntimeRegistry.set(scope.scopeId, resource);
  registerExecutionScopeCleanup(scope.scopeId, async () => {
    const current = codeRuntimeRegistry.get(scope.scopeId);
    if (!current) {
      return;
    }
    current.unsubscribeStatus();
    current.unsubscribeEvents();
    current.session.dispose();
    codeRuntimeRegistry.delete(scope.scopeId);
  });

  return resource;
}

export function getCodeRuntimeResource(scopeId: string): CodeRuntimeResource | null {
  return codeRuntimeRegistry.get(scopeId) ?? null;
}

export function ensureNotebookRuntimeResource(
  scope: ExecutionSessionScope,
  supportsNotebook: boolean,
  kernel?: KernelOption | LegacyKernel | null,
): NotebookRuntimeResource {
  const existing = notebookRuntimeRegistry.get(scope.scopeId);
  if (existing) {
    existing.supportsNotebook = supportsNotebook;
    if (kernel) {
      existing.activeKernel = kernel;
    }
    return existing;
  }

  const resource: NotebookRuntimeResource = {
    activeKernel: kernel ?? null,
    activeSession: null,
    notebookSession: null,
    sessionCleanup: null,
    executionCount: 0,
    interrupted: false,
    expectedPersistentShutdown: false,
    supportsNotebook,
  };

  notebookRuntimeRegistry.set(scope.scopeId, resource);
  registerExecutionScopeCleanup(scope.scopeId, async () => {
    const current = notebookRuntimeRegistry.get(scope.scopeId);
    if (!current) {
      return;
    }
    current.sessionCleanup?.();
    current.activeSession?.dispose();
    current.activeSession = null;
    if (current.notebookSession) {
      await current.notebookSession.dispose();
      current.notebookSession = null;
    }
    notebookRuntimeRegistry.delete(scope.scopeId);
  });

  return resource;
}

export function getNotebookRuntimeResource(scopeId: string): NotebookRuntimeResource | null {
  return notebookRuntimeRegistry.get(scopeId) ?? null;
}

export function resetNotebookExecutionCounter(scopeId: string): void {
  const resource = notebookRuntimeRegistry.get(scopeId);
  if (resource) {
    resource.executionCount = 0;
  }
}

export function nextNotebookExecutionCount(scopeId: string): number {
  const resource = notebookRuntimeRegistry.get(scopeId);
  if (!resource) {
    return 1;
  }
  resource.executionCount += 1;
  return resource.executionCount;
}

export function disposeNotebookTransientSession(scopeId: string): void {
  const resource = notebookRuntimeRegistry.get(scopeId);
  if (!resource?.activeSession) {
    return;
  }
  resource.activeSession.dispose();
  resource.activeSession = null;
}

export type { CodeRuntimeResource, NotebookRuntimeResource };
