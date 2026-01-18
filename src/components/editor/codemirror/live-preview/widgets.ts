/**
 * Live Preview Widgets - 统一的Widget库
 *
 * 从inline-decoration-plugin提取所有Widget类，统一管理。
 * 所有Widget都实现精确的光标定位和交互功能。
 *
 * Widget类型:
 * 1. FormattedTextWidget - 粗体、斜体、删除线、高亮、代码
 * 2. LinkWidget - 链接 [text](url)
 * 3. AnnotationLinkWidget - PDF批注链接 [[file.pdf#ann-uuid]]
 * 4. ImageWidget - 图片 ![alt](url)
 * 5. SuperscriptWidget - 上标 ^text^
 * 6. SubscriptWidget - 下标 ~text~
 * 7. KbdWidget - 键盘按键 <kbd>text</kbd>
 * 8. FootnoteRefWidget - 脚注引用 [^1]
 * 9. EmbedWidget - 嵌入内容 ![[file]]
 */

import { EditorView, WidgetType } from '@codemirror/view';

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
