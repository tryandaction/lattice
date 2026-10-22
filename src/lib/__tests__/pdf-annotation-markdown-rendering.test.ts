import { describe, expect, it } from "vitest";
import { decoratePdfAnnotationMarkdown } from "@/lib/pdf-annotation-markdown-rendering";

describe("decoratePdfAnnotationMarkdown", () => {
  it("upgrades legacy quote and screenshot blocks with the annotation color", () => {
    const markdown = [
      '### 1. Area',
      '<!-- lattice-pdf-annotation id="ann-blue" page="2" type="area" color="#2ea8e5" -->',
      '<span class="lattice-pdf-annotation-chip" data-color="#2ea8e5" data-type="area">Area</span>',
      '',
      '#### Quote',
      '',
      '> first line',
      '> second line',
      '',
      '#### Screenshot',
      '',
      '![Area Screenshot ann-blue Page 2](./_annotation_previews/ann-blue.png)',
    ].join("\n");

    const decorated = decoratePdfAnnotationMarkdown(markdown);

    expect(decorated).toContain('<blockquote class="lattice-pdf-annotation-quote" data-color="#2ea8e5">first line<br />second line</blockquote>');
    expect(decorated).toContain('<img class="lattice-pdf-annotation-preview" data-color="#2ea8e5"');
    expect(decorated).toContain('src="./_annotation_previews/ann-blue.png"');
  });

  it("does not alter ordinary markdown without managed annotation metadata", () => {
    const markdown = '> ordinary quote\n\n![Plot](assets/plot.png)';
    expect(decoratePdfAnnotationMarkdown(markdown)).toBe(markdown);
  });
});
