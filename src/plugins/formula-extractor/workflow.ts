import mammoth from 'mammoth';
import type { PluginActiveDocumentInfo, PluginContext } from '@/lib/plugins/types';
import { t } from '@/lib/i18n';
import { renderStrictFormula } from '@/lib/strict-formula-renderer';
import { recognizeFormulaImageWithPix2tex } from '@/lib/formula-ocr';
import { extractFormulasFromSource } from './extractors';
import { exportFormulaAsLatex, exportFormulaAsMarkdown, exportFormulaResultsAsLatex, exportFormulaResultsAsMarkdown } from './export';
import type { ExtractedFormula, FormulaExtractionResult, FormulaExtractionScope } from './types';

export const FORMULA_PANEL_ID = 'formula-extractor.results';
type Request = { scope: FormulaExtractionScope; ocr?: boolean };
type FormulaPayload = { formulaId?: string; latex?: string; edits?: Record<string,string>; sourceRevision?: string };
export const formulaDocumentKey = (info: PluginActiveDocumentInfo) => JSON.stringify([info.filePath,info.fileName,info.viewerType,info.tabId,info.revision]);

/** An activation owns its task/result; cancelled or unloaded tasks cannot publish. */
export function createFormulaWorkflow(ctx: PluginContext) {
  let disposed = false;
  let latest: FormulaExtractionResult | null = null;
  let task: { controller: AbortController; promise: Promise<void> } | null = null;
  let lastRequest: Request = {scope:'document'};
  let sequence = 0;
  const sessionId=crypto.randomUUID();
  const update = (props: Record<string, unknown>) => {
    if (!disposed) ctx.panels.update(FORMULA_PANEL_ID, {kind:'formula-extractor.results',result:latest,...props});
  };
  const cancel = () => {
    task?.controller.abort(); task = null;
    update({busy:false,error:t('formula.workflow.cancelled'),canCancel:false,canRetry:true});
  };
  async function boundResult(payload: FormulaPayload = {}) {
    if (!latest) throw new Error(t('formula.workflow.scanFirst'));
    const key = formulaDocumentKey(await ctx.document.getActive());
    if (key !== latest.documentKey || payload.sourceRevision && payload.sourceRevision !== latest.sourceRevision) {
      throw new Error(t('formula.workflow.sourceChanged'));
    }
    return latest;
  }
  function applyEdit(formula: ExtractedFormula, latex: string | undefined) {
    if (latex === undefined) return formula;
    if (!latex.trim()) throw new Error(t('formula.workflow.latexEmpty'));
    return {...formula,latex:latex.trim()};
  }
  async function edit(payload: FormulaPayload) {
    const result = await boundResult(payload);
    if (!result.formulas.some(f=>f.id===payload.formulaId)) throw new Error(t('formula.workflow.formulaMissing'));
    latest = {...result,formulas:result.formulas.map(f=>f.id===payload.formulaId?applyEdit(f,payload.latex):f)};
    update({error:null});
  }
  async function copy(payload: FormulaPayload, format: 'latex'|'markdown') {
    const result = await boundResult(payload);
    const original = result.formulas.find(f=>f.id===payload.formulaId);
    if (!original) throw new Error(t('formula.workflow.formulaMissing'));
    const formula = applyEdit(original,payload.latex);
    ensureOcrSyntax(formula);
    await ctx.clipboard.writeText(format === 'latex' ? exportFormulaAsLatex(formula) : exportFormulaAsMarkdown(formula));
  }
  async function reveal(payload: FormulaPayload) {
    const result = await boundResult(payload);
    const formula = result.formulas.find(f=>f.id===payload.formulaId);
    if (!formula?.target || !await ctx.document.reveal(formula.target)) throw new Error(t('formula.workflow.sourceUnavailable'));
  }
  async function exportResults(format:'latex'|'markdown',payload:FormulaPayload={}) {
    const result = await boundResult(payload);
    const formulas = result.formulas.map(f=>applyEdit(f,payload.edits?.[f.id]));
    formulas.forEach(ensureOcrSyntax);
    const content = format==='latex'?exportFormulaResultsAsLatex(formulas):exportFormulaResultsAsMarkdown(formulas);
    if (!content.trim()) throw new Error(t('formula.workflow.noFormulas'));
    const ok = await ctx.exportFile({suggestedName:format==='latex'?'formulas.tex':'formulas.md',content,mimeType:'text/plain;charset=utf-8'});
    if (!ok) throw new Error(t('formula.workflow.exportCancelled'));
  }
  function ensureOcrSyntax(formula:ExtractedFormula) {
    const initial=(formula.initialLatex??formula.originalLatex??formula.latex).trim();
    if(formula.kind==='ocr'&&(!renderStrictFormula(formula.latex,formula.displayMode)||formula.recognitionTruncated&&formula.latex.trim()===initial))throw new Error(t('formula.review.invalidSyntax'));
  }
  function start(request:Request):Promise<void> {
    if (disposed) return Promise.resolve();
    if (task) return task.promise;
    lastRequest=request;
    const controller = new AbortController();
    const current = {controller,promise:Promise.resolve()};
    task=current;
    const valid=()=>!disposed && task===current && !controller.signal.aborted;
    current.promise = (async()=>{
      update({busy:true,error:null,scope:request.scope,progress:0,canCancel:true,canRetry:false});
      try {
        // Capture source/selection before an overlay or result panel takes focus.
        const active=await ctx.document.getActive();
        const key=formulaDocumentKey(active);
        if(!active.filePath && !active.fileName) throw new Error(t('formula.workflow.openDocument'));
        if(request.scope==='current-page' && active.viewerType!=='pdf') throw new Error(t('formula.workflow.pdfRequired'));
        const selectionText=request.scope==='selection'?await ctx.document.getSelectionText():'';
        const image=request.scope==='selection' && active.viewerType==='pdf'?await ctx.document.getPdfSelectionImage({signal:controller.signal,expectedDocument:active}):null;
        if(request.scope==='selection' && !selectionText.trim() && !image) throw new Error(t('formula.workflow.selectFormula'));
        await ctx.ui.openPanel(FORMULA_PANEL_ID);
        if (!valid()) return;
        let result:FormulaExtractionResult;
        if(request.ocr){
          if(active.viewerType!=='pdf' || !image) throw new Error(t('formula.workflow.selectPdfFormula'));
          const ocr=await recognizeFormulaImageWithPix2tex({imageDataUrl:image.dataUrl,command:String(ctx.settings.get('ocrCommand')??'managed'),signal:controller.signal});
          const formula:ExtractedFormula={id:`ocr-${sequence}`,source:'pdf',kind:'ocr',page:image.pageNumber,bbox:image.bbox,
            target:{viewerType:'pdf',page:image.pageNumber,bbox:image.bbox},latex:ocr.latex,rawText:selectionText,originalLatex:ocr.rawLatex??ocr.latex,initialLatex:ocr.latex,
            sourceImage:{dataUrl:image.dataUrl,width:image.width,height:image.height,...(image.imageBbox?{imageBbox:image.imageBbox}:{})},recognitionTruncated:ocr.truncated===true,displayMode:true,needsReview:true,
            confidence:typeof ocr.confidence==='number'?Math.max(0,Math.min(1,ocr.confidence)):0,context:t('formula.workflow.ocrContext')};
          result={sourceFile:active.filePath,viewerType:'pdf',scope:'selection',formulas:[formula],scannedAt:Date.now(),warnings:['ocr-selection-review']};
        } else {
          const content=active.viewerType==='pdf'?{info:active}:await ctx.document.readCurrent();
          let text=content.text??'';
          if(active.viewerType==='docx' && content.arrayBuffer) text=(await mammoth.extractRawText({arrayBuffer:content.arrayBuffer})).value;
          if(!valid()) return;
          const pages=active.viewerType==='pdf'?await ctx.document.getPdfTextPages({scope:request.scope==='document'?'all':request.scope,
            selection:image?{pageNumber:image.pageNumber,bbox:image.bbox}:undefined,signal:controller.signal,
            onProgress:p=>{if(valid())update({progress:Math.round(p.completed/p.total*90)});},
          }):undefined;
          result=await extractFormulasFromSource({viewerType:active.viewerType,filePath:active.filePath,fileName:active.fileName,text,
            arrayBuffer:request.scope==='selection'?undefined:content.arrayBuffer,selectionText,pdfPages:pages,scope:request.scope});
        }
        if(!valid()) return;
        if(formulaDocumentKey(await ctx.document.getActive())!==key) throw new Error(t('formula.workflow.activeDocumentChanged'));
        result={...result,documentKey:key,sourceRevision:`${sessionId}:${++sequence}:${key}`};
        latest=result;
        update({busy:false,error:null,stale:false,scope:request.scope,progress:100,canCancel:false,canRetry:true});
      } catch(error){
        if(valid())update({busy:false,error:error instanceof Error?error.message:String(error),canCancel:false,canRetry:true});
      } finally {if(task===current)task=null;}
    })();
    return current.promise;
  }
  const unsubscribers=[ctx.events.onActiveFileChange(()=>{cancel();update({stale:true});}),ctx.events.onFileSave(()=>{cancel();update({stale:true});})];
  return {start,cancel,edit,copy,reveal,exportResults,retry:()=>start(lastRequest),dispose:()=>{
    disposed=true;task?.controller.abort();task=null;latest=null;unsubscribers.forEach(unsubscribe=>unsubscribe());
  }};
}
