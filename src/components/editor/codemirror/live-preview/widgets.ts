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
import { handleWidgetClick, setCursorPosition } from './cursor-positioning';
import { loadKaTeX } from './katex-loader';
import { getKaTeXOptions } from './katex-config';
import { wrapLatexForMarkdown } from '@/lib/formula-utils';
import { sanitizeInlineHtml } from '@/lib/sanitize';
import { logger } from '@/lib/logger';

type KaTeXModule = typeof import('katex').default;
type HighlightModule = typeof import('highlight.js').default;

type BlockContext = {
  blockquoteDepth?: number;
  listIndent?: number;
};

const DOUBLE_CLICK_DELAY = 260;

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
              const visibleText = widget.textContent ?? '';
              return this.mapVisibleOffsetToSourceOffset(visibleText, visibleOffset);
            });
            return;
          }

          if (e.ctrlKey || e.metaKey) {
            if (isWikiLink || !isExternalUrl(linkTarget)) {
              dispatchWikiLinkClick(span, linkTarget);
            } else {
              window.open(linkTarget, '_blank', 'noopener,noreferrer');
            }
            return;
          }

          (span as unknown as { _linkClickTimer?: number })._linkClickTimer = window.setTimeout(() => {
            (span as unknown as { _linkClickTimer?: number })._linkClickTimer = undefined;
            if (isWikiLink || !isExternalUrl(linkTarget)) {
              dispatchWikiLinkClick(span, linkTarget);
            } else {
              window.open(linkTarget, '_blank', 'noopener,noreferrer');
            }
          }, DOUBLE_CLICK_DELAY);

          return;
        }
      }

      handleWidgetClick(view, span, e, this.contentFrom, this.contentTo, (visibleOffset, widget) => {
        const visibleText = widget.textContent ?? '';
        return this.mapVisibleOffsetToSourceOffset(visibleText, visibleOffset);
      });
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
    const maxVisible = Math.min(visibleOffset, visibleText.length);
    let sourceIndex = 0;
    let visibleIndex = 0;
    while (sourceIndex < this.content.length && visibleIndex < maxVisible) {
      if (this.content[sourceIndex] === visibleText[visibleIndex]) {
        visibleIndex += 1;
      }
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
    return visibleIndex;
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
          loadKaTeX()
            .then((k) => {
              try {
                mathSpan.innerHTML = '';
                k.render(latex, mathSpan, getKaTeXOptions(false));
              } catch {
                mathSpan.textContent = part;
              }
            })
            .catch(() => {});
        }
        container.appendChild(mathSpan);
      } else if (part) {
        // Plain text
        container.appendChild(document.createTextNode(part));
      }
    });
  }

  ignoreEvent(_event: Event) {
    // Allow CodeMirror to handle cursor positioning
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
      if (this.isWikiLink || !isExternalUrl(target)) {
        dispatchWikiLinkClick(view.dom, target);
        return;
      }
      window.open(target, '_blank', 'noopener,noreferrer');
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

    return link;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
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
    icon.style.marginRight = '2px';
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

    return link;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
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
    img.src = this.url;
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
  .catch(() => {});

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
          loadKaTeX()
            .then((k) => {
              katexForHeading = k;
              try {
                mathSpan.innerHTML = '';
                k.render(latex, mathSpan, getKaTeXOptions(false));
              } catch {
                mathSpan.textContent = part;
              }
            })
            .catch(() => {});
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
      span.style.marginRight = '0.5em';
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

  toDOM(view: EditorView) {
    const container = document.createElement('div');
    container.className = 'cm-horizontal-rule-container';

    const hr = document.createElement('hr');
    hr.className = 'cm-horizontal-rule';

    container.appendChild(hr);

    // 点击定位光标
    container.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.originalFrom, head: this.originalFrom },
        scrollIntoView: true,
      });
      view.focus();
    });

    return container;
  }

  eq() {
    return true;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
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

    // 单击: 定位光标到公式开始位置（触发显示源码）
    container.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Avoid coordinate-based cursor drift for math widgets
      setCursorPosition(view, this.from);
      view.focus();
    });

    // 双击: 打开MathLive可视化编辑器
    container.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // 获取容器位置
      const rect = container.getBoundingClientRect();

      // 派发自定义事件打开MathEditor
      view.dom.dispatchEvent(
        new CustomEvent('open-math-editor', {
          detail: {
            latex: this.latex,
            isBlock: this.isBlock,
            from: this.from,
            to: this.to,
            position: {
              top: rect.bottom + window.scrollY,
              left: rect.left + window.scrollX,
            },
          },
          bubbles: true,
        })
      );
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
      }
    } else {
      // KaTeX未加载，显示原始LaTeX作为占位符
      container.textContent = this.isBlock ? `$$${this.latex}$$` : `$${this.latex}$`;
      container.classList.add('cm-math-loading');

      // 等待KaTeX加载后渲染（带超时保护）
      const latexStr = this.latex;
      const isBlock = this.isBlock;
      const timeoutMs = 8000;

      const loadWithTimeout = Promise.race([
        loadKaTeX(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('KaTeX load timeout')), timeoutMs)
        ),
      ]);

      loadWithTimeout
        .then((k) => {
          try {
            container.innerHTML = '';
            k.render(latexStr, container, getKaTeXOptions(isBlock));
            container.classList.remove('cm-math-loading');
          } catch {
            // Render failed — show raw source
            container.innerHTML = '';
            container.textContent = isBlock ? `$$${latexStr}$$` : `$${latexStr}$`;
            container.classList.remove('cm-math-loading');
            container.classList.add('cm-math-error');
          }
        })
        .catch((err) => {
          logger.warn('[KaTeX] Failed to load or render:', err);
          // Keep raw LaTeX visible as fallback
          container.classList.remove('cm-math-loading');
          container.classList.add('cm-math-error');
        });
    }

    return container;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown' && e.type !== 'dblclick' && e.type !== 'contextmenu';
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
    private context?: BlockContext
  ) {
    super();
  }

  eq(other: CodeBlockWidget) {
    return (
      other.code === this.code &&
      other.language === this.language &&
      other.showLineNumbers === this.showLineNumbers
    );
  }

  toDOM(_view: EditorView) {
    const container = document.createElement('div');
    container.className = 'cm-code-block-widget';
    container.dataset.from = String(this.from);
    container.dataset.to = String(this.to);
    applyBlockContext(container, this.context);

    // Let CodeMirror handle cursor positioning naturally - no custom mousedown handlers

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
        .catch(() => {
          // 加载失败，保持纯文本
        });
    }

    pre.appendChild(code);
    codeWrapper.appendChild(pre);
    container.appendChild(codeWrapper);

    return container;
  }

  ignoreEvent(_event: Event) {
    // Don't intercept events - let CodeMirror handle cursor positioning
    // (Copy button still works through normal event propagation)
    return false;
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

  // Protect escaped markdown symbols so they won't be parsed
  const escapeMap = new Map<string, string>();
  let escapeIndex = 0;
  result = result.replace(/\\([\\`*_[\]{}()#+\-.!|$])/g, (_, ch: string) => {
    const token = `@@ESC_${escapeIndex++}@@`;
    escapeMap.set(token, ch);
    return token;
  });

  // Protect inline code spans so they won't be parsed by other rules
  const codeSpans: string[] = [];
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const storeCodeSpan = (code: string) => {
    const token = `@@CODE_${codeSpans.length}@@`;
    codeSpans.push(escapeHtml(code));
    return token;
  };

  result = result.replace(/``([^`]+?)``/g, (_, code: string) => storeCodeSpan(code));
  result = result.replace(/(?<!`)`(?!`)([^`]+)`(?!`)/g, (_, code: string) => storeCodeSpan(code));

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

  // 行内公式: $formula$ (如果KaTeX可用则渲染)
  result = result.replace(/\$([^$\n]+)\$/g, (match, formula) => {
    try {
      if (katex) {
        return katex.renderToString(formula, getKaTeXOptions(false));
      }
      // 回退：显示公式在样式化的span中
      return `<span class="cm-math-inline-table">$${formula}$</span>`;
    } catch {
      return `<span class="cm-math-inline-table">$${formula}$</span>`;
    }
  });

  // 行内公式: \(formula\)
  result = result.replace(/\\\((.+?)\\\)/g, (match, formula) => {
    try {
      if (katex) {
        return katex.renderToString(formula, getKaTeXOptions(false));
      }
      return `<span class="cm-math-inline-table">\\(${formula}\\)</span>`;
    } catch {
      return `<span class="cm-math-inline-table">\\(${formula}\\)</span>`;
    }
  });

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
      result = result.replace(new RegExp(`@@CODE_${index}@@`, 'g'), `<code>${code}</code>`);
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
      other.referenceSignature === this.referenceSignature
    );
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-table-widget-wrapper';
    wrapper.dataset.from = String(this.from);
    wrapper.dataset.to = String(this.to);
    applyBlockContext(wrapper, this.context);

    const table = document.createElement('table');
    table.className = 'cm-table-widget';
    table.dataset.from = String(this.from);
    table.dataset.to = String(this.to);

    // 点击定位光标到表格开始
    wrapper.addEventListener('mousedown', (e) => {
      // 不拦截wiki链接和普通链接点击
      if ((e.target as HTMLElement).classList.contains('cm-wiki-link-table')) return;
      if ((e.target as HTMLElement).classList.contains('cm-link-table')) return;

      handleWidgetClick(view, wrapper, e, this.from, this.to);
    });

    // 计算列宽（基于内容）
    const colCount = this.rows.length > 0 ? Math.max(1, ...this.rows.map(r => r.length)) : 1;
    const colWidths: number[] = new Array(colCount).fill(0);

    const getDisplayTextForWidth = (cell: string) => {
      let text = cell;

      // Links & images
      text = text.replace(/!\[([^\]]*?)\]\([^)]+\)/g, '$1');
      text = text.replace(/\[([^\]]+?)\]\([^)]+\)/g, '$1');
      text = text.replace(/\[([^\]]+?)\]\s*\[[^\]]*\]/g, '$1');
      text = text.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target, alias) => alias || target);

      // Inline code
      text = text.replace(/``([^`]+?)``/g, '$1');
      text = text.replace(/`([^`]+?)`/g, '$1');

      // Inline math delimiters
      text = text.replace(/\$([^$\n]+)\$/g, '$1');
      text = text.replace(/\\\((.+?)\\\)/g, '$1');

      // Formatting markers
      text = text.replace(/(\*\*|__|~~|==|\*|_)/g, '');

      // Escaped pipes
      text = text.replace(/\\\|/g, '|');

      return text.trim();
    };

    // 测量每列的最大内容宽度
    this.rows.forEach((row, rowIndex) => {
      // 跳过分隔行
      if (rowIndex === 1 && this.hasHeader && row.every(c => /^[-:]+$/.test(c.trim()))) {
        return;
      }
      row.forEach((cell, colIndex) => {
        // 使用纯文本长度计算宽度
        const plainText = getDisplayTextForWidth(cell);
        const cellLen = plainText.length;
        colWidths[colIndex] = Math.max(colWidths[colIndex], cellLen);
      });
    });

    // 创建colgroup设置列宽
    const colgroup = document.createElement('colgroup');
    const totalWidth = colWidths.reduce((a, b) => a + b, 0);
    const minPercentage = Math.min(10, 100 / colCount);
    colWidths.forEach(width => {
      const col = document.createElement('col');
      // 设置比例宽度（最小10%）
      const percentage = totalWidth > 0
        ? Math.max(minPercentage, (width / totalWidth) * 100)
        : 100 / colCount;
      col.style.width = `${percentage}%`;
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);

    this.rows.forEach((row, rowIndex) => {
      // 跳过分隔行
      if (rowIndex === 1 && this.hasHeader && row.every(c => /^[-:]+$/.test(c.trim()))) {
        return;
      }

      const tr = document.createElement('tr');

      for (let colIndex = 0; colIndex < colCount; colIndex++) {
        const cell = row[colIndex] ?? '';
        const cellEl = document.createElement(
          this.hasHeader && rowIndex === 0 ? 'th' : 'td'
        );
        const alignment = this.alignments[colIndex];
        if (alignment) {
          cellEl.style.textAlign = alignment;
        }
        // 解析并渲染单元格中的行内Markdown
        const cellContent = cell.trim();
        cellEl.innerHTML = sanitizeInlineHtml(parseInlineMarkdown(cellContent, this.referenceDefs));
        tr.appendChild(cellEl);
      }

      table.appendChild(tr);
    });

    // 为表格中的wiki链接添加点击处理
    table.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('cm-wiki-link-table')) {
        e.preventDefault();
        e.stopPropagation();
        const linkTarget = target.dataset.target;
        if (linkTarget) {
          // 分发wiki链接点击事件
          table.dispatchEvent(new CustomEvent('wiki-link-click', {
            detail: { target: linkTarget },
            bubbles: true,
          }));
        }
      }
    });

    wrapper.appendChild(table);
    return wrapper;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

