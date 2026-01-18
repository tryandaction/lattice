/**
 * Decoration Coordinator - 装饰器统一协调系统
 *
 * 解决当前7个插件独立重建装饰器导致的性能问题和冲突。
 *
 * ## 核心问题
 * 1. **装饰器冲突**: 多个插件处理同一位置（标题内的粗体、表格内的公式）
 * 2. **性能瓶颈**:
 *    - block-decoration全文档扫描 (O(n))
 *    - 每次光标移动触发7个插件重建
 *    - 每行执行15个正则表达式
 * 3. **缺乏协调**: 插件之间不知道彼此的装饰器
 *
 * ## 新架构
 *
 * ```
 * 单次文档遍历
 *     ↓
 * 解析所有元素 (块级 + 行内 + 公式)
 *     ↓
 * 冲突解决 (按优先级过滤)
 *     ↓
 * 构建装饰器集合
 *     ↓
 * 返回 DecorationSet
 * ```
 *
 * ## 优先级规则
 * 1. 代码块 (最高) - 内部不处理其他语法
 * 2. 数学公式 - 内部不处理其他语法
 * 3. 表格 - 内部可以有行内元素
 * 4. Callout/Details - 内部可以有行内元素
 * 5. 块级元素 (标题、引用、列表) - 内部可以有行内元素
 * 6. 行内元素 (粗体、链接等) - 最低优先级
 */

import { EditorView, ViewUpdate, ViewPlugin, DecorationSet, Decoration } from '@codemirror/view';
import { EditorState, RangeSet } from '@codemirror/state';
import { shouldRevealLine } from './cursor-context-plugin';
import {
  FormattedTextWidget,
  LinkWidget,
  AnnotationLinkWidget,
  ImageWidget,
  SuperscriptWidget,
  SubscriptWidget,
  KbdWidget,
  FootnoteRefWidget,
  EmbedWidget,
  HeadingContentWidget,
  BlockquoteContentWidget,
  ListBulletWidget,
  HorizontalRuleWidget,
  MathWidget,
} from './widgets';
import { parseListItem, parseBlockquote } from './markdown-parser';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 元素类型枚举 - 定义优先级顺序
 */
export enum ElementType {
  CODE_BLOCK = 1,      // 代码块 - 优先级最高
  MATH_BLOCK = 2,      // 数学公式
  MATH_INLINE = 3,     // 行内公式
  TABLE = 4,           // 表格
  CALLOUT = 5,         // Callout块
  DETAILS = 6,         // Details折叠块
  HEADING = 7,         // 标题
  BLOCKQUOTE = 8,      // 引用
  LIST_ITEM = 9,       // 列表
  HORIZONTAL_RULE = 10,// 横线
  INLINE_BOLD = 11,    // 粗体
  INLINE_ITALIC = 12,  // 斜体
  INLINE_CODE = 13,    // 行内代码
  INLINE_LINK = 14,    // 链接
  INLINE_IMAGE = 15,   // 图片
  INLINE_OTHER = 16,   // 其他行内元素
}

/**
 * 解析后的元素 - 统一的数据结构
 */
export interface ParsedElement {
  type: ElementType;
  from: number;           // 起始位置
  to: number;             // 结束位置
  lineNumber: number;     // 行号

  // 可选属性 - 根据元素类型使用
  content?: string;       // 元素内容
  level?: number;         // 标题级别 (1-6)
  language?: string;      // 代码块语言
  latex?: string;         // LaTeX公式
  isBlock?: boolean;      // 是否块级元素

  // 嵌套子元素 (用于表格、Callout等)
  children?: ParsedElement[];

  // 用于装饰器创建
  decorationData?: unknown;
}

/**
 * 装饰器条目 - 用于排序和去重
 */
interface DecorationEntry {
  from: number;
  to: number;
  decoration: Decoration;
  priority: number;       // 优先级 (ElementType值)
  isLine: boolean;        // 是否为行装饰
}

// ============================================================================
// LRU 缓存 - 行解析结果缓存
// ============================================================================

/**
 * 简单的LRU缓存实现
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;

    // Move to end (most recently used)
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    // Remove if exists (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Add to end
    this.cache.set(key, value);

    // Evict oldest if over capacity
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

// 全局缓存实例
const lineElementCache = new LRUCache<string, ParsedElement[]>(2000);

// ============================================================================
// 解析器 - 单次文档遍历
// ============================================================================

/**
 * 解析整个文档，返回所有元素
 *
 * 性能优化:
 * - 只遍历一次文档
 * - 行级缓存 (行内容 hash → 解析结果)
 * - 视口优化 (可选)
 */
function parseDocument(view: EditorView, viewportOnly: boolean = false): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const doc = view.state.doc;
  const visibleRanges = view.visibleRanges;

  // 决定处理范围
  const ranges = viewportOnly
    ? visibleRanges
    : [{ from: 0, to: doc.length }];

  for (const range of ranges) {
    const startLine = doc.lineAt(range.from);
    const endLine = doc.lineAt(range.to);

    for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
      const line = doc.line(lineNum);
      const lineText = line.text;

      // 尝试从缓存获取
      const cacheKey = `${lineNum}:${lineText}`;
      const cached = lineElementCache.get(cacheKey);

      if (cached) {
        elements.push(...cached);
        continue;
      }

      // 解析这一行
      const lineElements = parseLineElements(view.state, line, lineNum, lineText);

      // 存入缓存
      if (lineElements.length > 0) {
        lineElementCache.set(cacheKey, lineElements);
        elements.push(...lineElements);
      }
    }
  }

  return elements;
}

/**
 * 解析单行元素
 *
 * 按优先级检测:
 * 1. 代码块标记 ```
 * 2. 块级公式 $$
 * 3. 表格行 |
 * 4. 标题 #
 * 5. 引用 >
 * 6. 列表 -/*/+/1.
 * 7. 行内元素
 */
function parseLineElements(
  state: EditorState,
  line: { from: number; to: number; text: string },
  lineNum: number,
  lineText: string
): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const revealed = shouldRevealLine(state, lineNum);

  // 如果行被光标激活，跳过渲染
  if (revealed) {
    return elements;
  }

  // 检测代码块标记
  const codeBlockMatch = lineText.match(/^```(\w*)/);
  if (codeBlockMatch) {
    elements.push({
      type: ElementType.CODE_BLOCK,
      from: line.from,
      to: line.to,
      lineNumber: lineNum,
      language: codeBlockMatch[1] || '',
      content: lineText,
    });
    return elements; // 代码块标记行不再处理其他元素
  }

  // 检测块级公式
  const blockMathMatch = lineText.match(/^\$\$/);
  if (blockMathMatch) {
    elements.push({
      type: ElementType.MATH_BLOCK,
      from: line.from,
      to: line.to,
      lineNumber: lineNum,
      content: lineText,
    });
    return elements;
  }

  // 检测标题
  const headingMatch = lineText.match(/^(#{1,6})\s+(.*)$/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const content = headingMatch[2];
    const markerEnd = line.from + headingMatch[1].length + 1; // +1 for space

    // 1. 行装饰器（样式）
    elements.push({
      type: ElementType.HEADING,
      from: line.from,
      to: line.from, // 行装饰器是点装饰
      lineNumber: lineNum,
      level: level,
      content: content,
      decorationData: {
        isLineStyle: true,
        level: level,
      },
    });

    // 2. Widget替换（隐藏#标记）
    if (content) {
      elements.push({
        type: ElementType.HEADING,
        from: line.from,
        to: line.to,
        lineNumber: lineNum,
        level: level,
        content: content,
        decorationData: {
          isWidget: true,
          content: content,
          level: level,
          markerEnd: markerEnd,
          originalFrom: line.from,
          originalTo: line.to,
        },
      });
    }
    // 标题内可能有行内元素，继续解析
  }

  // 检测引用（使用parseBlockquote）
  const blockquote = parseBlockquote(lineText, line.from);
  if (blockquote) {
    const content = lineText.slice(blockquote.markerTo - line.from);

    // 1. 行装饰器
    elements.push({
      type: ElementType.BLOCKQUOTE,
      from: line.from,
      to: line.from,
      lineNumber: lineNum,
      content: content,
      decorationData: {
        isLineStyle: true,
      },
    });

    // 2. Widget替换
    if (content) {
      elements.push({
        type: ElementType.BLOCKQUOTE,
        from: line.from,
        to: line.to,
        lineNumber: lineNum,
        content: content,
        decorationData: {
          isWidget: true,
          content: content,
          markerTo: blockquote.markerTo,
          originalFrom: line.from,
          originalTo: line.to,
        },
      });
    }
  }

  // 检测列表（使用parseListItem）
  const listItem = parseListItem(lineText, line.from);
  if (listItem) {
    // 1. 行装饰器
    elements.push({
      type: ElementType.LIST_ITEM,
      from: line.from,
      to: line.from,
      lineNumber: lineNum,
      content: lineText.slice(listItem.markerTo - line.from),
      decorationData: {
        isLineStyle: true,
        type: listItem.type,
        indent: listItem.indent,
      },
    });

    // 2. Widget替换标记
    elements.push({
      type: ElementType.LIST_ITEM,
      from: listItem.markerFrom,
      to: listItem.markerTo,
      lineNumber: lineNum,
      content: lineText.slice(listItem.markerTo - line.from),
      decorationData: {
        isWidget: true,
        type: listItem.type,
        marker: listItem.marker,
        checked: listItem.checked,
        markerFrom: listItem.markerFrom,
        markerTo: listItem.markerTo,
        lineFrom: line.from,
      },
    });
  }

  // 检测横线
  if (/^([-*_])\1{2,}\s*$/.test(lineText)) {
    elements.push({
      type: ElementType.HORIZONTAL_RULE,
      from: line.from,
      to: line.to,
      lineNumber: lineNum,
      decorationData: {
        originalFrom: line.from,
        originalTo: line.to,
      },
    });
    return elements;
  }

  // 解析行内元素 (公式、粗体、链接等)
  const inlineElements = parseInlineElements(lineText, line.from, lineNum);
  elements.push(...inlineElements);

  return elements;
}

/**
 * 解析行内元素
 *
 * 完整支持15种行内Markdown元素:
 * 1. 行内公式 $...$
 * 2. 粗体+斜体 ***...***
 * 3. 粗体 **...**
 * 4. 斜体 *...* 或 _..._
 * 5. 删除线 ~~...~~
 * 6. 高亮 ==...==
 * 7. 行内代码 `...`
 * 8. 链接 [text](url)
 * 9. Wiki链接 [[page]]
 * 10. 批注链接 [[file.pdf#ann-uuid]]
 * 11. 图片 ![alt](url)
 * 12. 上标 ^text^
 * 13. 下标 ~text~
 * 14. 键盘按键 <kbd>text</kbd>
 * 15. 脚注引用 [^1]
 * 16. 嵌入 ![[file]]
 */
function parseInlineElements(
  lineText: string,
  lineFrom: number,
  lineNum: number
): ParsedElement[] {
  const elements: ParsedElement[] = [];
  let match: RegExpExecArray | null;

  // 1. 行内公式: $...$
  const inlineMathRegex = /(?<!\$)\$(?!\$)(.+?)\$(?!\$)/g;
  while ((match = inlineMathRegex.exec(lineText)) !== null) {
    const latex = match[1];
    if (latex.includes('\n')) continue; // 块级公式用$$

    elements.push({
      type: ElementType.MATH_INLINE,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      latex: latex,
      isBlock: false,
      decorationData: {
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 1, // 跳过 $
        contentTo: lineFrom + match.index + match[0].length - 1, // 不含 $
      },
    });
  }

  // 2. 粗体+斜体: ***...***
  const boldItalicRegex = /\*\*\*([^*]+?)\*\*\*/g;
  while ((match = boldItalicRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_OTHER,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
      decorationData: {
        className: 'cm-strong cm-em',
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 3,
        contentTo: lineFrom + match.index + match[0].length - 3,
      },
    });
  }

  // 3. 粗体: **...**
  const boldRegex = /\*\*([^*]+?)\*\*/g;
  while ((match = boldRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_BOLD,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
      decorationData: {
        className: 'cm-strong',
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 2,
        contentTo: lineFrom + match.index + match[0].length - 2,
      },
    });
  }

  // 4. 斜体: *...* 或 _..._
  const italicRegex = /(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)|(?<!_)_(?!_)([^_]+?)_(?!_)/g;
  while ((match = italicRegex.exec(lineText)) !== null) {
    const content = match[1] || match[2];
    elements.push({
      type: ElementType.INLINE_ITALIC,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: content,
      decorationData: {
        className: 'cm-em',
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 1,
        contentTo: lineFrom + match.index + match[0].length - 1,
      },
    });
  }

  // 5. 删除线: ~~...~~
  const strikeRegex = /~~([^~]+?)~~/g;
  while ((match = strikeRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_OTHER,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
      decorationData: {
        className: 'cm-strikethrough',
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 2,
        contentTo: lineFrom + match.index + match[0].length - 2,
      },
    });
  }

  // 6. 高亮: ==...==
  const highlightRegex = /==([^=]+?)==/g;
  while ((match = highlightRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_OTHER,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
      decorationData: {
        className: 'cm-highlight',
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 2,
        contentTo: lineFrom + match.index + match[0].length - 2,
      },
    });
  }

  // 7. 行内代码: `...`
  const codeRegex = /`([^`]+?)`/g;
  while ((match = codeRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_CODE,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
      decorationData: {
        className: 'cm-inline-code',
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 1,
        contentTo: lineFrom + match.index + match[0].length - 1,
      },
    });
  }

  // 8. 批注链接: [[file.pdf#ann-uuid]]
  const annotationLinkRegex = /\[\[([^\]]+?\.pdf)#(ann-[^\]]+?)\]\]/gi;
  while ((match = annotationLinkRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_OTHER,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
      decorationData: {
        type: 'annotation-link',
        filePath: match[1],
        annotationId: match[2],
        displayText: match[1],
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 2,
        contentTo: lineFrom + match.index + match[0].length - 2,
      },
    });
  }

  // 9. Wiki链接: [[page]] or [[page|display]]
  const wikiLinkRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
  while ((match = wikiLinkRegex.exec(lineText)) !== null) {
    const target = match[1];
    const displayText = match[2] || match[1];

    elements.push({
      type: ElementType.INLINE_LINK,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: displayText,
      decorationData: {
        type: 'wiki-link',
        url: target,
        isWikiLink: true,
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 2,
        contentTo: lineFrom + match.index + match[0].length - 2,
      },
    });
  }

  // 10. Markdown链接: [text](url)
  const linkRegex = /\[([^\]]+?)\]\(([^)]+?)\)/g;
  while ((match = linkRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_LINK,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
      decorationData: {
        type: 'link',
        url: match[2],
        isWikiLink: false,
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 1,
        contentTo: lineFrom + match.index + 1 + match[1].length,
      },
    });
  }

  // 11. 嵌入: ![[file]]
  const embedRegex = /!\[\[([^\]]+?)\]\]/g;
  while ((match = embedRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_OTHER,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
      decorationData: {
        type: 'embed',
        target: match[1],
        displayText: match[1],
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 3,
        contentTo: lineFrom + match.index + match[0].length - 2,
      },
    });
  }

  // 12. 图片: ![alt](url) or ![alt|width](url)
  const imageRegex = /!\[([^\]]*?)(?:\|(\d+))?\]\(([^)]+?)\)/g;
  while ((match = imageRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_IMAGE,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
      decorationData: {
        type: 'image',
        url: match[3],
        alt: match[1],
        width: match[2] ? parseInt(match[2]) : undefined,
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 2,
        contentTo: lineFrom + match.index + 2 + match[1].length,
      },
    });
  }

  // 13. 上标: ^text^
  const superscriptRegex = /\^([^^]+?)\^/g;
  while ((match = superscriptRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_OTHER,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
      decorationData: {
        type: 'superscript',
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 1,
        contentTo: lineFrom + match.index + match[0].length - 1,
      },
    });
  }

  // 14. 下标: ~text~
  const subscriptRegex = /~([^~]+?)~/g;
  while ((match = subscriptRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_OTHER,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
      decorationData: {
        type: 'subscript',
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 1,
        contentTo: lineFrom + match.index + match[0].length - 1,
      },
    });
  }

  // 15. 键盘按键: <kbd>text</kbd>
  const kbdRegex = /<kbd>([^<]+?)<\/kbd>/g;
  while ((match = kbdRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_OTHER,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
      decorationData: {
        type: 'kbd',
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 5,
        contentTo: lineFrom + match.index + match[0].length - 6,
      },
    });
  }

  // 16. 脚注引用: [^1]
  const footnoteRegex = /\[\^([^\]]+?)\]/g;
  while ((match = footnoteRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_OTHER,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
      decorationData: {
        type: 'footnote-ref',
        identifier: match[1],
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 2,
        contentTo: lineFrom + match.index + match[0].length - 1,
      },
    });
  }

  return elements;
}

// ============================================================================
// 冲突解决 - 按优先级过滤重叠元素
// ============================================================================

/**
 * 解决元素冲突 - 移除被高优先级元素覆盖的低优先级元素
 *
 * 规则:
 * 1. 如果两个元素位置重叠，保留优先级高的
 * 2. 如果元素是父子关系（如标题包含粗体），都保留
 * 3. 按位置排序确保正确处理
 */
export function resolveConflicts(elements: ParsedElement[]): ParsedElement[] {
  if (elements.length === 0) return elements;

  // 按优先级排序 (低到高，这样后面的会覆盖前面的)
  const sorted = [...elements].sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    if (a.to !== b.to) return b.to - a.to; // 长的在前
    return a.type - b.type; // 优先级高的在前
  });

  const result: ParsedElement[] = [];
  const covered: boolean[] = new Array(sorted.length).fill(false);

  // 检测覆盖关系
  for (let i = 0; i < sorted.length; i++) {
    if (covered[i]) continue;

    const current = sorted[i];
    let shouldKeep = true;

    // 检查是否被其他元素覆盖
    for (let j = 0; j < sorted.length; j++) {
      if (i === j || covered[j]) continue;

      const other = sorted[j];

      // 检查位置重叠
      const overlaps = (
        (current.from >= other.from && current.from < other.to) ||
        (current.to > other.from && current.to <= other.to) ||
        (current.from <= other.from && current.to >= other.to)
      );

      if (overlaps) {
        // 如果other优先级更高，current被覆盖
        if (other.type < current.type) {
          shouldKeep = false;
          covered[i] = true;
          break;
        }
        // 如果current优先级更高，标记other为被覆盖
        else if (current.type < other.type) {
          covered[j] = true;
        }
      }
    }

    if (shouldKeep) {
      result.push(current);
    }
  }

  return result;
}

// ============================================================================
// 装饰器构建 - 从解析结果创建装饰器
// ============================================================================

/**
 * 从解析元素构建装饰器集合
 */
function buildDecorationsFromElements(elements: ParsedElement[]): DecorationSet {
  const entries: DecorationEntry[] = [];

  for (const element of elements) {
    const decoration = createDecorationForElement(element);
    if (decoration) {
      entries.push({
        from: element.from,
        to: element.to,
        decoration,
        priority: element.type,
        isLine: isLineDecoration(element), // 传递整个元素而非类型
      });
    }
  }

  // 排序装饰器条目
  entries.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    if (a.to !== b.to) return a.to - b.to;
    return a.priority - b.priority;
  });

  // 构建装饰器集合
  const ranges = entries.map(entry =>
    entry.isLine
      ? entry.decoration.range(entry.from)
      : entry.decoration.range(entry.from, entry.to)
  );

  return Decoration.set(ranges, true);
}

/**
 * 判断元素是否需要行装饰器（点装饰）
 */
function isLineDecoration(element: ParsedElement): boolean {
  const data = element.decorationData as any;

  // 检查isLineStyle标志
  if (data?.isLineStyle) {
    return true;
  }

  // 块级元素默认情况
  return (
    element.type === ElementType.CODE_BLOCK ||
    element.type === ElementType.MATH_BLOCK
  );
}

/**
 * 为单个元素创建装饰器
 *
 * 根据元素类型使用相应的Widget或Mark装饰器
 */
function createDecorationForElement(element: ParsedElement): Decoration | null {
  const data = element.decorationData as any;

  switch (element.type) {
    // ========================================================================
    // 块级元素 - 分为行装饰器和Widget替换
    // ========================================================================

    case ElementType.HEADING:
      if (data?.isLineStyle) {
        // 行装饰器（样式）
        return Decoration.line({
          class: `cm-heading cm-heading-${data.level}`,
        });
      } else if (data?.isWidget && data?.content && data?.markerEnd && data?.originalTo) {
        // Widget替换（隐藏#标记）
        return Decoration.replace({
          widget: new HeadingContentWidget(
            data.content,
            data.level || 1,
            data.markerEnd,
            data.originalTo
          ),
        });
      }
      return null;

    case ElementType.BLOCKQUOTE:
      if (data?.isLineStyle) {
        // 行装饰器
        return Decoration.line({
          class: 'cm-blockquote',
        });
      } else if (data?.isWidget && data?.content && data?.markerTo && data?.originalTo) {
        // Widget替换
        return Decoration.replace({
          widget: new BlockquoteContentWidget(
            data.content,
            data.markerTo,
            data.originalTo
          ),
        });
      }
      return null;

    case ElementType.LIST_ITEM:
      if (data?.isLineStyle) {
        // 行装饰器
        return Decoration.line({
          class: `cm-list-item cm-list-${data.type || 'bullet'}`,
          attributes: { 'data-indent': String(data.indent || 0) },
        });
      } else if (data?.isWidget && data?.type && data?.marker) {
        // Widget替换标记
        return Decoration.replace({
          widget: new ListBulletWidget(
            data.type,
            data.marker,
            data.checked,
            data.lineFrom
          ),
        });
      }
      return null;

    case ElementType.HORIZONTAL_RULE:
      if (data?.originalFrom !== undefined && data?.originalTo !== undefined) {
        return Decoration.replace({
          widget: new HorizontalRuleWidget(data.originalFrom, data.originalTo),
        });
      }
      return null;

    case ElementType.CODE_BLOCK:
      return Decoration.line({
        class: 'cm-code-block-line',
      });

    case ElementType.MATH_BLOCK:
      return Decoration.line({
        class: 'cm-math-block-line',
      });

    // ========================================================================
    // 行内元素 - 使用Widget替换
    // ========================================================================

    case ElementType.INLINE_BOLD:
      return Decoration.replace({
        widget: new FormattedTextWidget(
          element.content || '',
          data?.className || 'cm-strong',
          data?.contentFrom || element.from,
          data?.contentTo || element.to,
          data?.syntaxFrom || element.from,
          data?.syntaxTo || element.to
        ),
      });

    case ElementType.INLINE_ITALIC:
      return Decoration.replace({
        widget: new FormattedTextWidget(
          element.content || '',
          data?.className || 'cm-em',
          data?.contentFrom || element.from,
          data?.contentTo || element.to,
          data?.syntaxFrom || element.from,
          data?.syntaxTo || element.to
        ),
      });

    case ElementType.INLINE_CODE:
      return Decoration.replace({
        widget: new FormattedTextWidget(
          element.content || '',
          data?.className || 'cm-inline-code',
          data?.contentFrom || element.from,
          data?.contentTo || element.to,
          data?.syntaxFrom || element.from,
          data?.syntaxTo || element.to
        ),
      });

    case ElementType.INLINE_LINK:
      if (data?.isWikiLink) {
        return Decoration.replace({
          widget: new LinkWidget(
            element.content || '',
            data?.url || '',
            true, // isWikiLink
            data?.contentFrom || element.from,
            data?.contentTo || element.to,
            data?.syntaxFrom || element.from,
            data?.syntaxTo || element.to
          ),
        });
      } else {
        return Decoration.replace({
          widget: new LinkWidget(
            element.content || '',
            data?.url || '',
            false, // regular link
            data?.contentFrom || element.from,
            data?.contentTo || element.to,
            data?.syntaxFrom || element.from,
            data?.syntaxTo || element.to
          ),
        });
      }

    case ElementType.INLINE_IMAGE:
      return Decoration.replace({
        widget: new ImageWidget(
          data?.alt || element.content || '',
          data?.url || '',
          data?.width,
          data?.contentFrom || element.from,
          data?.contentTo || element.to,
          data?.syntaxFrom || element.from,
          data?.syntaxTo || element.to
        ),
      });

    case ElementType.INLINE_OTHER:
      // 根据decorationData的type字段分发到不同Widget
      if (!data?.type) {
        // 通用格式化文本（删除线、高亮等）
        return Decoration.replace({
          widget: new FormattedTextWidget(
            element.content || '',
            data?.className || '',
            data?.contentFrom || element.from,
            data?.contentTo || element.to,
            data?.syntaxFrom || element.from,
            data?.syntaxTo || element.to
          ),
        });
      }

      switch (data.type) {
        case 'annotation-link':
          return Decoration.replace({
            widget: new AnnotationLinkWidget(
              data.displayText || '',
              data.filePath || '',
              data.annotationId || '',
              data.contentFrom || element.from,
              data.contentTo || element.to,
              data.syntaxFrom || element.from,
              data.syntaxTo || element.to
            ),
          });

        case 'superscript':
          return Decoration.replace({
            widget: new SuperscriptWidget(
              element.content || '',
              data.contentFrom || element.from,
              data.contentTo || element.to,
              data.syntaxFrom || element.from,
              data.syntaxTo || element.to
            ),
          });

        case 'subscript':
          return Decoration.replace({
            widget: new SubscriptWidget(
              element.content || '',
              data.contentFrom || element.from,
              data.contentTo || element.to,
              data.syntaxFrom || element.from,
              data.syntaxTo || element.to
            ),
          });

        case 'kbd':
          return Decoration.replace({
            widget: new KbdWidget(
              element.content || '',
              data.contentFrom || element.from,
              data.contentTo || element.to,
              data.syntaxFrom || element.from,
              data.syntaxTo || element.to
            ),
          });

        case 'footnote-ref':
          return Decoration.replace({
            widget: new FootnoteRefWidget(
              data.identifier || element.content || '',
              data.contentFrom || element.from,
              data.contentTo || element.to,
              data.syntaxFrom || element.from,
              data.syntaxTo || element.to
            ),
          });

        case 'embed':
          return Decoration.replace({
            widget: new EmbedWidget(
              data.target || '',
              data.displayText || element.content || '',
              data.contentFrom || element.from,
              data.contentTo || element.to,
              data.syntaxFrom || element.from,
              data.syntaxTo || element.to
            ),
          });

        default:
          // 通用格式化文本
          return Decoration.replace({
            widget: new FormattedTextWidget(
              element.content || '',
              data.className || '',
              data.contentFrom || element.from,
              data.contentTo || element.to,
              data.syntaxFrom || element.from,
              data.syntaxTo || element.to
            ),
          });
      }

    // ========================================================================
    // 数学公式 - TODO: 需要集成KaTeX
    // ========================================================================

    case ElementType.MATH_INLINE:
      // 使用MathWidget渲染行内公式
      if (element.latex) {
        return Decoration.replace({
          widget: new MathWidget(
            element.latex,
            false, // isBlock
            element.from,
            element.to
          ),
        });
      }
      return null;

    case ElementType.MATH_BLOCK:
      // 使用MathWidget渲染块级公式
      if (element.latex) {
        return Decoration.replace({
          widget: new MathWidget(
            element.latex,
            true, // isBlock
            element.from,
            element.to
          ),
        });
      }
      return null;

    default:
      return null;
  }
}

// ============================================================================
// ViewPlugin - 统一装饰器管理
// ============================================================================

/**
 * 装饰协调器 ViewPlugin
 *
 * 替代所有现有的独立装饰器插件
 */
export const decorationCoordinatorPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      // 只在必要时重建
      if (update.docChanged || update.selectionSet) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    private buildDecorations(view: EditorView): DecorationSet {
      // 1. 解析文档
      const elements = parseDocument(view, false);

      // 2. 解决冲突
      const resolved = resolveConflicts(elements);

      // 3. 构建装饰器
      return buildDecorationsFromElements(resolved);
    }
  },
  {
    decorations: v => v.decorations,
  }
);

// ============================================================================
// 导出工具函数
// ============================================================================

/**
 * 清除缓存 - 用于调试和测试
 */
export function clearDecorationCache(): void {
  lineElementCache.clear();
}

/**
 * 获取缓存统计 - 用于性能监控
 */
export function getCacheStats(): { size: number; maxSize: number } {
  return {
    size: (lineElementCache as any).cache.size,
    maxSize: 2000,
  };
}
