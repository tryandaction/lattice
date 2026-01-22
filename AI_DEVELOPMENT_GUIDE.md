# AI Development Guide - Lattice 格致

**Last Updated**: 2026-01-22
**Purpose**: 为AI助手提供项目上下文、已知问题和开发指南

---

## 🚨 Critical Known Issues (未解决的关键问题)

### 1. **长文件截断问题** ⚠️ HIGH PRIORITY
**Status**: 未解决
**Reported**: 2026-01-22
**Description**:
- 长文件（>100行）无法完整显示，内容被截断
- 控制台显示文档有36行，解析了37个元素，但渲染不完整
- 用户只能看到前面一小部分内容

**Debug Info**:
```
[parseDocument] Lines: 36 ViewportOnly: false
[parseDocument] Ranges: [{from: 0, to: 634}]
[parseDocument] Processing lines: 1 to 36
[Decoration] Doc lines: 36 Elements: 37
```

**Possible Causes**:
- CSS高度限制
- 视口（viewport）渲染限制
- 装饰器（decoration）构建问题
- 滚动容器配置问题

**Files to Check**:
- `src/components/editor/codemirror/live-preview/decoration-coordinator.ts`
- `src/components/editor/codemirror/live-preview/live-preview-theme.ts`
- `src/components/editor/codemirror/live-preview/live-preview-editor.tsx`

---

### 2. **文件切换显示错误** ⚠️ HIGH PRIORITY
**Status**: 未解决
**Reported**: 2026-01-22
**Description**:
- 点击文件A，显示文件B的内容
- 文件切换后内容不更新或显示错误的文件内容

**Previous Attempts**:
- 已修改 `obsidian-markdown-viewer.tsx` 的 useEffect 依赖
- 已添加 `prevFileNameRef` 追踪文件变化
- 已在 `live-preview-editor.tsx` 添加 content 到依赖数组

**Files Modified**:
- `src/components/editor/obsidian-markdown-viewer.tsx` (Line 149-166)
- `src/components/editor/codemirror/live-preview/live-preview-editor.tsx` (Line 341)

**Still Not Working**: 需要更深入的状态管理重构

---

### 3. **文本重复显示** ⚠️ MEDIUM PRIORITY
**Status**: 部分解决，仍有问题
**Description**:
- 某些markdown元素的文本会重复显示
- 可能是装饰器（decoration）和原始文本同时显示

**Related Files**:
- `src/components/editor/codemirror/live-preview/decoration-coordinator.ts`
- `src/components/editor/codemirror/live-preview/widgets.ts`

---

### 4. **公式渲染失败** ⚠️ MEDIUM PRIORITY
**Status**: 部分解决
**Description**:
- 某些上下文中的公式无法渲染
- 公式显示为 "undefined" 或空白

**Previous Fixes**:
- 已导入 KaTeX CSS
- 已改进正则表达式匹配

**Still Failing**: 需要检查 MathWidget 的错误处理

---

### 5. **Markdown语法标记未隐藏** ⚠️ MEDIUM PRIORITY
**Status**: 未完全解决
**Description**:
- 标题的 `#` 符号没有隐藏
- 粗体的 `**` 符号可见
- 其他markdown语法标记显示

**Related**:
- `Decoration.replace()` 可能没有正确覆盖语法范围

---

### 6. **React Hydration 错误** ⚠️ LOW PRIORITY
**Status**: 已修复
**Fixed**: 2026-01-22
**Solution**: 在 `app-layout.tsx` 添加 `mounted` 状态检查

---

### 7. **Service Worker 404 错误** ⚠️ LOW PRIORITY
**Status**: 已修复
**Fixed**: 2026-01-22
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

**最后更新**: 2026-01-22
**文档版本**: 1.0
**状态**: 活跃维护中

