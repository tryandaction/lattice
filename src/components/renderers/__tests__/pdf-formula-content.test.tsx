/** @vitest-environment jsdom */

import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PdfFormulaContent } from "../pdf-formula-content";
import { KATEX_MACROS } from "@/lib/katex-config";
import { setLocale } from "@/lib/i18n";
import type { ImageAnnotationPreview, PdfFormulaAnnotation } from "@/types/universal-annotation";

const formula: PdfFormulaAnnotation = {
  latex: "\\frac{x^{2}}{y_{1}}",
  rawText: "x 2 y 1",
  status: "ready",
  source: "geometry",
  originalRects: [{ x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.3 }],
};
const preview: ImageAnnotationPreview = {
  type: "image", dataUrl: "data:image/png;base64,cG5n", width: 400, height: 160,
};
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  setLocale("zh-CN");
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "execCommand");
});

describe("PdfFormulaContent", () => {
  it('shows raw OCR and refuses to approve an unchanged truncated draft',async()=>{
    const onChange=vi.fn();render(<PdfFormulaContent formula={{...formula,status:'needs-review',source:'ocr',latex:'x+y',initialLatex:'x+y',originalLatex:'x + y',recognitionTruncated:true}} preview={preview} onChange={onChange}/>);
    expect(screen.getByText('识别结果未完整结束，请对照原图补全后再复制或导出。')).toBeTruthy();
    expect(screen.getByText('x + y')).toBeTruthy();fireEvent.click(screen.getByText('应用公式'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'x+y+z'}});fireEvent.click(screen.getByText('应用公式'));
    await waitFor(()=>expect(onChange).toHaveBeenCalledWith(expect.objectContaining({latex:'x+y+z',originalLatex:'x + y',recognitionTruncated:true,initialLatex:'x+y'})));
  });
  it("renders verified formula structure as accessible math", () => {
    const { container } = render(<PdfFormulaContent formula={formula} preview={preview} />);
    expect(container.querySelector(".katex math mfrac")).not.toBeNull();
    expect(container.querySelector(".katex math msup")).not.toBeNull();
    expect(container.querySelector(".katex math msub")).not.toBeNull();
    const sourceDetails = container.querySelector('details');
    expect(sourceDetails?.open).toBe(false);
    expect(sourceDetails?.querySelector('img')?.src).toBe(preview.dataUrl);
  });

  it.each([
    ["复制 LaTeX", "\\frac{x^{2}}{y_{1}}"],
    ["复制 Markdown", "$$\n\\frac{x^{2}}{y_{1}}\n$$"],
  ])("copies the complete %s format without navigating the annotation", async (label, expected) => {
    const onNavigate = vi.fn();
    render(<div onClick={onNavigate} onKeyDown={onNavigate}><PdfFormulaContent formula={formula} /></div>);
    const button = screen.getByRole("button", { name: label });
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
    expect(screen.getByRole("status").textContent).toContain("已复制");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("shows the original image and blocks copying unreviewed formula candidates", () => {
    const { container } = render(<PdfFormulaContent formula={{ ...formula, status: "needs-review" }} preview={preview} />);
    const image = screen.getByRole("img", { name: "原始公式截图" });
    expect(image.getAttribute("src")).toBe(preview.dataUrl);
    expect(image.getAttribute("width")).toBe("400");
    expect(image.getAttribute("height")).toBe("160");
    expect(container.querySelector(".katex")).toBeNull();
    expect(screen.getByText("待校对")).toBeTruthy();
    expect((screen.getByRole("button", { name: "复制 LaTeX" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "复制 Markdown" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "复制 LaTeX" }));
    expect(writeText).not.toHaveBeenCalled();
  });

  it.each([
    "\\frac{x}{",
    "\\unknowncommand{x}",
    "\\href{javascript:alert(1)}{x}",
    "\\htmlStyle{background:url(https://example.com)}{x}",
    "\\includegraphics{https://example.com/tracker.png}",
    "\\def\\loop{\\loop}\\loop",
    "x".repeat(20001),
  ])("rejects unsafe, malformed, or excessive source instead of presenting verified math (case %#)", (latex) => {
    const { container } = render(<PdfFormulaContent formula={{ ...formula, latex }} preview={preview} />);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector("a, script")).toBeNull();
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByText("待校对")).toBeTruthy();
    expect((screen.getByRole("button", { name: "复制 LaTeX" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps fallback source as text and never loads an external preview URL", () => {
    const rawText = '<script>alert(1)</script> complete source';
    const { container } = render(<PdfFormulaContent formula={{ ...formula, latex: undefined, rawText, status: "needs-review" }} preview={{ ...preview, dataUrl: "https://example.com/tracker.png" }} />);
    expect(screen.getByText(rawText)).toBeTruthy();
    expect(container.querySelector("script, img")).toBeNull();
  });

  it("isolates user macro definitions from the shared math renderer", () => {
    const original = KATEX_MACROS["\\R"];
    const { container } = render(<PdfFormulaContent formula={{ ...formula, latex: "\\gdef\\R{x}\\R" }} />);
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(KATEX_MACROS["\\R"]).toBe(original);
  });

  it("validates corrections and preserves original text and geometry when applying", async () => {
    const onChange = vi.fn();
    const onNavigate = vi.fn();
    function EditableFormula() {
      const [current, setCurrent] = useState<PdfFormulaAnnotation>({ ...formula, status: "needs-review" });
      return <PdfFormulaContent formula={current} preview={preview} onChange={(updated) => { onChange(updated); setCurrent(updated); }} />;
    }
    render(<div onClick={onNavigate} onKeyDown={onNavigate}><EditableFormula /></div>);
    fireEvent.click(screen.getByText("校对公式"));
    const input = screen.getByRole("textbox", { name: "LaTeX 公式" });
    fireEvent.change(input, { target: { value: "\\frac{x}{" } });
    fireEvent.click(screen.getByRole("button", { name: "应用公式" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("有效的 LaTeX");
    fireEvent.change(input, { target: { value: "  E=mc^2  " } });
    fireEvent.click(screen.getByRole("button", { name: "应用公式" }));
    expect(onChange).toHaveBeenCalledWith({ ...formula, latex: "E=mc^2", status: "ready", source: "manual" });
    fireEvent.click(screen.getByRole("button", { name: "复制 LaTeX" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("E=mc^2"));
    expect(onNavigate).not.toHaveBeenCalled();
  });
  it('does not report a corrected formula saved when persistence fails', async () => {
    render(<PdfFormulaContent formula={formula} onChange={async()=>{throw new Error('disk unavailable');}} />);
    fireEvent.click(screen.getByText('校对公式'));
    fireEvent.click(screen.getByRole('button',{name:'应用公式'}));
    await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('尚未保存'));
    expect(screen.queryByText('公式已应用')).toBeNull();
  });

  it("reports clipboard rejection without a success message", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<PdfFormulaContent formula={formula} />);
    fireEvent.click(screen.getByRole("button", { name: "复制 Markdown" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("复制失败"));
    expect(screen.queryByText("已复制")).toBeNull();
  });

  it("falls back to the document clipboard bridge when the async clipboard API is denied", async () => {
    writeText.mockRejectedValue(new Error("permission denied"));
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    render(<PdfFormulaContent formula={formula} />);

    fireEvent.click(screen.getByRole("button", { name: "复制 LaTeX" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已复制"));
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports unavailable clipboard access", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    render(<PdfFormulaContent formula={formula} />);
    fireEvent.click(screen.getByRole("button", { name: "复制 LaTeX" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("复制失败"));
  });

  it("shows pending local OCR and reports failure without losing the original image", async () => {
    let rejectRecognition!: (reason: Error) => void;
    const onRecognize = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectRecognition = reject; }));
    render(<PdfFormulaContent formula={{ ...formula, status: "needs-review" }} preview={preview} onRecognize={onRecognize} />);
    fireEvent.click(screen.getByRole("button", { name: "本地识别公式" }));
    expect((screen.getByRole("button", { name: "正在识别…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onRecognize).toHaveBeenCalledTimes(1);
    rejectRecognition(new Error("OCR unavailable"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("识别失败"));
    expect(screen.getByRole("img", { name: "原始公式截图" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "本地识别公式" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
