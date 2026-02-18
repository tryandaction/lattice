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

import { EditorView, DecorationSet, Decoration } from '@codemirror/view';
import { EditorState, StateField, StateEffect, Text } from '@codemirror/state';
import { shouldRevealAt } from './cursor-context-plugin';
import {
  FormattedTextWidget,
  LinkWidget,
  AnnotationLinkWidget,
  ImageWidget,
  SuperscriptWidget,
  SubscriptWidget,
  KbdWidget,
  FootnoteRefWidget,
  FootnoteDefWidget,
  EmbedWidget,
  ListBulletWidget,
  HorizontalRuleWidget,
  MathWidget,
  CodeBlockWidget,
  TableWidget,
  CalloutWidget,
  DetailsWidget,
} from './widgets';
import { parseListItem, parseBlockquote } from './markdown-parser';

// ============================================================================
// Debug Configuration
// ============================================================================

/**
 * Debug mode - set to false in production to disable verbose logging
 */
const DEBUG_MODE = process.env.NODE_ENV === 'development';

/**
 * Conditional debug log
 */
function debugLog(prefix: string, ...args: unknown[]) {
  if (DEBUG_MODE) {
    console.log(prefix, ...args);
  }
}

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
  FOOTNOTE_DEF = 18,   // 脚注定义块
  REFERENCE_DEF = 19,  // 引用式链接定义
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

type ParsedElementsCarrier = {
  _parsedElements?: ParsedElement[];
};

type DecorationData = Partial<{
  // Common flags
  isLineStyle: boolean;
  isEditingStyle: boolean;
  isMarkerHide: boolean;
  isWidget: boolean;
  isMultiLine: boolean;
  // Ranges and styling
  className: string;
  level: number;
  contentFrom: number;
  contentTo: number;
  syntaxFrom: number;
  syntaxTo: number;
  // Code/Math/Table
  showLineNumbers: boolean;
  rows: string[][];
  hasHeader: boolean;
  alignments: string[];
  // Callout/Details/Footnotes
  type: string;
  title: string;
  summary: string;
  contentLines: string[];
  isFolded: boolean;
  isOpen: boolean;
  identifier: string;
  // Links / images / tags
  url: string;
  isWikiLink: boolean;
  alt: string;
  width: number;
  tag: string;
  // List markers
  indent: number;
  marker: string;
  checked: boolean;
  lineFrom: number;
  // HR
  originalFrom: number;
  originalTo: number;
  // Annotation link / embeds
  displayText: string;
  filePath: string;
  annotationId: string;
  target: string;
}>;

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
 * 数学公式块匹配结果
 */
interface MathBlockMatch {
  from: number;
  to: number;
  latex: string;
  startLine: number;
  endLine: number;
}

type BlockContext = {
  blockquoteDepth: number;
  listIndent: number;
};

/**
 * 表格匹配结果
 */
interface TableMatch {
  from: number;
  to: number;
  rows: string[][];
  hasHeader: boolean;
  alignments?: Array<'left' | 'center' | 'right' | null>;
  startLine: number;
  endLine: number;
}

/**
 * Callout 匹配结果
 */
interface CalloutMatch {
  from: number;
  to: number;
  type: string;
  title: string;
  contentLines: string[];
  startLine: number;
  endLine: number;
  isFolded: boolean;
}

/**
 * Details 匹配结果
 */
interface DetailsMatch {
  from: number;
  to: number;
  summary: string;
  contentLines: string[];
  startLine: number;
  endLine: number;
  isOpen: boolean;
}

/**
 * 脚注定义匹配结果
 */
interface FootnoteDefMatch {
  from: number;
  to: number;
  identifier: string;
  contentLines: string[];
  startLine: number;
  endLine: number;
}

interface ReferenceDefinition {
  url: string;
  title?: string;
}

interface ReferenceDefMatch {
  from: number;
  to: number;
  label: string;
  url: string;
  title?: string;
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

  size(): number {
    return this.cache.size;
  }
}

// 全局缓存实例
const lineElementCache = new LRUCache<string, ParsedElement[]>(10000);

// ============================================================================
// Performance thresholds & cached parsing
// ============================================================================

const VIEWPORT_LINE_BUFFER = 120;

let cachedDoc: Text | null = null;
let cachedText: string = '';
let cachedLines: string[] = [];
let cachedCodeBlocks: CodeBlockMatch[] = [];
let cachedMathBlocks: MathBlockMatch[] = [];
let cachedTables: TableMatch[] = [];
let cachedCallouts: CalloutMatch[] = [];
let cachedDetails: DetailsMatch[] = [];
let cachedFootnoteDefs: FootnoteDefMatch[] = [];
let cachedReferenceDefs: Map<string, ReferenceDefinition> = new Map();
let cachedReferenceDefMatches: ReferenceDefMatch[] = [];

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
 *
 * CRITICAL: Order matters for conflict resolution:
 * 1. boldItalic (***) must be checked before bold (**) and italic (*)
 * 2. strikethrough (~~) must be checked before subscript (~)
 * 3. Escape sequences (\*) should be handled
 */
const REGEX_PATTERNS = {
  // Inline math: $...$ (not $$)
  inlineMath: /(?<!\$)\$(?!\$)(.+?)\$(?!\$)/g,
  // Inline math: \( ... \)
  inlineMathParen: /\\\((.+?)\\\)/g,

  // Bold+Italic: ***text*** - allows nested content
  boldItalic: /\*\*\*(.+?)\*\*\*/g,

  // Bold: **text** - allows nested content, but not ***
  bold: /(?<!\*)\*\*(?!\*)(.+?)(?<!\*)\*\*(?!\*)/g,

  // Italic: *text* or _text_ - negative lookbehind/ahead to avoid ** and __
  italic: /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g,

  // Strikethrough: ~~text~~ - must be checked before subscript
  strikethrough: /~~(.+?)~~/g,

  // Highlight: ==text==
  highlight: /==(.+?)==/g,

  // Inline code: ``text`` (allows single backticks inside)
  inlineCodeDouble: /``([^`]+?)``/g,

  // Inline code: `text` - no nesting allowed
  inlineCode: /`([^`]+?)`/g,

  // Annotation link: [[file.pdf#ann-uuid]]
  annotationLink: /\[\[([^\]]+?\.pdf)#(ann-[^\]]+?)\]\]/gi,

  // Wiki link: [[page]], [[page|display]], [[page#heading|alias]]
  wikiLink: /\[\[([^\]|#]+?)(?:#([^\]|]+?))?(?:\|([^\]]+?))?\]\]/g,

  // Markdown link: [text](url)
  link: /\[([^\]]+?)\]\(([^)]+?)\)/g,

  // Reference link: [text][label] or [text][]
  referenceLink: /\[([^\]]+?)\]\s*\[([^\]]*)\]/g,

  // Reference image: ![alt][label] or ![alt][]
  referenceImage: /!\[([^\]]*?)\]\s*\[([^\]]*)\]/g,

  // Reference link shortcut: [label]
  referenceLinkShortcut: /\[([^\]\[]+?)\]/g,

  // Reference image shortcut: ![alt]
  referenceImageShortcut: /!\[([^\]]+?)\]/g,

  // Embed: ![[file]]
  embed: /!\[\[([^\]]+?)\]\]/g,

  // Image: ![alt](url) or ![alt|width](url)
  image: /!\[([^\]]*?)(?:\|(\d+))?\]\(([^)]+?)\)/g,

  // Superscript: ^text^ - not inside math
  superscript: /\^([^^]+?)\^/g,

  // Subscript: ~text~ - negative lookbehind/ahead to avoid ~~
  subscript: /(?<!~)~(?!~)([^~]+?)(?<!~)~(?!~)/g,

  // Keyboard: <kbd>text</kbd>
  kbd: /<kbd>([^<]+?)<\/kbd>/g,

  // Footnote reference: [^1]
  footnote: /\[\^([^\]]+?)\]/g,

  // Tag: #tag
  tag: /#([a-zA-Z][a-zA-Z0-9_/-]*)/g,

  // Autolink: <https://example.com> or <mailto:...>
  autoLink: /<((https?:\/\/|mailto:)[^>]+)>/g,

  // Bare URL (GFM autolink literal)
  bareUrl: /(?<!\()https?:\/\/[^\s<]+/g,
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
 *
 * @param lines - 文档按行分割的数组
 * @param docLength - 文档总长度，用于边界检查
 */
function parseCodeBlocks(lines: string[], docLength?: number): CodeBlockMatch[] {
  const blocks: CodeBlockMatch[] = [];
  let offset = 0;
  let inBlock = false;
  let fenceChar = '';
  let fenceLength = 0;
  let blockStart = 0;
  let blockLang = '';
  let blockCode: string[] = [];
  let blockStartLine = 0;
  let blockquotePrefixLength = 0;
  let listIndentToStrip = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    const lineEnd = offset + line.length;
    const { stripped, prefix } = stripMathLinePrefix(line);
    const trimmed = stripped.trim();

    if (!inBlock) {
      const openMatch = trimmed.match(/^(`{3,}|~{3,})(.*)$/);
      if (openMatch) {
        inBlock = true;
        fenceChar = openMatch[1][0];
        fenceLength = openMatch[1].length;
        const info = openMatch[2]?.trim() || '';
        blockLang = info.split(/\s+/)[0] || '';
        blockStart = lineStart;
        blockCode = [];
        blockStartLine = i + 1; // 行号从1开始
        const blockquotePrefixMatch = prefix.match(/^(\s*>[ \t]?)+/);
        const blockquotePrefix = blockquotePrefixMatch?.[0] ?? '';
        blockquotePrefixLength = blockquotePrefix.length;
        listIndentToStrip = Math.max(0, prefix.length - blockquotePrefixLength);
      }
    } else {
      const closeRegex = new RegExp(`^${fenceChar}{${fenceLength},}\\s*$`);
      if (closeRegex.test(trimmed)) {
        const blockTo = docLength !== undefined ? Math.min(lineEnd, docLength) : lineEnd;
        blocks.push({
          from: blockStart,
          to: blockTo,
          language: blockLang,
          code: blockCode.join('\n'),
          startLine: blockStartLine,
          endLine: i + 1,
        });
        inBlock = false;
        fenceChar = '';
        fenceLength = 0;
        blockLang = '';
        blockquotePrefixLength = 0;
        listIndentToStrip = 0;
      } else {
        let contentLine = line;

        // Remove blockquote prefixes first (preserve nested quote depth)
        if (blockquotePrefixLength > 0) {
          let removed = 0;
          while (removed < blockquotePrefixLength) {
            const match = contentLine.match(/^(\s*>[ \t]?)/);
            if (!match) break;
            removed += match[1].length;
            contentLine = contentLine.slice(match[1].length);
          }
        }

        // Then remove list indentation (whitespace only)
        if (listIndentToStrip > 0) {
          let removedSpaces = 0;
          while (
            removedSpaces < listIndentToStrip &&
            (contentLine.startsWith(' ') || contentLine.startsWith('\t'))
          ) {
            contentLine = contentLine.slice(1);
            removedSpaces += 1;
          }
        }

        blockCode.push(contentLine);
      }
    }

    offset = lineEnd + 1; // +1 for newline
  }

  return blocks;
}

/**
 * 解析数学公式块 - 多行块级元素需要特殊处理
 *
 * 公式块格式:
 * $$
 * latex content
 * $$
 *
 * 性能优化：接收预先分割的lines数组，避免重复split
 *
 * @param lines - 文档按行分割的数组
 * @param docLength - 文档总长度，用于边界检查
 */
function stripMathLinePrefix(
  line: string,
  options?: { stripList?: boolean }
): { stripped: string; prefix: string } {
  let working = line;
  let prefix = '';
  const stripList = options?.stripList !== false;

  // Blockquote prefix: support nested levels like ">>" or "> >"
  while (true) {
    const blockquoteMatch = working.match(/^(\s*>[ \t]?)/);
    if (!blockquoteMatch) break;
    prefix += blockquoteMatch[1];
    working = working.slice(blockquoteMatch[1].length);
  }

  // List prefix: -, *, +, or 1. / 1) with optional task checkbox
  if (stripList) {
    const listMatch = working.match(/^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)/);
    if (listMatch) {
      prefix += listMatch[1];
      working = working.slice(listMatch[1].length);
    }
  }

  return { stripped: working, prefix };
}

function getBlockContext(lineText: string): BlockContext | null {
  let working = lineText;
  let blockquoteDepth = 0;

  while (true) {
    const blockquoteMatch = working.match(/^(\s*>[ \t]?)/);
    if (!blockquoteMatch) break;
    blockquoteDepth += 1;
    working = working.slice(blockquoteMatch[1].length);
  }

  const listMatch = working.match(/^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)/);
  const listIndent = listMatch ? listMatch[0].length : 0;

  if (blockquoteDepth === 0 && listIndent === 0) return null;
  return { blockquoteDepth, listIndent };
}

function parseMathBlocks(
  lines: string[],
  docLength?: number,
  ignoreLines?: Set<number>
): MathBlockMatch[] {
  const blocks: MathBlockMatch[] = [];
  let offset = 0;
  let inBlock = false;
  let blockType: 'dollar' | 'single' | 'bracket' | 'env' | null = null;
  let envName = '';
  let blockStart = 0;
  let blockLatex: string[] = [];
  let blockStartLine = 0;
  const envNames = '(equation|align|gather|multline|cases|matrix|pmatrix|bmatrix|aligned|split|eqnarray)';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    const lineEnd = offset + line.length;
    const lineNumber = i + 1;
    const isIgnored = ignoreLines?.has(lineNumber) ?? false;
    const { stripped } = stripMathLinePrefix(line);
    const trimmed = stripped.trim();

    if (isIgnored && !inBlock) {
      offset = lineEnd + 1;
      continue;
    }

    if (isIgnored && inBlock) {
      blockLatex.push(stripped);
      offset = lineEnd + 1;
      continue;
    }

    // TASK 5.2: Support inline block math $$...$$ on single line
    const inlineBlockMatch = stripped.match(/^\s*\$\$(.+?)\$\$\s*$/);
    const inlineBracketMatch = stripped.match(/^\s*\\\[(.+?)\\\]\s*$/);
    const inlineEnvMatch = stripped.match(
      new RegExp(`^\\s*(\\\\begin\\{${envNames}\\*?\\}[\\s\\S]+?\\\\end\\{\\2\\*?\\})\\s*$`)
    );
    if (inlineBlockMatch && !inBlock) {
      const latex = inlineBlockMatch[1].trim();
      if (latex && latex !== 'undefined') {
        // CRITICAL FIX: Ensure 'to' doesn't exceed document length
        const blockTo = docLength !== undefined ? Math.min(lineEnd, docLength) : lineEnd;
        blocks.push({
          from: lineStart,
          to: blockTo,
          latex: latex,
          startLine: i + 1,
          endLine: i + 1,
        });
      } else {
        console.warn('[parseMathBlocks] Empty inline block math at line', i + 1);
      }
      offset = lineEnd + 1;
      continue;
    }
    if (inlineBracketMatch && !inBlock) {
      const latex = inlineBracketMatch[1].trim();
      if (latex && latex !== 'undefined') {
        const blockTo = docLength !== undefined ? Math.min(lineEnd, docLength) : lineEnd;
        blocks.push({
          from: lineStart,
          to: blockTo,
          latex: latex,
          startLine: i + 1,
          endLine: i + 1,
        });
      } else {
        console.warn('[parseMathBlocks] Empty inline bracket math at line', i + 1);
      }
      offset = lineEnd + 1;
      continue;
    }
    if (inlineEnvMatch && !inBlock) {
      const latex = inlineEnvMatch[1].trim();
      if (latex && latex !== 'undefined') {
        const blockTo = docLength !== undefined ? Math.min(lineEnd, docLength) : lineEnd;
        blocks.push({
          from: lineStart,
          to: blockTo,
          latex: latex,
          startLine: i + 1,
          endLine: i + 1,
        });
      } else {
        console.warn('[parseMathBlocks] Empty inline env math at line', i + 1);
      }
      offset = lineEnd + 1;
      continue;
    }

    if (!inBlock && trimmed === '$$') {
      // 公式块开始
      inBlock = true;
      blockType = 'dollar';
      blockStart = lineStart;
      blockLatex = [];
      blockStartLine = i + 1; // 行号从1开始
    } else if (!inBlock && trimmed === '$') {
      // 容错：单 $ 包裹的块级公式
      inBlock = true;
      blockType = 'single';
      blockStart = lineStart;
      blockLatex = [];
      blockStartLine = i + 1;
    } else if (!inBlock && trimmed === '\\[') {
      // \[ ... \] 公式块开始
      inBlock = true;
      blockType = 'bracket';
      blockStart = lineStart;
      blockLatex = [];
      blockStartLine = i + 1;
    } else if (!inBlock) {
      const envStartMatch = trimmed.match(new RegExp(`^\\\\begin\\{${envNames}\\*?\\}\\s*$`));
      if (envStartMatch) {
        inBlock = true;
        blockType = 'env';
        envName = envStartMatch[1];
        blockStart = lineStart;
        blockLatex = [stripped];
        blockStartLine = i + 1;
      }
    } else if (inBlock && blockType === 'dollar' && trimmed === '$$') {
      // 公式块结束
      // PHASE 4 FIX: Validate latex content
      const latex = blockLatex.join('\n');
      if (latex.trim() !== '' && latex.trim() !== 'undefined') {
        // CRITICAL FIX: Ensure 'to' doesn't exceed document length
        const blockTo = docLength !== undefined ? Math.min(lineEnd, docLength) : lineEnd;
        blocks.push({
          from: blockStart,
          to: blockTo,
          latex: latex,
          startLine: blockStartLine,
          endLine: i + 1,
        });
      } else {
        console.warn('[parseMathBlocks] Empty math block at lines', blockStartLine, '-', i + 1);
      }
      inBlock = false;
      blockType = null;
      envName = '';
    } else if (inBlock && blockType === 'single' && trimmed === '$') {
      const latex = blockLatex.join('\n');
      if (latex.trim() !== '' && latex.trim() !== 'undefined') {
        const blockTo = docLength !== undefined ? Math.min(lineEnd, docLength) : lineEnd;
        blocks.push({
          from: blockStart,
          to: blockTo,
          latex: latex,
          startLine: blockStartLine,
          endLine: i + 1,
        });
      } else {
        console.warn('[parseMathBlocks] Empty single-dollar math block at lines', blockStartLine, '-', i + 1);
      }
      inBlock = false;
      blockType = null;
      envName = '';
    } else if (inBlock && blockType === 'bracket' && trimmed === '\\]') {
      const latex = blockLatex.join('\n');
      if (latex.trim() !== '' && latex.trim() !== 'undefined') {
        const blockTo = docLength !== undefined ? Math.min(lineEnd, docLength) : lineEnd;
        blocks.push({
          from: blockStart,
          to: blockTo,
          latex: latex,
          startLine: blockStartLine,
          endLine: i + 1,
        });
      } else {
        console.warn('[parseMathBlocks] Empty bracket math block at lines', blockStartLine, '-', i + 1);
      }
      inBlock = false;
      blockType = null;
      envName = '';
    } else if (inBlock && blockType === 'env' && trimmed.match(new RegExp(`^\\\\end\\{${envName}\\*?\\}\\s*$`))) {
      blockLatex.push(stripped);
      const latex = blockLatex.join('\n');
      if (latex.trim() !== '' && latex.trim() !== 'undefined') {
        const blockTo = docLength !== undefined ? Math.min(lineEnd, docLength) : lineEnd;
        blocks.push({
          from: blockStart,
          to: blockTo,
          latex: latex,
          startLine: blockStartLine,
          endLine: i + 1,
        });
      } else {
        console.warn('[parseMathBlocks] Empty env math block at lines', blockStartLine, '-', i + 1);
      }
      inBlock = false;
      blockType = null;
      envName = '';
    } else if (inBlock) {
      blockLatex.push(stripped);
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
 *
 * @param lines - 文档按行分割的数组
 * @param docLength - 文档总长度，用于边界检查
 */
function parseTables(
  lines: string[],
  docLength?: number,
  ignoreLines?: Set<number>
): TableMatch[] {
  const tables: TableMatch[] = [];
  let offset = 0;
  let tableStart = -1;
  let tableRows: string[][] = [];
  let hasHeader = false;
  let tableAlignments: Array<'left' | 'center' | 'right' | null> | null = null;
  let tableStartLine = 0;

  const splitTableRow = (text: string): string[] | null => {
    if (!text || !text.includes('|')) return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    const isEscaped = (source: string, index: number): boolean => {
      let backslashes = 0;
      for (let i = index - 1; i >= 0 && source[i] === '\\'; i--) {
        backslashes++;
      }
      return backslashes % 2 === 1;
    };

    let working = trimmed;
    if (working.startsWith('|')) {
      working = working.slice(1);
    }
    if (working.endsWith('|') && !isEscaped(working, working.length - 1)) {
      working = working.slice(0, -1);
    }

    const cells: string[] = [];
    let current = '';
    let inCode = false;
    let codeFence = '';
    let i = 0;

    while (i < working.length) {
      const ch = working[i];

      if (ch === '\\' && i + 1 < working.length && working[i + 1] === '|') {
        current += '|';
        i += 2;
        continue;
      }

      if (ch === '`') {
        let j = i;
        while (j < working.length && working[j] === '`') j++;
        const fence = working.slice(i, j);
        if (!inCode) {
          inCode = true;
          codeFence = fence;
        } else if (fence === codeFence) {
          inCode = false;
          codeFence = '';
        }
        current += fence;
        i = j;
        continue;
      }

      if (ch === '|' && !inCode) {
        cells.push(current.trim());
        current = '';
        i += 1;
        continue;
      }

      current += ch;
      i += 1;
    }

    cells.push(current.trim());
    if (cells.length === 0) return null;
    return cells;
  };

  const parseSeparatorRow = (
    text: string
  ): { cells: string[]; alignments: Array<'left' | 'center' | 'right' | null> } | null => {
    const cells = splitTableRow(text);
    if (!cells) return null;
    const isSeparator = cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()));
    if (!isSeparator) return null;

    const alignments = cells.map(cell => {
      const trimmed = cell.trim();
      const startsWithColon = trimmed.startsWith(':');
      const endsWithColon = trimmed.endsWith(':');
      if (startsWithColon && endsWithColon) return 'center';
      if (startsWithColon) return 'left';
      if (endsWithColon) return 'right';
      return null;
    });

    return { cells, alignments };
  };

  const finalizeTable = (tableEndOffset: number, endLine: number) => {
    if (tableStart === -1 || tableRows.length < 2 || !hasHeader) return;
    const safeEndOffset = Math.max(tableStart, tableEndOffset);
    const tableTo = docLength !== undefined ? Math.min(safeEndOffset, docLength) : safeEndOffset;
    tables.push({
      from: tableStart,
      to: tableTo,
      rows: tableRows,
      hasHeader,
      alignments: tableAlignments ?? undefined,
      startLine: tableStartLine,
      endLine,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    const lineEnd = offset + line.length;
    const lineNumber = i + 1;

    if (ignoreLines?.has(lineNumber)) {
      if (tableStart !== -1) {
        finalizeTable(lineStart - 1, i);
        tableStart = -1;
        tableRows = [];
        hasHeader = false;
        tableAlignments = null;
      }
      offset = lineEnd + 1;
      continue;
    }

    const { stripped } = stripMathLinePrefix(line);
    const normalized = stripped.trim();

    if (tableStart === -1) {
      const headerCells = splitTableRow(normalized);
      if (headerCells) {
        const nextLine = lines[i + 1];
        if (nextLine !== undefined) {
          const nextNormalized = stripMathLinePrefix(nextLine).stripped.trim();
          const separator = parseSeparatorRow(nextNormalized);
          if (separator) {
            tableStart = lineStart;
            tableRows = [headerCells, separator.cells];
            hasHeader = true;
            tableAlignments = separator.alignments;
            tableStartLine = i + 1; // 行号从1开始

            // 跳过已消费的分隔行
            offset = lineEnd + 1;
            const nextLineStart = offset;
            const nextLineEnd = nextLineStart + nextLine.length;
            offset = nextLineEnd + 1;
            i += 1;
            continue;
          }
        }
      }
    } else {
      const rowCells = splitTableRow(normalized);
      if (rowCells) {
        tableRows.push(rowCells);
      } else {
        finalizeTable(lineStart - 1, i);
        tableStart = -1;
        tableRows = [];
        hasHeader = false;
        tableAlignments = null;
      }
    }

    offset = lineEnd + 1; // +1 for newline
  }

  // 处理文档末尾的表格
  if (tableStart !== -1) {
    const lastLineEnd = offset - 1;
    finalizeTable(lastLineEnd, lines.length);
  }

  return tables;
}

function buildLineOffsets(lines: string[]): number[] {
  const offsets: number[] = new Array(lines.length);
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    offsets[i] = offset;
    offset += lines[i].length + 1;
  }
  return offsets;
}

/**
 * 解析 Obsidian Callout 块
 *
 * 语法示例:
 * > [!NOTE] Title
 * > content...
 * > more...
 */
function parseCallouts(lines: string[], docLength?: number): CalloutMatch[] {
  const callouts: CalloutMatch[] = [];
  const offsets = buildLineOffsets(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^>\s*\[!([A-Za-z0-9_-]+)([+-])?\]\s*(.*)$/);
    if (!match) continue;

    const type = match[1].toLowerCase();
    const foldFlag = match[2] || '';
    const isFolded = foldFlag === '-';
    const rawTitle = match[3] ?? '';
    const title = rawTitle.trim() || type.toUpperCase();

    const contentLines: string[] = [];
    let endLine = i;

    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].match(/^>\s?/)) break;
      contentLines.push(lines[j].replace(/^>\s?/, ''));
      endLine = j;
    }

    const from = offsets[i];
    const lastLineEnd = offsets[endLine] + lines[endLine].length;
    const to = docLength !== undefined ? Math.min(lastLineEnd, docLength) : lastLineEnd;

    callouts.push({
      from,
      to,
      type,
      title,
      contentLines,
      startLine: i + 1,
      endLine: endLine + 1,
      isFolded,
    });

    i = endLine;
  }

  return callouts;
}

/**
 * 解析 HTML Details 块
 *
 * 语法示例:
 * <details open>
 * <summary>Title</summary>
 * content...
 * </details>
 */
function parseDetailsBlocks(lines: string[], docLength?: number): DetailsMatch[] {
  const details: DetailsMatch[] = [];
  const offsets = buildLineOffsets(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const startMatch = line.match(/^\s*<details([^>]*)>\s*$/i);
    if (!startMatch) continue;

    const attr = startMatch[1] ?? '';
    const isOpen = /\bopen\b/i.test(attr);

    let endLine = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].match(/^\s*<\/details>\s*$/i)) {
        endLine = j;
        break;
      }
    }
    if (endLine === -1) continue;

    let summary = '';
    const contentLines: string[] = [];
    let inSummary = false;

    for (let j = i + 1; j < endLine; j++) {
      const current = lines[j];

      if (!summary) {
        const inlineSummary = current.match(/<summary>([\s\S]*?)<\/summary>/i);
        if (inlineSummary) {
          summary = inlineSummary[1].trim();
          const remainder = current.replace(/<summary>[\s\S]*?<\/summary>/i, '').trim();
          if (remainder) contentLines.push(remainder);
          continue;
        }

        const startSummary = current.match(/<summary>([\s\S]*)/i);
        if (startSummary) {
          inSummary = true;
          summary = startSummary[1].trim();
          continue;
        }
      }

      if (inSummary) {
        const endSummary = current.match(/([\s\S]*?)<\/summary>/i);
        if (endSummary) {
          summary = `${summary}\n${endSummary[1].trim()}`.trim();
          inSummary = false;
          continue;
        }
        summary = `${summary}\n${current}`.trim();
        continue;
      }

      contentLines.push(current);
    }

    const from = offsets[i];
    const lastLineEnd = offsets[endLine] + lines[endLine].length;
    const to = docLength !== undefined ? Math.min(lastLineEnd, docLength) : lastLineEnd;

    details.push({
      from,
      to,
      summary: summary || 'Details',
      contentLines,
      startLine: i + 1,
      endLine: endLine + 1,
      isOpen,
    });

    i = endLine;
  }

  return details;
}

/**
 * 解析脚注定义块
 *
 * 语法示例:
 * [^1]: Footnote text
 *     continued line
 */
function parseFootnoteDefinitions(lines: string[], docLength?: number): FootnoteDefMatch[] {
  const footnotes: FootnoteDefMatch[] = [];
  const offsets = buildLineOffsets(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
    if (!match) continue;

    const identifier = match[1];
    const contentLines: string[] = [];
    const firstContent = match[2]?.trim();
    if (firstContent) contentLines.push(firstContent);

    let endLine = i;
    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j];
      if (nextLine.trim() === '') break;
      if (!/^\s{2,}|\t/.test(nextLine)) break;
      contentLines.push(nextLine.trim());
      endLine = j;
    }

    const from = offsets[i];
    const lastLineEnd = offsets[endLine] + lines[endLine].length;
    const to = docLength !== undefined ? Math.min(lastLineEnd, docLength) : lastLineEnd;

    footnotes.push({
      from,
      to,
      identifier,
      contentLines,
      startLine: i + 1,
      endLine: endLine + 1,
    });

    i = endLine;
  }

  return footnotes;
}

function normalizeReferenceLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseReferenceDestination(input: string): { url: string; title?: string } {
  let rest = input.trim();
  if (!rest) return { url: '' };

  let url = '';

  if (rest.startsWith('<')) {
    const end = rest.indexOf('>');
    if (end > 0) {
      url = rest.slice(1, end);
      rest = rest.slice(end + 1).trim();
    }
  }

  if (!url) {
    const urlMatch = rest.match(/^[^\s]+/);
    if (urlMatch) {
      url = urlMatch[0];
      rest = rest.slice(url.length).trim();
    }
  }

  if (!url) return { url: '' };

  let title: string | undefined;
  const titleMatch = rest.match(/^(?:"([^"]+)"|'([^']+)'|\(([^)]+)\))/);
  if (titleMatch) {
    title = titleMatch[1] ?? titleMatch[2] ?? titleMatch[3];
  }

  return { url, title };
}

function parseReferenceDefinitions(
  lines: string[],
  docLength?: number,
  codeBlocks: CodeBlockMatch[] = []
): { defs: Map<string, ReferenceDefinition>; matches: ReferenceDefMatch[] } {
  const defs = new Map<string, ReferenceDefinition>();
  const matches: ReferenceDefMatch[] = [];
  const offsets = buildLineOffsets(lines);

  const occupiedLines = new Set<number>();
  for (const block of codeBlocks) {
    for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
      occupiedLines.add(lineNum);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    if (occupiedLines.has(lineNumber)) continue;

    const line = lines[i];
    const match = line.match(/^\s*\[([^\]]+)\]:\s*(.*)$/);
    if (!match) continue;

    const rawLabel = match[1];
    let rest = (match[2] || '').trim();

    let endLine = i;
    const continuation: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j];
      if (nextLine.trim() === '') break;
      if (!/^\s{2,}|\t/.test(nextLine)) break;
      continuation.push(nextLine.trim());
      endLine = j;
    }

    if (continuation.length > 0) {
      rest = `${rest} ${continuation.join(' ')}`.trim();
    }

    const { url, title } = parseReferenceDestination(rest);
    if (!url) {
      i = endLine;
      continue;
    }

    const label = normalizeReferenceLabel(rawLabel);
    if (!defs.has(label)) {
      defs.set(label, { url, title });
    }

    const from = offsets[i];
    const lastLineEnd = offsets[endLine] + lines[endLine].length;
    const to = docLength !== undefined ? Math.min(lastLineEnd, docLength) : lastLineEnd;

    matches.push({
      from,
      to,
      label,
      url,
      title,
      startLine: i + 1,
      endLine: endLine + 1,
    });

    i = endLine;
  }

  return { defs, matches };
}

function buildReferenceSignature(defs: Map<string, ReferenceDefinition>): string {
  if (!defs || defs.size === 0) return '';
  const entries = Array.from(defs.entries()).sort(([a], [b]) => a.localeCompare(b));
  return entries
    .map(([label, def]) => `${label}:${def.url}:${def.title ?? ''}`)
    .join('|');
}

function ensureCachedDocument(doc: Text): {
  text: string;
  lines: string[];
  codeBlocks: CodeBlockMatch[];
  mathBlocks: MathBlockMatch[];
  tables: TableMatch[];
  callouts: CalloutMatch[];
  details: DetailsMatch[];
  footnoteDefs: FootnoteDefMatch[];
  referenceDefs: Map<string, ReferenceDefinition>;
  referenceDefMatches: ReferenceDefMatch[];
} {
  if (cachedDoc === doc) {
    return {
      text: cachedText,
      lines: cachedLines,
      codeBlocks: cachedCodeBlocks,
      mathBlocks: cachedMathBlocks,
      tables: cachedTables,
      callouts: cachedCallouts,
      details: cachedDetails,
      footnoteDefs: cachedFootnoteDefs,
      referenceDefs: cachedReferenceDefs,
      referenceDefMatches: cachedReferenceDefMatches,
    };
  }

  cachedDoc = doc;
  cachedText = doc.toString();
  cachedLines = cachedText.split('\n');
  cachedCodeBlocks = parseCodeBlocks(cachedLines, doc.length);
  const ignoredLines = new Set<number>();
  for (const block of cachedCodeBlocks) {
    for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
      ignoredLines.add(lineNum);
    }
  }
  cachedMathBlocks = parseMathBlocks(cachedLines, doc.length, ignoredLines);
  cachedTables = parseTables(cachedLines, doc.length, ignoredLines);
  cachedCallouts = parseCallouts(cachedLines, doc.length);
  cachedDetails = parseDetailsBlocks(cachedLines, doc.length);
  cachedFootnoteDefs = parseFootnoteDefinitions(cachedLines, doc.length);
  const referenceData = parseReferenceDefinitions(cachedLines, doc.length, cachedCodeBlocks);
  cachedReferenceDefs = referenceData.defs;
  cachedReferenceDefMatches = referenceData.matches;

  return {
    text: cachedText,
    lines: cachedLines,
    codeBlocks: cachedCodeBlocks,
    mathBlocks: cachedMathBlocks,
    tables: cachedTables,
    callouts: cachedCallouts,
    details: cachedDetails,
    footnoteDefs: cachedFootnoteDefs,
    referenceDefs: cachedReferenceDefs,
    referenceDefMatches: cachedReferenceDefMatches,
  };
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
function parseDocument(
  state: EditorState,
  viewportOnly: boolean = false,
  visibleRanges: readonly { from: number; to: number }[] = []
): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const doc = state.doc;

  // DEBUG: Enhanced logging for long file truncation diagnosis
  debugLog('[parseDocument] ===== START PARSING =====');
  debugLog('[parseDocument] Doc lines:', doc.lines, 'Doc length:', doc.length);
  debugLog('[parseDocument] ViewportOnly:', viewportOnly);
  debugLog('[parseDocument] VisibleRanges:', visibleRanges.map(r => ({ from: r.from, to: r.to })));

  // 性能优化：缓存全文解析结果（仅在 docChanged 时更新）
  const cached = ensureCachedDocument(doc);
  const text = cached.text;
  const lines = cached.lines;
  const codeBlocks = cached.codeBlocks;
  const mathBlocks = cached.mathBlocks;
  const tables = cached.tables;
  const callouts = cached.callouts;
  const detailsBlocks = cached.details;
  const footnoteDefs = cached.footnoteDefs;
  const referenceDefs = cached.referenceDefs;
  const referenceDefMatches = cached.referenceDefMatches;
  const referenceSignature = buildReferenceSignature(referenceDefs);

  debugLog('[parseDocument] Text length:', text.length, 'Lines array length:', lines.length);

  // 用于标记已被块级元素占用的行
  const occupiedLines = new Set<number>();

  // 1. 先解析所有代码块（多行块级元素）
  debugLog('[parseDocument] Found', codeBlocks.length, 'code blocks');

  for (const block of codeBlocks) {
    // 检查代码块是否应该被reveal (element-level check)
    const shouldReveal = shouldRevealAt(
      state,
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

  // 2. 解析所有数学公式块（多行块级元素）
  debugLog('[parseDocument] Found', mathBlocks.length, 'math blocks');

  for (const block of mathBlocks) {
    // 检查公式块是否应该被reveal (element-level check)
    const shouldReveal = shouldRevealAt(
      state,
      block.from,
      block.to,
      ElementType.MATH_BLOCK
    );

    if (!shouldReveal) {
      // 添加公式块元素
      elements.push({
        type: ElementType.MATH_BLOCK,
        from: block.from,
        to: block.to,
        lineNumber: block.startLine,
        latex: block.latex,
        isBlock: true,
        startLine: block.startLine,
        endLine: block.endLine,
        decorationData: {
          isMultiLine: block.startLine !== block.endLine,
        },
      });

      // 标记这些行已被公式块占用
      for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
        occupiedLines.add(lineNum);
      }
    } else {
      // 公式块被reveal，添加编辑样式
      for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
        occupiedLines.add(lineNum);
        const line = doc.line(lineNum);
        elements.push({
          type: ElementType.MATH_BLOCK,
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

  // 3. 解析所有表格（多行块级元素）
  debugLog('[parseDocument] Found', tables.length, 'tables');

  for (const table of tables) {
    // 检查表格是否应该被reveal (element-level check)
    const shouldReveal = shouldRevealAt(
      state,
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
          alignments: table.alignments,
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

  // 4. 解析所有 Callout（Obsidian）
  debugLog('[parseDocument] Found', callouts.length, 'callouts');

  for (const callout of callouts) {
    const shouldReveal = shouldRevealAt(
      state,
      callout.from,
      callout.to,
      ElementType.CALLOUT
    );

    if (!shouldReveal) {
      elements.push({
        type: ElementType.CALLOUT,
        from: callout.from,
        to: callout.to,
        lineNumber: callout.startLine,
        startLine: callout.startLine,
        endLine: callout.endLine,
        decorationData: {
          type: callout.type,
          title: callout.title,
          contentLines: callout.contentLines,
          isMultiLine: callout.startLine !== callout.endLine,
          isFolded: callout.isFolded,
        },
      });

      for (let lineNum = callout.startLine; lineNum <= callout.endLine; lineNum++) {
        occupiedLines.add(lineNum);
      }
    } else {
      for (let lineNum = callout.startLine; lineNum <= callout.endLine; lineNum++) {
        occupiedLines.add(lineNum);
        const line = doc.line(lineNum);
        elements.push({
          type: ElementType.CALLOUT,
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

  // 5. 解析所有 Details（HTML <details>）
  debugLog('[parseDocument] Found', detailsBlocks.length, 'details blocks');

  for (const details of detailsBlocks) {
    const shouldReveal = shouldRevealAt(
      state,
      details.from,
      details.to,
      ElementType.DETAILS
    );

    if (!shouldReveal) {
      elements.push({
        type: ElementType.DETAILS,
        from: details.from,
        to: details.to,
        lineNumber: details.startLine,
        startLine: details.startLine,
        endLine: details.endLine,
        decorationData: {
          summary: details.summary,
          contentLines: details.contentLines,
          isMultiLine: details.startLine !== details.endLine,
          isOpen: details.isOpen,
        },
      });

      for (let lineNum = details.startLine; lineNum <= details.endLine; lineNum++) {
        occupiedLines.add(lineNum);
      }
    } else {
      for (let lineNum = details.startLine; lineNum <= details.endLine; lineNum++) {
        occupiedLines.add(lineNum);
        const line = doc.line(lineNum);
        elements.push({
          type: ElementType.DETAILS,
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

  // 6. 解析脚注定义（[^id]:）
  debugLog('[parseDocument] Found', footnoteDefs.length, 'footnote definitions');

  for (const footnote of footnoteDefs) {
    const shouldReveal = shouldRevealAt(
      state,
      footnote.from,
      footnote.to,
      ElementType.FOOTNOTE_DEF
    );

    if (!shouldReveal) {
      elements.push({
        type: ElementType.FOOTNOTE_DEF,
        from: footnote.from,
        to: footnote.to,
        lineNumber: footnote.startLine,
        startLine: footnote.startLine,
        endLine: footnote.endLine,
        decorationData: {
          identifier: footnote.identifier,
          contentLines: footnote.contentLines,
          isMultiLine: footnote.startLine !== footnote.endLine,
        },
      });

      for (let lineNum = footnote.startLine; lineNum <= footnote.endLine; lineNum++) {
        occupiedLines.add(lineNum);
      }
    } else {
      for (let lineNum = footnote.startLine; lineNum <= footnote.endLine; lineNum++) {
        occupiedLines.add(lineNum);
        const line = doc.line(lineNum);
        elements.push({
          type: ElementType.FOOTNOTE_DEF,
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

  // 7. 解析引用式链接定义（[label]: url）
  debugLog('[parseDocument] Found', referenceDefMatches.length, 'reference definitions');

  for (const referenceDef of referenceDefMatches) {
    const shouldReveal = shouldRevealAt(
      state,
      referenceDef.from,
      referenceDef.to,
      ElementType.REFERENCE_DEF
    );

    if (!shouldReveal) {
      elements.push({
        type: ElementType.REFERENCE_DEF,
        from: referenceDef.from,
        to: referenceDef.to,
        lineNumber: referenceDef.startLine,
        startLine: referenceDef.startLine,
        endLine: referenceDef.endLine,
        decorationData: {
          label: referenceDef.label,
          url: referenceDef.url,
          title: referenceDef.title,
          isMultiLine: referenceDef.startLine !== referenceDef.endLine,
        },
      });

      for (let lineNum = referenceDef.startLine; lineNum <= referenceDef.endLine; lineNum++) {
        occupiedLines.add(lineNum);
      }
    } else {
      for (let lineNum = referenceDef.startLine; lineNum <= referenceDef.endLine; lineNum++) {
        occupiedLines.add(lineNum);
        const line = doc.line(lineNum);
        elements.push({
          type: ElementType.REFERENCE_DEF,
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

  // 8. 逐行解析其他元素（跳过已占用的行）
  // CRITICAL FIX: Ensure we parse the entire document
  // Always parse full document to avoid truncation issues
  const ranges = viewportOnly && visibleRanges.length > 0
    ? visibleRanges
    : [{ from: 0, to: doc.length }];

  // DEBUG: Enhanced range logging
  debugLog('[parseDocument] Ranges count:', ranges.length);
  debugLog('[parseDocument] Ranges:', ranges.map(r => ({ from: r.from, to: r.to })));
  debugLog('[parseDocument] Using viewportOnly:', viewportOnly);
  debugLog('[parseDocument] Document length:', doc.length, 'Last line:', doc.lines);

  const processedLines = new Set<number>();

  for (const range of ranges) {
    // CRITICAL FIX: Ensure range.to doesn't exceed document length
    const safeTo = Math.min(range.to, doc.length);
    
    // CRITICAL FIX: Handle edge case where safeTo is 0 (empty document)
    if (safeTo === 0) {
      debugLog('[parseDocument] Empty document, skipping range');
      continue;
    }
    
    const startLine = doc.lineAt(range.from);
    const endLine = doc.lineAt(safeTo);

    const bufferedStart = viewportOnly
      ? Math.max(1, startLine.number - VIEWPORT_LINE_BUFFER)
      : startLine.number;
    const bufferedEnd = viewportOnly
      ? Math.min(doc.lines, endLine.number + VIEWPORT_LINE_BUFFER)
      : endLine.number;

    debugLog('[parseDocument] Processing range - startLine:', bufferedStart, 'endLine:', bufferedEnd, 'total lines to process:', bufferedEnd - bufferedStart + 1);

    // CRITICAL FIX: Ensure we process ALL lines including the last one
    for (let lineNum = bufferedStart; lineNum <= bufferedEnd; lineNum++) {
      if (processedLines.has(lineNum)) continue;
      processedLines.add(lineNum);
      // 跳过已被块级元素占用的行
      if (occupiedLines.has(lineNum)) {
        if (DEBUG_MODE) {
          debugLog('[parseDocument] Skipping occupied line:', lineNum);
        }
        continue;
      }

      const line = doc.line(lineNum);
      const lineText = line.text;

      // 尝试从缓存获取
      const cacheKey = `${lineNum}:${lineText}:${referenceSignature}`;
      const cached = lineElementCache.get(cacheKey);

      if (cached) {
        elements.push(...cached);
        continue;
      }

      // 解析这一行
      const lineElements = parseLineElements(state, line, lineNum, lineText, referenceDefs);

      // 存入缓存
      if (lineElements.length > 0) {
        lineElementCache.set(cacheKey, lineElements);
        elements.push(...lineElements);
      }
    }
  }

  // DEBUG: Final statistics
  debugLog('[parseDocument] ===== PARSING COMPLETE =====');
  debugLog('[parseDocument] Total elements parsed:', elements.length);
  debugLog('[parseDocument] Occupied lines:', occupiedLines.size);
  debugLog('[parseDocument] Elements by type:', elements.reduce((acc, el) => {
    const typeName = ElementType[el.type];
    acc[typeName] = (acc[typeName] || 0) + 1;
    return acc;
  }, {} as Record<string, number>));

  return elements;
}

/**
 * 诊断用途：从纯文本解析文档元素（不依赖 EditorView）
 * - 不做光标 reveal 判断
 * - 解析完整文档
 */
export function parseDocumentFromText(text: string): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const lines = text.split('\n');
  const doc = Text.of(lines);
  const state = EditorState.create({ doc });

  const codeBlocks = parseCodeBlocks(lines, doc.length);
  const ignoredLines = new Set<number>();
  for (const block of codeBlocks) {
    for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
      ignoredLines.add(lineNum);
    }
  }
  const mathBlocks = parseMathBlocks(lines, doc.length, ignoredLines);
  const tables = parseTables(lines, doc.length, ignoredLines);
  const callouts = parseCallouts(lines, doc.length);
  const detailsBlocks = parseDetailsBlocks(lines, doc.length);
  const footnoteDefs = parseFootnoteDefinitions(lines, doc.length);
  const referenceData = parseReferenceDefinitions(lines, doc.length, codeBlocks);
  const referenceDefs = referenceData.defs;
  const referenceDefMatches = referenceData.matches;

  const occupiedLines = new Set<number>();

  for (const block of codeBlocks) {
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
    for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
      occupiedLines.add(lineNum);
    }
  }

  for (const block of mathBlocks) {
    elements.push({
      type: ElementType.MATH_BLOCK,
      from: block.from,
      to: block.to,
      lineNumber: block.startLine,
      latex: block.latex,
      isBlock: true,
      startLine: block.startLine,
      endLine: block.endLine,
      decorationData: {
        isMultiLine: block.startLine !== block.endLine,
      },
    });
    for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
      occupiedLines.add(lineNum);
    }
  }

  for (const table of tables) {
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
        alignments: table.alignments,
        isMultiLine: table.startLine !== table.endLine,
      },
    });
    for (let lineNum = table.startLine; lineNum <= table.endLine; lineNum++) {
      occupiedLines.add(lineNum);
    }
  }

  for (const callout of callouts) {
    elements.push({
      type: ElementType.CALLOUT,
      from: callout.from,
      to: callout.to,
      lineNumber: callout.startLine,
      startLine: callout.startLine,
      endLine: callout.endLine,
      decorationData: {
        type: callout.type,
        title: callout.title,
        contentLines: callout.contentLines,
        isMultiLine: callout.startLine !== callout.endLine,
        isFolded: callout.isFolded,
      },
    });
    for (let lineNum = callout.startLine; lineNum <= callout.endLine; lineNum++) {
      occupiedLines.add(lineNum);
    }
  }

  for (const details of detailsBlocks) {
    elements.push({
      type: ElementType.DETAILS,
      from: details.from,
      to: details.to,
      lineNumber: details.startLine,
      startLine: details.startLine,
      endLine: details.endLine,
      decorationData: {
        summary: details.summary,
        contentLines: details.contentLines,
        isMultiLine: details.startLine !== details.endLine,
        isOpen: details.isOpen,
      },
    });
    for (let lineNum = details.startLine; lineNum <= details.endLine; lineNum++) {
      occupiedLines.add(lineNum);
    }
  }

  for (const footnote of footnoteDefs) {
    elements.push({
      type: ElementType.FOOTNOTE_DEF,
      from: footnote.from,
      to: footnote.to,
      lineNumber: footnote.startLine,
      startLine: footnote.startLine,
      endLine: footnote.endLine,
      decorationData: {
        identifier: footnote.identifier,
        contentLines: footnote.contentLines,
        isMultiLine: footnote.startLine !== footnote.endLine,
      },
    });
    for (let lineNum = footnote.startLine; lineNum <= footnote.endLine; lineNum++) {
      occupiedLines.add(lineNum);
    }
  }

  for (const referenceDef of referenceDefMatches) {
    elements.push({
      type: ElementType.REFERENCE_DEF,
      from: referenceDef.from,
      to: referenceDef.to,
      lineNumber: referenceDef.startLine,
      startLine: referenceDef.startLine,
      endLine: referenceDef.endLine,
      decorationData: {
        label: referenceDef.label,
        url: referenceDef.url,
        title: referenceDef.title,
        isMultiLine: referenceDef.startLine !== referenceDef.endLine,
      },
    });

    for (let lineNum = referenceDef.startLine; lineNum <= referenceDef.endLine; lineNum++) {
      occupiedLines.add(lineNum);
    }
  }

  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    if (occupiedLines.has(lineNum)) continue;
    const line = doc.line(lineNum);
    const lineText = line.text;
    const lineElements = parseLineElements(state, line, lineNum, lineText, referenceDefs);
    elements.push(...lineElements);
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
  lineText: string,
  referenceDefs: Map<string, ReferenceDefinition>
): ParsedElement[] {
  const elements: ParsedElement[] = [];

  // NOTE: We no longer skip parsing based on line reveal
  // Instead, we check element-level reveal for each element
  // This enables Obsidian-style granular reveal (e.g., only reveal the bold text, not the whole line)

  // NOTE: Block math ($$) is now handled by parseMathBlocks() in parseDocument()
  // This ensures proper multi-line block math support

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

    // 2. Hide the marker (>) only
    elements.push({
      type: ElementType.BLOCKQUOTE,
      from: line.from,
      to: blockquote.markerTo,
      lineNumber: lineNum,
      content: content,
      decorationData: {
        isMarkerHide: true,
      },
    });
  }

  // 检测列表（使用parseListItem）
  let listItem = parseListItem(lineText, line.from);
  if (!listItem && blockquote) {
    const contentStart = blockquote.markerTo - line.from;
    const contentText = lineText.slice(contentStart);
    listItem = parseListItem(contentText, line.from + contentStart);
  }
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

  // 检测横线（支持引用/列表前缀）
  const hrPattern = /^([-*_])(?:\s*\1){2,}\s*$/;
  const hrCandidate = stripMathLinePrefix(lineText, { stripList: false }).stripped.trim();
  const listHrCandidate = stripMathLinePrefix(lineText).stripped.trim();
  if (hrPattern.test(hrCandidate) || hrPattern.test(listHrCandidate)) {
    // line.to is already the end of line (newline excluded)
    const lineEnd = line.to;
    elements.push({
      type: ElementType.HORIZONTAL_RULE,
      from: line.from,
      to: lineEnd,
      lineNumber: lineNum,
      decorationData: {
        originalFrom: line.from,
        originalTo: lineEnd,
      },
    });
    return elements;
  }

  // 解析行内元素 (公式、粗体、链接等)
  const inlineElements = parseInlineElements(lineText, line.from, lineNum, referenceDefs);
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
  lineNum: number,
  referenceDefs: Map<string, ReferenceDefinition>
): ParsedElement[] {
  const elements: ParsedElement[] = [];
  let match: RegExpExecArray | null;

  // 重置所有正则表达式的lastIndex
  resetRegexPatterns();

  const isEscaped = (text: string, index: number): boolean => {
    let backslashes = 0;
    for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) {
      backslashes++;
    }
    return backslashes % 2 === 1;
  };

  const shouldSkipMatch = (startIndex: number, endMarkerIndex?: number): boolean => {
    if (isEscaped(lineText, startIndex)) return true;
    if (endMarkerIndex !== undefined && isEscaped(lineText, endMarkerIndex)) return true;
    return false;
  };

  const isInsideMarkdownLink = (index: number): boolean => {
    const linkStart = lineText.lastIndexOf('](', index);
    if (linkStart === -1) return false;
    const linkEnd = lineText.indexOf(')', linkStart + 2);
    return linkEnd !== -1 && index < linkEnd;
  };

  const resolveReference = (labelRaw: string): ReferenceDefinition | null => {
    const key = normalizeReferenceLabel(labelRaw);
    if (!key) return null;
    return referenceDefs.get(key) ?? null;
  };

  const hasReferenceDefs = referenceDefs.size > 0;

  // 1. 行内公式: \( ... \)
  while ((match = REGEX_PATTERNS.inlineMathParen.exec(lineText)) !== null) {
    const startIndex = match.index;
    const endMarkerIndex = match.index + match[0].length - 2; // backslash before )
    if (shouldSkipMatch(startIndex, endMarkerIndex)) continue;

    const latex = match[1];
    if (latex.includes('\n')) continue;

    if (!latex || latex.trim() === '') {
      console.warn('[parseInlineElements] Empty latex for inline math (paren) at', lineFrom + match.index);
      continue;
    }

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
        contentFrom: lineFrom + match.index + 2,
        contentTo: lineFrom + match.index + match[0].length - 2,
      },
    });
  }

  // 2. 行内公式: $...$
  while ((match = REGEX_PATTERNS.inlineMath.exec(lineText)) !== null) {
    const startIndex = match.index;
    const endMarkerIndex = match.index + match[0].length - 1;
    if (shouldSkipMatch(startIndex, endMarkerIndex)) continue;

    const latex = match[1];
    if (latex.includes('\n')) continue;
    
    // PHASE 4 FIX: Validate latex parameter to prevent "undefined" rendering
    if (!latex || latex.trim() === '') {
      console.warn('[parseInlineElements] Empty latex for inline math at', lineFrom + match.index);
      continue;
    }

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

  // 3. 粗体+斜体: ***...***
  while ((match = REGEX_PATTERNS.boldItalic.exec(lineText)) !== null) {
    const startIndex = match.index;
    const endMarkerIndex = match.index + match[0].length - 3;
    if (shouldSkipMatch(startIndex, endMarkerIndex)) continue;

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
    const startIndex = match.index;
    const endMarkerIndex = match.index + match[0].length - 2;
    if (shouldSkipMatch(startIndex, endMarkerIndex)) continue;

    // CRITICAL: Ensure we capture the entire **text** including markers
    const fullMatch = match[0]; // e.g., "**bold**"
    const content = match[1];   // e.g., "bold"
    
    // PHASE 3 FIX: Validate range to prevent text duplication
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + fullMatch.length;
    
    if (from >= to) {
      console.warn('[parseInlineElements] Invalid bold range:', from, to, 'content:', content);
      continue;
    }
    
    elements.push({
      type: ElementType.INLINE_BOLD,
      from: from,
      to: to,
      lineNumber: lineNum,
      content: content,
      decorationData: {
        className: 'cm-strong',
        syntaxFrom: from,
        syntaxTo: to,
        contentFrom: from + 2,
        contentTo: to - 2,
      },
    });
  }

  // 4. 斜体: *...* 或 _..._
  while ((match = REGEX_PATTERNS.italic.exec(lineText)) !== null) {
    const startIndex = match.index;
    const endMarkerIndex = match.index + match[0].length - 1;
    if (shouldSkipMatch(startIndex, endMarkerIndex)) continue;

    const content = match[1] || match[2];
    const fullMatch = match[0]; // e.g., "*italic*" or "_italic_"
    
    // PHASE 3 FIX: Validate range to prevent text duplication
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + fullMatch.length;
    
    if (from >= to) {
      console.warn('[parseInlineElements] Invalid italic range:', from, to, 'content:', content);
      continue;
    }
    
    elements.push({
      type: ElementType.INLINE_ITALIC,
      from: from,
      to: to,
      lineNumber: lineNum,
      content: content,
      decorationData: {
        className: 'cm-em',
        syntaxFrom: from,
        syntaxTo: to,
        contentFrom: from + 1,
        contentTo: to - 1,
      },
    });
  }

  // 5. 删除线: ~~...~~
  while ((match = REGEX_PATTERNS.strikethrough.exec(lineText)) !== null) {
    const startIndex = match.index;
    const endMarkerIndex = match.index + match[0].length - 2;
    if (shouldSkipMatch(startIndex, endMarkerIndex)) continue;

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
    const startIndex = match.index;
    const endMarkerIndex = match.index + match[0].length - 2;
    if (shouldSkipMatch(startIndex, endMarkerIndex)) continue;

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

  // 7. 行内代码: ``...`` (允许单个反引号)
  while ((match = REGEX_PATTERNS.inlineCodeDouble.exec(lineText)) !== null) {
    const startIndex = match.index;
    const endMarkerIndex = match.index + match[0].length - 2;
    if (shouldSkipMatch(startIndex, endMarkerIndex)) continue;

    const fullMatch = match[0]; // e.g., "``code``"
    const content = match[1];   // e.g., "code"

    const from = lineFrom + match.index;
    const to = lineFrom + match.index + fullMatch.length;

    if (from >= to) {
      console.warn('[parseInlineElements] Invalid inline code (double) range:', from, to, 'content:', content);
      continue;
    }

    elements.push({
      type: ElementType.INLINE_CODE,
      from: from,
      to: to,
      lineNumber: lineNum,
      content: content,
      decorationData: {
        className: 'cm-inline-code',
        syntaxFrom: from,
        syntaxTo: to,
        contentFrom: from + 2,
        contentTo: to - 2,
      },
    });
  }

  // 8. 行内代码: `...`
  while ((match = REGEX_PATTERNS.inlineCode.exec(lineText)) !== null) {
    const startIndex = match.index;
    const endMarkerIndex = match.index + match[0].length - 1;
    if (shouldSkipMatch(startIndex, endMarkerIndex)) continue;

    const fullMatch = match[0]; // e.g., "`code`"
    const content = match[1];   // e.g., "code"

    // PHASE 3 FIX: Validate range to prevent text duplication
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + fullMatch.length;

    if (from >= to) {
      console.warn('[parseInlineElements] Invalid inline code range:', from, to, 'content:', content);
      continue;
    }

    elements.push({
      type: ElementType.INLINE_CODE,
      from: from,
      to: to,
      lineNumber: lineNum,
      content: content,
      decorationData: {
        className: 'cm-inline-code',
        syntaxFrom: from,
        syntaxTo: to,
        contentFrom: from + 1,
        contentTo: to - 1,
      },
    });
  }

  // 9. 批注链接: [[file.pdf#ann-uuid]]
  while ((match = REGEX_PATTERNS.annotationLink.exec(lineText)) !== null) {
    if (shouldSkipMatch(match.index)) continue;

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

  // 10. Wiki链接: [[page]] / [[page|display]] / [[page#heading|alias]]
  while ((match = REGEX_PATTERNS.wikiLink.exec(lineText)) !== null) {
    if (shouldSkipMatch(match.index)) continue;

    const target = match[1];
    const heading = match[2];
    const alias = match[3];
    const fullTarget = heading ? `${target}#${heading}` : target;
    const displayText = alias || fullTarget;
    
    // PHASE 3 FIX: Validate range to prevent text duplication
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + match[0].length;
    
    if (from >= to) {
      console.warn('[parseInlineElements] Invalid wiki link range:', from, to, 'target:', target);
      continue;
    }

    elements.push({
      type: ElementType.INLINE_LINK,
      from: from,
      to: to,
      lineNumber: lineNum,
      content: displayText,
      decorationData: {
        type: 'wiki-link',
        url: fullTarget,
        isWikiLink: true,
        syntaxFrom: from,
        syntaxTo: to,
        contentFrom: from + 2,
        contentTo: to - 2,
      },
    });
  }

  // 10. Markdown链接: [text](url)
  while ((match = REGEX_PATTERNS.link.exec(lineText)) !== null) {
    if (shouldSkipMatch(match.index)) continue;

    // PHASE 3 FIX: Validate range to prevent text duplication
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + match[0].length;
    
    if (from >= to) {
      console.warn('[parseInlineElements] Invalid link range:', from, to, 'text:', match[1]);
      continue;
    }
    
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

  if (hasReferenceDefs) {
    // 10b. 引用式图片: ![alt][label] / ![alt][]
    while ((match = REGEX_PATTERNS.referenceImage.exec(lineText)) !== null) {
      if (shouldSkipMatch(match.index)) continue;

      const altText = match[1] || '';
      const label = match[2] && match[2].trim().length > 0 ? match[2] : altText;
      const def = resolveReference(label);
      if (!def) continue;

      const from = lineFrom + match.index;
      const to = lineFrom + match.index + match[0].length;
      if (from >= to) {
        console.warn('[parseInlineElements] Invalid reference image range:', from, to, 'alt:', altText);
        continue;
      }

      elements.push({
        type: ElementType.INLINE_IMAGE,
        from: from,
        to: to,
        lineNumber: lineNum,
        content: altText,
        decorationData: {
          type: 'image',
          url: def.url,
          alt: altText,
          title: def.title,
          isReference: true,
          syntaxFrom: from,
          syntaxTo: to,
          contentFrom: from + 2,
          contentTo: from + 2 + altText.length,
        },
      });
    }

    // 10c. 引用式链接: [text][label] / [text][]
    while ((match = REGEX_PATTERNS.referenceLink.exec(lineText)) !== null) {
      if (shouldSkipMatch(match.index)) continue;
      if (match.index > 0 && lineText[match.index - 1] === '!') continue;

      const text = match[1];
      const label = match[2] && match[2].trim().length > 0 ? match[2] : text;
      const def = resolveReference(label);
      if (!def) continue;

      const from = lineFrom + match.index;
      const to = lineFrom + match.index + match[0].length;
      if (from >= to) {
        console.warn('[parseInlineElements] Invalid reference link range:', from, to, 'text:', text);
        continue;
      }

      elements.push({
        type: ElementType.INLINE_LINK,
        from: from,
        to: to,
        lineNumber: lineNum,
        content: text,
        decorationData: {
          type: 'reference-link',
          url: def.url,
          title: def.title,
          isWikiLink: false,
          syntaxFrom: from,
          syntaxTo: to,
          contentFrom: from + 1,
          contentTo: from + 1 + text.length,
        },
      });
    }

    // 10d. 快捷引用式链接: [label]
    while ((match = REGEX_PATTERNS.referenceLinkShortcut.exec(lineText)) !== null) {
      const startIndex = match.index;
      const endIndex = match.index + match[0].length - 1;
      if (shouldSkipMatch(startIndex, endIndex)) continue;
      if (lineText[startIndex + 1] === '^') continue; // footnote
      if (startIndex > 0 && lineText[startIndex - 1] === '!') continue; // image
      if (lineText[startIndex + 1] === '[') continue; // wiki link [[...]]
      if (startIndex > 0 && lineText[startIndex - 1] === ']') continue; // part of [text][label]

      const nextChar = lineText[endIndex + 1];
      if (nextChar === '(' || nextChar === '[') continue;

      if (isInsideMarkdownLink(startIndex)) continue;

      const labelText = match[1];
      const def = resolveReference(labelText);
      if (!def) continue;

      const from = lineFrom + startIndex;
      const to = lineFrom + match.index + match[0].length;
      if (from >= to) {
        console.warn('[parseInlineElements] Invalid reference shortcut range:', from, to, 'label:', labelText);
        continue;
      }

      elements.push({
        type: ElementType.INLINE_LINK,
        from: from,
        to: to,
        lineNumber: lineNum,
        content: labelText,
        decorationData: {
          type: 'reference-link',
          url: def.url,
          title: def.title,
          isWikiLink: false,
          syntaxFrom: from,
          syntaxTo: to,
          contentFrom: from + 1,
          contentTo: from + 1 + labelText.length,
        },
      });
    }

    // 10e. 快捷引用式图片: ![alt]
    while ((match = REGEX_PATTERNS.referenceImageShortcut.exec(lineText)) !== null) {
      const startIndex = match.index;
      const endIndex = match.index + match[0].length - 1;
      if (shouldSkipMatch(startIndex, endIndex)) continue;

      if (lineText[startIndex + 2] === '[') continue; // embed ![[...]]
      const nextChar = lineText[endIndex + 1];
      if (nextChar === '(' || nextChar === '[') continue;

      const altText = match[1] || '';
      const def = resolveReference(altText);
      if (!def) continue;

      const from = lineFrom + startIndex;
      const to = lineFrom + match.index + match[0].length;
      if (from >= to) {
        console.warn('[parseInlineElements] Invalid reference image shortcut range:', from, to, 'alt:', altText);
        continue;
      }

      elements.push({
        type: ElementType.INLINE_IMAGE,
        from: from,
        to: to,
        lineNumber: lineNum,
        content: altText,
        decorationData: {
          type: 'image',
          url: def.url,
          alt: altText,
          title: def.title,
          isReference: true,
          syntaxFrom: from,
          syntaxTo: to,
          contentFrom: from + 2,
          contentTo: from + 2 + altText.length,
        },
      });
    }
  }

  // 11. 嵌入: ![[file]]
  while ((match = REGEX_PATTERNS.embed.exec(lineText)) !== null) {
    if (shouldSkipMatch(match.index)) continue;

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
    if (shouldSkipMatch(match.index)) continue;

    // PHASE 3 FIX: Validate range to prevent text duplication
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + match[0].length;
    
    if (from >= to) {
      console.warn('[parseInlineElements] Invalid image range:', from, to, 'alt:', match[1]);
      continue;
    }
    
    elements.push({
      type: ElementType.INLINE_IMAGE,
      from: from,
      to: to,
      lineNumber: lineNum,
      content: match[1],
      decorationData: {
        type: 'image',
        url: match[3],
        alt: match[1],
        width: match[2] ? parseInt(match[2]) : undefined,
        syntaxFrom: from,
        syntaxTo: to,
        contentFrom: from + 2,
        contentTo: from + 2 + match[1].length,
      },
    });
  }

  // 13. 上标: ^text^
  while ((match = REGEX_PATTERNS.superscript.exec(lineText)) !== null) {
    const startIndex = match.index;
    const endMarkerIndex = match.index + match[0].length - 1;
    if (shouldSkipMatch(startIndex, endMarkerIndex)) continue;

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
    const startIndex = match.index;
    const endMarkerIndex = match.index + match[0].length - 1;
    if (shouldSkipMatch(startIndex, endMarkerIndex)) continue;

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
    if (shouldSkipMatch(match.index)) continue;

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
    if (shouldSkipMatch(match.index)) continue;

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
    if (shouldSkipMatch(match.index)) continue;

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

  // 18. Autolink: <https://...> / <mailto:...>
  while ((match = REGEX_PATTERNS.autoLink.exec(lineText)) !== null) {
    const startIndex = match.index;
    const endMarkerIndex = match.index + match[0].length - 1;
    if (shouldSkipMatch(startIndex, endMarkerIndex)) continue;

    const url = match[1];
    elements.push({
      type: ElementType.INLINE_LINK,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      lineNumber: lineNum,
      content: url,
      decorationData: {
        url,
        isWikiLink: false,
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + match[0].length,
        contentFrom: lineFrom + match.index + 1,
        contentTo: lineFrom + match.index + match[0].length - 1,
      },
    });
  }

  // 19. Bare URL (GFM autolink literal)
  while ((match = REGEX_PATTERNS.bareUrl.exec(lineText)) !== null) {
    const startIndex = match.index;
    if (shouldSkipMatch(startIndex)) continue;
    const url = match[0];

    // Skip URLs that are already part of markdown links or autolinks
    if (isInsideMarkdownLink(startIndex)) continue;
    if (lineText[startIndex - 1] === '<' && lineText[startIndex + url.length] === '>') continue;

    elements.push({
      type: ElementType.INLINE_LINK,
      from: lineFrom + match.index,
      to: lineFrom + match.index + url.length,
      lineNumber: lineNum,
      content: url,
      decorationData: {
        url,
        isWikiLink: false,
        syntaxFrom: lineFrom + match.index,
        syntaxTo: lineFrom + match.index + url.length,
        contentFrom: lineFrom + match.index,
        contentTo: lineFrom + match.index + url.length,
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

  const NO_NESTING_TYPES = new Set<ElementType>([
    ElementType.INLINE_CODE,
    ElementType.MATH_INLINE,
  ]);

  const INLINE_CONTAINER_TYPES = new Set<ElementType>([
    ElementType.INLINE_BOLD,
    ElementType.INLINE_ITALIC,
    ElementType.INLINE_CODE,
    ElementType.INLINE_LINK,
    ElementType.INLINE_IMAGE,
    ElementType.INLINE_OTHER,
    ElementType.MATH_INLINE,
  ]);

  const isInlineContainer = (element: ParsedElement): boolean => {
    return INLINE_CONTAINER_TYPES.has(element.type);
  };

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
          // Inline replacement containers already render nested content
          // Avoid overlapping replace decorations that can duplicate text.
          if (other.from <= current.from && other.to >= current.to) {
            if (isInlineContainer(other) && isInlineContainer(current)) {
              shouldKeep = false;
              covered[i] = true;
              break;
            }
          }
          if (current.from <= other.from && current.to >= other.to) {
            if (isInlineContainer(current) && isInlineContainer(other)) {
              covered[j] = true;
            }
          }

          // Inline code / inline math should not contain nested elements
          if (other.from <= current.from && other.to >= current.to && NO_NESTING_TYPES.has(other.type)) {
            shouldKeep = false;
            covered[i] = true;
            break;
          }
          if (current.from <= other.from && current.to >= other.to && NO_NESTING_TYPES.has(current.type)) {
            covered[j] = true;
          }
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
function buildDecorationsFromElements(elements: ParsedElement[], state: EditorState): DecorationSet {
  const entries: DecorationEntry[] = [];
  let skippedCount = 0;
  let processedCount = 0;

  debugLog('[buildDecorations] ===== START BUILDING =====');
  debugLog('[buildDecorations] Input elements:', elements.length);
  debugLog('[buildDecorations] Doc lines:', state.doc.lines, 'Doc length:', state.doc.length);

  const docLength = state.doc.length;
  const cached = ensureCachedDocument(state.doc);
  const referenceDefs = cached.referenceDefs;
  const referenceSignature = buildReferenceSignature(referenceDefs);

  for (const element of elements) {
    // CRITICAL FIX: Validate element range to prevent truncation and errors
    if (element.from < 0 || element.to < 0) {
      debugLog('[buildDecorations] Skipping element with negative range:', element.from, element.to);
      skippedCount++;
      continue;
    }

    if (element.from > element.to) {
      debugLog('[buildDecorations] Skipping element with invalid range (from > to):', element.from, element.to);
      skippedCount++;
      continue;
    }

    // CRITICAL FIX: Clamp element range to document bounds instead of skipping
    // This ensures elements at the end of the document are still rendered
    const safeFrom = Math.min(element.from, docLength);
    const safeTo = Math.min(element.to, docLength);

    if (safeFrom !== element.from || safeTo !== element.to) {
      debugLog('[buildDecorations] Clamped element range:', element.from, '->', safeFrom, element.to, '->', safeTo);
      // Update element range for this iteration
      element.from = safeFrom;
      element.to = safeTo;
    }

    // Skip empty ranges (can happen after clamping)
    if (safeFrom === safeTo && element.type !== ElementType.HEADING &&
        element.type !== ElementType.BLOCKQUOTE && element.type !== ElementType.LIST_ITEM) {
      // Line decorations (HEADING, BLOCKQUOTE, LIST_ITEM) can have from === to
      debugLog('[buildDecorations] Skipping empty range after clamping');
      skippedCount++;
      continue;
    }

    // Element-level reveal check: Skip decoration if cursor is in this element
    // Keep line/editing styles even when revealing syntax markers
    let reveal = shouldRevealAt(state, element.from, element.to, element.type);
    const data = element.decorationData as DecorationData | undefined;
    const isLineStyle = data?.isLineStyle === true;
    const isEditingStyle = data?.isEditingStyle === true;

    // Heading marker hide should only reveal when cursor is within the marker itself
    if (element.type === ElementType.HEADING && data?.isMarkerHide) {
      reveal = shouldRevealAt(state, element.from, element.to, undefined);
    }

    if (reveal && !isLineStyle && !isEditingStyle) {
      skippedCount++;
      continue; // Skip this element - show raw markdown instead
    }

    processedCount++;

    // 多行代码块需要特殊处理
    if (element.type === ElementType.CODE_BLOCK && element.decorationData) {
      const data = element.decorationData as DecorationData;

      if (data?.isEditingStyle) {
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
      } else if (data?.isMultiLine && element.startLine && element.endLine) {
        // 多行代码块：widget + 隐藏行
        const doc = state.doc;
        const firstLine = doc.line(element.startLine);
        const context = getBlockContext(firstLine.text);

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
              element.to,
              context ?? undefined
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
        const lineContext = getBlockContext(state.doc.lineAt(element.from).text);
        entries.push({
          from: element.from,
          to: element.to,
          decoration: Decoration.replace({
            widget: new CodeBlockWidget(
              element.content || '',
              element.language || '',
              data.showLineNumbers === true, // Default: false (cleaner like Obsidian)
              element.from,
              element.to,
              lineContext ?? undefined
            ),
          }),
          priority: element.type,
          isLine: false,
        });
      }
      continue;
    }

    // 多行数学公式块需要特殊处理
    if (element.type === ElementType.MATH_BLOCK && element.decorationData) {
      const data = element.decorationData as DecorationData;

      if (data?.isEditingStyle) {
        // 编辑模式：每行添加样式
        entries.push({
          from: element.from,
          to: element.to,
          decoration: Decoration.line({
            class: 'cm-math-block-line cm-math-block-editing',
          }),
          priority: element.type,
          isLine: true,
        });
      } else if (data?.isMultiLine && element.startLine && element.endLine) {
        // 多行公式块：widget + 隐藏行
        // CRITICAL: Validate latex parameter
        if (!element.latex || element.latex.trim() === '') {
          console.warn('[buildDecorations] Empty latex for MATH_BLOCK at', element.from, element.to);
          continue;
        }

        const doc = state.doc;
        const firstLine = doc.line(element.startLine);
        const context = getBlockContext(firstLine.text);

        // 1. 在第一行添加widget
        entries.push({
          from: firstLine.from,
          to: firstLine.from,
          decoration: Decoration.widget({
            widget: new MathWidget(
              element.latex,
              true, // isBlock
              element.from,
              element.to,
              context ?? undefined
            ),
            side: -1,
          }),
          priority: element.type,
          isLine: true,
        });

        // 2. 隐藏所有公式块行
        for (let lineNum = element.startLine; lineNum <= element.endLine; lineNum++) {
          const line = doc.line(lineNum);
          entries.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({ class: 'cm-math-block-hidden' }),
            priority: element.type,
            isLine: true,
          });
        }
      } else {
        // 单行公式块
        if (!element.latex || element.latex.trim() === '') {
          console.warn('[buildDecorations] Empty latex for single-line MATH_BLOCK at', element.from, element.to);
          continue;
        }
        const lineContext = getBlockContext(state.doc.lineAt(element.from).text);
        entries.push({
          from: element.from,
          to: element.to,
          decoration: Decoration.replace({
            widget: new MathWidget(
              element.latex,
              true, // isBlock
              element.from,
              element.to,
              lineContext ?? undefined
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
      const data = element.decorationData as DecorationData;
      const alignments = (data.alignments || []).map((alignment) => {
        if (alignment === 'left' || alignment === 'center' || alignment === 'right') {
          return alignment;
        }
        return null;
      });

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
        const doc = state.doc;
        const firstLine = doc.line(element.startLine);
        const context = getBlockContext(firstLine.text);

        // 1. 在第一行添加widget
        entries.push({
          from: firstLine.from,
          to: firstLine.from,
          decoration: Decoration.widget({
            widget: new TableWidget(
              data.rows || [],
              data.hasHeader !== false,
              alignments,
              element.from,
              element.to,
              referenceDefs,
              referenceSignature,
              context ?? undefined
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
        const lineContext = getBlockContext(state.doc.lineAt(element.from).text);
        entries.push({
          from: element.from,
          to: element.to,
          decoration: Decoration.replace({
            widget: new TableWidget(
              data.rows || [],
              data.hasHeader !== false,
              alignments,
              element.from,
              element.to,
              referenceDefs,
              referenceSignature,
              lineContext ?? undefined
            ),
          }),
          priority: element.type,
          isLine: false,
        });
      }
      continue;
    }

    // Callout 块需要特殊处理
    if (element.type === ElementType.CALLOUT && element.decorationData) {
      const data = element.decorationData as DecorationData;

      if (data.isEditingStyle) {
        entries.push({
          from: element.from,
          to: element.to,
          decoration: Decoration.line({ class: 'cm-callout-source' }),
          priority: element.type,
          isLine: true,
        });
      } else if (data.isMultiLine && element.startLine && element.endLine) {
        const doc = state.doc;
        const firstLine = doc.line(element.startLine);

        entries.push({
          from: firstLine.from,
          to: firstLine.from,
          decoration: Decoration.widget({
            widget: new CalloutWidget(
              data.type || 'note',
              data.title || '',
              data.contentLines || [],
              element.from,
              element.to,
              data.isFolded === true,
              referenceDefs,
              referenceSignature
            ),
            side: -1,
          }),
          priority: element.type,
          isLine: true,
        });

        for (let lineNum = element.startLine; lineNum <= element.endLine; lineNum++) {
          const line = doc.line(lineNum);
          entries.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({ class: 'cm-advanced-block-hidden' }),
            priority: element.type,
            isLine: true,
          });
        }
      } else {
        entries.push({
          from: element.from,
          to: element.to,
          decoration: Decoration.replace({
            widget: new CalloutWidget(
              data.type || 'note',
              data.title || '',
              data.contentLines || [],
              element.from,
              element.to,
              data.isFolded === true,
              referenceDefs,
              referenceSignature
            ),
          }),
          priority: element.type,
          isLine: false,
        });
      }
      continue;
    }

    // Details 块需要特殊处理
    if (element.type === ElementType.DETAILS && element.decorationData) {
      const data = element.decorationData as DecorationData;

      if (data.isEditingStyle) {
        entries.push({
          from: element.from,
          to: element.to,
          decoration: Decoration.line({ class: 'cm-details-source' }),
          priority: element.type,
          isLine: true,
        });
      } else if (data.isMultiLine && element.startLine && element.endLine) {
        const doc = state.doc;
        const firstLine = doc.line(element.startLine);

        entries.push({
          from: firstLine.from,
          to: firstLine.from,
          decoration: Decoration.widget({
            widget: new DetailsWidget(
              data.summary || 'Details',
              data.contentLines || [],
              element.from,
              element.to,
              data.isOpen === true,
              referenceDefs,
              referenceSignature
            ),
            side: -1,
          }),
          priority: element.type,
          isLine: true,
        });

        for (let lineNum = element.startLine; lineNum <= element.endLine; lineNum++) {
          const line = doc.line(lineNum);
          entries.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({ class: 'cm-advanced-block-hidden' }),
            priority: element.type,
            isLine: true,
          });
        }
      } else {
        entries.push({
          from: element.from,
          to: element.to,
          decoration: Decoration.replace({
            widget: new DetailsWidget(
              data.summary || 'Details',
              data.contentLines || [],
              element.from,
              element.to,
              data.isOpen === true,
              referenceDefs,
              referenceSignature
            ),
          }),
          priority: element.type,
          isLine: false,
        });
      }
      continue;
    }

    // 脚注定义块
    if (element.type === ElementType.FOOTNOTE_DEF && element.decorationData) {
      const data = element.decorationData as DecorationData;

      if (data.isEditingStyle) {
        entries.push({
          from: element.from,
          to: element.to,
          decoration: Decoration.line({ class: 'cm-footnoteref-source' }),
          priority: element.type,
          isLine: true,
        });
      } else if (data.isMultiLine && element.startLine && element.endLine) {
        const doc = state.doc;
        const firstLine = doc.line(element.startLine);

        entries.push({
          from: firstLine.from,
          to: firstLine.from,
          decoration: Decoration.widget({
            widget: new FootnoteDefWidget(
              data.identifier || '',
              data.contentLines || [],
              element.from,
              element.to,
              referenceDefs,
              referenceSignature
            ),
            side: -1,
          }),
          priority: element.type,
          isLine: true,
        });

        for (let lineNum = element.startLine; lineNum <= element.endLine; lineNum++) {
          const line = doc.line(lineNum);
          entries.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({ class: 'cm-advanced-block-hidden' }),
            priority: element.type,
            isLine: true,
          });
        }
      } else {
        entries.push({
          from: element.from,
          to: element.to,
          decoration: Decoration.replace({
            widget: new FootnoteDefWidget(
              data.identifier || '',
              data.contentLines || [],
              element.from,
              element.to,
              referenceDefs,
              referenceSignature
            ),
          }),
          priority: element.type,
          isLine: false,
        });
      }
      continue;
    }

    // 引用式链接定义
    if (element.type === ElementType.REFERENCE_DEF && element.decorationData) {
      const data = element.decorationData as DecorationData | undefined;

      if (data?.isEditingStyle) {
        entries.push({
          from: element.from,
          to: element.to,
          decoration: Decoration.line({ class: 'cm-footnoteref-source' }),
          priority: element.type,
          isLine: true,
        });
      } else if (data?.isMultiLine && element.startLine && element.endLine) {
        const doc = state.doc;
        for (let lineNum = element.startLine; lineNum <= element.endLine; lineNum++) {
          const line = doc.line(lineNum);
          entries.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({ class: 'cm-advanced-block-hidden' }),
            priority: element.type,
            isLine: true,
          });
        }
      } else {
        entries.push({
          from: element.from,
          to: element.to,
          decoration: Decoration.replace({}),
          priority: element.type,
          isLine: false,
        });
      }
      continue;
    }

    // 其他元素使用通用创建函数
    const decoration = createDecorationForElement(element, referenceDefs, referenceSignature);
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

  debugLog('[buildDecorations] ===== BUILDING COMPLETE =====');
  debugLog('[buildDecorations] Processed elements:', processedCount, '/', elements.length);
  debugLog('[buildDecorations] Skipped (revealed) elements:', skippedCount);
  debugLog('[buildDecorations] Created', entries.length, 'decoration entries');
  debugLog('[buildDecorations] Created', ranges.length, 'decoration ranges');
  debugLog('[buildDecorations] Entries by priority:', entries.reduce((acc, entry) => {
    const typeName = ElementType[entry.priority];
    acc[typeName] = (acc[typeName] || 0) + 1;
    return acc;
  }, {} as Record<string, number>));

  return Decoration.set(ranges, true);
}

/**
 * 判断元素是否需要行装饰器（点装饰）
 */
function isLineDecoration(element: ParsedElement): boolean {
  const data = element.decorationData as DecorationData | undefined;

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
function createDecorationForElement(
  element: ParsedElement,
  referenceDefs: Map<string, ReferenceDefinition>,
  referenceSignature: string
): Decoration | null {
  const data = element.decorationData as DecorationData | undefined;

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
        // Hide heading markers (Obsidian-style) — use replace to fully remove from rendering
        return Decoration.replace({});
      }
      return null;

    case ElementType.BLOCKQUOTE:
      if (data?.isLineStyle) {
        // 行装饰器
        return Decoration.line({
          class: 'cm-blockquote',
        });
      } else if (data?.isMarkerHide) {
        // Hide the > marker (Obsidian-style)
        return Decoration.replace({});
      }
      return null;

    case ElementType.LIST_ITEM: {
      const listType =
        data?.type === 'numbered' || data?.type === 'task' || data?.type === 'bullet'
          ? data.type
          : 'bullet';
      if (data?.isLineStyle) {
        // 行装饰器
        return Decoration.line({
          class: `cm-list-item cm-list-${listType}`,
          attributes: { 'data-indent': String(data.indent || 0) },
        });
      } else if (data?.isWidget && data?.marker) {
        // Widget替换标记
        return Decoration.replace({
          widget: new ListBulletWidget(
            listType,
            data.marker,
            data.checked,
            data.lineFrom
          ),
        });
      }
      return null;
    }

    case ElementType.HORIZONTAL_RULE:
      if (data?.originalFrom !== undefined && data?.originalTo !== undefined) {
        return Decoration.replace({
          widget: new HorizontalRuleWidget(data.originalFrom, data.originalTo),
          // Block replacement so the HR can span full line width
          block: true,
        });
      }
      return null;

    case ElementType.CODE_BLOCK:
      // 代码块在buildDecorationsFromElements中特殊处理
      // 这里不应该被调用
      return null;

    // ========================================================================
    // 行内元素 - 使用Widget替换
    // ========================================================================

    case ElementType.INLINE_BOLD:
      // CRITICAL: Ensure we replace the ENTIRE syntax range including ** markers
      // from and to should cover **text** not just text
      if (element.from >= element.to) {
        console.warn('[Decoration] Invalid range for INLINE_BOLD:', element.from, element.to);
        return null;
      }
      
      // PHASE 3 FIX: Enhanced validation and logging
      debugLog('[Decoration] Creating INLINE_BOLD widget:', {
        from: element.from,
        to: element.to,
        content: element.content,
        syntaxFrom: data?.syntaxFrom,
        syntaxTo: data?.syntaxTo,
        contentFrom: data?.contentFrom,
        contentTo: data?.contentTo,
      });
      
      return Decoration.replace({
        widget: new FormattedTextWidget(
          element.content || '',
          data?.className || 'cm-strong',
          data?.contentFrom || element.from,
          data?.contentTo || element.to,
          data?.syntaxFrom || element.from,
          data?.syntaxTo || element.to,
          referenceDefs,
          referenceSignature
        ),
      });

    case ElementType.INLINE_ITALIC:
      // CRITICAL: Ensure we replace the ENTIRE syntax range including * or _ markers
      if (element.from >= element.to) {
        console.warn('[Decoration] Invalid range for INLINE_ITALIC:', element.from, element.to);
        return null;
      }
      return Decoration.replace({
        widget: new FormattedTextWidget(
          element.content || '',
          data?.className || 'cm-em',
          data?.contentFrom || element.from,
          data?.contentTo || element.to,
          data?.syntaxFrom || element.from,
          data?.syntaxTo || element.to,
          referenceDefs,
          referenceSignature
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
          data?.syntaxTo || element.to,
          referenceDefs,
          referenceSignature
        ),
      });

    case ElementType.INLINE_LINK:
      // CRITICAL: Ensure we replace the ENTIRE syntax range including []() markers
      if (element.from >= element.to) {
        console.warn('[Decoration] Invalid range for INLINE_LINK:', element.from, element.to);
        return null;
      }
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
            data?.syntaxTo || element.to,
            referenceDefs,
            referenceSignature
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
              data.syntaxTo || element.to,
              referenceDefs,
              referenceSignature
            ),
          });
      }

    // ========================================================================
    // 数学公式 - KaTeX 已集成
    // ========================================================================

    case ElementType.MATH_INLINE:
      // 使用MathWidget渲染行内公式
      // CRITICAL: Validate latex parameter to prevent "undefined" rendering
      if (!element.latex || element.latex.trim() === '') {
        console.warn('[Decoration] Empty latex for INLINE_MATH at', element.from, element.to);
        return null;
      }
      
      // PHASE 4 FIX: Enhanced validation and logging
      debugLog('[Decoration] Creating INLINE_MATH widget:', {
        from: element.from,
        to: element.to,
        latex: element.latex,
        latexLength: element.latex.length,
      });
      
      return Decoration.replace({
        widget: new MathWidget(
          element.latex,
          false, // isBlock
          element.from,
          element.to,
          undefined
        ),
      });

    case ElementType.MATH_BLOCK:
      // 使用MathWidget渲染块级公式
      // CRITICAL: Validate latex parameter to prevent "undefined" rendering
      if (!element.latex || element.latex.trim() === '') {
        console.warn('[Decoration] Empty latex for MATH_BLOCK at', element.from, element.to);
        return null;
      }
      
      // PHASE 4 FIX: Enhanced validation and logging
      debugLog('[Decoration] Creating MATH_BLOCK widget:', {
        from: element.from,
        to: element.to,
        latex: element.latex,
        latexLength: element.latex.length,
      });
      
      return Decoration.replace({
        widget: new MathWidget(
          element.latex,
          true, // isBlock
          element.from,
          element.to,
          undefined
        ),
      });

    default:
      return null;
  }
}

// ============================================================================
// StateField - 统一装饰器管理（避免 ViewPlugin block decoration 限制）
// ============================================================================

export const decorationCoordinatorField = StateField.define<DecorationSet>({
  create(state) {
    try {
      const elements = parseDocument(state, false);
      (state as ParsedElementsCarrier)._parsedElements = elements;
      const resolved = resolveConflicts(elements);
      return buildDecorationsFromElements(resolved, state);
    } catch (err) {
      console.error('[DecorationCoordinator] Failed to build decorations on create:', err);
      return Decoration.none;
    }
  },
  update(value, tr) {
    if (tr.docChanged) {
      // Document changed — full re-parse required
      try {
        const elements = parseDocument(tr.state, false);
        (tr.state as ParsedElementsCarrier)._parsedElements = elements;
        const resolved = resolveConflicts(elements);
        return buildDecorationsFromElements(resolved, tr.state);
      } catch (err) {
        console.error('[DecorationCoordinator] Failed to build decorations on update:', err);
        return Decoration.none;
      }
    } else if (tr.selection) {
      // Selection only changed — reuse parsed elements, rebuild decorations for reveal state
      try {
        const prevState = tr.startState as ParsedElementsCarrier;
        const elements = prevState._parsedElements;
        if (elements && elements.length > 0) {
          (tr.state as ParsedElementsCarrier)._parsedElements = elements;
          const resolved = resolveConflicts(elements);
          return buildDecorationsFromElements(resolved, tr.state);
        }
        // Fallback: full re-parse if no cached elements
        const freshElements = parseDocument(tr.state, false);
        (tr.state as ParsedElementsCarrier)._parsedElements = freshElements;
        const resolved = resolveConflicts(freshElements);
        return buildDecorationsFromElements(resolved, tr.state);
      } catch (err) {
        console.error('[DecorationCoordinator] Failed to rebuild decorations on selection:', err);
        return Decoration.none;
      }
    }
    return value;
  },
});

export const decorationCoordinatorExtension = [
  decorationCoordinatorField,
  EditorView.decorations.from(decorationCoordinatorField),
];

// ============================================================================
// 导出工具函数
// ============================================================================

/**
 * 清除缓存 - 用于调试和测试
 * CRITICAL: Call this when switching files to prevent stale cache
 */
export function clearDecorationCache(): void {
  debugLog('[Cache] Clearing decoration cache');
  lineElementCache.clear();
  cachedDoc = null;
  cachedText = '';
  cachedLines = [];
  cachedCodeBlocks = [];
  cachedMathBlocks = [];
  cachedTables = [];
  cachedCallouts = [];
  cachedDetails = [];
  cachedFootnoteDefs = [];
  cachedReferenceDefs = new Map();
  cachedReferenceDefMatches = [];
}

/**
 * 获取缓存统计 - 用于性能监控
 */
export function getCacheStats(): { size: number; maxSize: number } {
  return {
    size: lineElementCache.size(),
    maxSize: 10000,
  };
}

