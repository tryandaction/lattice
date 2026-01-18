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
    elements.push({
      type: ElementType.HEADING,
      from: line.from,
      to: line.to,
      lineNumber: lineNum,
      level: headingMatch[1].length,
      content: headingMatch[2],
    });
    // 标题内可能有行内元素，继续解析
  }

  // 检测引用
  const quoteMatch = lineText.match(/^>\s*(.*)/);
  if (quoteMatch) {
    elements.push({
      type: ElementType.BLOCKQUOTE,
      from: line.from,
      to: line.to,
      lineNumber: lineNum,
      content: quoteMatch[1],
    });
  }

  // 检测列表
  const listMatch = lineText.match(/^(\s*)([-*+]|\d+\.)\s+(.*)/);
  if (listMatch) {
    elements.push({
      type: ElementType.LIST_ITEM,
      from: line.from,
      to: line.to,
      lineNumber: lineNum,
      content: listMatch[3],
    });
  }

  // 检测横线
  if (/^---+$/.test(lineText)) {
    elements.push({
      type: ElementType.HORIZONTAL_RULE,
      from: line.from,
      to: line.to,
      lineNumber: lineNum,
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
 * 优先级:
 * 1. 行内公式 $...$
 * 2. 粗体/斜体 **...** *...*
 * 3. 行内代码 `...`
 * 4. 链接 [text](url)
 * 5. 图片 ![alt](url)
 */
function parseInlineElements(
  lineText: string,
  lineFrom: number,
  lineNum: number
): ParsedElement[] {
  const elements: ParsedElement[] = [];

  // 行内公式: $...$
  const inlineMathRegex = /(?<!\$)\$(?!\$)(.+?)\$(?!\$)/g;
  let match: RegExpExecArray | null;

  while ((match = inlineMathRegex.exec(lineText)) !== null) {
    const latex = match[1];

    // 过滤掉包含换行的（应该用块级公式）
    if (latex.includes('\n')) continue;

    elements.push({
      type: ElementType.MATH_INLINE,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      latex: latex,
      isBlock: false,
    });
  }

  // 粗体: **...**
  const boldRegex = /\*\*([^*]+?)\*\*/g;
  while ((match = boldRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_BOLD,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
    });
  }

  // 斜体: *...*
  const italicRegex = /(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)/g;
  while ((match = italicRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_ITALIC,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
    });
  }

  // 行内代码: `...`
  const codeRegex = /`([^`]+?)`/g;
  while ((match = codeRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_CODE,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
    });
  }

  // 链接: [text](url)
  const linkRegex = /\[([^\]]+?)\]\(([^)]+?)\)/g;
  while ((match = linkRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_LINK,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
      decorationData: { url: match[2] },
    });
  }

  // 图片: ![alt](url)
  const imageRegex = /!\[([^\]]*?)\]\(([^)]+?)\)/g;
  while ((match = imageRegex.exec(lineText)) !== null) {
    elements.push({
      type: ElementType.INLINE_IMAGE,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: match[1],
      decorationData: { url: match[2] },
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
        isLine: isLineDecoration(element.type),
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
 * 判断元素类型是否需要行装饰器
 */
function isLineDecoration(type: ElementType): boolean {
  return type === ElementType.HEADING ||
         type === ElementType.BLOCKQUOTE ||
         type === ElementType.LIST_ITEM ||
         type === ElementType.CODE_BLOCK ||
         type === ElementType.MATH_BLOCK;
}

/**
 * 为单个元素创建装饰器
 *
 * TODO: 这里需要实现每种元素类型的具体装饰器
 * 当前只是占位符实现
 */
function createDecorationForElement(element: ParsedElement): Decoration | null {
  switch (element.type) {
    case ElementType.HEADING:
      // 行样式
      return Decoration.line({
        class: `cm-heading cm-heading-${element.level}`
      });

    case ElementType.INLINE_BOLD:
      // 替换为带样式的span
      return Decoration.mark({
        class: 'cm-strong'
      });

    case ElementType.INLINE_ITALIC:
      return Decoration.mark({
        class: 'cm-em'
      });

    case ElementType.INLINE_CODE:
      return Decoration.mark({
        class: 'cm-inline-code'
      });

    // TODO: 添加其他元素类型的装饰器创建逻辑

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
