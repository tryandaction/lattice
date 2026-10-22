import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigateLinkDetailed } from "../navigate-link";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

vi.mock("@/lib/desktop-openers", () => ({ openFileWithSystem: vi.fn() }));

describe("navigateLinkDetailed contract", () => {
  it("turns a bare PDF evidence locator into a page target before attaching its quote", async () => {
    const result = await navigateLinkDetailed("paper.pdf", {
      paneId: "pane-left", currentFilePath: "paper.pdf",
      evidenceAnchor: { page: 3, snippet: "Exact quoted evidence" },
    });
    expect(result.target).toEqual({ type: "pdf_page", path: "paper.pdf", page: 3, snippet: "Exact quoted evidence" });
  });

  it("keeps absolute workspace PDF citations inside the active reader", async () => {
    const result = await navigateLinkDetailed("C:/Research/paper.pdf#page=2", {
      paneId: "pane-left", currentFilePath: "C:/Research/paper.pdf", pathMode: "workspace",
    });
    expect(result).toMatchObject({ status: "pending", target: { type: "pdf_page", path: "C:/Research/paper.pdf", page: 2 } });
  });

  beforeEach(() => {
    useLinkNavigationStore.setState({ pendingByPane: {}, outcomesByRequestId: {} });
    useWorkspaceStore.setState((state) => ({
      layout: { ...state.layout, activePaneId: "pane-left" },
    }));
  });

  it("returns a success field alongside the legacy ok field", async () => {
    const result = await navigateLinkDetailed("https://example.com");
    expect(result).toMatchObject({ ok: true, success: true, status: "success" });
  });

  it("deduplicates repeated pending navigation for the same target", async () => {
    const first = await navigateLinkDetailed("paper.pdf#page=3", { paneId: "pane-left", currentFilePath: "paper.pdf" });
    const second = await navigateLinkDetailed("paper.pdf#page=3", { paneId: "pane-left", currentFilePath: "paper.pdf" });

    expect(first.requestId).toBe(second.requestId);
    expect(Object.values(useLinkNavigationStore.getState().pendingByPane)).toHaveLength(1);
  });
});
