export interface PdfPageBounds {
  pageNumber: number;
  top: number;
  bottom: number;
}

export function deriveVisiblePdfPages(
  pages: PdfPageBounds[],
  scrollTop: number,
  viewportBottom: number,
  preloadDistance: number,
): Set<number> {
  const visibleTop = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
  const visibleBottom = Math.max(visibleTop, Number.isFinite(viewportBottom) ? viewportBottom : visibleTop);
  const preload = Math.max(0, Number.isFinite(preloadDistance) ? preloadDistance : 0);
  const rangeTop = visibleTop - preload;
  const rangeBottom = visibleBottom + preload;
  const result = new Set<number>();

  pages.forEach((page) => {
    if (
      Number.isInteger(page.pageNumber) &&
      page.pageNumber > 0 &&
      Number.isFinite(page.top) &&
      Number.isFinite(page.bottom) &&
      page.bottom >= rangeTop &&
      page.top <= rangeBottom
    ) {
      result.add(page.pageNumber);
    }
  });

  if (result.size > 0) {
    return result;
  }

  const nearest = pages
    .filter((page) => Number.isInteger(page.pageNumber) && page.pageNumber > 0)
    .sort((left, right) => {
      const leftDistance = left.bottom < visibleTop ? visibleTop - left.bottom : left.top - visibleBottom;
      const rightDistance = right.bottom < visibleTop ? visibleTop - right.bottom : right.top - visibleBottom;
      return Math.max(0, leftDistance) - Math.max(0, rightDistance);
    })[0];
  if (nearest) {
    result.add(nearest.pageNumber);
  }
  return result;
}
