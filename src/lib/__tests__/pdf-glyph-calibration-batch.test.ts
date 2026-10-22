import { afterEach, expect, it, vi } from 'vitest';
import { applyPdfGlyphCalibrationBatch } from '../pdf-glyph-calibration-batch';
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });
it('measures all glyphs before applying corrections to avoid per-span layout flushes', () => {
  const tasks = Array.from({length: 500}, (_, i) => {
    const element = document.createElement('span'); element.textContent = `glyph ${i}`;
    element.style.transform = 'scaleX(0.8)'; document.body.append(element);
    return {element, textNode: element.firstChild as Text, baseTransform: '', expectedWidth: 120, expectedHeight: 20};
  });
  let measurements = 0;
  vi.spyOn(document, 'createRange').mockImplementation(() => ({
    selectNodeContents: vi.fn(),
    getBoundingClientRect: () => {
      expect(tasks.every(task => task.element.style.transform === '')).toBe(true);
      measurements++;
      return {width: 100, height: 20};
    },
  }) as unknown as Range);
  applyPdfGlyphCalibrationBatch(tasks);
  expect(measurements).toBe(500);
  expect(tasks.every(task => task.element.dataset.pdfTextGlyphScaleX === '1.200000')).toBe(true);
  expect(tasks.every(task => task.element.style.transform.includes('scaleX(1.200000)'))).toBe(true);
});
