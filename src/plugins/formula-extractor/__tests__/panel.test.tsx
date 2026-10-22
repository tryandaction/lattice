import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormulaExtractorPanel } from "../panel";
import type { FormulaExtractionResult } from "../types";
import { getLocale, setLocale, t } from "@/lib/i18n";

const runPluginCommandMock = vi.fn();
const capability = vi.hoisted(() => ({ probe: vi.fn(), command: "pix2tex", changed: undefined as (() => void) | undefined }));
vi.mock('@/hooks/use-i18n',()=>({useI18n:()=>({locale:getLocale(),t})}));
vi.mock('@/lib/formula-ocr', () => ({ probeFormulaOcrBackend: capability.probe }));

vi.mock("@/lib/plugins/runtime", () => ({
  runPluginCommand: (...args: unknown[]) => runPluginCommandMock(...args),
  getPluginSetting: () => capability.command,
  subscribePluginSetting: (_pluginId: string, _key: string, listener: () => void) => {
    capability.changed = listener;
    return () => { capability.changed = undefined; };
  },
}));

function createResult(): FormulaExtractionResult {
  return {
    sourceFile: "paper.pdf",
    viewerType: "pdf",
    scope: "document",
    scannedAt: Date.now(),
    warnings: [],
    formulas: [
      {
        id: "formula-1",
        source: "pdf",
        kind: "text-layer",
        page: 3,
        location: "page:3:2",
        confidence: 0.91,
        bbox: { x1: 0.2, y1: 0.3, x2: 0.6, y2: 0.35 },
        target: {
          viewerType: "pdf",
          page: 3,
          bbox: { x1: 0.2, y1: 0.3, x2: 0.6, y2: 0.35 },
          quote: "E = mc^2",
        },
        latex: "E = mc^2",
        rawText: "E = mc^2",
        displayMode: true,
        context: "Energy relation",
      },
    ],
    hiddenCandidates: [
      {
        page: 3,
        reason: "prose-like",
        rawText: "This is an ordinary paragraph with numbers 1 and 2.",
        score: 0.12,
      },
    ],
  };
}

describe("FormulaExtractorPanel", () => {
  it('allows fresh OCR after switching files while old results remain stale and disabled',async()=>{
    const old=createResult();old.viewerType='md';render(<FormulaExtractorPanel result={old} stale/>);
    const button=screen.getByRole('button',{name:'OCR selection'});await waitFor(()=>expect(button.hasAttribute('disabled')).toBe(false));
    expect(screen.getByRole('button',{name:'Copy LaTeX'}).hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);expect(runPluginCommandMock).toHaveBeenCalledWith('formula-extractor.ocr.selection',undefined);
  });
  it('compares OCR pixels to the prediction and keeps malformed math visibly unrendered', async()=>{
    const result=createResult();result.formulas[0]={...result.formulas[0],kind:'ocr',needsReview:true,rawText:'',originalLatex:String.raw`\binom{a}{c}\begin{array}{\ b}{d}`,latex:String.raw`\binom{a}{c}\begin{array}{\ b}{d}`,sourceImage:{dataUrl:'data:image/png;base64,iVBORw0KGgo=',width:320,height:90}};
    render(<FormulaExtractorPanel result={result}/>);
    expect(screen.getByAltText('Original formula image').getAttribute('src')).toBe(result.formulas[0].sourceImage?.dataUrl);
    expect(screen.getByText('Formula syntax needs correction. Compare it with the original image.')).toBeTruthy();
    expect(screen.getByRole('button',{name:'Copy LaTeX'}).getAttribute('disabled')).not.toBeNull();
    fireEvent.change(screen.getByRole('textbox',{name:'LaTeX for formula-1'}),{target:{value:String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`}});
    expect(screen.getByRole('button',{name:'Copy LaTeX'}).getAttribute('disabled')).toBeNull();
    expect(screen.getByAltText('Original formula image').getAttribute('src')).toBe(result.formulas[0].sourceImage?.dataUrl);
  });
  beforeEach(() => {
    setLocale('en-US');
    capability.command = 'pix2tex';
    capability.probe.mockReset().mockImplementation(async (command: string) => ({ status: 'ready', command }));
    runPluginCommandMock.mockClear();
    runPluginCommandMock.mockResolvedValue(undefined);
  });

  it("renders extracted formulas with KaTeX preview and source LaTeX", async () => {
    const { container } = render(<FormulaExtractorPanel result={createResult()} />);

    expect(screen.getByText(/paper\.pdf/)).toBeTruthy();
    expect(screen.queryByText("Locate")).toBeNull();
    expect(screen.queryByText("review")).toBeNull();
    expect(screen.queryByText("Copy all")).toBeNull();
    expect(screen.getByText("Copy LaTeX")).toBeTruthy();
    expect(screen.getByText("Copy Markdown")).toBeTruthy();
    expect(screen.getByText("OCR selection")).toBeTruthy();
    expect(screen.getByText(".md")).toBeTruthy();
    expect(screen.getByText(".tex")).toBeTruthy();
    expect(screen.getByText("Diagnostics / Hidden candidates (1)")).toBeTruthy();
    expect(container.querySelector(".katex")).toBeTruthy();
    expect(screen.getByTestId("formula-rendered-preview")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', {name: /ocr selection/i}).getAttribute('disabled')).toBeNull());
  });

  it("waits for an explicit scan when opened without an existing result", async () => {
    render(<FormulaExtractorPanel result={null} busy={false} error={null} />);

    expect(runPluginCommandMock).not.toHaveBeenCalled();
    expect(screen.getByText("Click Scan to extract formulas from the active document.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    expect(runPluginCommandMock).toHaveBeenCalledWith("formula-extractor.extract.document", undefined);
    await waitFor(() => expect(screen.getByRole('button', {name: /ocr selection/i}).getAttribute('disabled')).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /ocr selection/i }));
    expect(runPluginCommandMock).toHaveBeenCalledWith("formula-extractor.ocr.selection", undefined);
  });

  it("routes card click and copy actions to explicit formula commands", async () => {
    render(<FormulaExtractorPanel result={createResult()} />);

    fireEvent.click(screen.getByRole("button", { name: /Page 3 .* Energy relation/ }));
    expect(runPluginCommandMock).toHaveBeenCalledWith("formula-extractor.reveal-formula", expect.objectContaining({ formulaId: "formula-1" }));

    fireEvent.click(screen.getByRole("button", { name: "Copy LaTeX" }));
    expect(runPluginCommandMock).toHaveBeenCalledWith("formula-extractor.copy-formula-latex", expect.objectContaining({ formulaId: "formula-1", latex: "E = mc^2" }));

    fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
    expect(runPluginCommandMock).toHaveBeenCalledWith("formula-extractor.copy-formula-markdown", expect.objectContaining({ formulaId: "formula-1", latex: "E = mc^2" }));
    await waitFor(() => expect(capability.probe).toHaveBeenCalled());
  });

  it('disables missing OCR while keeping native scans available without running a model', async () => {
    capability.probe.mockResolvedValue({status:'missing',command:'pix2tex'});
    render(<FormulaExtractorPanel />);
    await screen.findByText(/Local formula OCR was not found/);
    const ocr = screen.getByRole('button', {name:/ocr selection/i});
    expect(ocr.getAttribute('disabled')).not.toBeNull();
    fireEvent.click(ocr);
    expect(runPluginCommandMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name:/^scan$/i}));
    expect(runPluginCommandMock).toHaveBeenCalledWith('formula-extractor.extract.document',undefined);
  });

  it('keeps OCR disabled while probing and ignores an obsolete executable result', async () => {
    let oldResult!: (value: unknown) => void;
    let newResult!: (value: unknown) => void;
    capability.probe.mockImplementationOnce(() => new Promise(resolve => {oldResult=resolve;}))
      .mockImplementationOnce(() => new Promise(resolve => {newResult=resolve;}));
    render(<FormulaExtractorPanel />);
    expect(screen.getByRole('button', {name:/ocr selection/i}).getAttribute('disabled')).not.toBeNull();
    act(() => {capability.command='C:/tools/pix2tex.exe';capability.changed?.();});
    await waitFor(() => expect(capability.probe).toHaveBeenLastCalledWith('C:/tools/pix2tex.exe'));
    await act(async () => {oldResult({status:'ready',command:'pix2tex'});});
    expect(screen.getByRole('button', {name:/ocr selection/i}).getAttribute('disabled')).not.toBeNull();
    await act(async () => {newResult({status:'missing',command:'C:/tools/pix2tex.exe'});});
    expect(screen.getByRole('button', {name:/ocr selection/i}).getAttribute('disabled')).not.toBeNull();
    expect(screen.getByText(/Local formula OCR was not found/)).toBeTruthy();
  });

  it('reports desktop-only OCR in Chinese and localizes formula metadata', async () => {
    setLocale('zh-CN');
    capability.probe.mockResolvedValue({status:'desktop-only',command:'pix2tex'});
    render(<FormulaExtractorPanel result={createResult()} />);
    await screen.findByText(/图片公式 OCR 需要桌面端/);
    expect(screen.getByRole('button', {name:'OCR 所选图片公式'}).getAttribute('disabled')).not.toBeNull();
    expect(screen.getByText('第 3 页 - 文本层')).toBeTruthy();
    expect(screen.queryByText(/Page 3/)).toBeNull();
  });

  it('shows a recoverable capability-check failure while leaving native scans available',async()=>{
    capability.probe.mockRejectedValue(new Error('backend transport unavailable'));
    render(<FormulaExtractorPanel />);
    await screen.findByText(/Could not check local formula OCR/);
    expect(screen.getByRole('button',{name:/ocr selection/i}).getAttribute('disabled')).not.toBeNull();
    expect(screen.getByRole('button',{name:/^scan$/i}).getAttribute('disabled')).toBeNull();
  });
});
