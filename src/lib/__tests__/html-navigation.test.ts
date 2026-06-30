import { describe, expect, it } from "vitest";
import { shouldLetHtmlPreviewHandleAnchor } from "../html-navigation";

describe("html navigation helpers", () => {
  it("lets iframe previews handle same-document hash anchors natively", () => {
    expect(shouldLetHtmlPreviewHandleAnchor("#section-2")).toBe(true);
    expect(shouldLetHtmlPreviewHandleAnchor(" #section-2 ")).toBe(true);
  });

  it("routes non-hash links through the Lattice link router", () => {
    expect(shouldLetHtmlPreviewHandleAnchor("notes/demo.md#section-2")).toBe(false);
    expect(shouldLetHtmlPreviewHandleAnchor("./chapter.html#part-1")).toBe(false);
    expect(shouldLetHtmlPreviewHandleAnchor("https://example.com/#part-1")).toBe(false);
  });
});
