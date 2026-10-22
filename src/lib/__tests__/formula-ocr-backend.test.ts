import {beforeEach,describe,expect,it,vi} from 'vitest';
const backend=vi.hoisted(()=>({desktop:false,invoke:vi.fn()}));
vi.mock('@/lib/storage-adapter',()=>({isTauriHost:()=>backend.desktop,invokeTauriCommand:backend.invoke}));
import {probeFormulaOcrBackend,recognizeFormulaImageWithPix2tex} from '@/lib/formula-ocr';
import {setLocale} from '@/lib/i18n';
describe('formula OCR capability boundary',()=>{
  beforeEach(()=>{setLocale('en-US');localStorage.setItem('lattice-plugin-kv:formula-extractor:setting:ocrCommand',JSON.stringify('pix2tex'));backend.desktop=false;backend.invoke.mockReset();});
  it('reports desktop-only without invoking or downloading a backend',async()=>{
    expect((await probeFormulaOcrBackend()).status).toBe('desktop-only');expect(backend.invoke).not.toHaveBeenCalled();
  });
  it('probes existence without running version/model loading and rejects a missing command',async()=>{
    backend.desktop=true;backend.invoke.mockResolvedValue({available:false,error:'missing'});
    await expect(recognizeFormulaImageWithPix2tex({imageDataUrl:'data:image/png;base64,AA=='})).rejects.toThrow('Local formula OCR was not found');
    expect(backend.invoke).toHaveBeenCalledWith('probe_command_availability',{command:'pix2tex',includeVersion:false},{timeoutMs:5000});
    expect(backend.invoke).toHaveBeenCalledTimes(1);
  });
  it('releases cancelled frontend work and ignores a late native completion',async()=>{
    backend.desktop=true;backend.invoke.mockResolvedValueOnce({available:true}).mockImplementationOnce(()=>new Promise(()=>{}));
    const controller=new AbortController();const promise=recognizeFormulaImageWithPix2tex({imageDataUrl:'data:image/png;base64,AA==',signal:controller.signal});
    await vi.waitFor(()=>expect(backend.invoke).toHaveBeenCalledTimes(2));controller.abort();
    await expect(promise).rejects.toThrow('OCR cancelled');
  });
  it('cancels immediately while the executable probe is pending without invoking OCR',async()=>{
    backend.desktop=true;
    backend.invoke.mockImplementation(()=>new Promise(()=>{}));
    const controller=new AbortController();
    const pending=recognizeFormulaImageWithPix2tex({imageDataUrl:'data:image/png;base64,AA==',signal:controller.signal});
    controller.abort();
    await expect(pending).rejects.toMatchObject({name:'AbortError'});
    expect(backend.invoke).toHaveBeenCalledTimes(1);
  },3000);
  it('rejects an empty native result instead of publishing a successful formula',async()=>{
    backend.desktop=true;
    backend.invoke.mockResolvedValueOnce({available:true}).mockResolvedValueOnce({latex:'   ',command:'pix2tex',backend:'pix2tex'});
    await expect(recognizeFormulaImageWithPix2tex({imageDataUrl:'data:image/png;base64,AA=='})).rejects.toThrow(/returned no formula/);
  });
  it('does not turn non-finite backend confidence into a trusted score',async()=>{
    backend.desktop=true;
    backend.invoke.mockResolvedValueOnce({available:true}).mockResolvedValueOnce({latex:' x^2 ',command:'pix2tex',backend:'pix2tex',confidence:NaN});
    const result=await recognizeFormulaImageWithPix2tex({imageDataUrl:'data:image/png;base64,AA=='});
    expect(result.latex).toBe('x^2');
    expect(result.confidence).toBeUndefined();
  });
  it('uses Chinese capability errors without exposing a native path failure',async()=>{
    setLocale('zh-CN');backend.desktop=true;
    backend.invoke.mockResolvedValueOnce({available:false,error:'C:/private/backend.exe is missing'});
    await expect(recognizeFormulaImageWithPix2tex({imageDataUrl:'data:image/png;base64,AA=='})).rejects.toThrow('未找到本地公式 OCR 后端');
  });
  it('uses the saved formula backend in PDF annotation calls without an explicit command',async()=>{
    backend.desktop=true;
    localStorage.setItem('lattice-plugin-kv:formula-extractor:setting:ocrCommand',JSON.stringify('C:/OCR/pix2tex.exe'));
    backend.invoke.mockResolvedValueOnce({available:true}).mockResolvedValueOnce({latex:'x=1',command:'C:/OCR/pix2tex.exe',backend:'pix2tex'});
    await recognizeFormulaImageWithPix2tex({imageDataUrl:'data:image/png;base64,AA=='});
    expect(backend.invoke).toHaveBeenNthCalledWith(1,'probe_command_availability',{command:'C:/OCR/pix2tex.exe',includeVersion:false},{timeoutMs:5000});
    expect(backend.invoke).toHaveBeenNthCalledWith(2,'formula_ocr_pix2tex',expect.objectContaining({request:expect.objectContaining({command:'C:/OCR/pix2tex.exe'})}),expect.anything());
  });
});
