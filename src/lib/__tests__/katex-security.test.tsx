/**
 * @vitest-environment jsdom
 */

import React from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownRenderer } from "@/components/renderers/markdown-renderer";
import { AnnotationMarkdownRenderer } from "@/components/renderers/annotation-markdown-renderer";
import { renderLatex as renderWorkbenchLatex } from "@/lib/katex-renderer";
import { renderLatex as renderPptLatex } from "@/lib/formula-enhancer";
import { buildMarkdownExportPreview } from "@/lib/markdown-export";

vi.mock("@/hooks/use-selection-context-menu", () => ({
  useSelectionContextMenu: () => ({ menuState: null, closeMenu: vi.fn() }),
}));
vi.mock("@/components/ai/selection-context-menu", () => ({ SelectionContextMenu: () => null }));
vi.mock("@/components/ai/selection-ai-hub", () => ({ SelectionAiHub: () => null }));

const UNSAFE_FORMULA = String.raw`\href{https://untrusted.example/math}{x}+\htmlClass{unsafe-math-marker}{y}+\includegraphics{https://untrusted.example/math.png}`;
const SAFE_FORMULA = String.raw`\frac{a}{b}+\begin{pmatrix}1&0\\0&1\end{pmatrix}+\bra{\psi}\ket{\phi}`;

function parseHtml(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

function expectUntrustedCommandsRejected(container: HTMLElement) {
  expect(container.querySelector(".katex-html")).toBeTruthy();
  expect(container.querySelector("a[href], img[src], .unsafe-math-marker")).toBeNull();
  // KaTeX displays rejected commands as text instead of creating their HTML.
  expect(container.querySelector(".katex-html")?.textContent).toContain(String.raw`\href`);
  expect(container.querySelector(".katex-html")?.textContent).toContain(String.raw`\htmlClass`);
}

function expectScientificFormulaRendered(container: HTMLElement) {
  expect(container.querySelector(".katex-html")).toBeTruthy();
  expect(container.querySelector(".katex-error, .formula-error")).toBeNull();
  expect(container.querySelector(".frac-line")).toBeTruthy();
  expect(container.querySelector(".mtable")).toBeTruthy();
  expect(container.querySelector(".katex-html")?.textContent).toContain("ψ");
  expect(container.querySelector(".katex-html")?.textContent).toContain("ϕ");
}

describe("untrusted KaTeX render paths", () => {
  const directRenderers = [
    ["workbench/editor", (latex: string) => renderWorkbenchLatex(latex, false)],
    ["PowerPoint formula enhancer", (latex: string) => renderPptLatex(latex, false).html],
  ] as const;

  it.each(directRenderers)("%s rejects external-resource and HTML commands", (_name, renderer) => {
    expectUntrustedCommandsRejected(parseHtml(renderer(UNSAFE_FORMULA)));
  });

  it.each(directRenderers)("%s preserves fractions, matrices and physics notation", (_name, renderer) => {
    expectScientificFormulaRendered(parseHtml(renderer(SAFE_FORMULA)));
  });

  const markdownRenderers = [
    ["document Markdown", MarkdownRenderer],
    ["annotation Markdown", AnnotationMarkdownRenderer],
  ] as const;

  it.each(markdownRenderers)("%s rejects untrusted math after the KaTeX plugin loads", async (_name, Renderer) => {
    const { container } = render(<Renderer content={`$${UNSAFE_FORMULA}$`} />);
    await waitFor(() => expectUntrustedCommandsRejected(container));
  });

  it.each(markdownRenderers)("%s preserves scientific math after the KaTeX plugin loads", async (_name, Renderer) => {
    const { container } = render(<Renderer content={`$${SAFE_FORMULA}$`} />);
    await waitFor(() => expectScientificFormulaRendered(container));
  });

  it("exported Markdown rejects untrusted math while preserving scientific math", async () => {
    const preview = await buildMarkdownExportPreview(`$${UNSAFE_FORMULA}$\n\n$${SAFE_FORMULA}$`, {
      format: "docx", fileName: "formula-security.md", annotationMode: "clean",
      includeAnnotations: false, visualMode: "document",
    });
    const container = parseHtml(preview.html);
    const formulas = container.querySelectorAll<HTMLElement>(".katex");
    expect(formulas).toHaveLength(2);
    expectUntrustedCommandsRejected(formulas[0]);
    expectScientificFormulaRendered(formulas[1]);
  });
});
