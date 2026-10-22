import { afterEach, describe, expect, it, vi } from "vitest";
import { flashReferenceRange, flashReferenceTarget, REFERENCE_TARGET_FLASH_CLASS } from "../reference-target-flash";

describe("reference target flash", () => {
  it.each([{ rects: [] }, { rects: [new DOMRect(10, 20, 0, 18)] }])('rejects a quote with no drawable text fragments', ({ rects }) => {
    const range = document.createRange();
    range.selectNodeContents(document.createTextNode('Hidden evidence'));
    range.getClientRects = () => rects as unknown as DOMRectList;
    const cleanup = flashReferenceRange(range);
    try {
      expect(cleanup).toBeNull();
      expect(document.querySelector('[data-reference-quote-flash]')).toBeNull();
    } finally {
      cleanup?.();
    }
  });
  it('excludes block-level rectangles when the quote spans multiple text nodes', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    root.innerHTML = '<p>Before quoted</p><p>words after</p>';
    const range = document.createRange();
    range.setStart(root.firstChild!.firstChild!, 7);
    range.setEnd(root.lastChild!.firstChild!, 5);
    const descriptor = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: function (this: Range) {
      return [new DOMRect(10, 20, this.commonAncestorContainer.nodeType === Node.TEXT_NODE ? 35 : 500, 18)];
    } });
    try {
      const cleanup = flashReferenceRange(range);
      const frames = Array.from(document.querySelector('[data-reference-quote-flash]')!.children) as HTMLElement[];
      expect(frames).toHaveLength(2);
      expect(frames.every((frame) => frame.style.width === '35px')).toBe(true);
      cleanup!();
    } finally {
      if (descriptor) Object.defineProperty(Range.prototype, 'getClientRects', descriptor);
      else Reflect.deleteProperty(Range.prototype, 'getClientRects');
    }
  });
  it('outlines each exact quote fragment and clears frames and listeners', () => {
    vi.useFakeTimers();
    const range = document.createRange();
    range.selectNodeContents(document.createTextNode('first line second line'));
    const rects = [new DOMRect(12, 20, 90, 18), new DOMRect(8, 38, 43, 18)];
    range.getClientRects = () => rects as unknown as DOMRectList;
    const cleanup = flashReferenceRange(range);
    const layer = document.querySelector('[data-reference-quote-flash]')!;
    expect(layer.children).toHaveLength(2);
    expect((layer.children[0] as HTMLElement).style.borderStyle).toBe('dashed');
    expect((layer.children[1] as HTMLElement).style.width).toBe('43px');
    cleanup!();
    expect(document.querySelector('[data-reference-quote-flash]')).toBeNull();
    window.dispatchEvent(new Event('scroll'));
    expect(document.querySelector('[data-reference-quote-flash]')).toBeNull();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks the real target element and removes the red frame after the animation", () => {
    vi.useFakeTimers();
    const target = document.createElement("div");

    flashReferenceTarget(target);

    expect(target.classList.contains(REFERENCE_TARGET_FLASH_CLASS)).toBe(true);

    vi.advanceTimersByTime(1800);

    expect(target.classList.contains(REFERENCE_TARGET_FLASH_CLASS)).toBe(false);
  });
});
