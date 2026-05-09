/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { renderInlineMarkdownHtml } from "../widgets";

describe("live preview math rendering output", () => {
  it("renders inline math without embedding MathML fallback text in table HTML", () => {
    const html = renderInlineMarkdownHtml("$a^2 + b^2 = c^2$");
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelector(".katex")).toBeTruthy();
    expect(container.innerHTML.toLowerCase()).not.toContain("mathml");
    expect(container.textContent).not.toContain("a2+b2=c2a^2 + b^2 = c^2a2+b2=c2");
  });
});
