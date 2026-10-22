import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ ensure: vi.fn(), state: vi.fn(), update: vi.fn(), bounds: vi.fn(async () => {}), hide: vi.fn(async () => {}), show: vi.fn(async () => {}) }));
vi.mock("@/lib/storage-adapter", () => ({ isTauriHost: () => true }));
vi.mock("@/hooks/use-pane-command-bar", () => ({ usePaneCommandBar: () => {} }));
vi.mock("@/stores/workspace-store", () => ({ useWorkspaceStore: (selector: (state: unknown) => unknown) => selector({ reloadWebTab: vi.fn(), updateWebTab: mocks.update, openWebUrlInPane: vi.fn() }) }));
vi.mock("@/lib/desktop-webview", () => ({
  ensureDesktopWebview: mocks.ensure, getDesktopWebviewState: mocks.state, updateDesktopWebviewRect: mocks.bounds,
  getDesktopWebviewLabelForTab: (id: string) => id, goBackDesktopWebview: async () => {}, goForwardDesktopWebview: async () => {}, hideDesktopWebview: mocks.hide, showDesktopWebview: mocks.show, reloadDesktopWebview: async () => {},
  listenDesktopWebviewDownload: async () => () => {}, listenDesktopWebviewNewWindow: async () => () => {},
}));
import { DesktopNativeWebviewPane } from "../desktop-native-webview-pane";
describe("native webview navigation synchronization", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
  it("does not navigate again for title, redirect echoes or resize", async () => {
    const snapshot = { currentUrl: "http://localhost/final", title: "Final", status: "ready", lastError: null };
    mocks.ensure.mockResolvedValue(snapshot); mocks.state.mockResolvedValue(snapshot);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 500 } as DOMRect);
    const props = { paneId: "pane", tabId: "web-native", fileName: "First", url: "http://localhost/start", isActive: true };
    const view = render(<DesktopNativeWebviewPane {...props} />);
    await waitFor(() => expect(mocks.ensure).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    view.rerender(<DesktopNativeWebviewPane {...props} fileName="Final" url="http://localhost/final" />);
    await act(async () => {});
    expect(mocks.ensure).toHaveBeenCalledTimes(1);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 820, height: 500 } as DOMRect);
    window.dispatchEvent(new Event("resize"));
    await waitFor(() => expect(mocks.bounds).toHaveBeenCalledWith("web-native", expect.objectContaining({ width: 820 })));
    expect(mocks.ensure).toHaveBeenCalledTimes(1);
  });
  it("can navigate back to a formerly requested URL after a child navigation", async () => {
    const snapshot = { currentUrl: "http://localhost/start", title: "Start", status: "ready", lastError: null };
    mocks.ensure.mockResolvedValue(snapshot); mocks.state.mockResolvedValue(snapshot);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 500 } as DOMRect);
    const props = { paneId: "pane", tabId: "web-native", fileName: "Start", url: "http://localhost/start", isActive: true };
    const view = render(<DesktopNativeWebviewPane {...props} />);
    await waitFor(() => expect(mocks.ensure).toHaveBeenCalledTimes(1));
    mocks.state.mockResolvedValue({ ...snapshot, currentUrl: "http://localhost/child" });
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("pane", "web-native", expect.objectContaining({ url: "http://localhost/child" })));
    view.rerender(<DesktopNativeWebviewPane {...props} url="http://localhost/child" />);
    await act(async () => {});
    fireEvent.change(screen.getByRole("textbox", { name: "网页地址" }), { target: { value: "http://localhost/start" } });
    fireEvent.submit(screen.getByRole("textbox", { name: "网页地址" }).closest("form")!);
    view.rerender(<DesktopNativeWebviewPane {...props} />);
    await waitFor(() => expect(mocks.ensure).toHaveBeenCalledTimes(2));
  });
  it("does not hide newer navigation when an older ensure resolves last", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 500 } as DOMRect);
    const deferred: Array<(value: unknown) => void> = [];
    mocks.ensure.mockImplementation(() => new Promise(resolve => deferred.push(resolve)));
    const props = { paneId: "pane", tabId: "native-out-of-order", fileName: "Site", isActive: true };
    const view = render(<DesktopNativeWebviewPane {...props} url="http://localhost/first" />);
    await waitFor(() => expect(mocks.ensure).toHaveBeenCalledTimes(1));
    view.rerender(<DesktopNativeWebviewPane {...props} url="http://localhost/second" />);
    await waitFor(() => expect(mocks.ensure).toHaveBeenCalledTimes(2));
    await act(async () => deferred[1]({ currentUrl: "http://localhost/second", title: "Site", status: "ready", lastError: null }));
    await waitFor(() => expect(mocks.show).toHaveBeenCalled());
    const hides = mocks.hide.mock.calls.length;
    await act(async () => deferred[0]({ currentUrl: "http://localhost/first", title: "Site", status: "ready", lastError: null }));
    expect(mocks.hide).toHaveBeenCalledTimes(hides);
  });
});
