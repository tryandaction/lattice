/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStorageAdapter, type TauriInvoke } from "../storage-adapter";

describe("storage-adapter desktop bridge readiness", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();

    const tauriWindow = window as Window & {
      __TAURI__?: { core?: { invoke?: unknown } };
      __TAURI_INTERNALS__?: { invoke?: unknown };
    };
    delete tauriWindow.__TAURI__;
    tauriWindow.__TAURI_INTERNALS__ = {};
  });

  it("waits for the Tauri invoke bridge instead of eagerly falling back to localStorage", async () => {
    vi.useFakeTimers();

    localStorage.setItem("lattice-settings", JSON.stringify({ onboardingCompleted: false }));

    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "get_setting" && args?.key === "lattice-settings") {
        return { onboardingCompleted: true };
      }
      return null;
    });

    const pending = getStorageAdapter().get("lattice-settings");

    vi.advanceTimersByTime(50);
    (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__ = {
      invoke: invoke as TauriInvoke,
    };

    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ onboardingCompleted: true });
    expect(invoke).toHaveBeenCalledWith("get_setting", { key: "lattice-settings" }, undefined);
    expect(localStorage.getItem("lattice-settings")).toContain("false");

    vi.useRealTimers();
  });
});
