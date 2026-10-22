import { expect, it } from 'vitest';
import { detectPdfFormulaRules } from '../pdf-formula-rules';
it('uses painted fraction strokes but excludes glyphs and underlines', () => {
  const width=100,height=80,data=new Uint8ClampedArray(width*height*4).fill(255);
  for (const y of [30,31,70]) for(let x=25;x<65;x++){const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=0;}
  const glyphs=[{text:'x',x1:32,y1:10,x2:48,y2:26},{text:'y',x1:32,y1:38,x2:48,y2:54}];
  expect(detectPdfFormulaRules({width,height,data,glyphs})).toEqual([{text:'−',x1:25,y1:30,x2:65,y2:32}]);
  expect(detectPdfFormulaRules({width,height,data,glyphs:[...glyphs,{text:'−',x1:25,y1:29,x2:65,y2:33}]})).toEqual([]);
});
it('does not guess rules from empty or oversized images', () => {
  expect(detectPdfFormulaRules({width:100,height:80,data:new Uint8ClampedArray(0),glyphs:[]})).toEqual([]);
  expect(detectPdfFormulaRules({width:9000,height:9000,data:new Uint8ClampedArray(0),glyphs:[]})).toEqual([]);
});
it('detects an antialiased thin rule at reduced PDF zoom without accepting faint background bands', () => {
  const width=100,height=80,data=new Uint8ClampedArray(width*height*4).fill(255);
  for (const [y,gray] of [[30,114],[60,220]]) for(let x=25;x<65;x++){const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=gray;}
  const glyphs=[{text:'x',x1:32,y1:10,x2:48,y2:26},{text:'y',x1:32,y1:38,x2:48,y2:54},{text:'z',x1:32,y1:66,x2:48,y2:78}];
  expect(detectPdfFormulaRules({width,height,data,glyphs})).toEqual([{text:'−',x1:25,y1:30,x2:65,y2:31}]);
});
