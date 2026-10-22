import {describe,it,expect} from 'vitest';
import {applyPdfFormulaOcrResult} from '@/lib/pdf-formula-ocr-result';
import type {PdfFormulaAnnotation} from '@/types/universal-annotation';
describe('PDF OCR source and completion metadata',()=>{
  const source:PdfFormulaAnnotation={rawText:'x²',status:'ready',source:'geometry',originalRects:[{x1:0,y1:0,x2:1,y2:1}]};
  it('preserves source text while recording raw and normalized predictions',()=>{
    expect(applyPdfFormulaOcrResult(source,{latex:String.raw`\sqrt[3]{x}`,rawLatex:String.raw`\root 3 \of {x}`,truncated:true,tokenCount:1024})).toEqual({...source,source:'ocr',status:'needs-review',latex:String.raw`\sqrt[3]{x}`,originalLatex:String.raw`\root 3 \of {x}`,initialLatex:String.raw`\sqrt[3]{x}`,recognitionTruncated:true,tokenCount:1024});
  });
});
