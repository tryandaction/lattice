import {expect,it} from 'vitest';
import {enrichPdfFormulaSelection, remapPdfFormulaSelection} from '../pdf-formula-selection';
import type {PdfTextKernelPage} from '../pdf-text-kernel';
import type {PdfCanonicalSelection} from '../pdf-selection-session';
it('highlights a complete formula even when a missing symbol requires transcription review',()=>{
 const text='x=�';
 const chars=[...text].map((text,i)=>({charIndex:i,text,normalizedText:text,pdfRect:{x1:.1+i*.1,x2:.18+i*.1,y1:.2,y2:.25}}));
 const kernel={pageNumber:1,viewportWidth:600,viewportHeight:800,chars,pageText:text,normalizedText:text} as unknown as PdfTextKernelPage;
 const selection={pageNumber:1,startOffset:0,endOffset:3,text,textQuote:{exact:text,prefix:'',suffix:'',source:'pdfjs-text-model',confidence:'exact'},pageRects:chars.map(c=>c.pdfRect),viewportRects:[]} as PdfCanonicalSelection;
 const result=enrichPdfFormulaSelection(selection,kernel);
 expect(result.formula?.status).toBe('needs-review');
 expect(result.formula?.latex).toBeUndefined();
 expect(result.formula?.originalRects).toHaveLength(3);
 expect(result.pageRects).toHaveLength(1);
 expect(result.pageRects[0].x1).toBeCloseTo(.1);
 expect(result.pageRects[0].x2).toBeCloseTo(.38);
});
it('includes the glyph actually under the pointer endpoint when line selection dropped a superscript',()=>{
 const text='E=mc2';
 const chars=[...text].map((text,i)=>({charIndex:i,text,normalizedText:text,pdfRect:{x1:(10+i*12)/100,x2:(20+i*12)/100,y1:i===4?.1:.2,y2:i===4?.21:.4}}));
 const kernel={pageNumber:1,viewportWidth:100,viewportHeight:100,chars,pageText:text,normalizedText:text} as unknown as PdfTextKernelPage;
 const rect={x1:.1,x2:.56,y1:.2,y2:.4};
 const selection={pageNumber:1,startOffset:0,endOffset:4,text:'E=mc',textQuote:{exact:'E=mc',prefix:'',suffix:'',source:'pdfjs-text-model',confidence:'exact'},pageRects:[rect],viewportRects:[]} as PdfCanonicalSelection;
 const result=enrichPdfFormulaSelection(selection,kernel,null,false,{start:{x:10,y:30},end:{x:67,y:15}});
 expect(result.textQuote.exact).toBe('E=mc2');expect(result.formula?.latex).toBe('E=mc^{2}');expect(result.pageRects).toHaveLength(1);
});
it('remaps flattened rendering offsets to original mathematical glyphs without losing the raised script',()=>{
 const text='E=mc 2';
 const chars=[...text].map((text,i)=>({charIndex:i,text,normalizedText:text,pdfRect:{x1:(i===5?50:10+i*10)/100,x2:(i===5?58:18+i*10)/100,y1:i===5?.1:.2,y2:i===5?.21:.4}}));
 const kernel={pageNumber:1,viewportWidth:100,viewportHeight:100,chars,pageText:text,normalizedText:text} as unknown as PdfTextKernelPage;
 const selection={pageNumber:1,startOffset:0,endOffset:5,text:'E=mc2',textQuote:{exact:'E=mc2',prefix:'',suffix:'',source:'pdfjs-text-model',confidence:'exact'},pageRects:[{x1:.1,x2:.68,y1:.1,y2:.4}],viewportRects:[]} as PdfCanonicalSelection;
 const mapped=remapPdfFormulaSelection(selection,kernel);
 const result=enrichPdfFormulaSelection(mapped,kernel);
 expect(result.formula?.latex).toBe('E=mc^{2}');
 expect(result.pageRects).toHaveLength(1);
});

it('includes matrix cells whose ink crosses the scalable delimiter font box',()=>{
 const data:[string,number,number,number,number][]=[['M',70,247,15,18],['=',90,247,10,18],['(',115,236,20,62],[')',232,236,20,62],['a',145,230,10,18],['b',200,230,10,18],['c',145,262,10,18],['d',200,262,10,18]];
 const text=data.map(x=>x[0]).join('');
 const chars=data.map(([text,x,y,w,h],i)=>({charIndex:i,text,normalizedText:text,pdfRect:{x1:x/612,x2:(x+w)/612,y1:y/420,y2:(y+h)/420}}));
 const kernel={pageNumber:1,viewportWidth:612,viewportHeight:420,chars,pageText:text,normalizedText:text} as unknown as PdfTextKernelPage;
 const selection={pageNumber:1,startOffset:0,endOffset:4,text:'M=()',textQuote:{exact:'M=()',prefix:'',suffix:'',source:'pdfjs-text-model',confidence:'exact'},pageRects:chars.slice(0,4).map(c=>c.pdfRect),viewportRects:[]} as PdfCanonicalSelection;
 const result=enrichPdfFormulaSelection(selection,kernel);
 expect(result.formula?.latex).toBe('M=\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}');
 expect(result.pageRects).toHaveLength(1);
});
