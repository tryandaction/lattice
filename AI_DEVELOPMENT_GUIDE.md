# AI Development Guide - Lattice 格致

**Last Updated**: 2026-03-06
**Purpose**: 为AI助手提供项目上下文、已知问题和开发指南

---

## 🚨 Critical Known Issues (未解决的关键问题)

### 1. **Jupyter Notebook Python 执行问题** ✅ RESOLVED
**Status**: 已修复
**Fixed**: 2026-03-06
**Description**:
- Python 代码执行时出现 `SyntaxError: unterminated string literal` 错误
- HTML 嵌套错误导致 React hydration 警告

**Solution**:
- 使用 `js` 模块和 `pyodide.globals.set()` 安全传递字符串，避免字符串注入
- 修复 markdown 渲染中 `<p>` 标签包含 `<code>` 的问题
- 改进输出缓冲机制

**Files Modified**:
- `src/lib/python-worker-manager.ts`
- `src/workers/pyodide.worker.ts`
- `src/components/notebook/markdown-cell.tsx`

---

### 2. **长文件截断问题** ✅ RESOLVED
**Status**: 已解决
**Description**: 长文件（>100行）无法完整显示的问题已修复

---

### 3. **文件切换显示错误** ✅ RESOLVED
**Status**: 已解决
**Description**: 文件切换后内容不更新或显示错误的问题已修复

---

### 4. **文本重复显示** ✅ RESOLVED
**Status**: 已解决
**Description**: Markdown 元素文本重复显示的问题已修复

---

### 5. **React Hydration 错误** ✅ RESOLVED
**Status**: 已修复
**Solution**: 在 `app-layout.tsx` 添加 `mounted` 状态检查

---

### 6. **Service Worker 404 错误** ✅ RESOLVED
**Status**: 已修复
**Solution**: 删除 `public/sw.js`，添加 unregister 逻辑

---

## 📁 Project Structure (项目结构)

```
Lattice/
├── src/
│   ├── app/                    # Next.js App Router
│   ├── components/             # React组件
│   │   ├── editor/            # 编辑器相关
│   │   │   ├── codemirror/   # CodeMirror 6 编辑器
│   │   │   │   └── live-preview/  # Live Preview模式（核心）
│   │   │   │       ├── decoration-coordinator.ts  # 装饰器协调器
│   │   │   │       ├── widgets.ts                 # Widget组件库
│   │   │   │       ├── live-preview-editor.tsx    # 编辑器主组件
│   │   │   │       └── markdown-parser.ts         # Markdown解析器
│   │   │   └── obsidian-markdown-viewer.tsx  # Obsidian风格查看器
│   │   ├── explorer/          # 文件浏览器
│   │   ├── hud/              # 量子键盘HUD
│   │   ├── layout/           # 布局组件
│   │   └── main-area/        # 主内容区域
│   ├── lib/                   # 工具库
│   ├── stores/               # Zustand状态管理
│   └── hooks/                # React Hooks
├── public/                    # 静态资源
├── docs/                      # 文档（应该存放的位置）
└── [配置文件]
```

---

## 📋 Current Development Focus (当前开发重点)

### Phase 1: Jupyter Notebook Enhancement (对标 VSCode)
**Priority**: HIGH
**Goal**: 提升 Jupyter Notebook 体验，对标 VSCode 的 Jupyter 扩展

**Planned Features**:
1. **变量查看器** - 显示当前 Python 命名空间中的变量
2. **执行控制** - 内核重启、中断执行、清除输出
3. **代码补全** - 基于 Pyodide 的智能提示
4. **执行时间统计** - 显示每个 cell 的执行时间
5. **更多输出格式** - 支持 Plotly、Altair 等交互式图表

### Phase 2: File Management (文件管理)
**Priority**: MEDIUM
**Features**:
- 全局文件搜索（Ctrl+P）
- 文件内容搜索
- 文件操作（重命名、删除、新建）
- 最近打开文件历史

### Phase 3: Desktop App Enhancement (桌面应用增强)
**Priority**: MEDIUM
**Features**:
- 文件关联（.ipynb、.md 等）
- 全局快捷键
- 系统托盘
- 自动更新

---

## 🎯 Core Architecture (核心架构)

### Markdown渲染系统
**核心文件**: `decoration-coordinator.ts` (1800+ lines)
- 统一的装饰器协调系统
- 单次遍历解析（O(n)性能）
- 优先级冲突解决（16级优先级）
- LRU缓存（2000条目）

### Widget系统
**核心文件**: `widgets.ts` (1130+ lines)
- 14个专业Widget类
- 处理所有Markdown元素的渲染
- 支持点击、双击、右键交互

### 量子键盘系统
**状态**: 运行良好，不要修改
- 数学公式编辑
- 符号快速插入
- HUD定位系统

---

## 🔧 Development Guidelines (开发指南)

### 修复Bug的正确流程
1. **理解问题**: 仔细阅读用户描述，查看截图和控制台日志
2. **定位代码**: 使用 Grep/Glob 工具找到相关文件
3. **添加调试日志**: 在关键位置添加 console.log
4. **小步修改**: 每次只修改一个问题，立即测试
5. **提交代码**: 使用清晰的 commit message

### ⚠️ 重要注意事项
- **不要破坏量子键盘**: 这个功能运行良好，不要修改相关代码
- **不要过度优化**: 先解决功能问题，再考虑性能
- **不要一次性大改**: 小步迭代，每次改动都要能回滚
- **不要忽略用户反馈**: 用户说没解决就是没解决，不要自我安慰

### 调试技巧
```typescript
// 在关键位置添加日志
console.log('[ComponentName] State:', state);
console.log('[FunctionName] Input:', input, 'Output:', output);

// 追踪渲染次数
useEffect(() => {
  console.log('[Component] Rendered with props:', props);
}, [props]);
```

---

## 📝 Documentation Organization (文档组织)

### 根目录应保留的文档
- `README.md` - 项目介绍和快速开始
- `AI_DEVELOPMENT_GUIDE.md` - 本文档（给AI的开发指南）
- `CHANGELOG.md` - 版本更新日志
- `package.json` - 项目配置

### 应移动到 docs/ 的文档
- `MARKDOWN_FIX_SUMMARY.md` → `docs/fixes/markdown-fix-summary.md`
- `WEEK2_REFACTOR_COMPLETE.md` → `docs/refactors/week2-refactor.md`
- `DESKTOP_APP.md` → `docs/guides/desktop-app.md`
- `INSTALLATION.md` → `docs/guides/installation.md`
- `QUICK_START.md` → `docs/guides/quick-start.md`
- `ROADMAP.md` → `docs/roadmap.md`

### 应删除的文件
- 临时测试文件
- 重复的文档
- 过时的脚本

---

## 🎓 Learning Resources (学习资源)

### CodeMirror 6
- 官方文档: https://codemirror.net/docs/
- Decoration系统: https://codemirror.net/docs/ref/#view.Decoration
- ViewPlugin: https://codemirror.net/docs/ref/#view.ViewPlugin

### React + Next.js
- Next.js 16文档: https://nextjs.org/docs
- React Hooks: https://react.dev/reference/react

### 项目特定知识
- Obsidian Live Preview模式的实现原理
- CodeMirror装饰器的优先级系统
- Widget的生命周期管理

---

## 📊 Performance Considerations (性能考虑)

### 当前性能指标
- 解析: O(n) 单次遍历
- 缓存: LRU 2000条目
- 装饰器: 优先级排序后构建

### 性能瓶颈
1. **长文件渲染**: 目前有截断问题
2. **频繁重新解析**: 每次光标移动都触发
3. **大量装饰器**: 复杂文档可能有数百个装饰器

### 优化建议
- 实现虚拟滚动（10000+行文件）
- 减少不必要的重新解析
- 优化装饰器冲突解决算法

---

## 🐛 Debugging Checklist (调试检查清单)

### 当遇到渲染问题时
- [ ] 检查控制台是否有错误
- [ ] 检查 parseDocument 的日志输出
- [ ] 检查 buildDecorations 的日志输出
- [ ] 检查文档行数和元素数量是否匹配
- [ ] 检查 CSS 是否正确加载
- [ ] 检查装饰器范围是否正确

### 当遇到状态问题时
- [ ] 检查 useEffect 依赖数组
- [ ] 检查 React DevTools 的组件状态
- [ ] 检查 Zustand store 的状态
- [ ] 检查是否有状态更新丢失

### 当遇到性能问题时
- [ ] 使用 Chrome DevTools Performance 分析
- [ ] 检查是否有无限循环
- [ ] 检查是否有内存泄漏
- [ ] 检查渲染次数是否过多

---

## 📞 Contact & Support (联系与支持)

### 报告问题时请提供
1. 详细的问题描述
2. 重现步骤
3. 截图或录屏
4. 控制台日志
5. 文件内容示例（如果相关）

### 项目维护者
- 用户: 项目所有者
- AI助手: Claude Sonnet 4.5

---

**最后更新**: 2026-03-06
**文档版本**: 2.0
**状态**: 活跃维护中

