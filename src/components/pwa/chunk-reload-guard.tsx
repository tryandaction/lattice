"use client";

import { useEffect } from "react";

const CHUNK_RELOAD_GUARD_KEY = "lattice:chunk-reload-attempted";

function shouldRecoverChunkError(input: unknown): boolean {
  if (!input) return false;

  if (typeof input === "string") {
    return input.includes("/_next/static/")
      || input.includes("ChunkLoadError")
      || input.includes("Loading chunk")
      || input.includes("Failed to fetch dynamically imported module");
  }

  if (input instanceof Event) {
    const target = input.target;
    if (target instanceof HTMLScriptElement) {
      return target.src?.includes("/_next/static/") ?? false;
    }
    if (target instanceof HTMLLinkElement) {
      return target.href?.includes("/_next/static/") ?? false;
    }
  }

  if (input instanceof Error) {
    return shouldRecoverChunkError(input.message) || shouldRecoverChunkError(input.stack);
  }

  if (typeof input === "object") {
    const candidate = input as {
      message?: unknown;
      reason?: unknown;
      stack?: unknown;
      src?: unknown;
      href?: unknown;
    };

    return shouldRecoverChunkError(candidate.message)
      || shouldRecoverChunkError(candidate.reason)
      || shouldRecoverChunkError(candidate.stack)
      || shouldRecoverChunkError(candidate.src)
      || shouldRecoverChunkError(candidate.href);
  }

  return false;
}

function attemptChunkRecovery(): void {
  if (typeof window === "undefined") return;

  try {
    if (window.sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) === "1") {
      return;
    }
    window.sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, "1");
  } catch {
    return;
  }

  window.location.reload();
}

export function ChunkReloadGuard() {
  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      if (shouldRecoverChunkError(event.error) || shouldRecoverChunkError(event.message) || shouldRecoverChunkError(event)) {
        attemptChunkRecovery();
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (shouldRecoverChunkError(event.reason)) {
        attemptChunkRecovery();
      }
    };

    window.addEventListener("error", handleWindowError, true);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleWindowError, true);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}

export default ChunkReloadGuard;
