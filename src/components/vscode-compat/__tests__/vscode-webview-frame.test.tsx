/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VSCodeWebviewFrame } from "../vscode-webview-frame";

const content = {
  viewId: "claude.sidebar",
  title: "Claude Code",
  extensionId: "anthropic.claude-code",
  html: "<html><head></head><body>Claude</body></html>",
  options: { enableScripts: true, retainContextWhenHidden: true },
  source: "host" as const,
};

describe("VSCodeWebviewFrame", () => {
  it("posts outbound messages for its own view in a full-height frame", () => {
    const onMessage = vi.fn();

    render(<VSCodeWebviewFrame content={content} onMessage={onMessage} drainMessages={async () => []} />);

    const frame = screen.getByTitle("Claude Code webview");
    expect(frame.classList.contains("h-full")).toBe(true);
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "lattice-vscode-webview-message",
        viewId: "claude.sidebar",
        message: { ready: true },
      },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "lattice-vscode-webview-message",
        viewId: "codex.sidebar",
        message: { ready: true },
      },
    }));

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith("claude.sidebar", { ready: true });

    fireEvent.load(frame);
  });

  it("keeps the embedded webview synchronized with the Lattice color scheme", async () => {
    document.documentElement.classList.add("dark");
    try {
      render(<VSCodeWebviewFrame content={content} onMessage={async () => []} drainMessages={async () => []} />);

      const frame = screen.getByTitle("Claude Code webview");
      expect(frame.getAttribute("srcdoc")).toContain('data-lattice-vscode-webview-theme="dark"');

      fireEvent.load(frame);

      document.documentElement.classList.remove("dark");
      await waitFor(() => {
        expect((frame as HTMLIFrameElement).contentDocument?.documentElement.classList.contains("vscode-light")).toBe(true);
      });
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });

  it("delivers extension-host replies back to the originating webview", async () => {
    const hostReply = { type: "state", state: { apiConfiguration: { provider: "kilo" } } };
    const onMessage = vi.fn(async () => [hostReply]);

    render(<VSCodeWebviewFrame content={content} onMessage={onMessage} drainMessages={async () => []} />);

    const frame = screen.getByTitle("Claude Code webview") as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "lattice-vscode-webview-message",
        viewId: "claude.sidebar",
        message: { type: "requestConfig" },
      },
    }));

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith({
        type: "lattice-vscode-host-message",
        viewId: "claude.sidebar",
        message: hostReply,
      }, "*");
    });
  });

  it("polls asynchronous extension-host messages while the webview is open", async () => {
    vi.useFakeTimers();
    const asyncReply = { type: "configLoaded", config: { provider: "kilo" } };
    const drainMessages = vi.fn()
      .mockResolvedValueOnce([asyncReply])
      .mockResolvedValue([]);

    try {
      const { unmount } = render(
        <VSCodeWebviewFrame
          content={content}
          onMessage={async () => []}
          drainMessages={drainMessages}
        />,
      );

      const frame = screen.getByTitle("Claude Code webview") as HTMLIFrameElement;
      const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
      fireEvent.load(frame);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      expect(drainMessages).toHaveBeenCalledWith("claude.sidebar");
      expect(postMessage).toHaveBeenCalledWith({
        type: "lattice-vscode-host-message",
        viewId: "claude.sidebar",
        message: asyncReply,
      }, "*");
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
