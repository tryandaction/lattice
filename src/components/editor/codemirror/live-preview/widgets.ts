/**
 * Live Preview Widgets - 统一的Widget库
 *
 * 从inline-decoration-plugin和block-decoration-plugin提取所有Widget类，统一管理。
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
 */

import { EditorView, WidgetType } from '@codemirror/view';

// ============================================================================
// KaTeX动态加载
// ============================================================================

let katex: any = null;
let katexLoadPromise: Promise<any> | null = null;

/**
 * 动态加载KaTeX
 */
async function loadKaTeX(): Promise<any> {
  if (katex) return katex;

  if (katexLoadPromise) return katexLoadPromise;

  katexLoadPromise = import('katex')
    .then((module) => {
      katex = module.default || module;
      return katex;
    })
    .catch((err) => {
      console.error('Failed to load KaTeX:', err);
      throw err;
    });

  return katexLoadPromise;
}

// 预加载KaTeX
if (typeof window !== 'undefined') {
  loadKaTeX();
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
    private elementTo: number
  ) {
    super();
  }

  eq(other: FormattedTextWidget) {
    return (
      other.content === this.content &&
      other.className === this.className &&
      other.contentFrom === this.contentFrom
    );
  }

  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = `${this.className} cm-formatted-widget cm-syntax-transition`;
    span.textContent = this.content;

    // 存储位置信息用于调试
    span.dataset.contentFrom = String(this.contentFrom);
    span.dataset.contentTo = String(this.contentTo);
    span.dataset.elementFrom = String(this.elementFrom);
    span.dataset.elementTo = String(this.elementTo);

    // 处理点击 - 精确光标定位
    span.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // 计算点击位置对应的字符偏移
      const rect = span.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const textWidth = rect.width;
      const textLength = this.content.length;

      let charOffset = 0;
      if (textWidth > 0 && textLength > 0) {
        const avgCharWidth = textWidth / textLength;
        charOffset = Math.round(clickX / avgCharWidth);
        charOffset = Math.max(0, Math.min(charOffset, textLength));
      }

      // 定位光标到内容区域
      const pos = this.contentFrom + charOffset;
      view.dispatch({
        selection: { anchor: pos, head: pos },
        scrollIntoView: true,
      });
      view.focus();
    });

    return span;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

// ============================================================================
// 2. LinkWidget - 链接
// ============================================================================

/**
 * 链接Widget - 支持Markdown链接和Wiki链接
 *
 * 交互:
 * - 单击: 定位光标到链接文本
 * - Ctrl+Click: 在新标签页打开链接
 * - 双击: 打开链接（兼容性）
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
    link.textContent = this.text;
    link.href = this.isWikiLink ? '#' : this.url;
    link.title = this.isWikiLink
      ? `${this.url} (Ctrl+Click or double-click to open)`
      : `${this.url} (Ctrl+Click to open)`;

    // 存储位置
    link.dataset.contentFrom = String(this.contentFrom);
    link.dataset.contentTo = String(this.contentTo);
    link.dataset.elementFrom = String(this.elementFrom);
    link.dataset.elementTo = String(this.elementTo);

    // 双击检测
    let lastClickTime = 0;
    const DOUBLE_CLICK_THRESHOLD = 300;

    // 导航到链接
    const navigateToLink = () => {
      if (this.isWikiLink) {
        view.dom.dispatchEvent(
          new CustomEvent('wiki-link-click', {
            detail: { target: this.url },
            bubbles: true,
          })
        );
      } else {
        window.open(this.url, '_blank', 'noopener,noreferrer');
      }
    };

    // 定位光标
    const positionCursor = (e: MouseEvent) => {
      const rect = link.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const textWidth = rect.width;
      const textLength = this.text.length;

      let charOffset = 0;
      if (textWidth > 0 && textLength > 0) {
        const avgCharWidth = textWidth / textLength;
        charOffset = Math.round(clickX / avgCharWidth);
        charOffset = Math.max(0, Math.min(charOffset, textLength));
      }

      const pos = this.contentFrom + charOffset;
      view.dispatch({
        selection: { anchor: pos, head: pos },
        scrollIntoView: true,
      });
      view.focus();
    };

    // 处理点击
    link.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const now = Date.now();
      const isDoubleClick = now - lastClickTime < DOUBLE_CLICK_THRESHOLD;
      lastClickTime = now;

      if (e.ctrlKey || e.metaKey || isDoubleClick) {
        navigateToLink();
      } else {
        positionCursor(e);
      }
    });

    // 双击事件（兼容）
    link.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigateToLink();
    });

    return link;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown' && e.type !== 'dblclick';
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
    link.title = `批注: ${this.filePath}#${this.annotationId}`;

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
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        view.dom.dispatchEvent(
          new CustomEvent('annotation-link-click', {
            detail: {
              filePath: this.filePath,
              annotationId: this.annotationId,
            },
            bubbles: true,
          })
        );
      } else {
        e.preventDefault();
        e.stopPropagation();

        const rect = link.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const textWidth = rect.width;
        const textLength = this.displayText.length;

        let charOffset = 0;
        if (textWidth > 0 && textLength > 0) {
          const avgCharWidth = textWidth / textLength;
          charOffset = Math.round(clickX / avgCharWidth);
          charOffset = Math.max(0, Math.min(charOffset, textLength));
        }

        const pos = this.contentFrom + charOffset;
        view.dispatch({
          selection: { anchor: pos, head: pos },
          scrollIntoView: true,
        });
        view.focus();
      }
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
      e.preventDefault();
      e.stopPropagation();
      const pos = this.contentFrom;
      view.dispatch({
        selection: { anchor: pos, head: pos },
        scrollIntoView: true,
      });
      view.focus();
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
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.contentFrom, head: this.contentFrom },
        scrollIntoView: true,
      });
      view.focus();
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
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.contentFrom, head: this.contentFrom },
        scrollIntoView: true,
      });
      view.focus();
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
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.contentFrom, head: this.contentFrom },
        scrollIntoView: true,
      });
      view.focus();
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
        e.preventDefault();
        e.stopPropagation();
        view.dispatch({
          selection: { anchor: this.contentFrom, head: this.contentFrom },
          scrollIntoView: true,
        });
        view.focus();
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
// 9. EmbedWidget - 嵌入内容
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
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.contentFrom, head: this.contentFrom },
        scrollIntoView: true,
      });
      view.focus();
    });

    return container;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

// ============================================================================
// 10. HeadingContentWidget - 标题内容
// ============================================================================

// KaTeX for inline math in headings
let katexForHeading: any = null;
import('katex')
  .then((mod) => {
    katexForHeading = mod.default || mod;
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

  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = `cm-heading-content cm-heading-${this.level}-content`;
    span.dataset.from = String(this.originalFrom);
    span.dataset.to = String(this.originalTo);

    // 渲染内容（支持行内公式）
    this.renderContentWithMath(span);

    // 点击定位光标
    span.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // 定位到标题内容开始位置
      view.dispatch({
        selection: { anchor: this.originalFrom, head: this.originalFrom },
        scrollIntoView: true,
      });
      view.focus();
    });

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
            katexForHeading.render(latex, mathSpan, {
              displayMode: false,
              throwOnError: false,
              errorColor: '#ef4444',
              trust: true,
            });
          } catch {
            mathSpan.textContent = part;
          }
        } else {
          mathSpan.textContent = part;
          // 等待KaTeX加载
          import('katex')
            .then((mod) => {
              const k = mod.default || mod;
              katexForHeading = k;
              try {
                mathSpan.innerHTML = '';
                k.render(latex, mathSpan, {
                  displayMode: false,
                  throwOnError: false,
                  errorColor: '#ef4444',
                  trust: true,
                });
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

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
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

  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'cm-blockquote-content';
    span.textContent = this.content;
    span.dataset.from = String(this.originalFrom);
    span.dataset.to = String(this.originalTo);

    // 点击定位光标（精确到字符）
    span.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const rect = span.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const textWidth = rect.width;
      const textLength = this.content.length;

      let charOffset = Math.round((clickX / textWidth) * textLength);
      charOffset = Math.max(0, Math.min(charOffset, textLength));

      const pos = this.originalFrom + charOffset;

      view.dispatch({
        selection: { anchor: pos, head: pos },
        scrollIntoView: true,
      });
      view.focus();
    });

    return span;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
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
    // 容器确保全宽
    const container = document.createElement('div');
    container.className = 'cm-horizontal-rule-container';
    container.style.width = '100%';
    container.style.padding = '1em 0';
    container.style.cursor = 'pointer';

    const hr = document.createElement('hr');
    hr.className = 'cm-horizontal-rule';
    hr.style.border = 'none';
    hr.style.borderTop = '2px solid var(--border, #e5e7eb)';
    hr.style.margin = '0';
    hr.style.width = '100%';

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
    private to: number
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
    container.title = `${this.isBlock ? 'Block' : 'Inline'} formula: Click to edit, Right-click to copy LaTeX`;

    // 单击: 定位光标到公式开始位置（触发显示源码）
    container.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.from, head: this.from },
        scrollIntoView: true,
      });
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
    container.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const latexSource = this.isBlock ? `$$${this.latex}$$` : `$${this.latex}$`;

      try {
        await navigator.clipboard.writeText(latexSource);

        // 视觉反馈
        const originalTitle = container.title;
        container.title = '✓ LaTeX copied to clipboard!';
        container.style.backgroundColor = 'rgba(34, 197, 94, 0.1)'; // 绿色提示

        setTimeout(() => {
          container.title = originalTitle;
          container.style.backgroundColor = '';
        }, 1500);
      } catch (err) {
        console.error('Failed to copy LaTeX:', err);
        container.title = '✗ Failed to copy';
        setTimeout(() => {
          container.title = `${this.isBlock ? 'Block' : 'Inline'} formula: Click to edit, Right-click to copy LaTeX`;
        }, 1500);
      }
    });

    // 渲染公式
    if (katex) {
      try {
        katex.render(this.latex, container, {
          displayMode: this.isBlock,
          throwOnError: false,
          errorColor: '#ef4444',
          trust: true,
        });
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
      // KaTeX未加载，显示占位符
      container.textContent = this.isBlock ? `$$${this.latex}$$` : `$${this.latex}$`;
      container.classList.add('cm-math-loading');

      // 等待KaTeX加载后渲染
      loadKaTeX()
        .then((k) => {
          try {
            container.innerHTML = '';
            k.render(this.latex, container, {
              displayMode: this.isBlock,
              throwOnError: false,
              errorColor: '#ef4444',
              trust: true,
            });
            container.classList.remove('cm-math-loading');
          } catch {
            container.classList.add('cm-math-error');
          }
        })
        .catch(() => {
          container.classList.add('cm-math-error');
        });
    }

    return container;
  }

  ignoreEvent(e: Event) {
    return e.type !== 'mousedown' && e.type !== 'dblclick' && e.type !== 'contextmenu';
  }
}
