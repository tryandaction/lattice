export type FormulaTemplateId =
  | 'superscript'
  | 'subscript'
  | 'sqrt'
  | 'nth-root'
  | 'fraction'
  | 'sum'
  | 'integral'
  | 'limit'
  | 'matrix-2x2'
  | 'cases-2'
  | 'vector';

export interface FormulaTemplate {
  id: FormulaTemplateId;
  label: string;
  latex: string;
  mathLiveLatex: string;
  previewLatex: string;
  displayMode?: boolean;
  keywords: string[];
}

export const FORMULA_TEMPLATES: Record<FormulaTemplateId, FormulaTemplate> = {
  superscript: {
    id: 'superscript',
    label: '上标',
    latex: '^{ }',
    mathLiveLatex: '^{\\placeholder{}}',
    previewLatex: 'x^{\\square}',
    keywords: ['power', 'exponent', 'superscript', '上标', '指数'],
  },
  subscript: {
    id: 'subscript',
    label: '下标',
    latex: '_{ }',
    mathLiveLatex: '_{\\placeholder{}}',
    previewLatex: 'x_{\\square}',
    keywords: ['index', 'subscript', '下标'],
  },
  sqrt: {
    id: 'sqrt',
    label: '根号',
    latex: '\\sqrt{}',
    mathLiveLatex: '\\sqrt{\\placeholder{}}',
    previewLatex: '\\sqrt{\\square}',
    keywords: ['sqrt', 'root', 'radical', '根号', '平方根'],
  },
  'nth-root': {
    id: 'nth-root',
    label: 'n次根',
    latex: '\\sqrt[]{}',
    mathLiveLatex: '\\sqrt[\\placeholder{}]{\\placeholder{}}',
    previewLatex: '\\sqrt[\\square]{\\square}',
    keywords: ['nth root', 'root', 'n次根'],
  },
  fraction: {
    id: 'fraction',
    label: '分数',
    latex: '\\frac{}{}',
    mathLiveLatex: '\\frac{\\placeholder{}}{\\placeholder{}}',
    previewLatex: '\\frac{\\square}{\\square}',
    keywords: ['fraction', 'divide', 'frac', '分数'],
  },
  sum: {
    id: 'sum',
    label: '求和',
    latex: '\\sum_{}^{}',
    mathLiveLatex: '\\sum_{\\placeholder{}}^{\\placeholder{}}',
    previewLatex: '\\sum_{\\square}^{\\square}',
    displayMode: true,
    keywords: ['sum', 'series', '求和'],
  },
  integral: {
    id: 'integral',
    label: '积分',
    latex: '\\int_{}^{}',
    mathLiveLatex: '\\int_{\\placeholder{}}^{\\placeholder{}}',
    previewLatex: '\\int_{\\square}^{\\square}',
    displayMode: true,
    keywords: ['integral', 'int', '积分'],
  },
  limit: {
    id: 'limit',
    label: '极限',
    latex: '\\lim_{}',
    mathLiveLatex: '\\lim_{\\placeholder{}}',
    previewLatex: '\\lim_{\\square}',
    displayMode: true,
    keywords: ['limit', 'lim', '极限'],
  },
  'matrix-2x2': {
    id: 'matrix-2x2',
    label: '矩阵',
    latex: '\\begin{pmatrix}{}&{}\\\\{}&{}\\end{pmatrix}',
    mathLiveLatex: '\\begin{pmatrix}\\placeholder{}&\\placeholder{}\\\\\\placeholder{}&\\placeholder{}\\end{pmatrix}',
    previewLatex: '\\begin{pmatrix}\\square&\\square\\\\\\square&\\square\\end{pmatrix}',
    displayMode: true,
    keywords: ['matrix', 'pmatrix', 'linear algebra', '矩阵'],
  },
  'cases-2': {
    id: 'cases-2',
    label: '分段',
    latex: '\\begin{cases}{}&{}\\\\{}&{}\\end{cases}',
    mathLiveLatex: '\\begin{cases}\\placeholder{}&\\placeholder{}\\\\\\placeholder{}&\\placeholder{}\\end{cases}',
    previewLatex: '\\begin{cases}\\square&\\square\\\\\\square&\\square\\end{cases}',
    displayMode: true,
    keywords: ['cases', 'piecewise', '分段函数', '分段'],
  },
  vector: {
    id: 'vector',
    label: '向量',
    latex: '\\vec{}',
    mathLiveLatex: '\\vec{\\placeholder{}}',
    previewLatex: '\\vec{\\square}',
    keywords: ['vector', 'vec', '向量'],
  },
};

export const QUICK_FORMULA_TEMPLATE_IDS: FormulaTemplateId[] = [
  'fraction',
  'sqrt',
  'superscript',
  'subscript',
  'sum',
  'integral',
  'limit',
  'matrix-2x2',
  'cases-2',
  'vector',
];

export const FORMULA_TEMPLATE_KEYMAP: Partial<Record<string, FormulaTemplateId>> = {
  Digit1: 'superscript',
  Digit2: 'subscript',
  Digit3: 'sqrt',
  Digit4: 'fraction',
  Digit5: 'sum',
  Digit6: 'integral',
  Digit7: 'limit',
  KeyF: 'fraction',
  KeyS: 'sum',
  KeyI: 'integral',
  KeyM: 'matrix-2x2',
  KeyX: 'matrix-2x2',
  KeyB: 'cases-2',
  KeyV: 'vector',
};

export function getFormulaTemplate(id: FormulaTemplateId): FormulaTemplate {
  return FORMULA_TEMPLATES[id];
}

export function getQuickFormulaTemplates(): FormulaTemplate[] {
  return QUICK_FORMULA_TEMPLATE_IDS.map(getFormulaTemplate);
}

export function getFormulaTemplateForKey(keyCode: string): FormulaTemplate | null {
  const templateId = FORMULA_TEMPLATE_KEYMAP[keyCode];
  return templateId ? getFormulaTemplate(templateId) : null;
}

export function latexToVisualPreview(latex: string): string {
  const trimmed = latex.trim();
  if (!trimmed) return '\\square';

  let visual = trimmed
    .replace(/\\placeholder\{\}/g, '\\square')
    .replace(/\{\s*\}/g, '{\\square}')
    .replace(/\[\s*\]/g, '[\\square]')
    .replace(/\^\{\s+\}/g, '^{\\square}')
    .replace(/_\{\s+\}/g, '_{\\square}');

  if (visual.startsWith('^') || visual.startsWith('_')) {
    visual = `x${visual}`;
  }

  return visual;
}
