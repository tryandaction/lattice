import { beforeEach, describe, expect, it } from "vitest";
import { useLinkNavigationStore } from "../link-navigation-store";

describe("link navigation lifecycle", () => {
  beforeEach(() => {
    useLinkNavigationStore.setState({ pendingByPane: {}, outcomesByRequestId: {} });
  });

  it("keeps a claimed PDF request pending until a terminal outcome", () => {
    useLinkNavigationStore.getState().setPendingNavigation("pane-1", {
      requestId: "nav-test-1",
      filePath: "papers/paper.pdf",
      target: { type: "pdf_page", path: "papers/paper.pdf", page: 3 },
    });

    const claimed = useLinkNavigationStore.getState().claimPendingNavigation("pane-1", "papers/paper.pdf");
    expect(claimed?.requestId).toBe("nav-test-1");
    expect(useLinkNavigationStore.getState().pendingByPane["pane-1"]?.requestId).toBe("nav-test-1");

    useLinkNavigationStore.getState().completePendingNavigation("pane-1", "nav-test-1", {
      status: "quote_not_found",
    });

    expect(useLinkNavigationStore.getState().pendingByPane["pane-1"]).toBeUndefined();
    expect(useLinkNavigationStore.getState().outcomesByRequestId["nav-test-1"]).toMatchObject({
      requestId: "nav-test-1",
      status: "quote_not_found",
    });
  });

  it("does not confuse decoded hash characters in different filenames with link fragments", () => {
    useLinkNavigationStore.getState().setPendingNavigation("pane-1", {
      filePath: "papers/paper#final.pdf",
      target: { type: "pdf_page", path: "papers/paper#final.pdf", page: 3 },
    });
    expect(useLinkNavigationStore.getState().claimPendingNavigation("pane-1", "papers/paper#draft.pdf")).toBeNull();
  });

  it("deduplicates equivalent root-prefixed pending targets", () => {
    const firstId = useLinkNavigationStore.getState().setPendingNavigation("pane-1", {
      requestId: "nav-alias-1",
      filePath: "workspace/papers/paper.pdf",
      target: { type: "pdf_page", path: "workspace/papers/paper.pdf", page: 3 },
    });
    const secondId = useLinkNavigationStore.getState().setPendingNavigation("pane-1", {
      filePath: "./papers/paper.pdf",
      target: { type: "pdf_page", path: "papers/paper.pdf", page: 3 },
    });

    expect(secondId).toBe(firstId);
    expect(useLinkNavigationStore.getState().pendingByPane["pane-1"]?.requestId).toBe("nav-alias-1");
  });

  it("consumes pending navigation through an equivalent workspace path alias", () => {
    useLinkNavigationStore.getState().setPendingNavigation("pane-1", {
      requestId: "nav-consume-alias",
      filePath: "papers/paper.pdf",
      target: { type: "pdf_page", path: "papers/paper.pdf", page: 4 },
    });

    const consumed = useLinkNavigationStore.getState().consumePendingNavigation("pane-1", "workspace/papers/paper.pdf");
    expect(consumed?.requestId).toBe("nav-consume-alias");
    expect(useLinkNavigationStore.getState().pendingByPane["pane-1"]).toBeUndefined();
  });
});
