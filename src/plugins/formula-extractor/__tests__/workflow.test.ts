import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { formulaExtractorPlugin } from '../index';
import type { PluginCommand, PluginContext } from '@/lib/plugins/types';
import { setLocale } from '@/lib/i18n';
const ocr=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/formula-ocr',()=>({recognizeFormulaImageWithPix2tex:ocr}));

describe('formula workflow commands', () => {
  let commands: Map<string, PluginCommand>;
  let updates: Record<string, unknown>[];
  let active: {filePath:string;fileName:string;viewerType:'md';revision:string};
  let ctx: PluginContext;
  beforeEach(async () => {
    setLocale('zh-CN');
    ocr.mockReset().mockResolvedValue({latex:String.raw`\sqrt{x^2+y^2}`,backend:'rapid-latex-ocr',command:'managed'});
    commands = new Map(); updates = [];
    active = {filePath:'note.md',fileName:'note.md',viewerType:'md',revision:'1'};
    ctx = { commands:{register:(command:PluginCommand)=>commands.set(command.id,command)},
      panels:{register:vi.fn(),update:(_id:string,props:Record<string,unknown>)=>updates.push(props)},
      ui:{openPanel:vi.fn(async()=>{})}, document:{getActive:vi.fn(async()=>active),getSelectionText:vi.fn(async()=>'$$y=2$$'),readCurrent:vi.fn(async()=>({info:active,text:'$$x=1$$'})),getPdfTextPages:vi.fn(),getPdfSelectionImage:vi.fn(async()=>null),reveal:vi.fn(async()=>true)},
      clipboard:{writeText:vi.fn(async()=>{})}, exportFile:vi.fn(async()=>true), notice:{show:vi.fn()},
      events:{onActiveFileChange:()=>()=>{},onFileSave:()=>()=>{}}, settings:{get:()=>undefined,onChange:()=>()=>{}},
    } as unknown as PluginContext;
    await formulaExtractorPlugin.activate(ctx);
  });
  afterEach(async()=>{await formulaExtractorPlugin.deactivate?.();});
  const run = (id:string,payload?:unknown)=>commands.get(`formula-extractor.${id}`)!.run(payload);
  const result = ()=>updates.at(-1)!.result as import('../types').FormulaExtractionResult;

  it('keeps original pixels, extracted text and untouched prediction when an OCR draft is corrected',async()=>{
    vi.mocked(ctx.document.getActive).mockResolvedValue({filePath:'paper.pdf',fileName:'paper.pdf',viewerType:'pdf',revision:'1'});
    vi.mocked(ctx.document.getSelectionText).mockResolvedValue('x²+y²');
    const sourceImage={pageNumber:2,dataUrl:'data:image/png;base64,iVBORw0KGgo=',mimeType:'image/png' as const,width:320,height:90,bbox:{x1:0.1,y1:0.2,x2:0.5,y2:0.3},source:'current-selection' as const};
    vi.mocked(ctx.document.getPdfSelectionImage).mockResolvedValue(sourceImage);
    await run('ocr.selection');const formula=result().formulas[0];
    expect(formula.rawText).toBe('x²+y²');expect(formula.originalLatex).toBe(String.raw`\sqrt{x^2+y^2}`);
    expect(formula.sourceImage).toEqual({dataUrl:sourceImage.dataUrl,width:320,height:90});
    await run('update-formula',{formulaId:formula.id,latex:String.raw`\sqrt{a^2+b^2}`});
    const corrected=result().formulas[0];expect(corrected.latex).toBe(String.raw`\sqrt{a^2+b^2}`);
    expect(corrected.originalLatex).toBe(formula.originalLatex);expect(corrected.sourceImage).toEqual(formula.sourceImage);expect(corrected.rawText).toBe(formula.rawText);
  });
  it('rejects malformed OCR copy and export until its edited draft has valid syntax',async()=>{
    vi.mocked(ctx.document.getActive).mockResolvedValue({filePath:'paper.pdf',fileName:'paper.pdf',viewerType:'pdf',revision:'1'});
    vi.mocked(ctx.document.getPdfSelectionImage).mockResolvedValue({pageNumber:1,dataUrl:'data:image/png;base64,iVBORw0KGgo=',mimeType:'image/png',width:320,height:90,bbox:{x1:0,y1:0,x2:1,y2:1},source:'current-selection'});
    ocr.mockResolvedValueOnce({latex:String.raw`\begin{matrix}a&b`,truncated:true});await run('ocr.selection');const current=result(),formulaId=current.formulas[0].id;
    expect(current.formulas[0].recognitionTruncated).toBe(true);
    await expect(run('copy-formula-latex',{formulaId})).rejects.toThrow(/校正/);
    await expect(run('export-markdown')).rejects.toThrow(/校正/);expect(ctx.clipboard.writeText).not.toHaveBeenCalled();
    await run('copy-formula-latex',{formulaId,latex:String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`});expect(ctx.clipboard.writeText).toHaveBeenCalled();
  });
  it('keeps truncation immutable so undoing a correction cannot unlock the original partial draft',async()=>{
    vi.mocked(ctx.document.getActive).mockResolvedValue({filePath:'paper.pdf',fileName:'paper.pdf',viewerType:'pdf',revision:'1'});
    vi.mocked(ctx.document.getPdfSelectionImage).mockResolvedValue({pageNumber:1,dataUrl:'data:image/png;base64,iVBORw0KGgo=',mimeType:'image/png',width:320,height:90,bbox:{x1:0,y1:0,x2:1,y2:1},source:'current-selection'});
    ocr.mockResolvedValueOnce({latex:'x+y',truncated:true});await run('ocr.selection');const formulaId=result().formulas[0].id;
    await run('update-formula',{formulaId,latex:'x+y+0'});await run('copy-formula-latex',{formulaId});
    await run('update-formula',{formulaId,latex:'x+y'});
    await expect(run('copy-formula-latex',{formulaId})).rejects.toThrow(/校正/);await expect(run('export-markdown')).rejects.toThrow(/校正/);
  });

  it('exports an edit without requiring a prior copy and wraps corrected Markdown',async()=>{
    await run('extract.document'); const id=result().formulas[0].id;
    await run('update-formula',{formulaId:id,latex:'x=3',sourceRevision:result().sourceRevision});
    await run('export-markdown',{sourceRevision:result().sourceRevision});
    expect(ctx.exportFile).toHaveBeenCalledWith(expect.objectContaining({content:'$$x=3$$'}));
    await run('copy-formula-markdown',{formulaId:id,sourceRevision:result().sourceRevision});
    expect(ctx.clipboard.writeText).toHaveBeenCalledWith('$$x=3$$');
  });
  it('rejects copy and reveal after switching documents or revising the source',async()=>{
    await run('extract.document');const previous=result();active={...active,revision:'2'};
    await expect(run('copy-formula-latex',{formulaId:previous.formulas[0].id,sourceRevision:previous.sourceRevision})).rejects.toThrow('源文档已更改。请重新扫描后再复制、导出或定位结果。');
    expect(ctx.clipboard.writeText).not.toHaveBeenCalled();
  });
  it('localizes workflow-owned cancellation and missing-scan errors',async()=>{
    await run('cancel');
    expect(updates.at(-1)).toMatchObject({error:'扫描已取消。'});
    await expect(run('copy-formula-latex',{formulaId:'missing'})).rejects.toThrow('请先扫描当前文档。');
    setLocale('en-US');
    await run('cancel');
    expect(updates.at(-1)).toMatchObject({error:'Scan cancelled.'});
    await expect(run('copy-formula-latex',{formulaId:'missing'})).rejects.toThrow('Scan the active document first.');
  });
  it('always clears busy when opening the result panel fails',async()=>{
    vi.mocked(ctx.ui.openPanel).mockRejectedValueOnce(new Error('open failed'));
    await run('extract.document');
    expect(updates.at(-1)).toMatchObject({busy:false,error:'open failed'});
  });
  it('cancels safely and permits an immediate retry while an old read is pending',async()=>{
    let resolve!: (value:unknown)=>void;
    vi.mocked(ctx.document.readCurrent).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}) as never);
    const pending=run('extract.document');
    await vi.waitFor(()=>expect(ctx.document.readCurrent).toHaveBeenCalled());
    await run('cancel');const retry=run('retry');
    try {
      await vi.waitFor(()=>expect(ctx.document.readCurrent).toHaveBeenCalledTimes(2),{timeout:300});
      await retry;
      expect(result().formulas[0].latex.replace(/\s/g,'')).toBe('x=1');
    } finally {resolve({info:active,text:'$$z=9$$'});await pending;}
    expect(result().formulas[0].latex.replace(/\s/g,'')).toBe('x=1');expect(updates.at(-1)?.busy).toBe(false);
  });
  it('keeps copy/export failure recoverable with current corrected values',async()=>{
    await run('extract.document');const current=result();
    vi.mocked(ctx.clipboard.writeText).mockRejectedValueOnce(new Error('clipboard denied'));
    await expect(run('copy-formula-latex',{formulaId:current.formulas[0].id})).rejects.toThrow('clipboard denied');
    await run('copy-formula-latex',{formulaId:current.formulas[0].id});
    expect(ctx.clipboard.writeText).toHaveBeenLastCalledWith('x = 1');
    vi.mocked(ctx.exportFile).mockResolvedValueOnce(false);
    await expect(run('export-latex')).rejects.toThrow(/cancel|取消/);
  });
  it('uses only selected Markdown and rejects empty selections',async()=>{
    await run('extract.selection');expect(result().formulas.map(f=>f.latex.replace(/\s/g,''))).toEqual(['y=2']);
    vi.mocked(ctx.document.getSelectionText).mockResolvedValueOnce('');
    await run('extract.selection');expect(updates.at(-1)).toMatchObject({busy:false,error:expect.stringMatching(/select|选择/i)});
  });
});
