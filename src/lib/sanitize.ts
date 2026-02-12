/**
 * HTML Sanitization Utility
 *
 * Wraps DOMPurify to sanitize HTML strings before innerHTML assignment.
 * Used primarily in the live-preview widgets for parseInlineMarkdown output,
 * KaTeX rendered HTML, and highlight.js output.
 */
import DOMPurify from 'dompurify';

const INLINE_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'strong', 'em', 'del', 'mark', 'code', 'a', 'span', 'sub', 'sup', 'br',
    'img', 'svg', 'path', 'line', 'rect', 'circle', 'g', 'use', 'defs',
    'clipPath', 'style', 'semantics', 'annotation', 'math', 'mrow', 'mi',
    'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt', 'mover', 'munder',
    'munderover', 'mtable', 'mtr', 'mtd', 'mtext', 'mspace', 'menclose',
    'mpadded', 'mphantom', 'mstyle', 'merror',
  ],
  ALLOWED_ATTR: [
    'class', 'href', 'target', 'rel', 'src', 'alt', 'title', 'style',
    'data-target', 'data-annotation-id', 'data-type',
    'width', 'height', 'viewBox', 'xmlns', 'd', 'fill', 'stroke',
    'stroke-width', 'transform', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
    'cx', 'cy', 'r', 'rx', 'ry', 'id', 'clip-path',
    'mathvariant', 'encoding', 'columnalign', 'rowspacing', 'columnspacing',
    'displaystyle', 'scriptlevel', 'lspace', 'rspace', 'stretchy',
    'symmetric', 'maxsize', 'minsize', 'fence', 'separator', 'accent',
    'accentunder', 'notation',
  ],
  ADD_TAGS: ['semantics', 'annotation'],
  ALLOW_DATA_ATTR: true,
};

/**
 * Sanitize inline HTML (parseInlineMarkdown output, KaTeX, highlight.js).
 * Allows common formatting tags, math elements, and SVG for KaTeX.
 */
export function sanitizeInlineHtml(html: string): string {
  return DOMPurify.sanitize(html, INLINE_CONFIG as Parameters<typeof DOMPurify.sanitize>[1]);
}
