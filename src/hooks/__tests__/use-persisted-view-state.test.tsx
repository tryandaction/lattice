/**
 * @vitest-environment jsdom
 */

import React, { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePersistedViewState } from "../use-persisted-view-state";

const fileViewStateMocks = vi.hoisted(() => ({
  loadPersistedFileViewState: vi.fn(async () => null),
  savePersistedFileViewState: vi.fn(async () => undefined),
}));

vi.mock("@/lib/file-view-state", () => ({
  loadPersistedFileViewState: fileViewStateMocks.loadPersistedFileViewState,
  savePersistedFileViewState: fileViewStateMocks.savePersistedFileViewState,
}));

function TestScroller() {
  const ref = useRef<HTMLDivElement>(null);

  usePersistedViewState({
    storageKey: "image:test",
    containerRef: ref,
    viewState: {
      fitMode: "fit",
    },
  });

  return <div ref={ref} data-testid="scroller" />;
}

describe("usePersistedViewState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not persist during scroll bursts and only flushes on idle or unmount", async () => {
    vi.useFakeTimers();
    let idleCallback: (() => void) | null = null;
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: vi.fn((callback: () => void) => {
        idleCallback = callback;
        return 1;
      }),
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      value: vi.fn(),
    });

    const { unmount } = render(<TestScroller />);
    const scroller = screen.getByTestId("scroller");
    Object.defineProperties(scroller, {
      scrollTop: { value: 240, writable: true, configurable: true },
      scrollLeft: { value: 32, writable: true, configurable: true },
    });

    fireEvent.scroll(scroller);

    expect(fileViewStateMocks.savePersistedFileViewState).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(320);
    expect(fileViewStateMocks.savePersistedFileViewState).not.toHaveBeenCalled();
    expect(idleCallback).not.toBeNull();

    const runIdleCallback = idleCallback as (() => void) | null;
    runIdleCallback?.();
    await Promise.resolve();
    expect(fileViewStateMocks.savePersistedFileViewState).toHaveBeenCalledWith("image:test", {
      scrollTop: 240,
      scrollLeft: 32,
      viewState: { fitMode: "fit" },
    });

    Object.defineProperty(scroller, "scrollTop", { value: 480, writable: true, configurable: true });
    fireEvent(window, new Event("blur"));
    unmount();
    await Promise.resolve();
    expect(fileViewStateMocks.savePersistedFileViewState).toHaveBeenLastCalledWith("image:test", {
      scrollTop: 480,
      scrollLeft: 32,
      viewState: { fitMode: "fit" },
    });

    vi.useRealTimers();
  });
});
