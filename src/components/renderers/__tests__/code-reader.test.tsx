import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeReader } from "../code-reader";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import { flashReferenceRange } from "@/lib/reference-target-flash";

const flashCleanup = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reference-target-flash", () => ({ flashReferenceRange: vi.fn(() => flashCleanup), flashReferenceTarget: vi.fn(() => flashCleanup) }));
vi.mock("@/hooks/use-selection-context-menu", () => ({ useSelectionContextMenu: () => ({ menuState: null, closeMenu: vi.fn() }) }));
vi.mock("@/components/ai/selection-context-menu", () => ({ SelectionContextMenu: () => null }));
vi.mock("@/components/ai/selection-ai-hub", () => ({ SelectionAiHub: () => null }));
vi.mock("@/hooks/use-persisted-view-state", () => ({ usePersistedViewState: vi.fn() }));

describe("read-only code citations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLinkNavigationStore.setState({ pendingByPane: {}, outcomesByRequestId: {} });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);
  function navigate(requestId: string, snippet: string) {
    act(() => { useLinkNavigationStore.getState().setPendingNavigation("reader", {
      requestId, filePath: "sample.py", target: { type: "workspace_text", path: "sample.py", snippet },
    }); });
  }
  it("frames a multiline quote without line-number gutter text, cleaning prior flashes", () => {
    const { unmount } = render(<CodeReader content={"# Intro\nvalue = 42\nprint(value)\n# End"} fileName="sample.py" filePath="sample.py" paneId="reader" />);
    navigate("multi", "value = 42 print(value)");
    expect(useLinkNavigationStore.getState().outcomesByRequestId.multi?.status).toBe("success");
    expect(vi.mocked(flashReferenceRange).mock.calls.at(-1)?.[0].toString()).toBe("value = 42\nprint(value)");
    navigate("next", "42");
    expect(flashCleanup).toHaveBeenCalledTimes(1);
    expect(vi.mocked(flashReferenceRange).mock.calls.at(-1)?.[0].toString()).toBe("42");
    unmount();
    expect(flashCleanup).toHaveBeenCalledTimes(2);
  });
  it("rejects missing and ambiguous quotes rather than claiming a line-only success", () => {
    render(<CodeReader content={"value = 42\nprint(value)"} fileName="sample.py" filePath="sample.py" paneId="reader" />);
    navigate("missing", "value = 43");
    navigate("ambiguous", "value");
    expect(useLinkNavigationStore.getState().outcomesByRequestId.missing?.status).toBe("quote_not_found");
    expect(useLinkNavigationStore.getState().outcomesByRequestId.ambiguous?.status).toBe("quote_not_found");
    expect(flashReferenceRange).not.toHaveBeenCalled();
  });
  it("rejects a quote when its rendered range has no drawable fragments", () => {
    render(<CodeReader content="value = 42" fileName="sample.py" filePath="sample.py" paneId="reader" />);
    vi.mocked(flashReferenceRange).mockReturnValueOnce(null);
    navigate("hidden", "42");
    expect(useLinkNavigationStore.getState().outcomesByRequestId.hidden?.status).toBe("quote_not_found");
  });
});
