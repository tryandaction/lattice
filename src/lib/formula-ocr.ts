import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";
import { t } from "@/lib/i18n";
import { getManagedFormulaOcrStatus, recognizeManagedFormula } from '@/lib/formula-ocr-managed';
import { normalizeOcrLatex } from '@/lib/ocr-latex-normalization';

export interface FormulaOcrResult {
  latex: string;
  backend: "pix2tex" | "rapid-latex-ocr" | "pix2text-mfr";
  command: string;
  confidence?: number;
  endedWithEos?: boolean;
  truncated?: boolean;
  tokenCount?: number;
  rawLatex?: string;
}
function normalizeResult(result:FormulaOcrResult):FormulaOcrResult {
  const latex=normalizeOcrLatex(result.latex);
  return latex===result.latex?result:{...result,latex,rawLatex:result.latex};
}

export interface FormulaOcrAvailability { status:'ready'|'missing'|'desktop-only'|'error'; command:string; message?:string; resolvedPath?:string }
export function getConfiguredFormulaOcrCommand(): string {
  try {
    const raw = localStorage.getItem('lattice-plugin-kv:formula-extractor:setting:ocrCommand');
    if (raw !== null) {
      let saved: unknown;
      try { saved = JSON.parse(raw); } catch { saved = raw; }
      if (typeof saved === 'string' && saved.trim()) return saved.trim();
    }
  } catch { /* Restricted browser storage cannot disable native extraction. */ }
  return 'managed';
}
export async function probeFormulaOcrBackend(command=getConfiguredFormulaOcrCommand()):Promise<FormulaOcrAvailability> {
  if(!isTauriHost())return {status:'desktop-only',command};
  try {
    if (command === 'managed') {
      const status = await getManagedFormulaOcrStatus();
      return {status: status.status === 'ready' ? 'ready' : status.status === 'error' ? 'error' : 'missing', command};
    }
    const result=await invokeTauriCommand<{available:boolean;resolved_path?:string;error?:string}>('probe_command_availability',{command,includeVersion:false},{timeoutMs:5000});
    return {status:result.available?'ready':'missing',command,resolvedPath:result.resolved_path,message:result.error};
  } catch(error){return {status:'error',command,message:error instanceof Error?error.message:String(error)};}
}

async function abortableOcr<T>(operation:Promise<T>,signal?:AbortSignal):Promise<T> {
  if(!signal)return operation;
  signal.throwIfAborted();
  let abort:()=>void=()=>{};
  try {return await Promise.race([operation,new Promise<T>((_,reject)=>{abort=()=>reject(new DOMException('OCR cancelled','AbortError'));signal.addEventListener('abort',abort,{once:true});})]);}
  finally {signal.removeEventListener('abort',abort);}
}

export async function recognizeFormulaImageWithPix2tex(input: {
  imageDataUrl: string;
  command?: string;
  signal?: AbortSignal;
}): Promise<FormulaOcrResult> {
  input.signal?.throwIfAborted();
  if (!isTauriHost()) {
    throw new Error(t('formula.ocr.desktopOnly'));
  }
  const command = input.command?.trim() || getConfiguredFormulaOcrCommand();
  if (command === 'managed') return normalizeResult(await recognizeManagedFormula(input.imageDataUrl, input.signal));
  const availability=await abortableOcr(probeFormulaOcrBackend(command),input.signal);
  input.signal?.throwIfAborted();
  if(availability.status!=='ready')throw new Error(t(availability.status==='error'?'formula.ocr.error':'formula.ocr.missing'));
  const result = await abortableOcr(invokeTauriCommand<{
    latex: string;
    backend: string;
    command: string;
  }>(
    "formula_ocr_pix2tex",
    {
      request: {
        imageDataUrl: input.imageDataUrl,
        command,
      },
    },
    { timeoutMs: 60000 },
  ),input.signal);
  input.signal?.throwIfAborted();
  if (typeof result.latex !== 'string' || !result.latex.trim()) throw new Error(t('formula.ocr.emptyResult'));
  const confidence = (result as unknown as { confidence?: unknown }).confidence;
  return normalizeResult({
    latex: result.latex.trim(),
    backend: "pix2tex",
    command: result.command,
    confidence: typeof confidence === "number" && Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : undefined,
  });
}
