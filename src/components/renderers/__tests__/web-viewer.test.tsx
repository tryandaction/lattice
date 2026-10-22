import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { CommandBarState } from "@/types/layout";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), external: vi.fn(), update: vi.fn(), reload: vi.fn(), commandBar: vi.fn() }));
vi.mock("@/lib/storage-adapter", () => ({ isTauriHost: () => false }));
vi.mock("@/lib/web-document", () => ({ loadWebDocument: mocks.load, canOpenUrlInternally: () => true, deriveWebDocumentName: () => "Site" }));
vi.mock("@/hooks/use-pane-command-bar", () => ({ usePaneCommandBar: mocks.commandBar }));
vi.mock("@/lib/link-router/open-external", () => ({ openExternalUrl: mocks.external }));
vi.mock("@/lib/link-router/navigate-link", () => ({ navigateLink: vi.fn() }));
vi.mock("@/components/renderers/desktop-native-webview-pane", () => ({ DesktopNativeWebviewPane: () => null }));
vi.mock("@/stores/workspace-store", () => ({ useWorkspaceStore: (selector: (state: unknown) => unknown) => selector({ updateWebTab: mocks.update, reloadWebTab: mocks.reload }) }));
import { WebViewer } from "../web-viewer";
describe("web preview fallback", () => {
  beforeEach(() => vi.clearAllMocks());
  it("offers an isolated frame and an external browser action after CORS failure", async () => {
    mocks.load.mockRejectedValue(new TypeError("Failed to fetch"));
    const { container } = render(<WebViewer url="https://example.com/paper" fileName="Paper" paneId="pane-left" tabId="web" />);
    await waitFor(() => expect(container.querySelector("iframe")?.getAttribute("src")).toBe("https://example.com/paper"));
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(container.querySelector("iframe")?.getAttribute("sandbox")).not.toContain("allow-same-origin");
    const originalFrame = container.querySelector("iframe");
    const commandBar = mocks.commandBar.mock.calls.at(-1)![0].state as CommandBarState;
    expect(commandBar.actions.some(action => ["back", "forward", "reload"].includes(action.id))).toBe(false);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "停止加载" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "刷新网页" })));
    expect(container.querySelector("iframe")).not.toBe(originalFrame);
    fireEvent.click(screen.getByRole("button", { name: "浏览器打开" }));
    expect(mocks.external).toHaveBeenCalledWith("https://example.com/paper");
  });

  it("keeps the rendered page during navigation and ignores title-only changes", async () => {
    mocks.load.mockResolvedValue({ finalUrl: "https://example.com/first", body: "<title>First</title><p>First page</p>" });
    const props = { url: "https://example.com/first", fileName: "First", paneId: "pane-left", tabId: "stable-web" };
    const view = render(<WebViewer {...props} />);
    await waitFor(() => expect(view.container.querySelector('iframe[srcdoc*="First page"]')).toBeTruthy());
    const frame = view.container.querySelector('iframe[srcdoc*="First page"]')!;
    fireEvent.load(frame);
    view.rerender(<WebViewer {...props} fileName="Changed title" />);
    await act(async () => {});
    expect(mocks.load).toHaveBeenCalledTimes(1);
    mocks.load.mockImplementation(() => new Promise(() => {}));
    view.rerender(<WebViewer {...props} url="https://example.com/second" />);
    expect(view.container.contains(frame)).toBe(true);
    expect(screen.getByRole("button", { name: "停止加载" })).toBeTruthy();
  });

  it("does not refetch a resolved redirect when its URL is echoed by the store", async () => {
    mocks.load.mockResolvedValue({ finalUrl: "https://example.com/final", body: "<title>Final</title><p>Redirected</p>" });
    const props = { fileName: "Site", paneId: "pane-left", tabId: "redirect-web" };
    const view = render(<WebViewer {...props} url="https://example.com/start" />);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("pane-left", "redirect-web", expect.objectContaining({ url: "https://example.com/final" })));
    view.rerender(<WebViewer {...props} url="https://example.com/final" fileName="Final" />);
    await act(async () => {});
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it("offers a compact address bar and real host-managed back/forward navigation", async () => {
    mocks.load.mockImplementation(async (url: string) => ({ finalUrl: url, body: `<p>${url}</p>` }));
    const props = { fileName: "Site", paneId: "pane-left", tabId: "history-web" };
    const view = render(<WebViewer {...props} url="https://example.com/one" />);
    await waitFor(() => expect(view.container.querySelector('iframe[srcdoc*="/one"]')).toBeTruthy());
    fireEvent.change(screen.getByRole("textbox", { name: "网页地址" }), { target: { value: "https://example.com/two" } });
    fireEvent.submit(screen.getByRole("textbox", { name: "网页地址" }).closest("form")!);
    expect(mocks.update).toHaveBeenLastCalledWith("pane-left", "history-web", expect.objectContaining({ url: "https://example.com/two" }));
    view.rerender(<WebViewer {...props} url="https://example.com/two" />);
    await waitFor(() => expect(view.container.querySelector('iframe[srcdoc*="/two"]')).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "后退" }));
    expect(mocks.update).toHaveBeenLastCalledWith("pane-left", "history-web", expect.objectContaining({ url: "https://example.com/one" }));
    fireEvent.click(screen.getByRole("button", { name: "前进" }));
    expect(mocks.update).toHaveBeenLastCalledWith("pane-left", "history-web", expect.objectContaining({ url: "https://example.com/two" }));
  });
  it("aborts a stopped request and ignores its late response", async () => {
    let resolve!: (value: { finalUrl: string; body: string }) => void;
    mocks.load.mockImplementation(() => new Promise(done => { resolve = done; }));
    const view = render(<WebViewer url="https://example.com/slow" fileName="Slow" paneId="pane" tabId="stop-web" />);
    const signal = mocks.load.mock.calls[0][1] as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "停止加载" }));
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ finalUrl: "https://example.com/slow", body: "<p>Late page</p>" }));
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(screen.getByText("已停止加载")).toBeTruthy();
  });
  it("bounds a request that never returns and gives a retry action", async () => {
    vi.useFakeTimers();
    try {
      mocks.load.mockImplementation(() => new Promise(() => {}));
      render(<WebViewer url="https://example.com/hang" fileName="Hang" paneId="pane" tabId="timeout-web" />);
      await act(async () => vi.advanceTimersByTime(20001));
      expect(screen.getByRole("alert").textContent).toContain("超时");
      expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
      expect((mocks.load.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("clears pending navigation when Back returns to the page still displayed", async () => {
    mocks.load.mockResolvedValueOnce({ finalUrl: "https://example.com/ready", body: "<p>Ready</p>" });
    const props = { fileName: "Site", paneId: "pane", tabId: "cached-return-web" };
    const view = render(<WebViewer {...props} url="https://example.com/ready" />);
    await waitFor(() => expect(view.container.querySelector("iframe")).toBeTruthy());
    const frame = view.container.querySelector("iframe")!; fireEvent.load(frame);
    mocks.load.mockImplementation(() => new Promise(() => {}));
    view.rerender(<WebViewer {...props} url="https://example.com/pending" />);
    await act(async () => {});
    view.rerender(<WebViewer {...props} url="https://example.com/ready" />);
    await act(async () => {});
    expect(view.container.contains(frame)).toBe(true);
    expect(view.container.querySelector("[aria-busy]")?.getAttribute("aria-busy")).toBe("false");
    expect((mocks.load.mock.calls[1][1] as AbortSignal).aborted).toBe(true);
  });
});
