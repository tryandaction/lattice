# 🔧 性能优化方案

## 📊 当前性能问题

**测试结果：** > 0.5ms per line (⭐ Very Poor)

**问题分析：**
1. 文档解析：多次 `text.split('\n')` 和 `doc.toString()`
2. 正则表达式：15个正则表达式每行都执行
3. Widget渲染：Highlight.js 和 KaTeX 同步渲染
4. 缓存效率：初次渲染缓存命中率为0

---

## 🎯 优化策略

### Phase 1: 解析优化（立即实施）

#### 1.1 减少文档转换
**问题：** `parseCodeBlocks()` 和 `parseTables()` 都调用 `doc.toString()` 和 `split('\n')`

**优化：**
```typescript
// 优化前
function parseCodeBlocks(doc) {
  const text = doc.toString();  // 第1次
  const lines = text.split('\n');
  // ...
}

function parseTables(text: string) {
  const lines = text.split('\n');  // 第2次
  // ...
}

// 优化后
function parseDocument(view: EditorView) {
  const doc = view.state.doc;
  const text = doc.toString();  // 只调用1次
  const lines = text.split('\n');  // 只调用1次

  // 传递lines给解析函数
  const codeBlocks = parseCodeBlocks(lines, doc);
  const tables = parseTables(lines);
}
```

**预期提升：** 30-40%

#### 1.2 优化正则表达式
**问题：** 15个正则表达式每行都执行

**优化：**
```typescript
// 优化前：每次都创建新的正则对象
const boldRegex = /\*\*([^*]+?)\*\*/g;

// 优化后：预编译正则表达式
const REGEX_CACHE = {
  bold: /\*\*([^*]+?)\*\*/g,
  italic: /\*([^*]+?)\*/g,
  // ... 其他正则
};

// 使用前重置lastIndex
function parseInlineElements(text: string) {
  REGEX_CACHE.bold.lastIndex = 0;
  // ...
}
```

**预期提升：** 10-15%

#### 1.3 延迟Widget渲染
**问题：** Highlight.js 和 KaTeX 同步渲染阻塞

**优化：**
```typescript
// 优化前：同步渲染
if (hljs && this.language) {
  const result = hljs.highlight(this.code, { language: this.language });
  code.innerHTML = result.value;
}

// 优化后：异步渲染
code.textContent = this.code;  // 先显示纯文本
requestIdleCallback(() => {
  if (hljs && this.language) {
    const result = hljs.highlight(this.code, { language: this.language });
    code.innerHTML = result.value;
  }
});
```

**预期提升：** 20-30%

---

### Phase 2: 增量更新（第4周）

#### 2.1 增量解析
**当前：** 每次更新都重新解析整个文档

**优化：** 只解析变化的部分
```typescript
function parseDocumentIncremental(
  view: EditorView,
  changes: ChangeSet
): ParsedElement[] {
  // 只解析受影响的行
  const affectedLines = getAffectedLines(changes);
  // ...
}
```

**预期提升：** 50-70%（编辑时）

#### 2.2 视口渲染
**当前：** 渲染整个文档

**优化：** 只渲染可见区域
```typescript
function parseDocument(view: EditorView, viewportOnly: boolean = true) {
  const visibleRanges = view.visibleRanges;
  // 只解析可见范围
}
```

**预期提升：** 60-80%（大文档）

---

### Phase 3: Web Workers（第4周）

#### 3.1 Worker线程解析
**优化：** 将解析移到Worker线程
```typescript
// main thread
const worker = new Worker('parser-worker.js');
worker.postMessage({ doc: text });

// worker thread
self.onmessage = (e) => {
  const elements = parseDocument(e.data.doc);
  self.postMessage({ elements });
};
```

**预期提升：** 不阻塞主线程

---

## 📋 优化清单

### 立即实施（今天）
- [ ] 减少 `doc.toString()` 和 `split('\n')` 调用
- [ ] 预编译正则表达式
- [ ] 延迟Highlight.js渲染
- [ ] 延迟KaTeX渲染
- [ ] 优化Widget创建

### 第4周
- [ ] 实现增量解析
- [ ] 实现视口渲染
- [ ] 实现Web Workers
- [ ] 优化缓存策略

---

## 🎯 性能目标

### 当前
- ⭐ Very Poor: > 0.5ms per line

### 优化后（Phase 1）
- ⭐⭐⭐⭐ Good: < 0.05ms per line
- 提升：10x

### 优化后（Phase 2）
- ⭐⭐⭐⭐⭐ Excellent: < 0.01ms per line
- 提升：50x

---

## 🚀 开始优化

让我们从Phase 1开始，立即实施最关键的优化！
