import { describe, expect, it } from "vitest";

import {
  buildPdfNativeNormalizedModel,
  buildPdfNativeNormalizedRect,
} from "../pdf-native-text-model";
import type {
  PdfNativePageTextLayout,
  PdfNativeTextChar,
} from "../pdf-native-text-engine";

function createChar(input: Partial<PdfNativeTextChar> & Pick<PdfNativeTextChar, "charIndex" | "text">): PdfNativeTextChar {
  return {
    charIndex: input.charIndex,
    charEndIndex: input.charEndIndex,
    text: input.text,
    x1: input.x1 ?? input.charIndex * 10,
    y1: input.y1 ?? 20,
    x2: input.x2 ?? (input.charIndex * 10) + 8,
    y2: input.y2 ?? 32,
    fontSize: input.fontSize ?? 12,
  };
}

function createLayout(input: {
  text: string;
  chars: PdfNativeTextChar[];
  width?: number;
  height?: number;
}): PdfNativePageTextLayout {
  return {
    source: "pdfium",
    pageNumber: 3,
    width: input.width ?? 200,
    height: input.height ?? 100,
    text: input.text,
    chars: input.chars,
  };
}

describe("pdf-native-text-model", () => {
  it("normalizes whitespace while retaining native UTF-16 character boundaries", () => {
    const layout = createLayout({
      text: "alpha  beta",
      chars: [
        ..."alpha".split("").map((text, index) => createChar({ charIndex: index, text })),
        ..."beta".split("").map((text, index) => createChar({ charIndex: index + 7, text })),
      ].reverse(),
    });

    const model = buildPdfNativeNormalizedModel(layout);

    expect(model.normalizedText).toBe("alpha beta");
    expect(model.compact.compactText).toBe("alphabeta");
    expect(model.chars.map((char) => [char.normalizedStart, char.normalizedEnd])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [6, 7],
      [7, 8],
      [8, 9],
      [9, 10],
    ]);
    expect(model.chars[5]?.sourceChar.charIndex).toBe(7);
  });

  it("expands ligatures without losing UTF-16 offsets for non-BMP characters", () => {
    const layout = createLayout({
      text: "o\ufb03ce \ud83d\ude00",
      chars: [
        createChar({ charIndex: 0, text: "o" }),
        createChar({ charIndex: 1, charEndIndex: 2, text: "\ufb03" }),
        createChar({ charIndex: 2, text: "c" }),
        createChar({ charIndex: 3, text: "e" }),
        createChar({ charIndex: 5, charEndIndex: 7, text: "\ud83d\ude00" }),
      ],
    });

    const model = buildPdfNativeNormalizedModel(layout);

    expect(model.normalizedText).toBe("office \ud83d\ude00");
    expect(model.chars[1]).toMatchObject({
      normalizedStart: 1,
      normalizedEnd: 4,
      text: "ffi",
    });
    expect(model.chars.at(-1)).toMatchObject({
      normalizedStart: 7,
      normalizedEnd: 9,
      text: "\ud83d\ude00",
    });
  });

  it("clamps malformed native offsets and drops characters outside normalized text", () => {
    const layout = createLayout({
      text: "A",
      chars: [
        createChar({ charIndex: -4, charEndIndex: 1, text: "A" }),
        createChar({ charIndex: 20, charEndIndex: 21, text: "ignored" }),
      ],
    });

    const model = buildPdfNativeNormalizedModel(layout);

    expect(model.chars).toHaveLength(1);
    expect(model.chars[0]).toMatchObject({
      normalizedStart: 0,
      normalizedEnd: 1,
    });
  });

  it("projects native character geometry into normalized page coordinates", () => {
    const layout = createLayout({
      text: "A",
      width: 200,
      height: 100,
      chars: [],
    });

    expect(buildPdfNativeNormalizedRect({
      layout,
      char: createChar({
        charIndex: 0,
        text: "A",
        x1: 20,
        y1: 10,
        x2: 60,
        y2: 30,
      }),
    })).toEqual({
      x1: 0.1,
      y1: 0.1,
      x2: 0.3,
      y2: 0.3,
    });
  });

  it("rejects geometry when the native page dimensions are invalid", () => {
    const layout = createLayout({ text: "A", chars: [], width: 0 });

    expect(buildPdfNativeNormalizedRect({
      layout,
      char: createChar({ charIndex: 0, text: "A" }),
    })).toBeNull();
  });
});
