import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeTauriCommand: vi.fn(),
  isTauriHost: vi.fn(() => true),
  listen: vi.fn(),
}));

vi.mock("@/lib/storage-adapter", () => ({
  invokeTauriCommand: mocks.invokeTauriCommand,
  isTauriHost: mocks.isTauriHost,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

import {
  buildDesktopWebviewDataDirectory,
  getDesktopWebviewLabelForTab,
  goBackDesktopWebview,
  goForwardDesktopWebview,
  listenDesktopWebviewDownload,
  listenDesktopWebviewNewWindow,
  navigateDesktopWebview,
  reloadDesktopWebview,
} from "@/lib/desktop-webview";

describe("desktop webview helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauriHost.mockReturnValue(true);
  });

  it("builds a stable webview label from tab ids", () => {
    expect(getDesktopWebviewLabelForTab("tab-123")).toBe("lattice-webview:tab-123");
    expect(getDesktopWebviewLabelForTab("tab with spaces")).toBe("lattice-webview:tab_with_spaces");
  });

  it("builds a stable data directory from url origin", () => {
    expect(buildDesktopWebviewDataDirectory("https://example.com/docs")).toBe("embedded-web/https_example.com_default");
    expect(buildDesktopWebviewDataDirectory("https://example.com:8443/docs")).toBe("embedded-web/https_example.com_8443");
  });

  it("falls back to a default data directory for invalid urls", () => {
    expect(buildDesktopWebviewDataDirectory("not a url")).toBe("embedded-web/default");
  });

  it("invokes native navigate command", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({ label: "x", currentUrl: "https://example.com", title: null });

    await navigateDesktopWebview("lattice-webview:tab-1", "https://example.com");

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith("desktop_native_webview_navigate", {
      label: "lattice-webview:tab-1",
      url: "https://example.com",
    });
  });

  it("invokes native reload/back/forward commands", async () => {
    await reloadDesktopWebview("label-a");
    await goBackDesktopWebview("label-a");
    await goForwardDesktopWebview("label-a");

    expect(mocks.invokeTauriCommand).toHaveBeenNthCalledWith(1, "desktop_native_webview_reload", { label: "label-a" });
    expect(mocks.invokeTauriCommand).toHaveBeenNthCalledWith(2, "desktop_native_webview_go_back", { label: "label-a" });
    expect(mocks.invokeTauriCommand).toHaveBeenNthCalledWith(3, "desktop_native_webview_go_forward", { label: "label-a" });
  });

  it("subscribes to native webview events", async () => {
    mocks.listen.mockResolvedValue(() => {});

    await listenDesktopWebviewNewWindow(() => {});
    await listenDesktopWebviewDownload(() => {});

    expect(mocks.listen).toHaveBeenNthCalledWith(1, "desktop-native-webview://new-window", expect.any(Function));
    expect(mocks.listen).toHaveBeenNthCalledWith(2, "desktop-native-webview://download", expect.any(Function));
  });
});
