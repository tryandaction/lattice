# Obsidian 级别 Markdown 编辑体验优化任务

## 项目概述

Lattice 是一个基于 Next.js 的知识管理应用，核心功能是提供类似 Obsidian 的 Markdown 编辑和阅读体验。当前使用 CodeMirror 6 作为编辑器核心，但 Markdown 渲染效果未达到 Obsidian 的水准。

## 当前问题

### 核心问题
1. **标题渲染失败** - `#` 符号没有隐藏，标题显示为原始 Markdown 语法
2. **LaTeX 公式不渲染** - 行内公式 `$...$` 和块级公式 `$$...$$` 都没有正确渲染
3. **装饰器系统可能存在问题** - CodeMirror 6 的 ViewPlugin 装饰器可能没有正确应用

### 期望效果（对标 Obsidian）
1. **Live Preview 模式**：
   - 光标不在某行时，显示渲染后的内容（隐藏 Markdown 语法）
   - 光标在某行时，显示原始 Markdown 语法以便编辑
   - 平滑过渡，无闪烁

2. **标题渲染**：
   - `# 标题` 应显示为大号加粗文字，`#` 符号隐藏
   - 光标移入时显示 `# 标题` 原始语法

3. **LaTeX 公式**：
   - 行内公式 `$E=mc^2$` 应渲染为数学公式
   - 块级公式 `$$...$$` 应居中显示
   - 支持多行公式

4. **其他 Markdown 元素**：
   - 粗体、斜体、删除线等内联样式
   - 链接、图片
   - 代码块（带语法高亮）
   - 列表（有序、无序、任务列表）
   - 引用块
   - 表格

## 代码结构

### 核心文件路径

```
src/components/editor/codemirror/live-preview/
├── live-preview-editor.tsx      # 主编辑器组件，加载所有扩展
├── cursor-context-plugin.ts     # 光标上下文插件，决定哪些行显示原始语法
├── block-decoration-plugin.ts   # 块级装饰器（标题、水平线、引用、列表）
├── inline-decoration-plugin.ts  # 内联装饰器（粗体、斜体、链接等）
├── math-plugin.ts               # LaTeX 公式渲染
├── code-block-plugin.ts         # 代码块渲染
├── table-plugin.ts              # 表格渲染
├── advanced-block-plugin.ts     # 高级块（callout、脚注等）
├── live-preview-theme.ts        # 主题样式
├── markdown-parser.ts           # Markdown 解析工具
├── types.ts                     # 类型定义
└── ...其他辅助文件
```

### 关键组件说明

#### 1. `live-preview-editor.tsx`
- 主编辑器组件
- 根据 `mode` 参数（'live' | 'source' | 'reading'）加载不同扩展
- `buildExtensions` 函数构建 CodeMirror 扩展列表

```typescript
// 关键代码位置：约 158-191 行
if (mode === 'live') {
  extensions.push(
    cursorContextExtension,
    inlineDecorationPlugin,
    blockDecorationPlugin,
    advancedBlockPlugin,
    mathPlugin,
    codeBlockPlugin,
    tablePlugin,
    // ...
  );
}
```

#### 2. `cursor-context-plugin.ts`
- 提供 `shouldRevealLine(state, lineNumber)` 函数
- 当光标在某行时返回 `true`，表示该行应显示原始语法
- 当光标不在某行时返回 `false`，表示该行应显示渲染后的内容

```typescript
// 关键函数
export function shouldRevealLine(state: EditorState, lineNumber: number): boolean {
  try {
    const context = state.field(cursorContextField, false);
    if (!context) return false; // Reading mode
    return context.revealLines.has(lineNumber);
  } catch {
    return false;
  }
}
```

#### 3. `block-decoration-plugin.ts`
- 处理块级元素的装饰
- `HeadingContentWidget` 类用于渲染标题内容（隐藏 `#` 符号）
- 使用 `Decoration.line()` 添加行样式
- 使用 `Decoration.replace()` 替换内容

```typescript
// 关键逻辑：约 322-348 行
const headingMatch = lineText.match(/^(#{1,6})\s+(.*)$/);
if (headingMatch) {
  const level = headingMatch[1].length;
  const content = headingMatch[2];
  
  // 添加行样式
  decorations.push({
    from: line.from,
    to: line.from,
    decoration: Decoration.line({ class: `cm-heading cm-heading-${level}` }),
    isLine: true,
  });
  
  // 当不需要显示原始语法时，替换内容
  if (!lineRevealed && content) {
    decorations.push({
      from: line.from,
      to: line.to,
      decoration: Decoration.replace({
        widget: new HeadingContentWidget(content, level, markerEnd, line.to),
      }),
    });
  }
}
```

#### 4. `math-plugin.ts`
- 处理 LaTeX 公式渲染
- 使用 KaTeX 库动态加载和渲染
- `MathWidget` 类用于渲染公式

#### 5. `inline-decoration-plugin.ts`
- 处理内联元素（粗体、斜体、链接等）
- 使用正则表达式解析 Markdown 语法
- 使用 `Decoration.replace()` 替换内容

#### 6. `live-preview-theme.ts`
- 定义所有 CSS 样式
- 包含 `.cm-heading-1` 到 `.cm-heading-6` 等样式类

## 已尝试的修复

1. **修复 `Decoration.line` 的 `range` 调用**
   - Line decorations 只需要一个位置参数 (`from`)

2. **修复装饰器排序逻辑**
   - Line decorations 在同一位置时应该在 replace decorations 之前

3. **简化装饰器构建逻辑**
   - 使用 `Decoration.set` 替代 `RangeSetBuilder`

## 调试建议

### 1. 验证装饰器是否正确创建
在 `block-decoration-plugin.ts` 的 `buildBlockDecorations` 函数末尾添加：
```typescript
console.log('[BlockPlugin] Created', ranges.length, 'decorations');
```

### 2. 验证 ViewPlugin 是否正确注册
在 `blockDecorationPlugin` 的 constructor 中添加：
```typescript
console.log('[BlockPlugin] Plugin initialized');
```

### 3. 检查浏览器控制台
- 查看是否有 JavaScript 错误
- 查看装饰器日志是否输出

### 4. 检查 DOM 元素
- 使用浏览器开发者工具检查编辑器 DOM
- 查看是否有 `.cm-heading` 等 CSS 类

## 优化目标

### 必须实现
1. ✅ 标题 `#` 符号隐藏，显示渲染后的标题
2. ✅ LaTeX 公式正确渲染（行内和块级）
3. ✅ 光标移入时显示原始语法
4. ✅ 光标移出时显示渲染后的内容
5. ✅ 平滑过渡，无闪烁

### 可选优化
1. 代码块语法高亮
2. 表格渲染
3. 任务列表复选框
4. 链接预览
5. 图片预览

## 参考资源

### CodeMirror 6 文档
- [Decoration Example](https://codemirror.net/examples/decoration/)
- [View Plugin](https://codemirror.net/docs/ref/#view.ViewPlugin)
- [Decoration](https://codemirror.net/docs/ref/#view.Decoration)

### Obsidian 行为参考
- Live Preview 模式：光标所在行显示原始语法，其他行显示渲染后的内容
- 编辑和预览无缝切换
- 支持所有标准 Markdown 语法

## 技术栈

- **框架**: Next.js 16.1.1
- **编辑器**: CodeMirror 6
- **LaTeX 渲染**: KaTeX
- **代码高亮**: highlight.js
- **语言**: TypeScript
- **样式**: TailwindCSS

## 运行项目

```bash
cd "c:\universe\software development\Lattice"
npm run dev
```

访问 http://localhost:3000

## 测试文件

创建一个测试 Markdown 文件，包含以下内容：

```markdown
# 一级标题

## 二级标题

### 三级标题

这是一段普通文本，包含 **粗体**、*斜体* 和 `行内代码`。

行内公式：$E = mc^2$

块级公式：
$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

- 无序列表项 1
- 无序列表项 2

1. 有序列表项 1
2. 有序列表项 2

- [ ] 任务列表未完成
- [x] 任务列表已完成

> 这是一个引用块

| 表头1 | 表头2 |
|-------|-------|
| 单元格1 | 单元格2 |

[链接文本](https://example.com)

---

代码块：
```javascript
function hello() {
  console.log("Hello, World!");
}
```
```

## 期望结果

当你完成优化后，上述测试文件应该：
1. 标题显示为大号加粗文字，`#` 符号隐藏
2. 粗体、斜体正确渲染
3. 行内公式和块级公式正确渲染
4. 列表正确缩进和显示
5. 引用块有左边框样式
6. 表格正确渲染
7. 链接可点击
8. 代码块有语法高亮
9. 光标移入任何行时，显示该行的原始 Markdown 语法

## 注意事项

1. **不要破坏现有功能** - 确保编辑功能正常
2. **性能优化** - 大文件不应卡顿
3. **错误处理** - 优雅处理解析错误
4. **TypeScript 类型** - 保持类型安全
5. **代码风格** - 保持与现有代码一致

---

**请彻底分析上述代码文件，找出装饰器不生效的根本原因，并实现 Obsidian 级别的 Markdown 编辑体验！**
