/**
 * Tests for DownloadAppDialog
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { DownloadAppDialog } from "../download-app-dialog";

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const mapping: Record<string, string> = {
        "common.close": "Close",
        "downloadApp.title": "Download Desktop App",
        "downloadApp.subtitle": "Get a better Lattice experience",
        "downloadApp.benefit.performance.title": "Faster startup, smaller footprint",
        "downloadApp.benefit.performance.description": "Under 6 MB, 3x faster startup, and 50% lower memory use.",
        "downloadApp.benefit.workspace.title": "Remember workspaces",
        "downloadApp.benefit.workspace.description": "Automatically reopen recent folders and set a default workspace.",
        "downloadApp.benefit.native.title": "Native window experience",
        "downloadApp.benefit.native.description": "No browser shell, double-click launch, and stronger file-system access.",
        "downloadApp.download": "Go To Download Page",
        "downloadApp.continueWeb": "Continue In Browser",
        "downloadApp.dontShowAgain": "Do not show this again",
      };
      return mapping[key] ?? key;
    },
  }),
}));

function enableTauriRuntime() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {},
    configurable: true,
    writable: true,
  });
}

function disableTauriRuntime() {
  const tauriWindow = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  delete tauriWindow.__TAURI_INTERNALS__;
  delete tauriWindow.__TAURI__;
}

describe("DownloadAppDialog", () => {
  beforeEach(() => {
    disableTauriRuntime();
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    disableTauriRuntime();
  });

  it("shows download dialog in web after delay", () => {
    render(<DownloadAppDialog />);

    expect(screen.queryByText("Download Desktop App")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2100);
    });

    expect(screen.queryByText("Download Desktop App")).not.toBeNull();
  });

  it("never shows download dialog in tauri runtime", () => {
    enableTauriRuntime();
    render(<DownloadAppDialog />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText("Download Desktop App")).toBeNull();
  });

  it("uses theme tokens instead of hardcoded light and dark color pairs", () => {
    render(<DownloadAppDialog />);

    act(() => {
      vi.advanceTimersByTime(2100);
    });

    const dialog = screen.getByTestId("download-app-dialog");
    expect(dialog.className).toContain("bg-card");
    expect(dialog.className).toContain("text-card-foreground");
    expect(dialog.className).toContain("border-border");
    expect(dialog.className).not.toContain("bg-white");
    expect(dialog.className).not.toContain("text-gray");
  });
});
