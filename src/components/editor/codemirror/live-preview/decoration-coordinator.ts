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
import { EditorState, RangeSet, StateField, StateEffect } from '@codemirror/state';
import { shouldRevealLine, shouldRevealAt } from './cursor-context-plugin';
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
  BlockquoteContentWidget,
  ListBulletWidget,
  HorizontalRuleWidget,
  MathWidget,
  CodeBlockWidget,
  TableWidget,
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
  INLINE_TAG = 16,     // 标签 (#tag)
  INLINE_OTHER = 17,   // 其他行内元素
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

  // 代码块特有属性
  startLine?: number;     // 代码块起始行号
  endLine?: number;       // 代码块结束行号

  // 嵌套子元素 (用于表格、Callout等)
  children?: ParsedElement[];

  // 用于装饰器创建
  decorationData?: unknown;
}

/**
 * 代码块匹配结果
 */
interface CodeBlockMatch {
  from: number;
  to: number;
  language: string;
  code: string;
  startLine: number;
  endLine: number;
}

/**
 * 表格匹配结果
 */
interface TableMatch {
  from: number;
  to: number;
  rows: string[][];
  hasHeader: boolean;
  startLine: number;
  endLine: number;
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
      const firstKey = this.cache.keys().next().value as K;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

// 全局缓存实例
const lineElementCache = new LRUCache<string, ParsedElement[]>(2000);

// ============================================================================
// StateField - 存储解析后的元素供其他插件使用
// ============================================================================

/**
 * State effect to update parsed elements
 */
export const updateParsedElements = StateEffect.define<ParsedElement[]>();

/**
 * StateField to store parsed elements for cursor context plugin
 * This allows the cursor context plugin to determine which element the cursor is in
 */
export const parsedElementsField = StateField.define<ParsedElement[]>({
  create() {
    return [];
  },
  update(value, tr) {
    // Check for explicit update effect
    for (const effect of tr.effects) {
      if (effect.is(updateParsedElements)) {
        return effect.value;
      }
    }
    // Clear on document change (will be repopulated by decoration coordinator)
    if (tr.docChanged) {
      return [];
    }
    return value;
  },
});

// ============================================================================
// 预编译正则表达式 - 性能优化
// ============================================================================

/**
 * 预编译的正则表达式缓存
 * 避免每次解析时重新创建正则对象
 */
const REGEX_PATTERNS = {
  inlineMath: /(?<!\$)\$(?!\$)(.+?)\$(?!\$)/g,
  boldItalic: /\*\*\*([^*]+?)\*\*\*/g,
  bold: /\*\*([^*]+?)\*\*/g,
  italic: /(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)|(?<!_)_(?!_)([^_]+?)_(?!_)/g,
  strikethrough: /~~([^~]+?)~~/g,
  highlight: /==([^=]+?)==/g,
  inlineCode: /`([^`]+?)`/g,
  annotationLink: /\[\[([^\]]+?\.pdf)#(ann-[^\]]+?)\]\]/gi,
  wikiLink: /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
  link: /\[([^\]]+?)\]\(([^)]+?)\)/g,
  embed: /!\[\[([^\]]+?)\]\]/g,
  image: /!\[([^\]]*?)(?:\|(\d+))?\]\(([^)]+?)\)/g,
  superscript: /\^([^^]+?)\^/g,
  subscript: /~([^~]+?)~/g,
  kbd: /<kbd>([^<]+?)<\/kbd>/g,
  footnote: /\[\^([^\]]+?)\]/g,
  tag: /#([a-zA-Z][a-zA-Z0-9_/-]*)/g,
};

/**
 * 重置所有正则表达式的lastIndex
 * 必须在每次使用前调用，因为正则对象是有状态的
 */
function resetRegexPatterns(): void {
  Object.values(REGEX_PATTERNS).forEach(regex => {
    regex.lastIndex = 0;
  });
}

// ============================================================================
// 解析器 - 单次文档遍历
// ============================================================================

/**
 * 解析代码块 - 多行块级元素需要特殊处理
 *
 * 代码块格式:
 * ```language
 * code content
 * ```
 *
 * 性能优化：接收预先分割的lines数组，避免重复split
 */
function parseCodeBlocks(lines: string[]): CodeBlockMatch[] {
  const blocks: CodeBlockMatch[] = [];
  let offset = 0;
  let inBlock = false;
  let blockStart = 0;
  let blockLang = '';
  let blockCode: string[] = [];
  let blockStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    const lineEnd = offset + line.length;

    if (!inBlock && line.match(/^```(\w*)$/)) {
      // 代码块开始
      inBlock = true;
      blockStart = lineStart;
      blockLang = line.slice(3);
      blockCode = [];
      blockStartLine = i + 1; // 行号从1开始
    } else if (inBlock && line === '```') {
      // 代码块结束
      blocks.push({
        from: blockStart,
        to: lineEnd,
        language: blockLang,
        code: blockCode.join('\n'),
        startLine: blockStartLine,
        endLine: i + 1,
      });
      inBlock = false;
    } else if (inBlock) {
      blockCode.push(line);
    }

    offset = lineEnd + 1; // +1 for newline
  }

  return blocks;
}

/**
 * 解析表格 - 多行块级元素需要特殊处理
 *
 * 表格格式:
 * | Header 1 | Header 2 |
 * |----------|----------|
 * | Cell 1   | Cell 2   |
 *
 * 性能优化：接收预先分割的lines数组，避免重复split
 */
function parseTables(lines: string[]): TableMatch[] {
  const tables: TableMatch[] = [];
  let offset = 0;
  let tableStart = -1;
  let tableRows: string[][] = [];
  let hasHeader = false;
  let tableStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    const lineEnd = offset + line.length;

    // 检查是否为表格行
    const isTableRow = line.trim().startsWith('|') && line.trim().endsWith('|');
    const isSeparator = /^\|[-:| ]+\|$/.test(line.trim());

    if (isTableRow) {
      if (tableStart === -1) {
        tableStart = lineStart;
        tableRows = [];
        tableStartLine = i + 1; // 行号从1开始
      }

      // 解析单元格
      const cells = line
        .split('|')
        .slice(1, -1) // 移除首尾空元素
        .map(c => c.trim());

      tableRows.push(cells);

      // 检查表头分隔符
      if (isSeparator && tableRows.length === 2) {
        hasHeader = true;
      }
    } else if (tableStart !== -1) {
      // 表格结束
      if (tableRows.length >= 2) {
        tables.push({
          from: tableStart,
          to: offset - 1, // 上一行结束
          rows: tableRows,
          hasHeader,
          startLine: tableStartLine,
          endLine: i, // 当前行号（表格结束的下一行）
        });
      }
      tableStart = -1;
      tableRows = [];
      hasHeader = false;
    }

    offset = lineEnd + 1; // +1 for newline
  }

  // 处理文档末尾的表格
  if (tableStart !== -1 && tableRows.length >= 2) {
    tables.push({
      from: tableStart,
      to: offset - 1,
      rows: tableRows,
      hasHeader,
      startLine: tableStartLine,
      endLine: lines.length,
    });
  }

  return tables;
}

/**
 * 解析整个文档，返回所有元素
 *
 * 性能优化:
 * - 只遍历一次文档
 * - 只调用一次 toString() 和 split()
 * - 行级缓存 (行内容 hash → 解析结果)
 * - 视口优化 (可选)
 *
 * 新增: 先解析代码块和表格，然后逐行解析其他元素
 */
function parseDocument(view: EditorView, viewportOnly: boolean = false): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const doc = view.state.doc;
  const visibleRanges = view.visibleRanges;

  // 性能优化：只调用一次 toString() 和 split()
  const text = doc.toString();
  const lines = text.split('\n');

  // 用于标记已被块级元素占用的行
  const occupiedLines = new Set<number>();

  // 1. 先解析所有代码块（多行块级元素）
  const codeBlocks = parseCodeBlocks(lines);

  for (const block of codeBlocks) {
    // 检查代码块是否应该被reveal (element-level check)
    const shouldReveal = shouldRevealAt(
      view.state,
      block.from,
      block.to,
      ElementType.CODE_BLOCK
    );

    if (!shouldReveal) {
      // 添加代码块元素
      elements.push({
        type: ElementType.CODE_BLOCK,
        from: block.from,
        to: block.to,
        lineNumber: block.startLine,
        language: block.language,
        content: block.code,
        startLine: block.startLine,
        endLine: block.endLine,
        decorationData: {
          isMultiLine: block.startLine !== block.endLine,
          showLineNumbers: true,
        },
      });

      // 标记这些行已被代码块占用
      for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
        occupiedLines.add(lineNum);
      }
    } else {
      // 代码块被reveal，添加编辑样式
      for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
        occupiedLines.add(lineNum);
        const line = doc.line(lineNum);
        elements.push({
          type: ElementType.CODE_BLOCK,
          from: line.from,
          to: line.from,
          lineNumber: lineNum,
          decorationData: {
            isEditingStyle: true,
          },
        });
      }
    }
  }

  // 2. 解析所有表格（多行块级元素）
  const tables = parseTables(lines);

  for (const table of tables) {
    // 检查表格是否应该被reveal (element-level check)
    const shouldReveal = shouldRevealAt(
      view.state,
      table.from,
      table.to,
      ElementType.TABLE
    );

    if (!shouldReveal) {
      // 添加表格元素
      elements.push({
        type: ElementType.TABLE,
        from: table.from,
        to: table.to,
        lineNumber: table.startLine,
        startLine: table.startLine,
        endLine: table.endLine,
        decorationData: {
          rows: table.rows,
          hasHeader: table.hasHeader,
          isMultiLine: table.startLine !== table.endLine,
        },
      });

      // 标记这些行已被表格占用
      for (let lineNum = table.startLine; lineNum <= table.endLine; lineNum++) {
        occupiedLines.add(lineNum);
      }
    } else {
      // 表格被reveal，添加编辑样式
      for (let lineNum = table.startLine; lineNum <= table.endLine; lineNum++) {
        occupiedLines.add(lineNum);
        const line = doc.line(lineNum);
        elements.push({
          type: ElementType.TABLE,
          from: line.from,
          to: line.from,
          lineNumber: lineNum,
          decorationData: {
            isEditingStyle: true,
          },
        });
      }
    }
  }

  // 3. 逐行解析其他元素（跳过已占用的行）
  const ranges = viewportOnly
    ? visibleRanges
    : [{ from: 0, to: doc.length }];

  for (const range of ranges) {
    const startLine = doc.lineAt(range.from);
    const endLine = doc.lineAt(range.to);

    for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
      // 跳过已被块级元素占用的行
      if (occupiedLines.has(lineNum)) {
        continue;
      }

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
 * 1. 块级公式 $$
 * 2. 表格行 |
 * 3. 标题 #
 * 4. 引用 >
 * 5. 列表 - * + 1.
 * 6. 行内元素
 *
 * 注意: 代码块标记```已由parseCodeBlocks统一处理
 */
function parseLineElements(
  state: EditorState,
  line: { from: number; to: number; text: string },
  lineNum: number,
  lineText: string
): ParsedElement[] {
  const elements: ParsedElement[] = [];

  // NOTE: We no longer skip parsing based on line reveal
  // Instead, we check element-level reveal for each element
  // This enables Obsidian-style granular reveal (e.g., only reveal the bold text, not the whole line)

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

    // 2. Replace decoration to hide # markers (Obsidian-style)
    elements.push({
      type: ElementType.HEADING,
      from: line.from,
      to: markerEnd,
      lineNumber: lineNum,
      level: level,
      content: content,
      decorationData: {
        isMarkerHide: true,
      },
    });
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
        to: Math.max(line.from, line.to - 1), // Exclude newline character
        lineNumber: lineNum,
        content: content,
        decorationData: {
          isWidget: true,
          content: content,
          markerTo: blockquote.markerTo,
          originalFrom: line.from,
          originalTo: Math.max(line.from, line.to - 1), // Exclude newline character
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
      to: Math.max(line.from, line.to - 1), // Exclude newline character
      lineNumber: lineNum,
      decorationData: {
        originalFrom: line.from,
        originalTo: Math.max(line.from, line.to - 1), // Exclude newline character
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
 * 完整支持15种行内Markdown元素
 * 性能优化：使用预编译的正则表达式
 */
function parseInlineElements(
  lineText: string,
  lineFrom: number,
  lineNum: number
): ParsedElement[] {
  const elements: ParsedElement[] = [];
  let match: RegExpExecArray | null;

  // 重置所有正则表达式的lastIndex
  resetRegexPatterns();

  // 1. 行内公式: $...$
  while ((match = REGEX_PATTERNS.inlineMath.exec(lineText)) !== null) {
    const latex = match[1];
    if (latex.includes('\n')) continue;

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
        contentFrom: lineFrom + match.index + 1,
        contentTo: lineFrom + match.index + match[0].length - 1,
      },
    });
  }

  // 2. 粗体+斜体: ***...***
  while ((match = REGEX_PATTERNS.boldItalic.exec(lineText)) !== null) {
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
  while ((match = REGEX_PATTERNS.bold.exec(lineText)) !== null) {
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
  while ((match = REGEX_PATTERNS.italic.exec(lineText)) !== null) {
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
  while ((match = REGEX_PATTERNS.strikethrough.exec(lineText)) !== null) {
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
  while ((match = REGEX_PATTERNS.highlight.exec(lineText)) !== null) {
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
  while ((match = REGEX_PATTERNS.inlineCode.exec(lineText)) !== null) {
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
  while ((match = REGEX_PATTERNS.annotationLink.exec(lineText)) !== null) {
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
  while ((match = REGEX_PATTERNS.wikiLink.exec(lineText)) !== null) {
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
  while ((match = REGEX_PATTERNS.link.exec(lineText)) !== null) {
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
  while ((match = REGEX_PATTERNS.embed.exec(lineText)) !== null) {
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
  while ((match = REGEX_PATTERNS.image.exec(lineText)) !== null) {
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
  while ((match = REGEX_PATTERNS.superscript.exec(lineText)) !== null) {
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
  while ((match = REGEX_PATTERNS.subscript.exec(lineText)) !== null) {
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
  while ((match = REGEX_PATTERNS.kbd.exec(lineText)) !== null) {
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
  while ((match = REGEX_PATTERNS.footnote.exec(lineText)) !== null) {
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

  // 17. 标签: #tag
  while ((match = REGEX_PATTERNS.tag.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_TAG,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
      decorationData: {
        tag: match[1],
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 1,
        contentTo: lineFrom + match.index + match[0].length,
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
        // Check if this is a parent-child relationship (nesting)
        // Parent completely contains child: keep both
        const isParentChild = (
          (other.from <= current.from && other.to >= current.to) || // other contains current
          (current.from <= other.from && current.to >= other.to)    // current contains other
        );

        if (isParentChild) {
          // Keep both - this is nesting (e.g., **$E=mc^2$**)
          continue;
        }

        // Partial overlap - use priority to resolve
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
function buildDecorationsFromElements(elements: ParsedElement[], view: EditorView): DecorationSet {
  const entries: DecorationEntry[] = [];

  for (const element of elements) {
    // Element-level reveal check: Skip decoration if cursor is in this element
    // This enables Obsidian-style granular reveal (e.g., only reveal the bold text, not the whole line)
    if (shouldRevealAt(view.state, element.from, element.to, element.type)) {
      continue; // Skip this element - show raw markdown instead
    }

    // 多行代码块需要特殊处理
    if (element.type === ElementType.CODE_BLOCK && element.decorationData) {
      const data = element.decorationData as any;

      if (data.isEditingStyle) {
        // 编辑模式：每行添加样式
        entries.push({
          from: element.from,
          to: element.to,
          decoration: Decoration.line({
            class: 'cm-code-block-line cm-code-block-editing',
          }),
          priority: element.type,
          isLine: true,
        });
      } else if (data.isMultiLine && element.startLine && element.endLine) {
        // 多行代码块：widget + 隐藏行
        const doc = view.state.doc;
        const firstLine = doc.line(element.startLine);

        // 1. 在第一行添加widget
        entries.push({
          from: firstLine.from,
          to: firstLine.from,
          decoration: Decoration.widget({
            widget: new CodeBlockWidget(
              element.content || '',
              element.language || '',
              data.showLineNumbers === true, // Default: false (cleaner like Obsidian)
              element.from,
              element.to
            ),
            side: -1,
          }),
          priority: element.type,
          isLine: true,
        });

        // 2. 隐藏所有代码块行
        for (let lineNum = element.startLine; lineNum <= element.endLine; lineNum++) {
          const line = doc.line(lineNum);
          entries.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({ class: 'cm-code-block-hidden' }),
            priority: element.type,
            isLine: true,
          });
        }
      } else {
        // 单行代码块
        entries.push({
          from: element.from,
          to: element.to,
          decoration: Decoration.replace({
            widget: new CodeBlockWidget(
              element.content || '',
              element.language || '',
              data.showLineNumbers === true, // Default: false (cleaner like Obsidian)
              element.from,
              element.to
            ),
          }),
          priority: element.type,
          isLine: false,
        });
      }
      continue;
    }

    // 多行表格需要特殊处理
    if (element.type === ElementType.TABLE && element.decorationData) {
      const data = element.decorationData as any;

      if (data.isEditingStyle) {
        // 编辑模式：每行添加样式
        entries.push({
          from: element.from,
          to: element.to,
          decoration: Decoration.line({
            class: 'cm-table-line',
          }),
          priority: element.type,
          isLine: true,
        });
      } else if (data.isMultiLine && element.startLine && element.endLine) {
        // 多行表格：widget + 隐藏行
        const doc = view.state.doc;
        const firstLine = doc.line(element.startLine);

        // 1. 在第一行添加widget
        entries.push({
          from: firstLine.from,
          to: firstLine.from,
          decoration: Decoration.widget({
            widget: new TableWidget(
              data.rows || [],
              data.hasHeader !== false,
              element.from,
              element.to
            ),
            side: -1,
          }),
          priority: element.type,
          isLine: true,
        });

        // 2. 隐藏所有表格行
        for (let lineNum = element.startLine; lineNum <= element.endLine; lineNum++) {
          const line = doc.line(lineNum);
          entries.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({ class: 'cm-table-hidden' }),
            priority: element.type,
            isLine: true,
          });
        }
      } else {
        // 单行表格（罕见）
        entries.push({
          from: element.from,
          to: element.to,
          decoration: Decoration.replace({
            widget: new TableWidget(
              data.rows || [],
              data.hasHeader !== false,
              element.from,
              element.to
            ),
          }),
          priority: element.type,
          isLine: false,
        });
      }
      continue;
    }

    // 其他元素使用通用创建函数
    const decoration = createDecorationForElement(element);
    if (decoration) {
      entries.push({
        from: element.from,
        to: element.to,
        decoration,
        priority: element.type,
        isLine: isLineDecoration(element),
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
      } else if (data?.isMarkerHide) {
        // Replace decoration to hide # markers (Obsidian-style)
        return Decoration.replace({});
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
      // 代码块在buildDecorationsFromElements中特殊处理
      // 这里不应该被调用
      return null;

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

    case ElementType.INLINE_TAG:
      // Render tag as styled span
      return Decoration.mark({
        class: 'cm-tag',
        attributes: {
          'data-tag': data?.tag || element.content || '',
        },
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
    private lastSelectionLine: number = -1;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
      this.lastSelectionLine = view.state.doc.lineAt(view.state.selection.main.head).number;
    }

    update(update: ViewUpdate) {
      // CRITICAL PERFORMANCE FIX:
      // Only rebuild decorations when:
      // 1. Document content changed (docChanged)
      // 2. Selection moved to a different line (affects reveal state)
      // 3. Viewport changed (user scrolled to new content)

      if (update.docChanged) {
        // Document changed - must rebuild
        this.decorations = this.buildDecorations(update.view);
        this.lastSelectionLine = update.view.state.doc.lineAt(update.view.state.selection.main.head).number;
      } else if (update.selectionSet) {
        // Selection changed - only rebuild if it moved to a different line
        const currentLine = update.view.state.doc.lineAt(update.view.state.selection.main.head).number;
        if (currentLine !== this.lastSelectionLine) {
          this.decorations = this.buildDecorations(update.view);
          this.lastSelectionLine = currentLine;
        }
      } else if (update.viewportChanged) {
        // Viewport changed (scrolling) - rebuild for new visible content
        this.decorations = this.buildDecorations(update.view);
      }
    }

    private buildDecorations(view: EditorView): DecorationSet {
      // 1. 解析文档 (解析全文档以确保完整渲染)
      const elements = parseDocument(view, false);

      // 2. 更新 parsedElementsField 供 cursor context plugin 使用
      view.dispatch({
        effects: updateParsedElements.of(elements),
      });

      // 3. 解决冲突
      const resolved = resolveConflicts(elements);

      // 4. 构建装饰器
      return buildDecorationsFromElements(resolved, view);
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
