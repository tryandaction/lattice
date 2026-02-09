import {
  convertCharToLatex,
  convertTextToLatex,
  convertOmmlToLatex,
  convertMathmlToLatex,
  renderLatex,
} from './markdown-converter';

export {
  convertCharToLatex,
  convertTextToLatex,
  convertOmmlToLatex,
  convertMathmlToLatex,
  renderLatex,
};

export interface DetectedFormula {
  latex: string;
  displayMode: boolean;
  start: number;
  end: number;
  original: string;
}

export function detectLatexInText(text: string): DetectedFormula[] {
  if (!text || typeof text !== 'string') return [];

  const formulas: DetectedFormula[] = [];

  const pushIfNoOverlap = (formula: DetectedFormula) => {
    const overlaps = formulas.some(
      existing =>
        (formula.start >= existing.start && formula.start < existing.end) ||
        (formula.end > existing.start && formula.end <= existing.end) ||
        (existing.start >= formula.start && existing.start < formula.end)
    );
    if (!overlaps) {
      formulas.push(formula);
    }
  };

  const addMatches = (regex: RegExp, displayMode: boolean, extractor?: (match: RegExpExecArray) => string) => {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const latex = extractor ? extractor(match) : match[1];
      pushIfNoOverlap({
        latex: latex.trim(),
        displayMode,
        start: match.index,
        end: match.index + match[0].length,
        original: match[0],
      });
    }
  };

  // Block math $$...$$
  addMatches(/\$\$([\s\S]+?)\$\$/g, true);

  // Inline math $...$
  addMatches(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, false);

  // Inline math \(...\)
  addMatches(/\\\(([\s\S]+?)\\\)/g, false);

  // Block math \[...\]
  addMatches(/\\\[([\s\S]+?)\\\]/g, true);

  formulas.sort((a, b) => a.start - b.start);
  return formulas;
}

export function renderLatexSafe(
  latex: string,
  displayMode: boolean
): { success: boolean; html: string } {
  const html = renderLatex(latex, displayMode);
  const success = !html.includes('formula-error');
  return { success, html };
}
