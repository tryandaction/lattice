/**
 * Live Preview Widgets - 统一的Widget库
 *
 * 从inline-decoration-plugin、block-decoration-plugin、code-block-plugin提取所有Widget类，统一管理。
 * 所有Widget都实现精确的光标定位和交互功能。
 *
 * Inline Widget类型:
 * 1. FormattedTextWidget - 粗体、斜体、删除线、高亮、代码
 * 2. LinkWidget - 链接 [text](url)
 * 3. AnnotationLinkWidget - PDF批注链接 [[file.pdf#ann-uuid]]
 * 4. ImageWidget - 图片 ![alt](url)
 * 5. SuperscriptWidget - 上标 ^text^
 * 6. SubscriptWidget - 下标 ~text~
 * 7. KbdWidget - 键盘按键 <kbd>text</kbd>
 * 8. FootnoteRefWidget - 脚注引用 [^1]
 * 9. EmbedWidget - 嵌入内容 ![[file]]
 *
 * Block Widget类型:
 * 10. HeadingContentWidget - 标题内容 # Heading
 * 11. BlockquoteContentWidget - 引用内容 > Quote
 * 12. ListBulletWidget - 列表标记 - * + 1. [ ]
 * 13. HorizontalRuleWidget - 分割线 ---
 *
 * Math Widget类型:
 * 14. MathWidget - LaTeX公式渲染 $...$ $$...$$
 *
 * Code Widget类型:
 * 15. CodeBlockWidget - 代码块语法高亮 ```lang...```
 */

import { EditorView, WidgetType } from '@codemirror/view';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { handleWidgetClick } from './cursor-positioning';
import { loadKaTeX } from './katex-loader';
import { getKaTeXOptions } from './katex-config';
import { wrapLatexForMarkdown } from '@/lib/formula-utils';
import { sanitizeInlineHtml } from '@/lib/sanitize';
import { logger } from '@/lib/logger';
import { imageResolverFacet } from './image-resolver-facet';
import { MarkdownErrorHandler } from '@/lib/markdown-error-handler';
import { enterCodeBlockSourceMode, enterMathSourceMode } from './source-mode';
import { TableEditor } from './table-editor';
import type { LivePreviewCodeBlockRunRequest } from './types';
export { tableToMarkdown, insertTableColumn, deleteTableColumn, insertTableDataRow, deleteTableDataRow, setTableColumnAlignment, type TableAlignment } from './table-editor';

type KaTeXModule = typeof import('katex').default;
type HighlightModule = typeof import('highlight.js').default;

type BlockContext = {
  blockquoteDepth?: number;
  listIndent?: number;
};

const DOUBLE_CLICK_DELAY = 260;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isExternalUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('//')) return true;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
}

function decodeLinkTarget(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function dispatchWikiLinkClick(element: HTMLElement, target: string): void {
  element.dispatchEvent(
    new CustomEvent('wiki-link-click', {
      detail: { target },
      bubbles: true,
    })
  );
}

function dispatchWorkspaceLinkClick(element: HTMLElement, target: string): void {
  element.dispatchEvent(
    new CustomEvent('workspace-link-click', {
      detail: { target },
      bubbles: true,
    })
  );
}

function dispatchExternalLinkClick(element: HTMLElement, url: string): void {
  element.dispatchEvent(
    new CustomEvent('external-link-click', {
      detail: { url },
      bubbles: true,
    })
  );
}

function dispatchCodeBlockRun(element: HTMLElement, detail: LivePreviewCodeBlockRunRequest): void {
  element.dispatchEvent(
    new CustomEvent('run-code-block', {
      detail,
      bubbles: true,
    })
  );
}

function applyBlockContext(container: HTMLElement, context?: BlockContext) {
  if (!context) return;
  const blockquoteDepth = context.blockquoteDepth ?? 0;
  const listIndent = context.listIndent ?? 0;

  if (blockquoteDepth <= 0 && listIndent <= 0) return;

  container.classList.add('cm-block-context');
  if (blockquoteDepth > 0) {
    container.classList.add('cm-block-context-quote');
    container.style.setProperty('--cm-blockquote-depth', String(blockquoteDepth));
  }
  if (listIndent > 0) {
    container.style.setProperty('--cm-list-indent', String(listIndent));
  }
}

// ============================================================================
// KaTeX动态加载 (使用共享加载器)
// ============================================================================

let katex: KaTeXModule | null = null;

// 预加载KaTeX
if (typeof window !== 'undefined') {
  loadKaTeX().then(k => { katex = k; });
}

// ============================================================================
// 1. FormattedTextWidget - 通用格式化文本
// ============================================================================

/**
 * 格式化文本Widget - 用于粗体、斜体、删除线、高亮、行内代码
 *
 * 精确光标定位:
 * - contentFrom/To: 实际内容位置（不含语法标记）
 * - elementFrom/To: 完整元素位置（含语法标记）
 * - 点击时根据点击位置映射到字符偏移量
 */
export class FormattedTextWidget extends WidgetType {
  constructor(
    private content: string,
    private className: string,
    private contentFrom: number,
    private contentTo: number,
    private elementFrom: number,
    private elementTo: number,
    private referenceDefs?: Map<string, ReferenceDefinition>,
    private referenceSignature: string = ''
  ) {
    super();
  }

  eq(other: FormattedTextWidget) {
    return (
      other.content === this.content &&
      other.className === this.className &&
      other.contentFrom === this.contentFrom &&
      other.referenceSignature === this.referenceSignature
    );
  }

  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = `${this.className} cm-formatted-widget cm-syntax-transition`;

    // 存储位置信息用于调试
    span.dataset.contentFrom = String(this.contentFrom);
    span.dataset.contentTo = String(this.contentTo);
    span.dataset.elementFrom = String(this.elementFrom);
    span.dataset.elementTo = String(this.elementTo);

    // Render nested inline markdown for Obsidian-like nested formatting
    // Inline code should stay literal (no nested parsing)
    if (this.className.includes('cm-inline-code')) {
      span.textContent = this.content;
    } else {
      span.innerHTML = sanitizeInlineHtml(parseInlineMarkdown(this.content, this.referenceDefs));
      const visibleText = span.textContent ?? '';
      (span as HTMLElement & { _v2sMap?: number[] })._v2sMap = this.buildVisibleToSourceMap(visibleText);
    }

    // 处理点击 - 精确光标定位 + 内嵌链接行为
    span.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === 'A') {
        const isWikiLink = target.classList.contains('cm-wiki-link-table');
        const isExternalLink = target.classList.contains('cm-link-table');
        if (isWikiLink || isExternalLink) {
          e.preventDefault();
          e.stopPropagation();

          const rawTarget = isWikiLink ? target.dataset.target : target.getAttribute('href');
          const linkTarget = rawTarget ? decodeLinkTarget(rawTarget) : '';
          if (!linkTarget) return;

          if (e.button !== 0) return;

          if ((span as unknown as { _linkClickTimer?: number })._linkClickTimer) {
            window.clearTimeout((span as unknown as { _linkClickTimer?: number })._linkClickTimer);
            (span as unknown as { _linkClickTimer?: number })._linkClickTimer = undefined;
            handleWidgetClick(view, span, e, this.contentFrom, this.contentTo, (visibleOffset, widget) => {
              const map = (widget as HTMLElement & { _v2sMap?: number[] })._v2sMap;
              if (map && visibleOffset < map.length) return map[visibleOffset];
              const visibleText = widget.textContent ?? '';
              return this.mapVisibleOffsetToSourceOffset(visibleText, visibleOffset);
            });
            return;
          }

          if (e.ctrlKey || e.metaKey) {
            if (isWikiLink) {
              dispatchWikiLinkClick(span, linkTarget);
            } else if (!isExternalUrl(linkTarget)) {
              dispatchWorkspaceLinkClick(span, linkTarget);
            } else {
              dispatchExternalLinkClick(span, linkTarget);
            }
            return;
          }

          (span as unknown as { _linkClickTimer?: number })._linkClickTimer = window.setTimeout(() => {
            (span as unknown as { _linkClickTimer?: number })._linkClickTimer = undefined;
            if (isWikiLink) {
              dispatchWikiLinkClick(span, linkTarget);
            } else if (!isExternalUrl(linkTarget)) {
              dispatchWorkspaceLinkClick(span, linkTarget);
            } else {
              dispatchExternalLinkClick(span, linkTarget);
            }
          }, DOUBLE_CLICK_DELAY);

          return;
        }
      }

      handleWidgetClick(view, span, e, this.contentFrom, this.contentTo, (visibleOffset, widget) => {
        const map = (widget as HTMLElement & { _v2sMap?: number[] })._v2sMap;
        if (map && visibleOffset < map.length) return map[visibleOffset];
        const visibleText = widget.textContent ?? '';
        return this.mapVisibleOffsetToSourceOffset(visibleText, visibleOffset);
      });
    });

    span.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'A') {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    return span;
  }

  coordsAt(dom: HTMLElement, pos: number, _side: number) {
    // Enable precise cursor positioning within the widget
    const safeOffset = Math.max(
      0,
      Math.min(pos - this.contentFrom, this.content.length)
    );
    const visibleText = dom.textContent ?? '';
    const visibleOffset = this.mapSourceOffsetToVisibleOffset(visibleText, safeOffset);
    const target = this.findTextNodeAtOffset(dom, visibleOffset);
    if (!target) return null;

    const range = document.createRange();
    try {
      range.setStart(target.node, target.offset);
      range.setEnd(target.node, target.offset);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    } catch {
      return null;
    }
  }

  private findTextNodeAtOffset(
    element: HTMLElement,
    offset: number
  ): { node: Text; offset: number } | null {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode() as Text | null;
    let remaining = offset;
    let lastText: Text | null = null;

    while (current) {
      const length = current.nodeValue?.length ?? 0;
      lastText = current;
      if (remaining <= length) {
        return { node: current, offset: remaining };
      }
      remaining -= length;
      current = walker.nextNode() as Text | null;
    }

    if (lastText) {
      return { node: lastText, offset: lastText.nodeValue?.length ?? 0 };
    }

    return null;
  }

  private mapVisibleOffsetToSourceOffset(visibleText: string, visibleOffset: number): number {
    if (!visibleText) return 0;
    // Clicking at or past the end of visible text → cursor at end of source content.
    // This handles trailing syntax markers (e.g. closing '_' in "_world_") that are
    // invisible in the rendered output but present in this.content.
    if (visibleOffset >= visibleText.length) return this.content.length;

    let sourceIndex = 0;
    let visibleIndex = 0;
    while (sourceIndex < this.content.length && visibleIndex < visibleOffset) {
      if (this.content[sourceIndex] === visibleText[visibleIndex]) {
        visibleIndex += 1;
      }
      sourceIndex += 1;
    }
    // Skip any source chars that are syntax markers between visible characters
    // (e.g. '_' between words in "hello _world_").
    while (
      sourceIndex < this.content.length &&
      visibleIndex < visibleText.length &&
      this.content[sourceIndex] !== visibleText[visibleIndex]
    ) {
      sourceIndex += 1;
    }
    return Math.min(sourceIndex, this.content.length);
  }

  private mapSourceOffsetToVisibleOffset(visibleText: string, sourceOffset: number): number {
    if (!visibleText) return 0;
    const maxSource = Math.min(sourceOffset, this.content.length);
    let sourceIndex = 0;
    let visibleIndex = 0;
    while (sourceIndex < maxSource && visibleIndex < visibleText.length) {
      if (this.content[sourceIndex] === visibleText[visibleIndex]) {
        visibleIndex += 1;
      }
      sourceIndex += 1;
    }
    // If we stopped at a syntax marker (source char not in visible text),
    // don't advance visibleIndex — the cursor sits just before the next visible char.
    return visibleIndex;
  }

  private buildVisibleToSourceMap(visibleText: string): number[] {
    const map: number[] = [];
    const src = this.content;
    let si = 0;
    let vi = 0;

    while (si < src.length && vi < visibleText.length) {
      // 转义字符: \X → X
      if (src[si] === '\\' && si + 1 < src.length &&
          '\\`*_[]{}()#+-.!|$'.includes(src[si + 1])) {
        if (visibleText[vi] === src[si + 1]) { map[vi] = si; vi++; }
        si += 2; continue;
      }
      // Wiki链接: [[target|alias]] → alias (或 target)
      if (src[si] === '[' && src[si + 1] === '[') {
        const closeIdx = src.indexOf(']]', si + 2);
        if (closeIdx !== -1) {
          const inner = src.slice(si + 2, closeIdx);
          const pipeIdx = inner.indexOf('|');
          const display = pipeIdx !== -1 ? inner.slice(pipeIdx + 1) : inner.split('#')[0];
          for (let di = 0; di < display.length && vi < visibleText.length; di++, vi++) {
            map[vi] = si;
          }
          si = closeIdx + 2; continue;
        }
      }
      // 内联公式: $formula$ → KaTeX渲染不可预测，整体映射到 $
      if (src[si] === '$' && src[si + 1] !== '$') {
        const closeIdx = src.indexOf('$', si + 1);
        if (closeIdx !== -1) {
          const afterMath = src[closeIdx + 1] ?? '';
          while (vi < visibleText.length && visibleText[vi] !== afterMath) {
            map[vi] = si; vi++;
          }
          si = closeIdx + 1; continue;
        }
      }
      // 粗斜体标记: *** 或 ___ (3字符 → 0可见)
      if ((src[si] === '*' || src[si] === '_') &&
          src[si] === src[si + 1] && src[si] === src[si + 2] &&
          visibleText[vi] !== src[si]) { si += 3; continue; }
      // 粗体标记: ** 或 __ (2字符 → 0可见)
      if ((src[si] === '*' || src[si] === '_') &&
          src[si] === src[si + 1] && visibleText[vi] !== src[si]) { si += 2; continue; }
      // 斜体/单删除线标记 (1字符 → 0可见)
      if ((src[si] === '*' || src[si] === '_') && visibleText[vi] !== src[si]) { si++; continue; }
      // 删除线: ~~ (2字符 → 0可见)
      if (src[si] === '~' && src[si + 1] === '~' && visibleText[vi] !== '~') { si += 2; continue; }
      // 高亮: == (2字符 → 0可见)
      if (src[si] === '=' && src[si + 1] === '=' && visibleText[vi] !== '=') { si += 2; continue; }
      // 行内代码反引号 (1字符 → 0可见)
      if (src[si] === '`' && visibleText[vi] !== '`') { si++; continue; }
      // 普通字符 1:1
      if (src[si] === visibleText[vi]) { map[vi] = si; vi++; si++; continue; }
      // 其他源码字符（语法标记）跳过
      si++;
    }
    while (vi < visibleText.length) { map[vi] = si; vi++; }
    return map;
  }

  private renderContentWithMath(container: HTMLElement, text: string) {
    // Split by math formulas
    const parts = text.split(/(\$[^$\n]+\$)/g);

    parts.forEach(part => {
      const mathMatch = part.match(/^\$([^$\n]+)\$$/);
      if (mathMatch) {
        // This is a math formula
        const latex = mathMatch[1];
        const mathSpan = document.createElement('span');
        mathSpan.className = 'cm-math-inline-nested';

        if (katex) {
          try {
            katex.render(latex, mathSpan, getKaTeXOptions(false));
          } catch {
            mathSpan.textContent = part;
          }
        } else {
          mathSpan.textContent = part;
          // Try to render when KaTeX loads
          MarkdownErrorHandler.loadKaTeXWithRetry(
            () => loadKaTeX().then((k) => {
              try {
                mathSpan.innerHTML = '';
                k.render(latex, mathSpan, getKaTeXOptions(false));
              } catch {
                mathSpan.textContent = part;
              }
            }),
            latex
          ).catch((error) => {
            MarkdownErrorHandler.handleMathError(
              error instanceof Error ? error : new Error(String(error)),
              latex,
              mathSpan,
              'FormattedTextWidget'
            );
          });
        }
        container.appendChild(mathSpan);
      } else if (part) {
        // Plain text
        container.appendChild(document.createTextNode(part));
      }
    });

  }

  ignoreEvent(event: Event) {
    // Block mousedown from reaching CodeMirror — we handle cursor placement
    // manually in the mousedown listener above. Returning true here prevents
    // CodeMirror from also trying to set the cursor, which would fight with
    // our custom positioning and cause misalignment.
    if (event.type === 'mousedown') return true;
    return false;
  }
}

// ============================================================================
// 2. LinkWidget - 链接
// ============================================================================

/**
 * 链接Widget - 支持Markdown链接和Wiki链接
 *
 * 交互:
 * - 单击: 打开链接
 * - 双击: 进入编辑（定位光标）
 * - Ctrl/Cmd+Click: 立即打开
 */
export class LinkWidget extends WidgetType {
  constructor(
    private text: string,
    private url: string,
    private isWikiLink: boolean = false,
    private contentFrom: number = 0,
    private contentTo: number = 0,
    private elementFrom: number = 0,
    private elementTo: number = 0
  ) {
    super();
  }

  eq(other: LinkWidget) {
    return (
      other.text === this.text &&
      other.url === this.url &&
      other.isWikiLink === this.isWikiLink
    );
  }

  toDOM(view: EditorView) {
    const link = document.createElement('a');
    link.className = `${
      this.isWikiLink ? 'cm-wiki-link' : 'cm-link'
    } cm-formatted-widget cm-syntax-transition`;
    link.innerHTML = sanitizeInlineHtml(parseInlineMarkdown(this.text, undefined, {
      disableLinks: true,
      disableImages: true,
    }));
    link.href = this.isWikiLink ? '#' : this.url;
    link.title = this.isWikiLink
      ? `${this.url} (Click to open, double-click to edit)`
      : `${this.url} (Click to open, double-click to edit)`;

    // 存储位置
    link.dataset.contentFrom = String(this.contentFrom);
    link.dataset.contentTo = String(this.contentTo);
    link.dataset.elementFrom = String(this.elementFrom);
    link.dataset.elementTo = String(this.elementTo);

    // 导航到链接
    const navigateToLink = () => {
      const target = decodeLinkTarget(this.url);
      if (this.isWikiLink) {
        dispatchWikiLinkClick(view.dom, target);
        return;
      }
      if (!isExternalUrl(target)) {
        dispatchWorkspaceLinkClick(view.dom, target);
        return;
      }
      dispatchExternalLinkClick(view.dom, target);
    };

    // 定位光标
    const positionCursor = (e: MouseEvent) => {
      handleWidgetClick(view, link, e, this.contentFrom, this.contentTo);
    };

    // 处理点击
    link.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.button !== 0) return;

      if ((link as unknown as { _linkClickTimer?: number })._linkClickTimer) {
        window.clearTimeout((link as unknown as { _linkClickTimer?: number })._linkClickTimer);
        (link as unknown as { _linkClickTimer?: number })._linkClickTimer = undefined;
        positionCursor(e);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        navigateToLink();
        return;
      }

      (link as unknown as { _linkClickTimer?: number })._linkClickTimer = window.setTimeout(() => {
        (link as unknown as { _linkClickTimer?: number })._linkClickTimer = undefined;
        navigateToLink();
      }, DOUBLE_CLICK_DELAY);
    });

    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    return link;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown' && e.type !== 'click';
  }
}

// ============================================================================
// 3. AnnotationLinkWidget - PDF批注链接
// ============================================================================

/**
 * PDF批注链接Widget - [[file.pdf#ann-uuid]]
 */
export class AnnotationLinkWidget extends WidgetType {
  constructor(
    private displayText: string,
    private filePath: string,
    private annotationId: string,
    private contentFrom: number = 0,
    private contentTo: number = 0,
    private elementFrom: number = 0,
    private elementTo: number = 0
  ) {
    super();
  }

  eq(other: AnnotationLinkWidget) {
    return (
      other.filePath === this.filePath &&
      other.annotationId === this.annotationId &&
      other.displayText === this.displayText
    );
  }

  toDOM(view: EditorView) {
    const link = document.createElement('a');
    link.className = 'cm-annotation-link cm-formatted-widget cm-syntax-transition';
    link.href = '#';
    link.title = `批注: ${this.filePath}#${this.annotationId} (Click to open, double-click to edit)`;

    // 图标
    const icon = document.createElement('span');
    icon.className = 'cm-annotation-link-icon';
    icon.innerHTML = '📌';
    icon.style.fontSize = '0.85em';

    // 文本
    const text = document.createElement('span');
    text.textContent = this.displayText;

    link.appendChild(icon);
    link.appendChild(text);

    // 存储数据
    link.dataset.contentFrom = String(this.contentFrom);
    link.dataset.contentTo = String(this.contentTo);
    link.dataset.elementFrom = String(this.elementFrom);
    link.dataset.elementTo = String(this.elementTo);
    link.dataset.filePath = this.filePath;
    link.dataset.annotationId = this.annotationId;

    // 处理点击
    link.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.button !== 0) return;

      if ((link as unknown as { _linkClickTimer?: number })._linkClickTimer) {
        window.clearTimeout((link as unknown as { _linkClickTimer?: number })._linkClickTimer);
        (link as unknown as { _linkClickTimer?: number })._linkClickTimer = undefined;
        handleWidgetClick(view, link, e, this.contentFrom, this.contentTo);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        view.dom.dispatchEvent(
          new CustomEvent('annotation-link-click', {
            detail: {
              filePath: this.filePath,
              annotationId: this.annotationId,
            },
            bubbles: true,
          })
        );
        return;
      }

      (link as unknown as { _linkClickTimer?: number })._linkClickTimer = window.setTimeout(() => {
        (link as unknown as { _linkClickTimer?: number })._linkClickTimer = undefined;
        view.dom.dispatchEvent(
          new CustomEvent('annotation-link-click', {
            detail: {
              filePath: this.filePath,
              annotationId: this.annotationId,
            },
            bubbles: true,
          })
        );
      }, DOUBLE_CLICK_DELAY);
    });

    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    return link;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown' && e.type !== 'click';
  }
}

// ============================================================================
// 4. ImageWidget - 图片
// ============================================================================

/**
 * 图片Widget - ![alt](url)
 */
export class ImageWidget extends WidgetType {
  constructor(
    private alt: string,
    private url: string,
    private width: number | undefined,
    private contentFrom: number = 0,
    private contentTo: number = 0,
    private elementFrom: number = 0,
    private elementTo: number = 0
  ) {
    super();
  }

  eq(other: ImageWidget) {
    return (
      other.alt === this.alt &&
      other.url === this.url &&
      other.width === this.width
    );
  }

  toDOM(view: EditorView) {
    const container = document.createElement('span');
    container.className = 'cm-image-container cm-formatted-widget cm-syntax-transition';
    container.dataset.contentFrom = String(this.contentFrom);
    container.dataset.contentTo = String(this.contentTo);
    container.dataset.elementFrom = String(this.elementFrom);
    container.dataset.elementTo = String(this.elementTo);

    const img = document.createElement('img');
    img.className = 'cm-image';
    img.alt = this.alt;
    if (this.width) {
      img.style.width = `${this.width}px`;
    }
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.display = 'inline-block';
    img.style.verticalAlign = 'middle';

    // 错误处理
    img.onerror = () => {
      img.style.display = 'none';
      const errorSpan = document.createElement('span');
      errorSpan.className = 'cm-image-error';
      errorSpan.textContent = `[Image not found: ${this.alt}]`;
      container.appendChild(errorSpan);
    };

    // Try to resolve local image paths via the facet resolver
    const resolver = view.state.facet(imageResolverFacet);
    if (resolver && this.url) {
      // Set a placeholder while resolving
      img.src = '';
      resolver(this.url).then((resolvedUrl) => {
        if (resolvedUrl) {
          img.src = resolvedUrl;
        } else {
          img.src = this.url;
        }
      }).catch((error) => {
        MarkdownErrorHandler.handleImageError(
          error instanceof Error ? error : new Error(String(error)),
          this.url,
          container,
          'ImageWidget'
        );
        img.src = this.url; // Fallback to original URL
      });
    } else {
      img.src = this.url;
    }

    // 点击定位到alt文本
    container.addEventListener('mousedown', (e) => {
      handleWidgetClick(view, container, e, this.contentFrom, this.contentTo);
    });

    container.appendChild(img);
    return container;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

// ============================================================================
// 5. SuperscriptWidget - 上标
// ============================================================================

export class SuperscriptWidget extends WidgetType {
  constructor(
    private content: string,
    private contentFrom: number,
    private contentTo: number,
    private elementFrom: number,
    private elementTo: number
  ) {
    super();
  }

  eq(other: SuperscriptWidget) {
    return other.content === this.content && other.contentFrom === this.contentFrom;
  }

  toDOM(view: EditorView) {
    const sup = document.createElement('sup');
    sup.className = 'cm-superscript cm-formatted-widget cm-syntax-transition';
    sup.textContent = this.content;
    sup.dataset.contentFrom = String(this.contentFrom);
    sup.dataset.contentTo = String(this.contentTo);

    sup.addEventListener('mousedown', (e) => {
      handleWidgetClick(view, sup, e, this.contentFrom, this.contentTo);
    });

    return sup;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

// ============================================================================
// 6. SubscriptWidget - 下标
// ============================================================================

export class SubscriptWidget extends WidgetType {
  constructor(
    private content: string,
    private contentFrom: number,
    private contentTo: number,
    private elementFrom: number,
    private elementTo: number
  ) {
    super();
  }

  eq(other: SubscriptWidget) {
    return other.content === this.content && other.contentFrom === this.contentFrom;
  }

  toDOM(view: EditorView) {
    const sub = document.createElement('sub');
    sub.className = 'cm-subscript cm-formatted-widget cm-syntax-transition';
    sub.textContent = this.content;
    sub.dataset.contentFrom = String(this.contentFrom);
    sub.dataset.contentTo = String(this.contentTo);

    sub.addEventListener('mousedown', (e) => {
      handleWidgetClick(view, sub, e, this.contentFrom, this.contentTo);
    });

    return sub;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

// ============================================================================
// 7. KbdWidget - 键盘按键
// ============================================================================

export class KbdWidget extends WidgetType {
  constructor(
    private content: string,
    private contentFrom: number,
    private contentTo: number,
    private elementFrom: number,
    private elementTo: number
  ) {
    super();
  }

  eq(other: KbdWidget) {
    return other.content === this.content && other.contentFrom === this.contentFrom;
  }

  toDOM(view: EditorView) {
    const kbd = document.createElement('kbd');
    kbd.className = 'cm-kbd cm-formatted-widget cm-syntax-transition';
    kbd.textContent = this.content;
    kbd.dataset.contentFrom = String(this.contentFrom);
    kbd.dataset.contentTo = String(this.contentTo);

    kbd.addEventListener('mousedown', (e) => {
      handleWidgetClick(view, kbd, e, this.contentFrom, this.contentTo);
    });

    return kbd;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

// ============================================================================
// 8. FootnoteRefWidget - 脚注引用
// ============================================================================

export class FootnoteRefWidget extends WidgetType {
  constructor(
    private identifier: string,
    private contentFrom: number,
    private contentTo: number,
    private elementFrom: number,
    private elementTo: number
  ) {
    super();
  }

  eq(other: FootnoteRefWidget) {
    return (
      other.identifier === this.identifier && other.contentFrom === this.contentFrom
    );
  }

  toDOM(view: EditorView) {
    const sup = document.createElement('sup');
    sup.className = 'cm-footnote-ref cm-formatted-widget cm-syntax-transition';
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = this.identifier;
    link.title = `Footnote: ${this.identifier}`;

    link.addEventListener('mousedown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        // 触发跳转到脚注定义
        view.dom.dispatchEvent(
          new CustomEvent('footnote-ref-click', {
            detail: { identifier: this.identifier },
            bubbles: true,
          })
        );
      } else {
        handleWidgetClick(view, link, e, this.contentFrom, this.contentTo);
      }
    });

    sup.appendChild(link);
    sup.dataset.contentFrom = String(this.contentFrom);
    sup.dataset.contentTo = String(this.contentTo);

    return sup;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

// ============================================================================
// 9. FootnoteDefWidget - 脚注定义
// ============================================================================

export class FootnoteDefWidget extends WidgetType {
  constructor(
    private identifier: string,
    private contentLines: string[],
    private from: number,
    private to: number,
    private referenceDefs?: Map<string, ReferenceDefinition>,
    private referenceSignature: string = ''
  ) {
    super();
  }

  eq(other: FootnoteDefWidget) {
    return (
      other.identifier === this.identifier &&
      JSON.stringify(other.contentLines) === JSON.stringify(this.contentLines) &&
      other.referenceSignature === this.referenceSignature
    );
  }

  toDOM(view: EditorView) {
    const container = document.createElement('div');
    container.className = 'cm-footnote-def cm-formatted-widget cm-syntax-transition';
    container.dataset.from = String(this.from);
    container.dataset.to = String(this.to);

    const label = document.createElement('span');
    label.className = 'cm-footnote-def-label';
    label.textContent = `[^${this.identifier}]`;

    const content = document.createElement('span');
    content.className = 'cm-footnote-def-content';
    const joined = this.contentLines.join(' ');
    content.innerHTML = sanitizeInlineHtml(parseInlineMarkdown(joined, this.referenceDefs));

    const backlink = document.createElement('a');
    backlink.className = 'cm-footnote-backlink';
    backlink.href = '#';
    backlink.textContent = '↩';
    backlink.title = 'Back to reference';
    backlink.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dom.dispatchEvent(
        new CustomEvent('footnote-def-click', {
          detail: { identifier: this.identifier },
          bubbles: true,
        })
      );
    });

    container.appendChild(label);
    container.appendChild(content);
    container.appendChild(backlink);

    container.addEventListener('mousedown', (e) => {
      handleWidgetClick(view, container, e, this.from, this.to);
    });

    return container;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

// ============================================================================
// 10. EmbedWidget - 嵌入内容
// ============================================================================

export class EmbedWidget extends WidgetType {
  constructor(
    private target: string,
    private displayText: string,
    private contentFrom: number,
    private contentTo: number,
    private elementFrom: number,
    private elementTo: number
  ) {
    super();
  }

  eq(other: EmbedWidget) {
    return other.target === this.target && other.displayText === this.displayText;
  }

  toDOM(view: EditorView) {
    const container = document.createElement('div');
    container.className = 'cm-embed cm-formatted-widget cm-syntax-transition';

    const header = document.createElement('div');
    header.className = 'cm-embed-header';
    header.textContent = `📎 Embedded: ${this.displayText}`;

    const content = document.createElement('div');
    content.className = 'cm-embed-content';
    content.textContent = '[Loading embedded content...]';

    container.appendChild(header);
    container.appendChild(content);

    container.dataset.contentFrom = String(this.contentFrom);
    container.dataset.contentTo = String(this.contentTo);
    container.dataset.target = this.target;

    // 触发加载嵌入内容
    view.dom.dispatchEvent(
      new CustomEvent('embed-load', {
        detail: { target: this.target, element: content },
        bubbles: true,
      })
    );

    container.addEventListener('mousedown', (e) => {
      handleWidgetClick(view, container, e, this.contentFrom, this.contentTo);
    });

    return container;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

// ============================================================================
// 11. CalloutWidget - Obsidian Callout
// ============================================================================

const CALLOUT_ICONS: Record<string, string> = {
  note: '📝',
  tip: '💡',
  info: 'ℹ️',
  warning: '⚠️',
  danger: '⛔',
  success: '✅',
  question: '❓',
  bug: '🐛',
  example: '📌',
  quote: '❝',
  abstract: '🧾',
};

export class CalloutWidget extends WidgetType {
  constructor(
    private calloutType: string,
    private title: string,
    private contentLines: string[],
    private from: number,
    private to: number,
    private isFolded: boolean,
    private referenceDefs?: Map<string, ReferenceDefinition>,
    private referenceSignature: string = ''
  ) {
    super();
  }

  eq(other: CalloutWidget) {
    return (
      other.calloutType === this.calloutType &&
      other.title === this.title &&
      JSON.stringify(other.contentLines) === JSON.stringify(this.contentLines) &&
      other.isFolded === this.isFolded &&
      other.referenceSignature === this.referenceSignature
    );
  }

  toDOM(view: EditorView) {
    const container = document.createElement('div');
    container.className = `cm-callout cm-callout-${this.calloutType}`;
    container.dataset.from = String(this.from);
    container.dataset.to = String(this.to);

    const header = document.createElement('div');
    header.className = 'cm-callout-header';

    const icon = document.createElement('span');
    icon.className = 'cm-callout-icon';
    icon.textContent = CALLOUT_ICONS[this.calloutType] || 'ℹ️';

    const title = document.createElement('span');
    title.className = 'cm-callout-title';
    title.innerHTML = sanitizeInlineHtml(parseInlineMarkdown(this.title || this.calloutType.toUpperCase(), this.referenceDefs));

    const fold = document.createElement('span');
    fold.className = 'cm-callout-fold';
    fold.textContent = this.isFolded ? '▶' : '▼';
    fold.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.isFolded = !this.isFolded;
      fold.textContent = this.isFolded ? '▶' : '▼';
      content.style.display = this.isFolded ? 'none' : '';
    });

    header.appendChild(icon);
    header.appendChild(title);
    header.appendChild(fold);

    const content = document.createElement('div');
    content.className = 'cm-callout-content';
    if (this.contentLines.length === 0) {
      content.textContent = '';
    } else {
      this.contentLines.forEach((line) => {
        const lineEl = document.createElement('div');
        lineEl.innerHTML = sanitizeInlineHtml(parseInlineMarkdown(line, this.referenceDefs));
        content.appendChild(lineEl);
      });
    }
    if (this.isFolded) {
      content.style.display = 'none';
    }

    container.appendChild(header);
    container.appendChild(content);

    container.addEventListener('mousedown', (e) => {
      handleWidgetClick(view, container, e, this.from, this.to);
    });

    return container;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

// ============================================================================
// 12. DetailsWidget - HTML <details>
// ============================================================================

export class DetailsWidget extends WidgetType {
  constructor(
    private summary: string,
    private contentLines: string[],
    private from: number,
    private to: number,
    private isOpen: boolean,
    private referenceDefs?: Map<string, ReferenceDefinition>,
    private referenceSignature: string = ''
  ) {
    super();
  }

  eq(other: DetailsWidget) {
    return (
      other.summary === this.summary &&
      JSON.stringify(other.contentLines) === JSON.stringify(this.contentLines) &&
      other.isOpen === this.isOpen &&
      other.referenceSignature === this.referenceSignature
    );
  }

  toDOM(view: EditorView) {
    const details = document.createElement('details');
    details.className = 'cm-details-widget';
    details.open = this.isOpen;
    details.dataset.from = String(this.from);
    details.dataset.to = String(this.to);

    const summary = document.createElement('summary');
    summary.className = 'cm-details-summary';
    summary.innerHTML = sanitizeInlineHtml(parseInlineMarkdown(this.summary || 'Details', this.referenceDefs));

    const content = document.createElement('div');
    content.className = 'cm-details-content';
    if (this.contentLines.length === 0) {
      content.textContent = '';
    } else {
      this.contentLines.forEach((line) => {
        const lineEl = document.createElement('div');
        lineEl.innerHTML = sanitizeInlineHtml(parseInlineMarkdown(line, this.referenceDefs));
        content.appendChild(lineEl);
      });
    }

    content.addEventListener('mousedown', (e) => {
      handleWidgetClick(view, content, e, this.from, this.to);
    });

    details.appendChild(summary);
    details.appendChild(content);

    return details;
  }

  ignoreEvent() {
    return true;
  }
}

// ============================================================================
// 13. HeadingContentWidget - 标题内容
// ============================================================================

// KaTeX for inline math in headings (使用共享加载器)
let katexForHeading: KaTeXModule | null = null;
loadKaTeX()
  .then((k) => {
    katexForHeading = k;
  })
  .catch((error) => {
    logger.error('Failed to load KaTeX for headings', {
      error: error instanceof Error ? error.message : String(error)
    });
  });

/**
 * 标题内容Widget - 渲染标题文本（隐藏#标记）
 * 支持标题内的行内LaTeX公式渲染
 */
export class HeadingContentWidget extends WidgetType {
  constructor(
    private content: string,
    private level: number,
    private originalFrom: number,
    private originalTo: number
  ) {
    super();
  }

  eq(other: HeadingContentWidget) {
    return other.content === this.content && other.level === this.level;
  }

  toDOM(_view: EditorView) {
    const span = document.createElement('span');
    span.className = `cm-heading-content cm-heading-${this.level}-content`;
    span.dataset.from = String(this.originalFrom);
    span.dataset.to = String(this.originalTo);

    // 渲染内容（支持行内公式）
    this.renderContentWithMath(span);

    // Let CodeMirror handle cursor positioning naturally - no custom mousedown handlers

    return span;
  }

  /**
   * 渲染内容（支持行内公式 $...$）
   */
  private renderContentWithMath(container: HTMLElement) {
    // 按行内公式模式分割内容
    const parts = this.content.split(/(\$[^$\n]+\$)/g);

    for (const part of parts) {
      if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
        // 行内公式
        const latex = part.slice(1, -1);
        const mathSpan = document.createElement('span');
        mathSpan.className = 'cm-math-inline';

        if (katexForHeading) {
          try {
            katexForHeading.render(latex, mathSpan, getKaTeXOptions(false));
          } catch {
            mathSpan.textContent = part;
          }
        } else {
          mathSpan.textContent = part;
          // 等待KaTeX加载 (使用共享加载器)
          MarkdownErrorHandler.loadKaTeXWithRetry(
            () => loadKaTeX().then((k) => {
              katexForHeading = k;
              try {
                mathSpan.innerHTML = '';
                k.render(latex, mathSpan, getKaTeXOptions(false));
              } catch {
                mathSpan.textContent = part;
              }
            }),
            latex
          ).catch((error) => {
            MarkdownErrorHandler.handleMathError(
              error instanceof Error ? error : new Error(String(error)),
              latex,
              mathSpan,
              'HeadingContentWidget'
            );
          });
        }
        container.appendChild(mathSpan);
      } else if (part) {
        // 普通文本
        container.appendChild(document.createTextNode(part));
      }
    }
  }

  ignoreEvent(_event: Event) {
    // Don't intercept any events - let CodeMirror handle everything
    return false;
  }
}

// ============================================================================
// 11. BlockquoteContentWidget - 引用内容
// ============================================================================

/**
 * 引用内容Widget - 渲染引用文本（隐藏>标记）
 */
export class BlockquoteContentWidget extends WidgetType {
  constructor(
    private content: string,
    private originalFrom: number,
    private originalTo: number
  ) {
    super();
  }

  eq(other: BlockquoteContentWidget) {
    return other.content === this.content;
  }

  toDOM(_view: EditorView) {
    const span = document.createElement('span');
    span.className = 'cm-blockquote-content';
    span.textContent = this.content;
    span.dataset.from = String(this.originalFrom);
    span.dataset.to = String(this.originalTo);

    // Let CodeMirror handle cursor positioning naturally - no custom mousedown handlers

    return span;
  }

  ignoreEvent(_event: Event) {
    // Don't intercept any events - let CodeMirror handle everything
    return false;
  }
}

// ============================================================================
// 12. ListBulletWidget - 列表标记
// ============================================================================

/**
 * 列表标记Widget - 渲染样式化的列表标记（•、数字、复选框）
 */
export class ListBulletWidget extends WidgetType {
  constructor(
    private type: 'bullet' | 'numbered' | 'task',
    private marker: string,
    private checked?: boolean,
    private lineFrom?: number
  ) {
    super();
  }

  eq(other: ListBulletWidget) {
    return (
      other.type === this.type &&
      other.marker === this.marker &&
      other.checked === this.checked
    );
  }

  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'cm-list-marker';

    if (this.type === 'task') {
      // 任务列表 - 可点击复选框
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = this.checked || false;
      checkbox.className = 'cm-task-checkbox';
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        // 切换复选框状态
        if (this.lineFrom !== undefined) {
          const line = view.state.doc.lineAt(this.lineFrom);
          const lineText = line.text;
          const newText = this.checked
            ? lineText.replace(/\[x\]/i, '[ ]')
            : lineText.replace(/\[ \]/, '[x]');
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: newText },
          });
        }
      });
      span.appendChild(checkbox);
    } else if (this.type === 'bullet') {
      // 无序列表 - 显示为•
      span.textContent = '•';
      span.style.paddingRight = '0.5em';
    } else {
      // 有序列表 - 保留数字
      span.textContent = this.marker;
    }

    return span;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'click';
  }
}

// ============================================================================
// 13. HorizontalRuleWidget - 分割线
// ============================================================================

/**
 * 分割线Widget - 渲染全宽水平线
 */
export class HorizontalRuleWidget extends WidgetType {
  constructor(private originalFrom: number, private originalTo: number) {
    super();
  }

  get estimatedHeight() {
    return 40;
  }

  updateDOM() {
    return false;
  }

  toDOM(view: EditorView) {
    const container = document.createElement('div');
    container.className = 'cm-horizontal-rule-container';
    container.dataset.from = String(this.originalFrom);
    container.dataset.to = String(this.originalTo);

    const hr = document.createElement('hr');
    hr.className = 'cm-horizontal-rule';

    container.appendChild(hr);

    container.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        selection: { anchor: this.originalFrom, head: this.originalFrom },
        scrollIntoView: true,
      });
      view.focus();
    });

    requestAnimationFrame(() => {
      if (container.isConnected) {
        view.requestMeasure();
      }
    });

    return container;
  }

  coordsAt(dom: HTMLElement, pos: number, _side: number) {
    const rect = dom.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      return null;
    }

    const midpoint = this.originalFrom + Math.floor((this.originalTo - this.originalFrom) / 2);
    const x = pos <= midpoint ? rect.left : rect.right;
    return { left: x, right: x, top: rect.top, bottom: rect.bottom };
  }

  eq() {
    return true;
  }

  ignoreEvent(event: Event) {
    return /^(mouse|pointer|click|contextmenu)/.test(event.type);
  }
}

// ============================================================================
// 14. MathWidget - LaTeX公式渲染
// ============================================================================

/**
 * 数学公式Widget - 使用KaTeX渲染LaTeX公式
 *
 * 交互:
 * - 单击: 定位光标到公式开始位置（显示源码）
 * - 双击: 选择整个公式（便于编辑）
 * - 右键: 复制LaTeX源码到剪贴板
 */
export class MathWidget extends WidgetType {
  constructor(
    private latex: string,
    private isBlock: boolean,
    private from: number,
    private to: number,
    private context?: BlockContext
  ) {
    super();
  }

  eq(other: MathWidget) {
    return other.latex === this.latex && other.isBlock === this.isBlock;
  }

  get estimatedHeight() {
    return -1;
  }

  updateDOM() {
    return false;
  }

  toDOM(view: EditorView) {
    const container = document.createElement(this.isBlock ? 'div' : 'span');
    container.className = this.isBlock ? 'cm-math-block' : 'cm-math-inline';
    container.dataset.from = String(this.from);
    container.dataset.to = String(this.to);
    container.dataset.latex = this.latex; // 存储LaTeX用于复制功能
    container.title = `${this.isBlock ? 'Block' : 'Inline'} formula: Click to edit, Right-click to copy Markdown, Shift+Right-click to copy LaTeX`;
    if (this.isBlock) {
      applyBlockContext(container, this.context);
    }

    // CRITICAL: Validate latex to prevent "undefined" rendering
    if (!this.latex || this.latex === 'undefined' || this.latex.trim() === '') {
      console.error('[MathWidget] Invalid latex:', this.latex, 'at', this.from, this.to);
      const errorSpan = document.createElement('span');
      errorSpan.className = 'cm-math-error-source';
      errorSpan.textContent = this.isBlock ? '$$...$$' : '$...$';
      container.appendChild(errorSpan);
      container.classList.add('cm-math-error');
      container.title = 'Empty or invalid LaTeX formula — click to edit';
      return container;
    }

    // 单击: 切换到源码态，光标落到公式内部起点
    container.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      enterMathSourceMode(view, this.from, this.to);
    });

    // 右键: 复制LaTeX源码
    container.addEventListener('contextmenu', async (event) => {
      const e = event as MouseEvent;
      e.preventDefault();
      e.stopPropagation();

      const copyAsLatex = e.shiftKey || e.altKey;
      const markdownSource =
        wrapLatexForMarkdown(this.latex, this.isBlock) ||
        (this.isBlock ? `$$${this.latex}$$` : `$${this.latex}$`);
      const latexSource = copyAsLatex ? this.latex : markdownSource;

      try {
        await navigator.clipboard.writeText(latexSource);

        // 视觉反馈
        const originalTitle = container.title;
        container.title = copyAsLatex
          ? '✓ LaTeX copied to clipboard!'
          : '✓ Markdown formula copied!';
        container.style.backgroundColor = 'rgba(34, 197, 94, 0.1)'; // 绿色提示

        setTimeout(() => {
          container.title = originalTitle;
          container.style.backgroundColor = '';
        }, 1500);
      } catch (err) {
        console.error('Failed to copy LaTeX:', err);
        container.title = '✗ Failed to copy';
        setTimeout(() => {
          container.title = `${this.isBlock ? 'Block' : 'Inline'} formula: Click to edit, Right-click to copy Markdown, Shift+Right-click to copy LaTeX`;
        }, 1500);
      }
    });

    // 渲染公式
    if (katex) {
      try {
        katex.render(this.latex, container, getKaTeXOptions(this.isBlock));

        // CRITICAL FIX: Even for synchronous render, request measure for block math
        // This ensures CodeMirror recalculates coordinates after initial render
        if (this.isBlock) {
          view.requestMeasure();
        }
      } catch (e) {
        // 显示错误和原始LaTeX
        container.innerHTML = '';
        const errorWrapper = document.createElement('span');
        errorWrapper.className = 'cm-math-error-wrapper';

        const errorIndicator = document.createElement('span');
        errorIndicator.className = 'cm-math-error-indicator';
        errorIndicator.textContent = '⚠️';
        errorIndicator.title = e instanceof Error ? e.message : 'Math rendering error';

        const errorSource = document.createElement('span');
        errorSource.className = 'cm-math-error-source';
        errorSource.textContent = this.isBlock ? `$$${this.latex}$$` : `$${this.latex}$`;

        errorWrapper.appendChild(errorIndicator);
        errorWrapper.appendChild(errorSource);
        container.appendChild(errorWrapper);
        container.classList.add('cm-math-error');

        // Also request measure on error
        if (this.isBlock) {
          view.requestMeasure();
        }
      }
    } else {
      // KaTeX未加载，显示原始LaTeX作为占位符
      container.textContent = this.isBlock ? `$$${this.latex}$$` : `$${this.latex}$`;
      container.classList.add('cm-math-loading');

      // 等待KaTeX加载后渲染（带超时保护）
      const latexStr = this.latex;
      const isBlock = this.isBlock;
      const timeoutMs = 8000;

      // Track if widget is still mounted to prevent rendering to removed DOM
      let isMounted = true;

      const loadWithTimeout = Promise.race([
        loadKaTeX(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('KaTeX load timeout')), timeoutMs)
        ),
      ]);

      loadWithTimeout
        .then((k) => {
          // Check if container is still in DOM before rendering
          if (!isMounted || !container.parentElement) {
            return;
          }

          try {
            container.innerHTML = '';
            k.render(latexStr, container, getKaTeXOptions(isBlock));
            container.classList.remove('cm-math-loading');

            // CRITICAL FIX: Notify CodeMirror to recalculate coordinates after async render
            // This fixes cursor positioning issues after math formulas
            if (isBlock) {
              view.requestMeasure();
            }
          } catch {
            // Render failed — show raw source
            if (!isMounted || !container.parentElement) {
              return;
            }
            container.innerHTML = '';
            container.textContent = isBlock ? `$$${latexStr}$$` : `$${latexStr}$`;
            container.classList.remove('cm-math-loading');
            container.classList.add('cm-math-error');

            // Also request measure on error (height may have changed)
            if (isBlock) {
              view.requestMeasure();
            }
          }
        })
        .catch((err) => {
          if (!isMounted || !container.parentElement) {
            return;
          }
          logger.warn('[KaTeX] Failed to load or render:', err);
          // Show raw LaTeX as fallback
          container.textContent = isBlock ? `$$${latexStr}$$` : `$${latexStr}$`;
          container.classList.remove('cm-math-loading');
          container.classList.add('cm-math-error');

          // Request measure even on load failure
          if (isBlock) {
            view.requestMeasure();
          }
        });

      // Cleanup function to mark widget as unmounted
      // Note: CodeMirror doesn't provide a destroy hook, but this helps prevent errors
      setTimeout(() => {
        if (!container.parentElement) {
          isMounted = false;
        }
      }, 100);
    }

    return container;
  }

  coordsAt(dom: HTMLElement, pos: number) {
    const rect = dom.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      return null;
    }

    if (this.isBlock) {
      const midpoint = this.from + Math.floor((this.to - this.from) / 2);
      const x = pos <= midpoint ? rect.left : rect.right;
      return { left: x, right: x, top: rect.top, bottom: rect.bottom };
    }

    const length = Math.max(1, this.to - this.from);
    const ratio = Math.max(0, Math.min(1, (pos - this.from) / length));
    const x = rect.left + rect.width * ratio;
    return { left: x, right: x, top: rect.top, bottom: rect.bottom };
  }

  ignoreEvent(e: Event) {
    return /^(mouse|pointer|click|contextmenu)/.test(e.type);
  }
}

// ============================================================================
// 15. CodeBlockWidget - 代码块语法高亮
// ============================================================================

// Highlight.js动态加载
type HighlightLoaderModule = HighlightModule | { default?: HighlightModule };

let hljs: HighlightModule | null = null;
let hljsLoadPromise: Promise<HighlightModule> | null = null;

function resolveHighlightModule(module: HighlightLoaderModule): HighlightModule {
  if ('default' in module && module.default) {
    return module.default;
  }
  return module as HighlightModule;
}

async function loadHighlightJS(): Promise<HighlightModule> {
  if (hljs) return hljs;
  if (hljsLoadPromise) return hljsLoadPromise;

  hljsLoadPromise = import('highlight.js')
    .then((module) => {
      hljs = resolveHighlightModule(module as HighlightLoaderModule);
      return hljs;
    })
    .catch((err) => {
      console.error('Failed to load highlight.js:', err);
      throw err;
    });

  return hljsLoadPromise;
}

// 预加载highlight.js
if (typeof window !== 'undefined') {
  loadHighlightJS();
}

/**
 * 代码块Widget - 语法高亮渲染
 *
 * 功能:
 * - 语法高亮（highlight.js）
 * - 行号显示
 * - 复制按钮
 * - 语言标签
 * - 点击定位光标
 */
export class CodeBlockWidget extends WidgetType {
  constructor(
    private code: string,
    private language: string,
    private showLineNumbers: boolean = false, // Default: no line numbers (cleaner like Obsidian)
    private from: number = 0,
    private to: number = 0,
    private context?: BlockContext,
    private blockIndex: number = 0,
    private filePath?: string,
    private startLine: number = 0,
    private endLine: number = 0,
  ) {
    super();
  }

  eq(other: CodeBlockWidget) {
    return (
      other.code === this.code &&
      other.language === this.language &&
      other.showLineNumbers === this.showLineNumbers &&
      other.blockIndex === this.blockIndex &&
      other.filePath === this.filePath
    );
  }

  toDOM(view: EditorView) {
    const container = document.createElement('div');
    container.className = 'cm-code-block-widget';
    container.dataset.from = String(this.from);
    container.dataset.to = String(this.to);
    applyBlockContext(container, this.context);

    container.addEventListener('mousedown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.cm-code-block-copy')) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      enterCodeBlockSourceMode(view, this.from, this.to);
    });

    // 头部：语言标签 + 复制按钮
    const header = document.createElement('div');
    header.className = 'cm-code-block-header';

    const langLabel = document.createElement('span');
    langLabel.className = 'cm-code-block-lang';
    langLabel.textContent = this.language || 'text';
    header.appendChild(langLabel);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'cm-code-block-copy';
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy code';
    copyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(this.code).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 2000);
      });
    });
    header.appendChild(copyBtn);

    const runBtn = document.createElement('button');
    runBtn.className = 'cm-code-block-copy';
    runBtn.textContent = 'Run';
    runBtn.title = 'Run code block';
    runBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dispatchCodeBlockRun(view.dom, {
        blockKey: `${this.filePath ?? 'untitled.md'}#block:${this.blockIndex}:${this.language || 'text'}`,
        language: this.language || 'text',
        code: this.code,
        filePath: this.filePath,
        range: {
          from: this.from,
          to: this.to,
          startLine: this.startLine,
          endLine: this.endLine,
        },
      });
    });
    header.appendChild(runBtn);

    container.appendChild(header);

    // 代码内容包装器（行号 + 代码）
    const codeWrapper = document.createElement('div');
    codeWrapper.className = 'cm-code-block-wrapper';

    const lines = this.code.split('\n');

    // 行号
    if (this.showLineNumbers && lines.length > 1) {
      const lineNumbers = document.createElement('div');
      lineNumbers.className = 'cm-code-block-line-numbers';

      for (let i = 1; i <= lines.length; i++) {
        const lineNum = document.createElement('div');
        lineNum.className = 'cm-code-block-line-number';
        lineNum.textContent = String(i);
        lineNumbers.appendChild(lineNum);
      }

      codeWrapper.appendChild(lineNumbers);
    }

    // 代码内容
    const pre = document.createElement('pre');
    pre.className = 'cm-code-block-pre';

    const code = document.createElement('code');
    code.className = `cm-code-block-code language-${this.language}`;

    // 性能优化：先显示纯文本，然后异步高亮
    code.textContent = this.code;

    // 延迟应用语法高亮（不阻塞主线程）
    const highlight = hljs;
    if (highlight && this.language) {
      // 使用 setTimeout 延迟渲染，让主线程先完成其他工作
      setTimeout(() => {
        try {
          const result = highlight.highlight(this.code, { language: this.language });
          code.innerHTML = sanitizeInlineHtml(result.value);
        } catch {
          // 语言不支持，保持纯文本
        }
      }, 0);
    } else if (!highlight) {
      // 等待加载后高亮
      loadHighlightJS()
        .then((h) => {
          if (this.language) {
            try {
              const result = h.highlight(this.code, { language: this.language });
              code.innerHTML = sanitizeInlineHtml(result.value);
            } catch {
              // 语言不支持
            }
          }
        })
        .catch((error) => {
          MarkdownErrorHandler.handleGenericError(
            error instanceof Error ? error : new Error(String(error)),
            'highlight.js loading',
            'CodeBlockWidget'
          );
        });
    }

    pre.appendChild(code);
    codeWrapper.appendChild(pre);
    container.appendChild(codeWrapper);

    return container;
  }

  ignoreEvent(_event: Event) {
    return true;
  }
}

// ============================================================================
// 16. TableWidget - 表格渲染
// ============================================================================

/**
 * 解析行内Markdown格式
 * 返回带有渲染格式的HTML字符串
 */
type ReferenceDefinition = {
  url: string;
  title?: string;
};

type TableWidgetRootHost = HTMLDivElement & {
  __tableRoot?: Root;
  __tableUnmountTimer?: number;
};

function scheduleTableRootUnmount(host: TableWidgetRootHost): void {
  if (host.__tableUnmountTimer !== undefined) {
    return;
  }

  const root = host.__tableRoot;
  if (!root) {
    return;
  }

  host.__tableRoot = undefined;

  const win = host.ownerDocument.defaultView ?? window;
  host.__tableUnmountTimer = win.setTimeout(() => {
    host.__tableUnmountTimer = undefined;
    try {
      root.unmount();
    } catch (error) {
      logger.warn('[TableWidget] delayed unmount failed', error);
    }
  }, 32);
}

function isMarkdownTableSeparatorCell(value: string): boolean {
  return /^:?-{3,}:?$/.test(value.trim());
}

function stripMarkdownTableSeparatorRow(rows: string[][], hasHeader: boolean): string[][] {
  if (!hasHeader || rows.length < 2) {
    return rows.map((row) => [...row]);
  }

  const [headerRow, maybeSeparator, ...bodyRows] = rows;
  const isSeparatorRow = maybeSeparator.length > 0 && maybeSeparator.every(isMarkdownTableSeparatorCell);

  if (!isSeparatorRow) {
    return rows.map((row) => [...row]);
  }

  return [[...headerRow], ...bodyRows.map((row) => [...row])];
}

function normalizeReferenceLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

function resolveReferenceDefinition(
  label: string,
  referenceDefs?: Map<string, ReferenceDefinition>
): ReferenceDefinition | null {
  if (!referenceDefs || referenceDefs.size === 0) return null;
  const key = normalizeReferenceLabel(label);
  if (!key) return null;
  return referenceDefs.get(key) ?? null;
}

type InlineParseOptions = {
  disableLinks?: boolean;
  disableImages?: boolean;
};

function parseInlineMarkdown(
  text: string,
  referenceDefs?: Map<string, ReferenceDefinition>,
  options?: InlineParseOptions
): string {
  let result = text;

  // Protect inline code spans so they won't be parsed by other rules
  const codeSpans: string[] = [];
  const storeCodeSpan = (code: string) => {
    const token = `@@CODE${codeSpans.length}@@`;
    codeSpans.push(escapeHtml(code));
    return token;
  };

  result = result.replace(/``([^`]+?)``/g, (_, code: string) => storeCodeSpan(code));
  result = result.replace(/(?<!`)`(?!`)([^`]+)`(?!`)/g, (_, code: string) => storeCodeSpan(code));

  const mathSpans: string[] = [];
  const storeMathSpan = (html: string) => {
    const token = `@@MATH${mathSpans.length}@@`;
    mathSpans.push(html);
    return token;
  };

  const renderMathSpan = (source: string, formula: string, displayMode: boolean) => {
    try {
      if (katex) {
        return katex.renderToString(formula.trim(), getKaTeXOptions(displayMode));
      }
      return `<span class="${displayMode ? 'cm-math-block-table' : 'cm-math-inline-table'}">${escapeHtml(source)}</span>`;
    } catch {
      return `<span class="${displayMode ? 'cm-math-block-table' : 'cm-math-inline-table'} cm-math-error">${escapeHtml(source)}</span>`;
    }
  };

  const mathRules: Array<{
    regex: RegExp;
    displayMode: boolean;
    resolve: (match: string, ...groups: string[]) => { source: string; formula: string };
  }> = [
    {
      regex: /\\begin\{([a-zA-Z*]+)\}([\s\S]+?)\\end\{\1\}/g,
      displayMode: true,
      resolve: (match: string) => ({ source: match, formula: match }),
    },
    {
      regex: /\$\$([\s\S]+?)\$\$/g,
      displayMode: true,
      resolve: (match: string, formula: string) => ({ source: match, formula }),
    },
    {
      regex: /\\\[([\s\S]+?)\\\]/g,
      displayMode: true,
      resolve: (match: string, formula: string) => ({ source: match, formula }),
    },
    {
      regex: /\\\((.+?)\\\)/g,
      displayMode: false,
      resolve: (match: string, formula: string) => ({ source: match, formula }),
    },
    {
      regex: /(?<!\\)(?<!\$)\$([^\n$]+?)\$(?!\$)/g,
      displayMode: false,
      resolve: (match: string, formula: string) => ({ source: match, formula }),
    },
  ];

  for (const rule of mathRules) {
    result = result.replace(rule.regex, (match, ...groups: string[]) => {
      const { source, formula } = rule.resolve(match, ...groups);
      return storeMathSpan(renderMathSpan(source, formula, rule.displayMode));
    });
  }

  // Protect escaped markdown symbols after math parsing so \(...\) and \[...\] still work.
  const escapeMap = new Map<string, string>();
  let escapeIndex = 0;
  result = result.replace(/\\([\\`*_[\]{}()#+\-.!|$])/g, (_, ch: string) => {
    const token = `@@ESC${escapeIndex++}@@`;
    escapeMap.set(token, ch);
    return token;
  });

  // 先转义HTML
  result = result
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 粗体+斜体: ***text*** 或 ___text___
  result = result.replace(/(\*\*\*|___)(.+?)\1/g, '<strong><em>$2</em></strong>');

  // 粗体: **text** 或 __text__
  result = result.replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>');

  // 斜体: *text* 或 _text_ (避免匹配粗体内部)
  result = result.replace(/(?<![*_])([*_])(?![*_])(.+?)(?<![*_])\1(?![*_])/g, '<em>$2</em>');

  // 删除线: ~~text~~
  result = result.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // 高亮: ==text==
  result = result.replace(/==(.+?)==/g, '<mark>$1</mark>');

  if (!options?.disableLinks) {
    // Wiki链接: [[target]] 或 [[target#heading|alias]]
    result = result.replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (match, target, heading, alias) => {
      const fullTarget = heading ? `${target}#${heading}` : target;
      const displayText = alias || fullTarget;
      return `<a class="cm-wiki-link-table" href="#" data-target="${fullTarget}">${displayText}</a>`;
    });

    // 普通链接: [text](url)
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="cm-link-table" href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  // 引用式链接与图片: [text][label] / [text][] / [label]
  if (referenceDefs && referenceDefs.size > 0) {
    if (!options?.disableImages) {
      // 引用式图片: ![alt][label] / ![alt][]
      result = result.replace(/!\[([^\]]*?)\]\s*\[([^\]]*)\]/g, (match, alt, label, _offset, _str) => {
        const resolvedLabel = label && String(label).trim().length > 0 ? label : alt;
        const def = resolveReferenceDefinition(resolvedLabel, referenceDefs);
        if (!def) return match;
        const titleAttr = def.title ? ` title="${def.title}"` : '';
        return `<img class="cm-inline-image" alt="${alt}" src="${def.url}"${titleAttr} />`;
      });
    }

    if (!options?.disableLinks) {
      // 引用式链接: [text][label] / [text][]
      result = result.replace(/\[([^\]]+?)\]\s*\[([^\]]*)\]/g, (match, text, label, offset, str) => {
        if (offset > 0 && str[offset - 1] === '!') return match;
        const resolvedLabel = label && String(label).trim().length > 0 ? label : text;
        const def = resolveReferenceDefinition(resolvedLabel, referenceDefs);
        if (!def) return match;
        const titleAttr = def.title ? ` title="${def.title}"` : '';
        return `<a class="cm-link-table" href="${def.url}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
      });
    }

    if (!options?.disableImages) {
      // 快捷引用式图片: ![alt]
      result = result.replace(/!\[([^\]]+?)\]/g, (match, alt, offset, str) => {
        const nextChar = str[offset + match.length];
        if (nextChar === '(' || nextChar === '[') return match;
        if (str[offset + 2] === '[') return match;
        const def = resolveReferenceDefinition(alt, referenceDefs);
        if (!def) return match;
        const titleAttr = def.title ? ` title="${def.title}"` : '';
        return `<img class="cm-inline-image" alt="${alt}" src="${def.url}"${titleAttr} />`;
      });
    }

    if (!options?.disableLinks) {
      // 快捷引用式链接: [label]
      result = result.replace(/\[([^\]\[]+?)\]/g, (match, label, offset, str) => {
        if (label && String(label).startsWith('^')) return match; // footnote
        if (offset > 0 && str[offset - 1] === '!') return match;
        if (offset > 0 && str[offset - 1] === ']') return match;
        if (str[offset + 1] === '[') return match; // wiki link [[...]]
        const nextChar = str[offset + match.length];
        if (nextChar === '(' || nextChar === '[') return match;
        const def = resolveReferenceDefinition(label, referenceDefs);
        if (!def) return match;
        const titleAttr = def.title ? ` title="${def.title}"` : '';
        return `<a class="cm-link-table" href="${def.url}" target="_blank" rel="noopener noreferrer"${titleAttr}>${label}</a>`;
      });
    }
  }

  if (!options?.disableLinks) {
    // Autolink: <https://...> / <mailto:...>
    result = result.replace(/<((https?:\/\/|mailto:)[^>]+)>/g, '<a class="cm-link-table" href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  if (!options?.disableImages) {
    // 图片: ![alt](url)
    result = result.replace(/!\[([^\]]*?)\]\(([^)]+)\)/g, '<img class="cm-inline-image" alt="$1" src="$2" />');
  }

  // 标签: #tag
  result = result.replace(/(^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)/g, '$1<span class="cm-tag">#$2</span>');

  // 脚注引用: [^1]
  result = result.replace(/\[\^([^\]]+)\]/g, '<sup class="cm-footnote-ref"><a class="cm-footnote-ref-link" href="#">$1</a></sup>');

  // 嵌入: ![[file]]
  result = result.replace(/!\[\[([^\]]+?)\]\]/g, '<span class="cm-embed-title">📎 $1</span>');

  // Restore inline code spans
  if (codeSpans.length > 0) {
    codeSpans.forEach((code, index) => {
      result = result.replace(new RegExp(`@@CODE${index}@@`, 'g'), `<code>${code}</code>`);
    });
  }

  if (mathSpans.length > 0) {
    mathSpans.forEach((html, index) => {
      result = result.replace(new RegExp(`@@MATH${index}@@`, 'g'), html);
    });
  }

  // Restore escaped symbols
  if (escapeMap.size > 0) {
    for (const [token, value] of escapeMap) {
      result = result.replace(new RegExp(token, 'g'), value);
    }
  }

  return result;
}

export function renderInlineMarkdownHtml(
  text: string,
  referenceDefs?: Map<string, ReferenceDefinition>,
  options?: InlineParseOptions
): string {
  return sanitizeInlineHtml(parseInlineMarkdown(text, referenceDefs, options));
}

/**
 * 表格Widget - 渲染Markdown表格
 *
 * 功能:
 * - 自动列宽
 * - 支持表头
 * - 行内Markdown格式（粗体、斜体、链接、公式等）
 * - Wiki链接点击
 * - 点击定位光标
 */
export class TableWidget extends WidgetType {
  constructor(
    private rows: string[][],
    private hasHeader: boolean,
    private alignments: Array<'left' | 'center' | 'right' | null> = [],
    private from: number = 0,
    private to: number = 0,
    private referenceDefs?: Map<string, ReferenceDefinition>,
    private referenceSignature: string = '',
    private context?: BlockContext
  ) {
    super();
  }

  eq(other: TableWidget) {
    return (
      JSON.stringify(other.rows) === JSON.stringify(this.rows) &&
      other.hasHeader === this.hasHeader &&
      JSON.stringify(other.alignments) === JSON.stringify(this.alignments) &&
      other.referenceSignature === this.referenceSignature
    );
  }

  get estimatedHeight() {
    const visibleRows = stripMarkdownTableSeparatorRow(this.rows, this.hasHeader).length + 1;
    return Math.max(96, visibleRows * 44 + 12);
  }

  updateDOM() {
    return false;
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement('div') as TableWidgetRootHost;
    wrapper.className = 'cm-table-widget-wrapper';
    wrapper.dataset.from = String(this.from);
    wrapper.dataset.to = String(this.to);
    applyBlockContext(wrapper, this.context);

    const root = createRoot(wrapper);
    wrapper.__tableRoot = root;
    root.render(
      createElement(TableEditor, {
        rows: stripMarkdownTableSeparatorRow(this.rows, this.hasHeader),
        hasHeader: this.hasHeader,
        alignments: [...this.alignments],
        from: this.from,
        to: this.to,
        view,
        onUpdate: () => undefined,
        renderCellHtml: (value: string) => renderInlineMarkdownHtml(value, this.referenceDefs),
      })
    );

    view.requestMeasure();
    return wrapper;
  }

  coordsAt(dom: HTMLElement, pos: number) {
    const rect = dom.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      return null;
    }

    const midpoint = this.from + Math.floor((this.to - this.from) / 2);
    const x = pos <= midpoint ? rect.left : rect.right;
    return { left: x, right: x, top: rect.top, bottom: rect.bottom };
  }

  destroy(dom: HTMLElement) {
    scheduleTableRootUnmount(dom as TableWidgetRootHost);
  }

  ignoreEvent() {
    return true;
  }
}


