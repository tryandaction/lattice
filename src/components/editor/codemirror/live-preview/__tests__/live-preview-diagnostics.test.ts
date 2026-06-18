/**
 * Live Preview Diagnostics
 * Validates parsed elements for test fixtures without relying on browser UI.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";
import { LIVE_PREVIEW_DIAGNOSTIC_FIXTURES } from "@/components/diagnostics/live-preview-content";
import {
  parseDocumentFromText,
  resolveConflicts,
  ElementType,
} from "../decoration-coordinator";

const FIXTURES = LIVE_PREVIEW_DIAGNOSTIC_FIXTURES.map((fixture) => `public${fixture.url}`);

const INLINE_TYPES = new Set<ElementType>([
  ElementType.INLINE_BOLD,
  ElementType.INLINE_ITALIC,
  ElementType.INLINE_CODE,
  ElementType.INLINE_LINK,
  ElementType.INLINE_IMAGE,
  ElementType.INLINE_TAG,
  ElementType.INLINE_OTHER,
  ElementType.MATH_INLINE,
]);

const NO_NESTING_TYPES = new Set<ElementType>([
  ElementType.INLINE_CODE,
  ElementType.MATH_INLINE,
]);

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function hasDecorationType(
  decorationData: unknown,
  type: string,
): decorationData is Record<string, unknown> & { type: string } {
  return typeof decorationData === "object"
    && decorationData !== null
    && "type" in decorationData
    && decorationData.type === type;
}

function hasDecorationClass(
  decorationData: unknown,
  className: string,
): decorationData is Record<string, unknown> & { className: string } {
  return typeof decorationData === "object"
    && decorationData !== null
    && "className" in decorationData
    && decorationData.className === className;
}

describe("live preview diagnostics", () => {
  it("keeps annotation, wiki links, and embeds from stealing each other", () => {
    const text = [
      "See [[paper.pdf#ann-123]] and [[Daily Note#Heading|daily]].",
      "Image ![[assets/chart 1.png|320]] and embed ![[notes/card|Card]].",
      "Inline code `==literal==` and highlight ==marked==.",
    ].join("\n");

    const elements = resolveConflicts(parseDocumentFromText(text));
    const inlineLinks = elements.filter((element) => element.type === ElementType.INLINE_LINK);
    const inlineImages = elements.filter((element) => element.type === ElementType.INLINE_IMAGE);
    const inlineOther = elements.filter((element) => element.type === ElementType.INLINE_OTHER);

    const annotation = inlineOther.find((element) => hasDecorationType(element.decorationData, "annotation-link"));
    const embed = inlineOther.find((element) => hasDecorationType(element.decorationData, "embed"));
    const wikiLinks = inlineLinks.filter((element) => hasDecorationType(element.decorationData, "wiki-link"));
    const highlights = inlineOther.filter((element) => hasDecorationClass(element.decorationData, "cm-highlight"));
    const annotationData = hasDecorationType(annotation?.decorationData, "annotation-link")
      ? annotation.decorationData
      : null;
    const embedData = hasDecorationType(embed?.decorationData, "embed")
      ? embed.decorationData
      : null;
    const wikiData = hasDecorationType(wikiLinks[0]?.decorationData, "wiki-link")
      ? wikiLinks[0].decorationData
      : null;

    expect(annotationData?.filePath).toBe("paper.pdf");
    expect(annotationData?.annotationId).toBe("ann-123");
    expect(wikiLinks).toHaveLength(1);
    expect(wikiData?.url).toBe("Daily Note#Heading");
    expect(inlineImages[0]?.decorationData).toMatchObject({
      type: "image",
      url: "assets/chart 1.png",
      width: 320,
      syntax: "wiki",
    });
    expect(embedData?.target).toBe("notes/card");
    expect(embedData?.displayText).toBe("Card");
    expect(highlights).toHaveLength(1);
    expect(highlights[0]?.content).toBe("marked");
  });

  it("includes frontmatter properties in text diagnostics parsing", () => {
    const text = "---\nstatus: draft\naliases:\n  - one\n---\n\n# Note";
    const elements = resolveConflicts(parseDocumentFromText(text));
    const properties = elements.find((element) => element.type === ElementType.PROPERTIES);

    expect(properties).toMatchObject({
      from: 0,
      lineNumber: 1,
      startLine: 1,
      endLine: 5,
    });
    expect(properties?.decorationData).toMatchObject({
      source: "---\nstatus: draft\naliases:\n  - one\n---",
      isMultiLine: true,
    });
  });

  it("preserves callout fold markers in diagnostics parsing", () => {
    const text = "> [!note-] Original\n> Body";
    const elements = resolveConflicts(parseDocumentFromText(text));
    const callout = elements.find((element) => element.type === ElementType.CALLOUT);

    expect(callout?.decorationData).toMatchObject({
      type: "note",
      title: "Original",
      isFolded: true,
      foldMarker: "-",
    });
  });

  it("parses fixtures without invalid ranges or escaped matches", () => {
    for (const fixture of FIXTURES) {
      const fullPath = resolve(process.cwd(), fixture);
      const text = readFileSync(fullPath, "utf-8");

      const parsed = parseDocumentFromText(text);
      const elements = resolveConflicts(parsed);

      const counts: Record<string, number> = {};
      for (const element of elements) {
        const name = ElementType[element.type];
        counts[name] = (counts[name] || 0) + 1;

        expect(element.from).toBeGreaterThanOrEqual(0);
        expect(element.to).toBeGreaterThanOrEqual(element.from);
        expect(element.to).toBeLessThanOrEqual(text.length);

        if (INLINE_TYPES.has(element.type)) {
          expect(isEscaped(text, element.from)).toBe(false);
        }
      }

      for (const container of elements) {
        if (!NO_NESTING_TYPES.has(container.type)) continue;
        for (const other of elements) {
          if (other === container) continue;
          const inside =
            other.from >= container.from && other.to <= container.to;
          if (!inside) continue;
          if (other.type === container.type) continue;
          throw new Error(
            `Nested element found inside ${ElementType[container.type]} in ${fixture}: ${ElementType[other.type]}`
          );
        }
      }

      expect(Object.keys(counts).length).toBeGreaterThan(0);
    }
  }, 120000);
});
