/**
 * Tests for DownloadAppDialog
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { DownloadAppDialog } from "../download-app-dialog";

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

    expect(screen.queryByText("下载桌面应用")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2100);
    });

    expect(screen.queryByText("下载桌面应用")).not.toBeNull();
  });

  it("never shows download dialog in tauri runtime", () => {
    enableTauriRuntime();
    render(<DownloadAppDialog />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText("下载桌面应用")).toBeNull();
  });
});
