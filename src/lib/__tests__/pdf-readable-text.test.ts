import { describe, expect, it } from "vitest";
import { normalizePdfReadableText } from "@/lib/pdf-readable-text";
import { getCanonicalPdfAnnotationText, type AnnotationItem } from "@/types/universal-annotation";

describe("pdf-readable-text", () => {
  it("repairs Saffman-style exponent and ratio spacing for sidebar quotes", () => {
    expect(
      normalizePdfReadableText(", but stability requirements become more problematic, about 10 -4 100/ n 2 V / cm for a 1 MHz shift."),
    ).toBe(", but stability requirements become more problematic, about 10^-4(100/n)^2 V/cm for a 1 MHz shift.");
  });

  it("repairs legacy PDF annotation text before sidebar rendering", () => {
    const annotation: Pick<AnnotationItem, "target" | "content"> = {
      target: {
        type: "pdf",
        page: 7,
        rects: [{ x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.12 }],
        textQuote: {
          exact: ", but stability requirements become more problematic, about 10 −4 100/ n 2 V / cm for a 1 MHz shift.",
          prefix: "",
          suffix: "",
          source: "pdfjs-text-model",
          confidence: "exact",
        },
      },
      content: undefined,
    };

    expect(getCanonicalPdfAnnotationText(annotation)).toBe(
      ", but stability requirements become more problematic, about 10^-4(100/n)^2 V/cm for a 1 MHz shift.",
    );
  });
});
