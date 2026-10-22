/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeTauriCommand: vi.fn(),
  close: vi.fn(),
  beforeClose: vi.fn(),
  destroy: vi.fn(),
  onCloseRequested: vi.fn(),
}));

vi.mock("@/lib/storage-adapter", () => ({
  isTauriHost: () => true,
  invokeTauriCommand: mocks.invokeTauriCommand,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "main",
    close: mocks.close,
    destroy: mocks.destroy,
    onCloseRequested: mocks.onCloseRequested,
  }),
}));

import { closeDesktopWindow, registerDesktopWindowCloseHandler, subscribeDesktopWindowCloseRequests } from "../desktop-window";

describe("desktop window controls", () => {
  beforeEach(() => {
    mocks.invokeTauriCommand.mockReset();
    mocks.close.mockReset();
    mocks.beforeClose.mockReset();
    mocks.destroy.mockReset();
    mocks.onCloseRequested.mockReset();
  });

  it("falls back to the current window when a void close command resolves undefined", async () => {
    mocks.invokeTauriCommand.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);

    await closeDesktopWindow();

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_window_close",
      undefined,
      { timeoutMs: 4000 },
    );
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("flushes registered desktop state before closing the window", async () => {
    const unregister = registerDesktopWindowCloseHandler(mocks.beforeClose);
    mocks.beforeClose.mockResolvedValue(undefined);
    mocks.invokeTauriCommand.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);

    await closeDesktopWindow();

    expect(mocks.beforeClose).toHaveBeenCalledTimes(1);
    expect(mocks.invokeTauriCommand).toHaveBeenCalledTimes(1);
    unregister();
  });

  it("keeps the desktop window open when a strict state save fails", async () => {
    const unregister = registerDesktopWindowCloseHandler(async () => { throw new Error("AI state could not be saved"); });
    try {
      await expect(closeDesktopWindow()).rejects.toThrow("AI state could not be saved");
      expect(mocks.invokeTauriCommand).not.toHaveBeenCalled();
      expect(mocks.close).not.toHaveBeenCalled();
    } finally { unregister(); }
  });

  it("serializes simultaneous close requests behind the same durable save", async () => {
    let finish!: () => void;
    const saving = new Promise<void>(resolve => { finish = resolve; });
    const unregister = registerDesktopWindowCloseHandler(() => saving);
    mocks.invokeTauriCommand.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
    try {
      const first = closeDesktopWindow();
      const second = closeDesktopWindow();
      await Promise.resolve();
      expect(mocks.close).not.toHaveBeenCalled();
      finish();
      await Promise.all([first, second]);
      expect(mocks.close).toHaveBeenCalledTimes(1);
    } finally { unregister(); }
  });

  it("waits for durable state before destroying a system-requested window", async () => {
    let requested!: (event: { preventDefault(): void }) => Promise<void>;
    mocks.onCloseRequested.mockImplementation(async handler => { requested = handler; return () => {}; });
    let finish!: () => void;
    const saving = new Promise<void>(resolve => { finish = resolve; });
    const unregister = registerDesktopWindowCloseHandler(() => saving);
    const unlisten = await subscribeDesktopWindowCloseRequests(() => {});
    try {
      const event = { preventDefault: vi.fn() };
      const closing = requested(event);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(mocks.destroy).not.toHaveBeenCalled();
      finish();
      await closing;
      expect(mocks.destroy).toHaveBeenCalledTimes(1);
      expect(mocks.close).not.toHaveBeenCalled();
    } finally { unlisten(); unregister(); }
  });

  it("reports a failed system-close save while leaving the window open", async () => {
    let requested!: (event: { preventDefault(): void }) => Promise<void>;
    mocks.onCloseRequested.mockImplementation(async handler => { requested = handler; return () => {}; });
    const unregister = registerDesktopWindowCloseHandler(async () => { throw new Error("Durable save failed"); });
    const errors: string[] = [];
    const unlisten = await subscribeDesktopWindowCloseRequests(error => errors.push(String(error)));
    try {
      await requested({ preventDefault: () => {} });
      expect(errors).toEqual(["Error: Durable save failed"]);
      expect(mocks.destroy).not.toHaveBeenCalled();
    } finally { unlisten(); unregister(); }
  });
});
