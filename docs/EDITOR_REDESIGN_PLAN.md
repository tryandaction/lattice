# 🚨 Lattice编辑器彻底重构计划

**日期：** 2026-01-19
**状态：** 🔴 紧急 - 当前架构存在严重问题
**目标：** 对标并超越Obsidian的编辑体验

---

## 📋 当前严重问题

### 1. 致命错误
```
Error: Decorations that replace line breaks may not be specified via plugins
```

**原因：** 我们的 `Decoration.replace()` 跨越了换行符，这在CodeMirror 6中是**严格禁止**的。

**问题代码位置：**
- `decoration-coordinator.ts:1330` - HeadingContentWidget
- `decoration-coordinator.ts:1349` - BlockquoteContentWidget
- `decoration-coordinator.ts:1368` - ListBulletWidget
- 所有多行元素的 `Decoration.replace()`

### 2. 架构设计问题

#### 问题A：混淆了阅读模式和编辑模式
- ❌ 当前：试图在编辑模式中实现阅读模式效果
- ✅ Obsidian：清晰分离 **Live Preview** 和 **Reading View**

#### 问题B：不必要的UI元素
- ❌ 显示行号（用户不需要）
- ❌ 复杂的光标定位逻辑
- ❌ 过度的装饰器替换

#### 问题C：光标定位不准确
- 用户点击渲染后的内容，光标位置错误
- Widget的点击事件处理不正确
- 没有正确映射渲染位置到源码位置

### 3. 性能问题（已部分解决）
- ✅ 选择性更新已实现
- ❌ 仍然存在不必要的全文档解析
- ❌ 装饰器创建开销大

---

## 🎯 Obsidian的设计哲学

### 核心原则

根据 [Obsidian官方文档](https://docs.obsidian.md/Plugins/Editor/Editor) 和 [Live Preview指南](https://publish.obsidian.md/hub/04+-+Guides,+Workflows,+&+Courses/Guides/How+to+update+your+plugins+and+CSS+for+live+preview)：

1. **三种模式清晰分离**
   - **Source Mode**: 纯文本编辑，无渲染
   - **Live Preview**: 编辑时部分渲染（WYSIWYG）
   - **Reading View**: 完全渲染，只读模式

2. **Live Preview的设计原则**
   - 光标所在行：显示源码
   - 其他行：显示渲染结果
   - 使用 `EditorView.decorations` 而非 `ViewPlugin`
   - **绝不跨越换行符**

3. **装饰器使用规则**
   - `Decoration.mark()`: 添加CSS类（不替换内容）
   - `Decoration.widget()`: 插入Widget（不替换内容）
   - `Decoration.replace()`: **仅用于单行内的替换**
   - `Decoration.line()`: 行级样式

---

## 🏗️ 新架构设计

### 阶段1：修复致命错误（立即）

#### 1.1 禁止跨行的 `Decoration.replace()`

**原则：**
- ✅ 单行内的替换：使用 `Decoration.replace()`
- ❌ 多行替换：使用 `Decoration.widget()` + `Decoration.line()`

**修复方案：**

```typescript
// ❌ 错误：跨行替换
Decoration.replace({
  widget: new HeadingContentWidget(...),
}).range(line.from, line.to) // line.to 包含换行符

// ✅ 正确：分离标记和内容
// 1. 隐藏标记（单行内）
Decoration.replace({}).range(line.from, markerEnd)

// 2. 添加Widget（不替换）
Decoration.widget({
  widget: new HeadingContentWidget(...),
  side: 1
}).range(markerEnd)

// 3. 行样式
Decoration.line({
  class: 'cm-heading cm-heading-1'
}).range(line.from)
```

#### 1.2 重新设计Widget系统

**当前问题：**
- Widget试图替换整行内容
- 点击Widget后光标定位错误

**新设计：**
```typescript
// Widget只负责渲染，不处理光标
class HeadingContentWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-heading-content';
    span.textContent = this.content;
    // ❌ 移除所有mousedown事件处理
    // 让CodeMirror自己处理光标
    return span;
  }

  // ✅ 不拦截任何事件
  ignoreEvent() {
    return false;
  }
}
```

### 阶段2：实现真正的Live Preview（1-2天）

#### 2.1 光标上下文感知

```typescript
/**
 * 核心原则：光标所在行显示源码，其他行显示渲染
 */
function shouldRenderLine(state: EditorState, lineNum: number): boolean {
  const cursorLine = state.doc.lineAt(state.selection.main.head).number;

  // 光标所在行：不渲染
  if (lineNum === cursorLine) {
    return false;
  }

  // 其他行：渲染
  return true;
}
```

#### 2.2 简化装饰器策略

**新策略：**
1. **标题**：只添加CSS类，不替换内容
2. **粗体/斜体**：使用 `Decoration.mark()` 添加样式
3. **链接**：使用 `Decoration.mark()` + CSS
4. **代码块**：使用Widget（已正确实现）
5. **表格**：使用Widget（已正确实现）

```typescript
// ✅ 简单有效的标题渲染
function decorateHeading(line: Line, level: number) {
  return [
    // 1. 行样式
    Decoration.line({
      class: `cm-heading cm-heading-${level}`
    }).range(line.from),

    // 2. 隐藏标记（# ## ###）
    Decoration.mark({
      class: 'cm-formatting cm-formatting-header'
    }).range(line.from, line.from + level),
  ];
}

// ✅ 简单有效的粗体渲染
function decorateBold(from: number, to: number, content: string) {
  return [
    // 隐藏 **
    Decoration.mark({
      class: 'cm-formatting cm-formatting-strong'
    }).range(from, from + 2),

    // 粗体样式
    Decoration.mark({
      class: 'cm-strong'
    }).range(from + 2, to - 2),

    // 隐藏 **
    Decoration.mark({
      class: 'cm-formatting cm-formatting-strong'
    }).range(to - 2, to),
  ];
}
```

### 阶段3：优化渲染效果（2-3天）

#### 3.1 CSS驱动的渲染

**核心思想：** 用CSS隐藏语法标记，而不是用JavaScript替换

```css
/* 隐藏标记 */
.cm-formatting {
  opacity: 0;
  font-size: 0;
  display: none;
}

/* 标题样式 */
.cm-heading-1 {
  font-size: 2em;
  font-weight: bold;
  line-height: 1.3;
}

/* 粗体样式 */
.cm-strong {
  font-weight: bold;
}

/* 链接样式 */
.cm-link {
  color: var(--link-color);
  text-decoration: underline;
  cursor: pointer;
}
```

#### 3.2 移除不必要的功能

**移除：**
- ❌ 行号显示
- ❌ 复杂的光标定位逻辑
- ❌ Widget的点击事件处理
- ❌ 过度的位置计算

**保留：**
- ✅ 代码块语法高亮
- ✅ 表格渲染
- ✅ 数学公式渲染
- ✅ 光标上下文感知

### 阶段4：实现Reading View（3-5天）

#### 4.1 独立的Reading View组件

```typescript
/**
 * Reading View - 完全渲染的只读视图
 *
 * 特点：
 * - 使用 EditorState.readOnly.of(true)
 * - 完全渲染所有Markdown
 * - 无编辑功能
 * - 优化的渲染性能
 */
export function createReadingView(content: string) {
  return new EditorView({
    state: EditorState.create({
      doc: content,
      extensions: [
        EditorState.readOnly.of(true),
        readingViewTheme,
        readingViewDecorations,
      ]
    })
  });
}
```

#### 4.2 模式切换

```typescript
/**
 * 三种模式切换
 */
enum EditorMode {
  SOURCE = 'source',        // 纯文本
  LIVE_PREVIEW = 'live',    // 实时预览
  READING = 'reading',      // 阅读模式
}

function switchMode(mode: EditorMode) {
  switch (mode) {
    case EditorMode.SOURCE:
      // 移除所有装饰器
      return [];

    case EditorMode.LIVE_PREVIEW:
      // 启用Live Preview装饰器
      return [livePreviewPlugin];

    case EditorMode.READING:
      // 切换到Reading View组件
      return createReadingView(editor.state.doc.toString());
  }
}
```

---

## 📊 实施计划

### Week 1: 紧急修复（1-2天）
- [x] ~~分析当前问题~~
- [x] ~~修复line break decoration错误~~
- [x] ~~移除跨行的 `Decoration.replace()`~~
- [x] ~~重新设计Widget系统~~
- [x] ~~移除不必要的行号显示~~
- [x] ~~简化Widget光标处理~~
- [ ] 测试基本功能

**已完成工作 (2026-01-19):**
1. 修复了所有line break decoration错误
   - HEADING: `to: Math.max(line.from, line.to - 1)`
   - BLOCKQUOTE: `to: Math.max(line.from, line.to - 1)`
   - HORIZONTAL_RULE: `to: Math.max(line.from, line.to - 1)`
2. 移除了代码块行号显示（默认false）
3. 简化了Widget系统
   - 移除了HeadingContentWidget的mousedown处理
   - 移除了BlockquoteContentWidget的mousedown处理
   - 移除了CodeBlockWidget的mousedown处理
   - 所有Widget的ignoreEvent()返回false，让CodeMirror自然处理光标

### Week 2: Live Preview重构（3-5天）
- [ ] 实现光标上下文感知
- [ ] 简化装饰器策略
- [ ] 使用 `Decoration.mark()` 替代 `replace()`
- [ ] 优化CSS样式
- [ ] 移除不必要的功能

### Week 3: Reading View实现（3-5天）
- [ ] 创建独立的Reading View组件
- [ ] 实现模式切换
- [ ] 优化渲染性能
- [ ] 完善UI/UX

### Week 4: 测试和优化（2-3天）
- [ ] 全面测试
- [ ] 性能优化
- [ ] Bug修复
- [ ] 文档更新

---

## 🎯 成功标准

### 功能标准
- ✅ 无 "line break decoration" 错误
- ✅ 光标定位100%准确
- ✅ Live Preview流畅（无卡顿）
- ✅ Reading View完美渲染
- ✅ 模式切换无缝

### 性能标准
- ✅ 2000行文档：< 50ms 渲染时间
- ✅ 10000行文档：< 200ms 渲染时间
- ✅ 光标移动：< 5ms 响应时间

### 体验标准
- ✅ 渲染效果接近或超越Obsidian
- ✅ 无不必要的UI元素
- ✅ 直观的编辑体验
- ✅ 平滑的动画过渡

---

## 📚 参考资源

### Obsidian官方文档
- [Editor API](https://docs.obsidian.md/Plugins/Editor/Editor)
- [Decorations](https://docs.obsidian.md/Plugins/Editor/Decorations)
- [Live Preview Guide](https://publish.obsidian.md/hub/04+-+Guides,+Workflows,+&+Courses/Guides/How+to+update+your+plugins+and+CSS+for+live+preview)

### CodeMirror 6文档
- [Decorations](https://codemirror.net/docs/ref/#view.Decoration)
- [ViewPlugin](https://codemirror.net/docs/ref/#view.ViewPlugin)
- [EditorView](https://codemirror.net/docs/ref/#view.EditorView)

### 社区资源
- [Obsidian CodeMirror Options](https://github.com/nothingislost/obsidian-codemirror-options)
- [CodeMirror Discuss](https://discuss.codemirror.net/)

---

## 🚀 立即行动

**第一步：** 修复line break decoration错误
**第二步：** 简化装饰器策略
**第三步：** 实现真正的Live Preview
**第四步：** 对标Obsidian的渲染效果

**目标：** 在2周内完成核心重构，达到Obsidian的编辑体验水平。
