import { invokeTauriCommand, isTauriHost } from '@/lib/storage-adapter';

export interface ManagedFormulaOcrStatus {
  status: 'ready' | 'missing' | 'unsupported' | 'installing' | 'cancelled' | 'error';
  phase: string;
  downloadedBytes: number;
  totalBytes: number;
  requestId?: string | null;
  errorCode?: string | null;
}
export async function getManagedFormulaOcrStatus(): Promise<ManagedFormulaOcrStatus> {
  if (!isTauriHost()) return { status: 'unsupported', phase: '', downloadedBytes: 0, totalBytes: 0 };
  return invokeTauriCommand<ManagedFormulaOcrStatus>('formula_ocr_runtime_status', {}, { timeoutMs: 10000 });
}
export async function installManagedFormulaOcr(requestId?: string): Promise<void> {
  if (!isTauriHost()) throw new Error('OCR_DESKTOP_ONLY');
  await invokeTauriCommand('formula_ocr_runtime_install', requestId === undefined ? {} : { requestId }, { timeoutMs: 1800000 });
}
export async function cancelManagedFormulaOcr(requestId: string): Promise<boolean> {
  return await invokeTauriCommand<boolean>('formula_ocr_runtime_cancel', { requestId }, { timeoutMs: 5000 });
}
export async function recognizeManagedFormula(imageDataUrl: string, signal?: AbortSignal): Promise<{ latex: string; backend: 'pix2text-mfr'; command: string; endedWithEos?:boolean; truncated?:boolean; tokenCount?:number }> {
  signal?.throwIfAborted();
  if (!isTauriHost()) throw new Error('OCR_DESKTOP_ONLY');
  const requestId = crypto.randomUUID();
  const operation = invokeTauriCommand<{ latex: string; endedWithEos?:boolean; truncated?:boolean; tokenCount?:number }>('formula_ocr_runtime_recognize', { requestId, imageDataUrl }, { timeoutMs: 120000 });
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => { void cancelManagedFormulaOcr(requestId).catch(() => {}); reject(new DOMException('OCR cancelled', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
  try {
    const result = await Promise.race([operation, aborted]);
    signal?.throwIfAborted();
    if (!result || typeof result.latex !== 'string' || !result.latex.trim()) throw new Error('OCR_EMPTY');
    return { latex: result.latex.trim(), backend: 'pix2text-mfr', command: 'managed',
      ...(typeof result.endedWithEos==='boolean'?{endedWithEos:result.endedWithEos}:{}),
      ...(typeof result.truncated==='boolean'?{truncated:result.truncated}:{}),
      ...(typeof result.tokenCount==='number'&&Number.isSafeInteger(result.tokenCount)&&result.tokenCount>0&&result.tokenCount<=1024?{tokenCount:result.tokenCount}:{}),
    };
  } finally { signal?.removeEventListener('abort', onAbort); }
}
