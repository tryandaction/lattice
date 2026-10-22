import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn(), desktop: true }));
vi.mock('@/lib/storage-adapter', () => ({ invokeTauriCommand: native.invoke, isTauriHost: () => native.desktop }));
import { cancelManagedFormulaOcr, getManagedFormulaOcrStatus, installManagedFormulaOcr, recognizeManagedFormula } from '@/lib/formula-ocr-managed';
import { getConfiguredFormulaOcrCommand } from '@/lib/formula-ocr';

describe('managed local formula runtime', () => {
  beforeEach(() => { native.invoke.mockReset(); native.desktop = true; });
  it('defaults unconfigured PDF annotation OCR to the managed engine', () => {
    localStorage.removeItem('lattice-plugin-kv:formula-extractor:setting:ocrCommand');
    expect(getConfiguredFormulaOcrCommand()).toBe('managed');
  });
  it('does not offer a local download in a web browser', async () => {
    native.desktop = false;
    expect((await getManagedFormulaOcrStatus()).status).toBe('unsupported');
    await expect(installManagedFormulaOcr()).rejects.toThrow();
    expect(native.invoke).not.toHaveBeenCalled();
  });
  it('keeps failed installations failed instead of turning them ready', async () => {
    native.invoke.mockRejectedValue(new Error('OCR_DOWNLOAD_HASH'));
    await expect(installManagedFormulaOcr()).rejects.toThrow('OCR_DOWNLOAD_HASH');
  });
  it('binds installation and cancellation to the same caller-owned task ID', async () => {
    native.invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce(false);
    await installManagedFormulaOcr('synthetic-install-id');
    expect(native.invoke).toHaveBeenNthCalledWith(1, 'formula_ocr_runtime_install', { requestId: 'synthetic-install-id' }, { timeoutMs: 1800000 });
    await expect(cancelManagedFormulaOcr('synthetic-install-id')).resolves.toBe(false);
    expect(native.invoke).toHaveBeenNthCalledWith(2, 'formula_ocr_runtime_cancel', { requestId: 'synthetic-install-id' }, { timeoutMs: 5000 });
  });
  it('preserves compatibility for an installation without a caller-owned ID', async () => {
    native.invoke.mockResolvedValueOnce(undefined);
    await installManagedFormulaOcr();
    expect(native.invoke).toHaveBeenCalledWith('formula_ocr_runtime_install', {}, { timeoutMs: 1800000 });
  });
  it('cancels the native job and does not return its late result', async () => {
    native.invoke.mockImplementation((name: string) => name === 'formula_ocr_runtime_cancel' ? Promise.resolve(true) : new Promise(() => {}));
    const control = new AbortController();
    const pending = recognizeManagedFormula('data:image/png;base64,AA==', control.signal);
    control.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith('formula_ocr_runtime_cancel', expect.objectContaining({ requestId: expect.any(String) }), expect.anything()));
  });
  it('rejects empty native results and preserves literal corrected math', async () => {
    native.invoke.mockResolvedValueOnce({ latex: '   ' });
    await expect(recognizeManagedFormula('data:image/png;base64,AA==')).rejects.toThrow();
    native.invoke.mockResolvedValueOnce({ latex: String.raw` \frac{x}{2} ` });
    expect((await recognizeManagedFormula('data:image/png;base64,AA==')).latex).toBe(String.raw`\frac{x}{2}`);
  });
  it('preserves decoder completion metadata and identifies the managed model',async()=>{
    native.invoke.mockResolvedValueOnce({latex:'x+y',engine:'pix2text-mfr-1.5',endedWithEos:false,truncated:true,tokenCount:1024});
    await expect(recognizeManagedFormula('data:image/png;base64,AA==')).resolves.toMatchObject({latex:'x+y',backend:'pix2text-mfr',truncated:true,endedWithEos:false,tokenCount:1024});
  });
});
