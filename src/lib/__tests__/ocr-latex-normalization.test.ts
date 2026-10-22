import {describe,it,expect} from 'vitest';
import {normalizeOcrLatex} from '@/lib/ocr-latex-normalization';
describe('bounded TeX root dialect compatibility',()=>{
  it('translates a whole grouped plain-TeX root without changing its symbols',()=>{
    expect(normalizeOcrLatex(String.raw`\root 3 \of { x + 1 }`)).toBe(String.raw`\sqrt[3]{ x + 1 }`);
    expect(normalizeOcrLatex(String.raw`\root n+1 \of {\alpha+\frac{x}{y}}`)).toBe(String.raw`\sqrt[n+1]{\alpha+\frac{x}{y}}`);
  });
  it.each([String.raw`\sqrt{\alpha^2+y^2}`,String.raw`\root 3 \of x+1`,String.raw`\root 3 \of {x}+y`,String.raw`\root 3 \of {x`,String.raw`x=\root 3 \of {y}`,String.raw`\root \alpha \of{x}`,String.raw`\root 3 \of {x}}`,String.raw`\root a]b \of{x}`,String.raw`\root 3%comment \of{x}`])('preserves unsupported or already standard input verbatim: %s',value=>{
    expect(normalizeOcrLatex(value)).toBe(value);
  });
});
