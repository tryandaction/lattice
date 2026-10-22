import {it,expect} from 'vitest';
import {selectPdfReadingOrderChars} from '../pdf-reading-order-selection';
import type {PdfCanonicalChar} from '../pdf-canonical-text-anchoring';
const rows=[{text:'LEFT_TOP',x:20,y:20},{text:'RIGHT_TOP',x:320,y:20},{text:'LEFT_BOTTOM',x:20,y:300},{text:'RIGHT_BOTTOM',x:320,y:300}];
const chars=rows.flatMap((r,row)=>[...r.text].map((text,i)=>({text,left:r.x+i*8,right:r.x+(i+1)*8,top:r.y,bottom:r.y+16,width:8,height:16,centerX:r.x+i*8+4,centerY:r.y+8,normalizedStart:row*20+i,normalizedEnd:row*20+i+1,itemIndex:row,lineIndex:row,columnIndex:r.x<200?0:1,blockIndex:row,layoutClass:'main'} as PdfCanonicalChar)));
it.each([false,true])('reads left-column bottom to right-column top in logical order, reversed drag=%s',reverse=>{
 const start={x:20,y:308},end={x:392,y:28};
 const result=selectPdfReadingOrderChars({chars,gutter:250,start:reverse?end:start,end:reverse?start:end});
 expect(result?.map(c=>c.text).join('')).toBe('LEFT_BOTTOMRIGHT_TOP');
});
it('does not activate cross-column mode for a same-column drag',()=>{
 expect(selectPdfReadingOrderChars({chars,gutter:250,start:{x:20,y:308},end:{x:100,y:308}})).toBeNull();
});
it('honors caret sides at partially selected boundary glyphs',()=>{
 const result=selectPdfReadingOrderChars({chars,gutter:250,start:{x:67,y:308},end:{x:359,y:28}});
 expect(result?.map(c=>c.text).join('')).toBe('OTTOMRIGHT');
});
it('keeps a spanning middle row between the two column bands',()=>{
 const middle=[...'FULL WIDTH BREAK'].map((text,i)=>({text,left:20+i*25,right:45+i*25,top:160,bottom:180,width:25,height:20,centerX:32.5+i*25,centerY:170,normalizedStart:100+i,normalizedEnd:101+i,itemIndex:100,layoutClass:'main'} as PdfCanonicalChar));
 const result=selectPdfReadingOrderChars({chars:[...chars,...middle],gutter:250,start:{x:20,y:28},end:{x:416,y:308}});
 expect(result?.map(c=>c.text).join('')).toBe('LEFT_TOPRIGHT_TOPFULLWIDTHBREAKLEFT_BOTTOMRIGHT_BOTTOM');
});
