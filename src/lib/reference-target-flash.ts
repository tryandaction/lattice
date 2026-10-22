export const REFERENCE_TARGET_FLASH_CLASS = "lattice-reference-target-flash";
export const REFERENCE_TARGET_FLASH_DURATION_MS = 1800;

function quoteTextRects(range: Range): DOMRect[] {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) return Array.from(range.getClientRects());
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const rects: DOMRect[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent?.trim() || !range.intersectsNode(node)) continue;
    const fragment = document.createRange();
    fragment.selectNodeContents(node);
    if (range.compareBoundaryPoints(Range.START_TO_START, fragment) > 0) fragment.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, fragment) < 0) fragment.setEnd(range.endContainer, range.endOffset);
    rects.push(...Array.from(fragment.getClientRects()));
  }
  return rects;
}

/** Outline each visible fragment of the actual quoted range, including wrapped lines. */
export function flashReferenceRange(range: Range, durationMs = REFERENCE_TARGET_FLASH_DURATION_MS): (() => void) | null {
  const initialRects = quoteTextRects(range).filter((rect) => rect.width > 0 && rect.height > 0);
  if (!initialRects.length) return null;
  const layer = document.createElement('div');
  layer.dataset.referenceQuoteFlash = 'true';
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:60;';
  document.body.append(layer);
  const draw = (rects: DOMRect[]) => {
    layer.replaceChildren();
    for (const rect of rects) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const frame = document.createElement('div');
      frame.style.cssText = `position:absolute;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;border:1.5px dashed #ef4444;border-radius:2px;box-sizing:border-box;background:rgba(239,68,68,.06);`;
      layer.append(frame);
    }
  };
  draw(initialRects);
  const render = () => draw(quoteTextRects(range));
  window.addEventListener('scroll', render, true);
  window.addEventListener('resize', render);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timer);
    window.removeEventListener('scroll', render, true);
    window.removeEventListener('resize', render);
    layer.remove();
  };
  const timer = window.setTimeout(finish, durationMs);
  return finish;
}

export function flashReferenceTarget(
  element: HTMLElement,
  durationMs = REFERENCE_TARGET_FLASH_DURATION_MS,
): () => void {
  element.classList.remove(REFERENCE_TARGET_FLASH_CLASS);
  void element.offsetWidth;
  element.classList.add(REFERENCE_TARGET_FLASH_CLASS);

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timerId);
    element.classList.remove(REFERENCE_TARGET_FLASH_CLASS);
  };
  const timerId = window.setTimeout(finish, durationMs);
  return finish;
}
