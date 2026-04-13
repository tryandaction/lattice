export interface PptSlideRenderMetrics {
  declaredWidth: number;
  declaredHeight: number;
  contentWidth: number;
  contentHeight: number;
  renderedTextContent: string;
  hasImages: boolean;
  hasSvg: boolean;
}

export interface PptSlideSnapshot {
  element: HTMLElement;
  metrics: PptSlideRenderMetrics;
}

const DEFAULT_SLIDE_WIDTH = 960;
const DEFAULT_SLIDE_HEIGHT = 540;
const OVERFLOW_PADDING = 10;

function parseDimension(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function measurePptSlideElement(sourceElement: HTMLElement): PptSlideRenderMetrics {
  const declaredWidth = parseDimension(sourceElement.style.width) || sourceElement.offsetWidth || DEFAULT_SLIDE_WIDTH;
  const declaredHeight = parseDimension(sourceElement.style.height) || sourceElement.offsetHeight || DEFAULT_SLIDE_HEIGHT;
  const renderedTextContent = sourceElement.textContent?.trim() || "";
  const hasImages = sourceElement.querySelectorAll("img").length > 0;
  const hasSvg = sourceElement.querySelectorAll("svg").length > 0;

  const scrollWidth = sourceElement.scrollWidth;
  const scrollHeight = sourceElement.scrollHeight;
  let contentWidth = scrollWidth;
  let contentHeight = scrollHeight;

  if (scrollWidth > declaredWidth || scrollHeight > declaredHeight) {
    const children = sourceElement.querySelectorAll("*");
    let maxRight = 0;
    let maxBottom = 0;

    children.forEach((child) => {
      const element = child as HTMLElement;
      if (element.offsetWidth === 0 && element.offsetHeight === 0) {
        return;
      }

      const left = element.offsetLeft;
      const top = element.offsetTop;
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const styleLeft = parseDimension(element.style.left);
      const styleTop = parseDimension(element.style.top);
      const styleWidth = parseDimension(element.style.width);
      const styleHeight = parseDimension(element.style.height);

      const effectiveLeft = Math.max(left, styleLeft);
      const effectiveTop = Math.max(top, styleTop);
      const effectiveWidth = Math.max(width, styleWidth);
      const effectiveHeight = Math.max(height, styleHeight);

      maxRight = Math.max(maxRight, effectiveLeft + effectiveWidth);
      maxBottom = Math.max(maxBottom, effectiveTop + effectiveHeight);
    });

    contentWidth = Math.max(scrollWidth, maxRight);
    contentHeight = Math.max(scrollHeight, maxBottom);
  }

  return {
    declaredWidth,
    declaredHeight,
    contentWidth: contentWidth > declaredWidth ? contentWidth + OVERFLOW_PADDING : declaredWidth,
    contentHeight: contentHeight > declaredHeight ? contentHeight + OVERFLOW_PADDING : declaredHeight,
    renderedTextContent,
    hasImages,
    hasSvg,
  };
}

export function createPptSlideSnapshot(sourceElement: HTMLElement): PptSlideSnapshot {
  return {
    element: sourceElement.cloneNode(true) as HTMLElement,
    metrics: measurePptSlideElement(sourceElement),
  };
}
