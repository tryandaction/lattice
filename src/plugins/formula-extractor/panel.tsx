"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Copy, FileDown, ScanLine, RefreshCcw } from "lucide-react";
import { renderLatexSafe } from "@/lib/formula-converter";
import { getPluginSetting, runPluginCommand, subscribePluginSetting } from "@/lib/plugins/runtime";
import { probeFormulaOcrBackend, type FormulaOcrAvailability } from "@/lib/formula-ocr";
import { FORMULA_EXTRACTOR_PLUGIN_ID } from "@/lib/plugins/defaults";
import { cn } from "@/lib/utils";
import { useI18n } from '@/hooks/use-i18n';
import type { ExtractedFormula, FormulaExtractionResult, FormulaExtractionScope, HiddenFormulaCandidate } from "./types";
import { ManagedOcrSetup } from './managed-ocr-setup';

export interface FormulaExtractorPanelProps {
  result?: FormulaExtractionResult | null;
  busy?: boolean;
  error?: string | null;
  progress?: number;
  canCancel?: boolean;
  canRetry?: boolean;
  scope?: FormulaExtractionScope;
  stale?: boolean;
}

function sourceLabel(result: FormulaExtractionResult | null | undefined, zh: boolean): string {
  if (!result) return zh ? "公式提取" : "Formula Extractor";
  return result.sourceFile || result.viewerType.toUpperCase();
}

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function getFormulaMeta(formula: ExtractedFormula, zh: boolean): string {
  const kinds: Record<ExtractedFormula['kind'], string> = zh
    ? {explicit:'源公式', 'text-layer':'文本层', geometry:'PDF 结构', omml:'Word 公式', mathml:'MathML', ocr:'图像 OCR'}
    : {explicit:'source math', 'text-layer':'text-layer', geometry:'geometry', omml:'omml', mathml:'mathml', ocr:'ocr'};
  const parts = [
    formula.page ? (zh ? `第 ${formula.page} 页` : `Page ${formula.page}`) : null,
    kinds[formula.kind],
  ].filter(Boolean);
  return parts.join(" - ");
}

async function runFormulaCommand(
  commandId: string,
  payload: unknown,
  onError: (message: string) => void,
) {
  try {
    await runPluginCommand(commandId, payload);
    onError("");
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error));
  }
}

function FormulaPreview({ formula, rendered }: { formula: ExtractedFormula; rendered:ReturnType<typeof renderLatexSafe> }) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-md border bg-background px-3 py-3",
        formula.displayMode ? "text-center" : "text-left",
        rendered.success ? "border-border" : "border-amber-300/70 bg-amber-50/70 dark:bg-amber-950/20",
      )}
      data-testid="formula-rendered-preview"
    >
      <div
        className="formula-extractor-katex min-w-0 text-sm text-foreground"
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    </div>
  );
}

function FormulaRow({ formula, latex, revision, disabled, onLatexChange, onCommandError }: { formula: ExtractedFormula; latex: string; revision?:string; disabled:boolean; onLatexChange: (value: string) => void; onCommandError: (message: string) => void }) {
  const editable = { ...formula, latex };
  const {locale,t}=useI18n();const zh=locale!=='en-US';
  const rendered=renderLatexSafe(latex,formula.displayMode);
  const syntaxValid=rendered.success;
  const sourceImage=formula.sourceImage?.dataUrl.startsWith('data:image/png;base64,')?formula.sourceImage:undefined;
  const truncatedUncorrected=formula.recognitionTruncated&&latex.trim()===(formula.initialLatex??formula.originalLatex??formula.latex).trim();
  const copyDisabled=disabled||(formula.kind==='ocr'&&(!syntaxValid||truncatedUncorrected));
  const payload={formulaId:formula.id,sourceRevision:revision};
  return (
    <article className="group rounded-md border border-border bg-background shadow-sm transition-colors hover:border-primary/40">
      <button
        type="button"
        aria-label={[getFormulaMeta(formula,zh),formula.context].filter(Boolean).join(' · ')}
        disabled={disabled}
        onClick={() => void runFormulaCommand("formula-extractor.reveal-formula", payload, onCommandError)}
        className="block w-full p-3 text-left"
      >
        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{getFormulaMeta(formula,zh)}</span>
          <span className="shrink-0">{formula.needsReview?(zh?'待校正':'Needs review'):formatConfidence(formula.confidence)}</span>
        </div>
        <FormulaPreview formula={editable} rendered={rendered} />
        {formula.kind==='ocr'&&!syntaxValid&&<p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t('formula.review.invalidSyntax')}</p>}
        {truncatedUncorrected&&<p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t('formula.review.truncated')}</p>}
        {formula.context ? (
          <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">{formula.context}</div>
        ) : null}
      </button>
      <div className="mx-3 mb-2 min-w-0">
        <textarea aria-label={zh ? `公式 LaTeX：${formula.id}` : `LaTeX for ${formula.id}`} disabled={disabled} value={latex} onChange={(event) => onLatexChange(event.target.value)} className="block min-h-16 w-full max-w-full rounded border border-border bg-background p-2 font-mono text-xs" />
      </div>
      {sourceImage&&<figure className="mx-3 mb-2 overflow-x-auto rounded border border-border bg-white p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={sourceImage.dataUrl} alt={t('formula.review.originalImage')} width={sourceImage.width} height={sourceImage.height} className="h-auto max-w-full object-contain"/>
      </figure>}
      {formula.originalLatex!==undefined&&<details className="mx-3 mb-2 text-xs text-muted-foreground"><summary>{t('formula.review.originalPrediction')}</summary><pre className="whitespace-pre-wrap break-words">{formula.originalLatex}</pre></details>}
      {formula.rawText&&<details className="mx-3 mb-2 text-xs text-muted-foreground"><summary>{zh?'来源原文':'Original source'}</summary><pre className="whitespace-pre-wrap">{formula.rawText}</pre></details>}
      <div className="grid grid-cols-2 gap-1 border-t border-border px-3 py-2">
        <button
          type="button"
          disabled={copyDisabled}
          onClick={() => void runFormulaCommand("formula-extractor.copy-formula-latex", { ...payload, latex }, onCommandError)}
          className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Copy className="h-3.5 w-3.5" />
          {zh?'复制 LaTeX':'Copy LaTeX'}
        </button>
        <button
          type="button"
          disabled={copyDisabled}
          onClick={() => void runFormulaCommand("formula-extractor.copy-formula-markdown", { ...payload, latex }, onCommandError)}
          className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Copy className="h-3.5 w-3.5" />
          {zh?'复制 Markdown':'Copy Markdown'}
        </button>
      </div>
    </article>
  );
}

function hiddenCandidateLabel(candidate: HiddenFormulaCandidate, zh: boolean): string {
  return [
    candidate.page ? (zh ? `第 ${candidate.page} 页` : `Page ${candidate.page}`) : null,
    candidate.reason,
    typeof candidate.score === "number" ? formatConfidence(candidate.score) : null,
  ].filter(Boolean).join(" - ");
}

export function FormulaExtractorPanel(props:FormulaExtractorPanelProps) {
  return <FormulaPanelContent key={props.result?.sourceRevision??props.result?.scannedAt??'empty'} {...props} />;
}

const subscribeOcrCommand = (listener: () => void) => subscribePluginSetting(FORMULA_EXTRACTOR_PLUGIN_ID, 'ocrCommand', listener);
const getOcrCommand = () => String(getPluginSetting(FORMULA_EXTRACTOR_PLUGIN_ID, 'ocrCommand') ?? 'managed');

function FormulaPanelContent({ result, busy = false, error = null, progress=0,canCancel=false,canRetry=false,scope='document',stale=false }: FormulaExtractorPanelProps) {
  const formulas = result?.formulas ?? [];
  const hiddenCandidates = result?.hiddenCandidates ?? [];
  const [commandError, setCommandError] = useState("");
  const [correctedLatex, setCorrectedLatex] = useState<Record<string, string>>({});
  const {locale,t}=useI18n();const zh=locale!=='en-US';
  const ocrCommand = useSyncExternalStore(subscribeOcrCommand, getOcrCommand, () => 'managed');
  const [ocrAvailability,setOcrAvailability] = useState<FormulaOcrAvailability | null>(null);
  const [ocrRevision, setOcrRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void probeFormulaOcrBackend(ocrCommand).then(value => {
      if (active) setOcrAvailability(value);
    }).catch(() => {
      if (active) setOcrAvailability({command:ocrCommand,status:'error'});
    });
    return () => { active = false; };
  },[ocrCommand, ocrRevision]);
  const ocrStatus = ocrAvailability?.command === ocrCommand ? ocrAvailability.status : null;
  const ocrMessage = t(ocrStatus === 'ready' ? 'formula.ocr.ready' : ocrStatus === 'missing' ? 'formula.ocr.missing' : ocrStatus === 'desktop-only' ? 'formula.ocr.desktopOnly' : ocrStatus === 'error' ? 'formula.ocr.error' : 'formula.ocr.checking');
  const [scanScope,setScanScope]=useState<FormulaExtractionScope>(scope);
  const exportPayload={edits:correctedLatex,sourceRevision:result?.sourceRevision};

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{sourceLabel(result,zh)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {result ? `${formulas.length} ${zh?'条公式':'formulas'}` : (zh?'尚未扫描':'No scan yet')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void runFormulaCommand(`formula-extractor.extract.${scanScope}`, undefined, setCommandError)}
            disabled={busy}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
            {zh?'识别公式':'Scan'}
          </button>
        </div>

        <select aria-label={zh?'扫描范围':'Scan scope'} value={scanScope} disabled={busy} onChange={event=>setScanScope(event.target.value as FormulaExtractionScope)} className="w-full rounded border border-border bg-background p-1 text-xs"><option value="document">{zh?'全文':'Whole document'}</option><option value="current-page">{zh?'PDF 当前页':'Current PDF page'}</option><option value="selection">{zh?'当前选区':'Current selection'}</option></select>
        {busy && <progress aria-label={zh?'识别进度':'Scan progress'} value={progress} max={100} className="w-full accent-primary" />}
        {canCancel && <button type="button" className="w-full rounded border border-destructive/40 px-2 py-1 text-xs text-destructive" onClick={() => void runFormulaCommand("formula-extractor.cancel", undefined, setCommandError)}>{zh?'取消识别':'Cancel'}</button>}
        {!busy && canRetry && <button type="button" className="w-full rounded border border-border px-2 py-1 text-xs" onClick={() => void runFormulaCommand("formula-extractor.retry", undefined, setCommandError)}>{zh?'重试':'Retry'}</button>}

        <button
          type="button"
          onClick={() => void runFormulaCommand("formula-extractor.ocr.selection", undefined, setCommandError)}
          disabled={busy || ocrStatus !== 'ready'}
          aria-describedby="formula-ocr-capability"
          className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 text-xs text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
        >
          <ScanLine className={cn("h-3.5 w-3.5", busy && "animate-pulse")} />
          {zh?'OCR 所选图片公式':'OCR selection'}
        </button>

        <p id="formula-ocr-capability" role="status" className="text-xs text-muted-foreground">{ocrMessage}</p>
        {ocrStatus !== 'ready' && <ManagedOcrSetup onReady={() => setOcrRevision(value => value + 1)} />}

        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => void runFormulaCommand("formula-extractor.export-markdown", exportPayload, setCommandError)}
            disabled={busy || stale || formulas.length === 0}
            className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <FileDown className="h-3.5 w-3.5" />
            .md
          </button>
          <button
            type="button"
            onClick={() => void runFormulaCommand("formula-extractor.export-latex", exportPayload, setCommandError)}
            disabled={busy || stale || formulas.length === 0}
            className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <FileDown className="h-3.5 w-3.5" />
            .tex
          </button>
        </div>
      </div>

      {busy ? (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {zh?'正在识别当前文档…':'Scanning the active document...'}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {commandError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {commandError}
        </div>
      ) : null}

      {!busy && formulas.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
          {result ? (zh?'未发现公式。可选择公式区域后重试。':'No reliable formulas found. Try selecting a formula region and scan the selection.') : (zh?'点击识别公式，扫描当前文档。':'Click Scan to extract formulas from the active document.')}
        </div>
      ) : null}

      <div className="space-y-2">
        {formulas.map((formula) => (
          <FormulaRow key={formula.id} formula={formula} disabled={busy||stale} revision={result?.sourceRevision} latex={correctedLatex[formula.id] ?? formula.latex} onLatexChange={(value) => {
            setCorrectedLatex((current) => ({ ...current, [formula.id]: value }));
            if(value.trim())void runFormulaCommand('formula-extractor.update-formula',{formulaId:formula.id,latex:value,sourceRevision:result?.sourceRevision},setCommandError);
          }} onCommandError={setCommandError} />
        ))}
      </div>

      {hiddenCandidates.length > 0 ? (
        <details className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none font-medium text-foreground">
            {zh?'诊断 / 排除候选':'Diagnostics / Hidden candidates'} ({hiddenCandidates.length})
          </summary>
          <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
            {hiddenCandidates.slice(0, 60).map((candidate, index) => (
              <div key={`${candidate.page ?? "x"}-${candidate.reason}-${index}`} className="rounded-md border border-border bg-background p-2">
                <div className="mb-1 font-medium text-muted-foreground">{hiddenCandidateLabel(candidate,zh)}</div>
                <div className="line-clamp-3 break-words">{candidate.rawText}</div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
