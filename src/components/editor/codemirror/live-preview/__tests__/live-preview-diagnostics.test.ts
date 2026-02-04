/**
 * Live Preview Diagnostics
 * Validates parsed elements for test fixtures without relying on browser UI.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";
import {
  parseDocumentFromText,
  resolveConflicts,
  ElementType,
} from "../decoration-coordinator";

const FIXTURES = [
  "public/test-syntax-hiding.md",
  "public/test-nested-formatting.md",
  "public/test-10000-lines.md",
];

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

describe("live preview diagnostics", () => {
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

      // Ensure inline code/math do not contain nested elements
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

      // Helpful console summary for manual review
      // eslint-disable-next-line no-console
      console.log(`[diagnostics] ${fixture}`, counts);
    }
  });
});
