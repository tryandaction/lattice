/**
 * Tests for DownloadAppDialog
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { DownloadAppDialog } from "../download-app-dialog";
import { setLocale } from "@/lib/i18n";

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
    setLocale("en-US");
    disableTauriRuntime();
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    setLocale("zh-CN");
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

  it("opens the release list without promising an unverified latest build", () => {
    render(<DownloadAppDialog />);
    act(() => { vi.advanceTimersByTime(2100); });
    const releaseLink = screen.getByRole("link", { name: "View desktop releases" });
    expect(releaseLink.getAttribute("href")).toBe("https://github.com/tryandaction/lattice/releases");
    expect(screen.getByTestId("download-app-dialog").textContent).toContain("Check its build time and checksum");
    act(() => setLocale("zh-CN"));
    expect(screen.getByRole("link", { name: "查看桌面发行版本" })).toBeTruthy();
    expect(screen.getByTestId("download-app-dialog").textContent).toContain("构建时间与校验值");
  });

  it("never shows download dialog in tauri runtime", () => {
    enableTauriRuntime();
    render(<DownloadAppDialog />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText("Download Desktop App")).toBeNull();
  });

  it("waits until the active onboarding or work dialog is closed", () => {
    const { rerender } = render(<DownloadAppDialog blocked />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText("Download Desktop App")).toBeNull();

    rerender(<DownloadAppDialog blocked={false} />);
    act(() => { vi.advanceTimersByTime(2100); });
    expect(screen.queryByText("Download Desktop App")).not.toBeNull();
  });

  it("does not cover a work dialog opened after the download notice", () => {
    const { rerender } = render(<DownloadAppDialog />);
    act(() => { vi.advanceTimersByTime(2100); });
    expect(screen.queryByText("Download Desktop App")).not.toBeNull();

    rerender(<DownloadAppDialog blocked />);
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
