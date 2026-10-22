import { describe, expect, it } from "vitest";
import { buildPluginPdfTextPage } from "@/lib/plugins/pdf-geometry";

describe("plugin PDF runtime geometry bridge", () => {
  it("converts kernel glyph font size and baseline to normalized item metadata", () => {
    const model = {
      pageNumber: 1,
      viewportWidth: 1000,
      viewportHeight: 800,
      normalizedText: "E2",
      textContent: { items: [], styles: {} },
      items: [
        { str: "E", transform: [12, 0, 0, 12, 100, 200], width: 12, height: 12, hasEOL: false, dir: "ltr", fontName: "f" },
        { str: "2", transform: [7, 0, 0, 7, 114, 193], width: 7, height: 7, hasEOL: false, dir: "ltr", fontName: "f" },
      ],
      segments: [
        { itemIndex: 0, text: "E", normalizedText: "E", hasEOL: false, pageTextStart: 0, pageTextEnd: 1 },
        { itemIndex: 1, text: "2", normalizedText: "2", hasEOL: false, pageTextStart: 1, pageTextEnd: 2 },
      ],
      itemRects: [
        { itemIndex: 0, left: 100, top: 200, width: 12, height: 12 },
        { itemIndex: 1, left: 114, top: 193, width: 7, height: 7 },
      ],
    } as never;
    const enriched = buildPluginPdfTextPage(model).glyphs!;
    expect(enriched).toHaveLength(2);
    expect(enriched[0].fontSize).toBeGreaterThan(0);
    expect(enriched[0].baseline).toBeGreaterThan(0);
    expect(enriched[1].fontSize).toBeLessThan(enriched[0].fontSize!);
  });
});
