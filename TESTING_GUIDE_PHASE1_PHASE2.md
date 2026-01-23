# 测试指南 - Phase 1 & Phase 2 修复

## 开发服务器状态

✅ **开发服务器已启动**
- 本地地址: http://localhost:3000
- 网络地址: http://10.33.59.54:3000

## Phase 1: 长文件完整显示修复 (CRITICAL) ✅

### 已完成的修复

#### 1. 诊断日志增强
- ✅ 在 `parseDocument()` 添加详细日志
  - 记录文档总行数、长度
  - 记录 viewportOnly 参数
  - 记录 visibleRanges
  - 记录解析的元素数量和类型分布
- ✅ 在 `buildDecorationsFromElements()` 添加详细日志
  - 记录处理的元素数量
  - 记录跳过的元素数量
  - 记录创建的装饰器数量

#### 2. 核心修复
- ✅ **确保完整文档解析**: `parseDocument()` 现在始终传递 `viewportOnly: false`
- ✅ **修复行范围计算**: 确保循环遍历所有行，包括最后一行
  ```typescript
  // CRITICAL FIX: Ensure we process ALL lines including the last one
  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
  ```
- ✅ **安全边界检查**: 防止 `range.to` 超出文档长度
  ```typescript
  const safeTo = Math.min(range.to, doc.length);
  ```
- ✅ **空文档处理**: 处理 `safeTo === 0` 的边界情况

#### 3. CSS 修复
- ✅ 修改隐藏行样式从 `display: none` 改为 `visibility: hidden`
  - `.cm-code-block-hidden`
  - `.cm-math-block-hidden`
  - `.cm-table-hidden`
  - `.cm-advanced-block-hidden`
- 这样可以保持文档高度，避免截断

### 测试步骤

1. **打开测试文件**
   - 打开 `public/test-100-lines.md` (100行)
   - 打开 `public/test-500-lines.md` (500行)
   - 打开 `public/test-1000-lines.md` (1000行)
   - 打开 `public/test-10000-lines.md` (10000行)

2. **验证完整显示**
   - ✅ 滚动到文件末尾，确认能看到最后一行
   - ✅ 检查行号是否连续（如果显示行号）
   - ✅ 确认没有内容被截断

3. **检查控制台日志**
   - 打开浏览器开发者工具 (F12)
   - 查看 Console 标签
   - 搜索 `[parseDocument]` 日志
   - 验证日志显示:
     ```
     [parseDocument] ===== START PARSING =====
     [parseDocument] Doc lines: 100 Doc length: 5000
     [parseDocument] ViewportOnly: false
     [parseDocument] Processing range - startLine: 1 endLine: 100 total lines to process: 100
     [parseDocument] ===== PARSING COMPLETE =====
     [parseDocument] Total elements parsed: 150
     ```

4. **性能测试**
   - ✅ 打开10000行文件，检查加载时间（应该在3秒内）
   - ✅ 滚动流畅度（应该没有明显卡顿）
   - ✅ 编辑响应时间（输入文字应该立即响应）

### 预期结果

- ✅ 所有测试文件都能完整显示
- ✅ 滚动到底部能看到最后一行
- ✅ 控制台日志显示正确的行数和元素数量
- ✅ 没有性能问题

---

## Phase 2: 文件切换内容正确显示修复 (CRITICAL) ✅

### 已完成的修复

#### 1. ObsidianMarkdownViewer 增强
- ✅ **文件切换检测**: 使用 `prevFileNameRef` 跟踪文件变化
  ```typescript
  if (fileName !== prevFileNameRef.current) {
    // File changed - force update
    console.log('[FileSwitch] ===== FILE CHANGED =====');
    prevFileNameRef.current = fileName;
    setLocalContent(content);
    setIsDirty(false);
    setSaveStatus('idle');
    setOutline([]);
    setActiveHeading(undefined);
  }
  ```
- ✅ **状态重置**: 文件切换时清除所有状态
  - 内容 (localContent)
  - 脏标记 (isDirty)
  - 保存状态 (saveStatus)
  - 大纲 (outline)
  - 活动标题 (activeHeading)
- ✅ **详细日志**: 记录文件切换过程

#### 2. LivePreviewEditor 强化
- ✅ **强制重新初始化**: `fileId` 变化时完全销毁并重建编辑器
  ```typescript
  useEffect(() => {
    // Destroy existing view
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }
    
    // CRITICAL: Clear decoration cache on file switch
    clearDecorationCache();
    
    // Create new view
    // ...
  }, [fileId, content]); // fileId change triggers re-init
  ```
- ✅ **缓存清理**: 调用 `clearDecorationCache()` 清除装饰器缓存
- ✅ **内容同步**: 确保新文件内容正确加载
- ✅ **详细日志**: 记录编辑器初始化过程

#### 3. 装饰器缓存管理
- ✅ **LRU 缓存**: 使用 LRU 缓存存储行解析结果
- ✅ **缓存清理函数**: `clearDecorationCache()` 清除所有缓存
- ✅ **文件切换时清理**: 确保不会使用旧文件的缓存数据

### 测试步骤

1. **准备测试文件**
   - 创建或使用多个不同的 Markdown 文件
   - 确保文件内容明显不同（例如不同的标题、内容）

2. **单个文件切换测试**
   - ✅ 打开文件 A
   - ✅ 记住文件 A 的内容（例如第一行标题）
   - ✅ 切换到文件 B
   - ✅ 验证显示的是文件 B 的内容，不是文件 A
   - ✅ 切换回文件 A
   - ✅ 验证显示的是文件 A 的内容

3. **快速连续切换测试**
   - ✅ 快速点击文件 A → B → C → D
   - ✅ 验证最终显示的是文件 D 的内容
   - ✅ 没有内容闪烁或混乱

4. **检查控制台日志**
   - 打开浏览器开发者工具 (F12)
   - 查看 Console 标签
   - 搜索 `[FileSwitch]` 和 `[EditorInit]` 日志
   - 验证日志显示:
     ```
     [FileSwitch] ===== FILE CHANGED =====
     [FileSwitch] From: file-a.md To: file-b.md
     [FileSwitch] New content length: 1234
     [EditorInit] ===== INITIALIZING EDITOR =====
     [EditorInit] fileId: file-b.md
     [EditorInit] Decoration cache cleared
     [EditorInit] ===== INITIALIZATION COMPLETE =====
     ```

5. **边界情况测试**
   - ✅ 空文件切换到有内容的文件
   - ✅ 大文件切换到小文件
   - ✅ 相同文件名但不同路径的文件

### 预期结果

- ✅ 文件切换后显示正确的内容
- ✅ 没有内容混乱或显示错误
- ✅ 快速切换不会导致问题
- ✅ 控制台日志显示正确的文件切换和初始化过程

---

## 如何测试

### 1. 访问应用
打开浏览器访问: http://localhost:3000

### 2. 打开文件浏览器
- 点击左侧的文件浏览器图标
- 或使用快捷键打开文件选择器

### 3. 执行测试
按照上面的测试步骤逐一验证

### 4. 报告问题
如果发现问题，请提供:
- 问题描述
- 重现步骤
- 控制台日志截图
- 预期行为 vs 实际行为

---

## 下一步计划

### Phase 3: 文本不重复显示修复 (HIGH)
- 诊断文本重复问题
- 修复装饰器范围
- 优化 Widget 渲染

### Phase 4: 公式正确渲染修复 (HIGH)
- 诊断公式渲染问题
- 修复 MathWidget
- 优化公式解析

### Phase 5: Markdown语法标记完全隐藏修复 (MEDIUM)
- 诊断语法标记显示问题
- 修复标记隐藏
- 优化标记显示/隐藏过渡

---

## 技术细节

### 修改的文件
1. `src/components/editor/codemirror/live-preview/decoration-coordinator.ts`
   - 增强 `parseDocument()` 日志和边界检查
   - 增强 `buildDecorationsFromElements()` 日志
   - 导出 `clearDecorationCache()` 函数

2. `src/components/editor/codemirror/live-preview/live-preview-editor.tsx`
   - 在 `fileId` 变化时强制重新初始化
   - 调用 `clearDecorationCache()` 清除缓存
   - 增强初始化和内容更新日志

3. `src/components/editor/obsidian-markdown-viewer.tsx`
   - 使用 `prevFileNameRef` 跟踪文件变化
   - 文件切换时重置所有状态
   - 增强文件切换日志

4. `src/components/editor/codemirror/live-preview/live-preview-theme.ts`
   - 修改隐藏行样式从 `display: none` 改为 `visibility: hidden`

### 关键修复点
1. **完整文档解析**: 确保 `parseDocument()` 解析整个文档，不截断
2. **边界检查**: 防止数组越界和空文档错误
3. **缓存清理**: 文件切换时清除装饰器缓存
4. **强制重新初始化**: `fileId` 变化时完全重建编辑器
5. **状态重置**: 文件切换时清除所有相关状态

---

## 调试技巧

### 查看解析日志
```javascript
// 在浏览器控制台执行
localStorage.setItem('DEBUG_MODE', 'true');
// 刷新页面
```

### 查看缓存统计
```javascript
// 在浏览器控制台执行
import { getCacheStats } from './decoration-coordinator';
console.log(getCacheStats());
```

### 手动清除缓存
```javascript
// 在浏览器控制台执行
import { clearDecorationCache } from './decoration-coordinator';
clearDecorationCache();
```

---

**祝测试顺利！如果遇到任何问题，请立即反馈。** 🚀


---

## Phase 3: 文本不重复显示修复 (HIGH) ✅

### 已完成的修复

#### 1. 装饰器范围验证增强
- ✅ **粗体文本**: 添加范围验证，确保 `from < to`
  ```typescript
  const from = lineFrom + match.index;
  const to = lineFrom + match.index + fullMatch.length;
  
  if (from >= to) {
    console.warn('[parseInlineElements] Invalid bold range:', from, to);
    continue;
  }
  ```
- ✅ **斜体文本**: 同样的范围验证
- ✅ **行内代码**: 同样的范围验证
- ✅ **链接**: 同样的范围验证（Wiki链接和Markdown链接）
- ✅ **图片**: 同样的范围验证

#### 2. 装饰器创建日志增强
- ✅ **调试日志**: 在 `createDecorationForElement()` 添加详细日志
  ```typescript
  debugLog('[Decoration] Creating INLINE_BOLD widget:', {
    from: element.from,
    to: element.to,
    content: element.content,
    syntaxFrom: data?.syntaxFrom,
    syntaxTo: data?.syntaxTo,
    contentFrom: data?.contentFrom,
    contentTo: data?.contentTo,
  });
  ```

#### 3. Widget 范围确保
- ✅ **完整语法覆盖**: 确保 `Decoration.replace()` 的 from/to 覆盖完整的语法标记
  - 粗体: `**text**` 完整覆盖
  - 斜体: `*text*` 或 `_text_` 完整覆盖
  - 代码: `` `code` `` 完整覆盖
  - 链接: `[text](url)` 或 `[[wiki]]` 完整覆盖
  - 图片: `![alt](url)` 完整覆盖

### 测试步骤

1. **打开测试文件**
   - 打开 `public/test-text-duplication.md`

2. **视觉检查**
   - ✅ 滚动浏览所有测试用例
   - ✅ 检查是否有文本重复（例如 "**bold**bold" 或 "boldbo**ld**"）
   - ✅ 检查语法标记是否正确隐藏

3. **交互测试**
   - ✅ 点击格式化文本（粗体、斜体等）
   - ✅ 验证光标定位正确
   - ✅ 验证语法标记在光标处显示
   - ✅ 移开光标，验证语法标记隐藏

4. **嵌套格式测试**
   - ✅ 测试 **bold with *italic* inside**
   - ✅ 测试 *italic with **bold** inside*
   - ✅ 测试 **bold with `code` inside**
   - ✅ 测试 **bold with $E=mc^2$ math**

5. **检查控制台日志**
   - 打开浏览器开发者工具 (F12)
   - 查看 Console 标签
   - 搜索 `[Decoration]` 日志
   - 验证没有 "Invalid range" 警告
   - 验证装饰器创建日志显示正确的范围

### 预期结果

- ✅ 所有格式化元素只显示一次
- ✅ 没有文本重复
- ✅ 语法标记正确隐藏/显示
- ✅ 嵌套格式正确渲染
- ✅ 控制台没有范围错误

---

## Phase 4: 公式正确渲染修复 (HIGH) - 准备中

### 测试文件已创建
- ✅ `public/test-formula-rendering.md` - 公式渲染测试文件

### 待修复问题
1. **"undefined" 渲染**: 公式显示为 "undefined" 而不是数学公式
2. **上下文问题**: 公式在特定上下文（标题、列表等）中失败
3. **KaTeX 加载**: 确保 KaTeX 库正确加载
4. **参数传递**: 确保 latex 参数正确传递给 MathWidget

### 下一步
- 诊断公式渲染失败的根本原因
- 修复 MathWidget 参数传递
- 改进错误处理
- 添加加载检查

---

## 修改文件总结

### Phase 3 修改的文件
1. `src/components/editor/codemirror/live-preview/decoration-coordinator.ts`
   - 在 `parseInlineElements()` 添加范围验证
   - 在 `createDecorationForElement()` 添加调试日志
   - 确保所有行内元素的 from/to 范围正确

2. `public/test-text-duplication.md` (新建)
   - 文本重复测试文件
   - 包含10个测试场景

3. `public/test-formula-rendering.md` (新建)
   - 公式渲染测试文件
   - 包含10个测试场景

4. `.kiro/specs/critical-bugs-fix/tasks.md`
   - 更新 Phase 3 任务状态

---

## 关键修复点 (Phase 3)

1. **范围验证**: 所有行内元素解析时验证 `from < to`
2. **完整覆盖**: 确保 `Decoration.replace()` 覆盖完整的语法标记
3. **调试日志**: 添加详细日志帮助诊断问题
4. **错误处理**: 跳过无效范围，避免崩溃

---

**Phase 3 代码修复完成！请测试 `test-text-duplication.md` 文件。** 🎯


---

## Phase 4: 公式正确渲染修复 (HIGH) ✅

### 已完成的修复

#### 1. Latex 参数验证增强
- ✅ **行内公式解析**: 添加 latex 参数验证
  ```typescript
  if (!latex || latex.trim() === '') {
    console.warn('[parseInlineElements] Empty latex for inline math at', lineFrom + match.index);
    continue;
  }
  ```
- ✅ **块级公式解析**: 添加 latex 参数验证
  ```typescript
  const latex = blockLatex.join('\n');
  if (latex.trim() !== '') {
    blocks.push({ ... });
  } else {
    console.warn('[parseMathBlocks] Empty math block at lines', blockStartLine, '-', i + 1);
  }
  ```

#### 2. MathWidget 创建日志增强
- ✅ **调试日志**: 在 `createDecorationForElement()` 添加详细日志
  ```typescript
  debugLog('[Decoration] Creating INLINE_MATH widget:', {
    from: element.from,
    to: element.to,
    latex: element.latex,
    latexLength: element.latex.length,
  });
  ```

#### 3. MathWidget 错误处理
- ✅ **已有的错误处理**: MathWidget 已经有完善的错误处理
  - 验证 latex 参数不为空或 "undefined"
  - KaTeX 渲染错误时显示错误指示器和原始 LaTeX
  - KaTeX 未加载时显示占位符，加载后自动渲染
  - 右键复制 LaTeX 源码功能
  - 双击打开 MathLive 可视化编辑器

### 测试步骤

1. **打开测试文件**
   - 打开 `public/test-formula-rendering.md`

2. **基础公式测试**
   - ✅ 检查简单行内公式: $E=mc^2$
   - ✅ 检查块级公式
   - ✅ 验证公式渲染正确，不显示 "undefined"

3. **上下文测试**
   - ✅ 标题中的公式
   - ✅ 列表中的公式
   - ✅ 引用中的公式
   - ✅ 粗体/斜体中的公式

4. **复杂公式测试**
   - ✅ 分数: $\frac{a}{b}$
   - ✅ 根号: $\sqrt{x}$
   - ✅ 求和: $\sum_{i=1}^{n} i$
   - ✅ 积分: $\int_0^1 x dx$
   - ✅ 矩阵
   - ✅ 希腊字母

5. **边界情况测试**
   - ✅ 空公式: $$
   - ✅ 公式前后有空格: $ x + y $
   - ✅ 多个公式在一行: $a$ and $b$ and $c$

6. **错误处理测试**
   - ✅ 无效 LaTeX 语法
   - ✅ 验证显示错误指示器 ⚠️
   - ✅ 验证显示原始 LaTeX 作为后备

7. **交互测试**
   - ✅ 单击公式定位光标
   - ✅ 双击公式打开编辑器
   - ✅ 右键复制 LaTeX 源码

8. **检查控制台日志**
   - 打开浏览器开发者工具 (F12)
   - 查看 Console 标签
   - 搜索 `[Decoration]` 和 `[MathWidget]` 日志
   - 验证没有 "Empty latex" 警告
   - 验证公式创建日志显示正确的 latex 内容

### 预期结果

- ✅ 所有公式正确渲染（不显示 "undefined"）
- ✅ 公式在各种上下文中都能工作
- ✅ 复杂公式正确显示
- ✅ 无效公式显示友好错误提示
- ✅ KaTeX 加载失败时有后备方案
- ✅ 交互功能正常（点击、双击、右键）

---

## 修改文件总结 (Phase 4)

### Phase 4 修改的文件
1. `src/components/editor/codemirror/live-preview/decoration-coordinator.ts`
   - 在 `parseInlineElements()` 添加 latex 参数验证
   - 在 `parseMathBlocks()` 添加 latex 参数验证
   - 在 `createDecorationForElement()` 添加调试日志

2. `src/components/editor/codemirror/live-preview/widgets.ts`
   - MathWidget 已有完善的错误处理（无需修改）

3. `public/test-formula-rendering.md` (已创建)
   - 公式渲染测试文件
   - 包含10个测试场景

4. `.kiro/specs/critical-bugs-fix/tasks.md`
   - 更新 Phase 4 任务状态

---

## 关键修复点 (Phase 4)

1. **Latex 验证**: 解析时验证 latex 参数不为空
2. **空公式跳过**: 跳过空的数学公式块
3. **调试日志**: 添加详细日志帮助诊断问题
4. **错误处理**: MathWidget 已有完善的错误处理机制

---

**Phase 4 代码修复完成！请测试 `test-formula-rendering.md` 文件。** 📐
