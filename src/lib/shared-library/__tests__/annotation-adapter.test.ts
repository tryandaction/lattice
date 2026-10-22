import { describe, expect, it } from "vitest";
import { fromLegacyAnnotation, toLegacyAnnotation } from "../annotation-adapter";
import type { AnnotationItem } from "@/types/universal-annotation";
import type { Annotation } from "../domain";

function legacyPdf(): AnnotationItem {
  return {
    id: "legacy-ann-1",
    target: {
      type: "pdf",
      page: 2,
      rects: [{ x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 }],
      textQuote: {
        exact: "erasure conversion",
        prefix: "Logical qubits with ",
        suffix: " yields higher",
        source: "pdfjs-text-model",
        confidence: "exact",
      },
    },
    style: { type: "highlight", color: "#FFD400" },
    content: "erasure conversion",
    comment: "important!",
    tags: ["core", "qec"],
    author: "user-1",
    createdAt: 1_752_000_000_000,
  };
}

describe("annotation adapter", () => {
  it("maps a legacy PDF annotation to the shared model preserving identity, page and quote", () => {
    const shared = fromLegacyAnnotation(legacyPdf(), {
      itemId: "item-1",
      versionId: "ver-1",
    });

    expect(shared.id).toBe("legacy-ann-1");
    expect(shared.itemId).toBe("item-1");
    expect(shared.versionId).toBe("ver-1");
    expect(shared.authorId).toBe("user-1");
    expect(shared.target.locatorType).toBe("pdf-page");
    expect(shared.target.locator.page).toBe(2);
    expect(shared.quote?.exact).toBe("erasure conversion");
    expect(shared.geometry?.rects).toEqual([
      { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 },
    ]);
  });

  it("round-trips a legacy PDF annotation through the shared model", () => {
    const legacy = legacyPdf();
    const shared = fromLegacyAnnotation(legacy, {
      itemId: "item-1",
      versionId: "ver-1",
    });
    expect(toLegacyAnnotation(shared)).toEqual(legacy);
  });

  it("maps image and code annotations to structured locators", () => {
    const image = fromLegacyAnnotation(
      {
        id: "a1",
        target: { type: "image", x: 10, y: 20, width: 30, height: 40 },
        style: { type: "area", color: "transparent" },
        author: "u",
        createdAt: 1,
      },
      { itemId: "item-1", versionId: "ver-1" },
    );
    expect(image.target.locatorType).toBe("image-region");
    expect(image.target.locator).toEqual({ x: 10, y: 20, width: 30, height: 40 });

    const code = fromLegacyAnnotation(
      {
        id: "a2",
        target: { type: "code_line", line: 12 },
        style: { type: "highlight", color: "#FFD400" },
        author: "u",
        createdAt: 1,
      },
      { itemId: "item-1", versionId: "ver-1" },
    );
    expect(code.target.locatorType).toBe("code-line");
    expect(code.target.locator).toEqual({ line: 12 });
  });

  it("reconstructs a legacy target from the structured model when no legacy target was preserved", () => {
    const remote: Annotation = {
      id: "remote-ann-1",
      itemId: "item-1",
      versionId: "ver-1",
      authorId: "user-9",
      kind: "highlight",
      target: { locatorType: "pdf-page", locator: { page: 5 } },
      quote: { exact: "some quote" },
      geometry: { rects: [{ x1: 0, y1: 0, x2: 0.5, y2: 0.5 }] },
      style: { type: "highlight", color: "#FFD400" },
      body: {},
      status: "active",
      revision: 1,
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    };

    const legacy = toLegacyAnnotation(remote);
    expect(legacy.target).toEqual({
      type: "pdf",
      page: 5,
      rects: [{ x1: 0, y1: 0, x2: 0.5, y2: 0.5 }],
      textQuote: {
        exact: "some quote",
        prefix: "",
        suffix: "",
        source: "pdfjs-text-model",
        confidence: "exact",
      },
    });
    expect(legacy.content).toBe("some quote");
    expect(legacy.author).toBe("user-9");
  });

  it("preserves comment, tags and author across the boundary", () => {
    const legacy = legacyPdf();
    const shared = fromLegacyAnnotation(legacy, {
      itemId: "item-1",
      versionId: "ver-1",
    });
    expect(shared.body.comment).toBe("important!");
    expect(shared.body.tags).toEqual(["core", "qec"]);

    const back = toLegacyAnnotation(shared);
    expect(back.comment).toBe("important!");
    expect(back.tags).toEqual(["core", "qec"]);
  });
});
