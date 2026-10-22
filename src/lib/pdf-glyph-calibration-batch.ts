import { computePdfTextLayerGlyphCalibration } from './pdf-highlighter-adapter-utils';

export interface PdfGlyphCalibrationTask {
  element: HTMLElement;
  textNode: Text;
  baseTransform: string;
  expectedWidth: number;
  expectedHeight: number;
}

/** Absolute-positioned glyphs do not affect each other's layout. Reset, measure,
 * then apply as three batches instead of forcing layout between every glyph. */
export function applyPdfGlyphCalibrationBatch(tasks: PdfGlyphCalibrationTask[]): void {
  for (const task of tasks) {
    task.element.style.transform = task.baseTransform;
    task.element.style.transformOrigin = '0% 0%';
  }
  const corrections = tasks.map(task => {
    const range = document.createRange();
    range.selectNodeContents(task.textNode);
    const measured = range.getBoundingClientRect();
    return computePdfTextLayerGlyphCalibration({actualWidth: measured.width, actualHeight: measured.height,
      expectedWidth: task.expectedWidth, expectedHeight: task.expectedHeight});
  });
  tasks.forEach((task, index) => {
    const correction = corrections[index];
    if (!correction) return;
    const scaleX = correction.scaleX.toFixed(6), scaleY = correction.scaleY.toFixed(6);
    task.element.style.transform = `${task.baseTransform} scaleX(${scaleX}) scaleY(${scaleY})`.trim();
    task.element.style.transformOrigin = '0% 50%';
    task.element.dataset.pdfTextGlyphScaleX = scaleX;
    task.element.dataset.pdfTextGlyphScaleY = scaleY;
  });
}
