import type {FormulaOcrResult} from '@/lib/formula-ocr';
import type {PdfFormulaAnnotation} from '@/types/universal-annotation';

/** OCR never replaces source text or grants a reviewed annotation status. */
export function applyPdfFormulaOcrResult(source:PdfFormulaAnnotation,result:Pick<FormulaOcrResult,'latex'|'rawLatex'|'truncated'|'tokenCount'>):PdfFormulaAnnotation {
  return {...source,latex:result.latex,originalLatex:result.rawLatex??result.latex,initialLatex:result.latex,
    recognitionTruncated:result.truncated===true,tokenCount:result.tokenCount,source:'ocr',status:'needs-review'};
}
