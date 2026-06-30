# Lattice UX Core Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 Lattice 已有多轮迭代后的细节缺陷做系统闭环：语言体系中英切换全覆盖，明暗主题一致可读，桌面窗口/面板/弹窗层级稳定，PDF 文本识别与标注渲染更稳健，Markdown/HTML 编辑阅读接近专业软件体验，量子键盘降低记忆负担并提升上手效率。

**Architecture:** 先建立可验证的 UI 基础系统（i18n、主题 token、层级/窗口 contract、回归测试），再在 PDF、Markdown/HTML、量子键盘等核心功能上做局部高质量修复。任何实现都必须保持现有模块边界，优先复用项目已有 store、renderer、CodeMirror extension、PDF text kernel 与测试脚本。

**Tech Stack:** Next.js 16、React 19、TypeScript、Tauri 2、Rust、Tailwind CSS、CodeMirror 6、PDF.js/react-pdf、react-pdf-highlighter、MathLive、KaTeX、Vitest、Playwright/Puppeteer。

---

## 0. 当前现场结论

- 本计划基于 `2026-06-27` 对 `C:/universe/software development/me/Lattice` 的本地阅读结果。
- 当前工作区已有大量未提交改动，后续执行必须先读 diff 并保护现有改动，不做 `git reset`、`git checkout --`、`git commit`、`git push`，除非用户明确要求。
- 项目已有 `.agents/skills/lattice-project-flow/SKILL.md`，其中 `npm run qa:gate` 是最终质量门禁；PDF 主路径为 `src/components/renderers/pdf-highlighter-adapter.tsx`，不是旧 fallback `pdf-viewer.tsx`。
- 文档与 i18n 字典疑似存在局部编码损坏或历史乱码：`src/lib/i18n/zh-CN.ts`、`src/lib/i18n/en-US.ts`、`src/components/hud/keyboard-hud.tsx`、`src/config/quantum-keymap.ts`、部分本地文档输出出现乱码。执行时要先用 UTF-8 读取与快照脚本确认，避免把终端编码问题误判为源文件损坏。
- 主题系统已有 `src/app/globals.css` token，但仍散落 `bg-white`、`#fff`、`rgba(255,255,255,...)`、固定灰色、固定 z-index 与 CSS pseudo 中文文本。文档画布类白底需要作为例外登记，而不是一刀切替换。
- AI 对话面板已经挂在桌面右侧 `ResizablePanel` 中，但滚动与 panel 高度需要通过真实布局回归验证；内部 `ChatMessages` 有 `overflow-y-auto` 和自动滚到底逻辑，问题更可能来自父级 `min-h-0`、面板组合、证据面板、composer 或弹窗遮挡。
- PDF 已有文本内核与选择 reconciler：`src/lib/pdf-text-kernel.ts`、`src/lib/pdf-selection-reconciler.ts`、`src/lib/pdf-text-rects.ts`。下划线位置由 `buildPdfUnderlineDecorationStyle` 与 `baselineTop` 推导，需补基线级测试并修复“线在文字上方”的视觉偏移。
- CodeMirror 官方文档确认：影响垂直布局的 block widget / replacing decoration 必须用直接 decoration 提供；函数式 decorations 在 viewport 计算后运行，不能引入跨行替换或 block widget。这是 Markdown live preview/table 编辑稳定性的硬约束。
- Tauri 2 官方文档确认：frameless/custom titlebar 应使用 `getCurrentWindow().startDragging()` 与 `startResizeDragging(direction)`，同时需要 `core:window:allow-start-dragging` 和 `core:window:allow-start-resize-dragging` 权限。
- PDF.js 官方文档确认：PDF 文本事实源应来自 `page.getTextContent()` 的 text items、styles、transform 与 page viewport，DOM selection 只能作为用户手势输入，不能作为持久化文本事实源。

## 1. 优先级总览

### P0 - 基线与护栏

- [x] 固化当前工作区现场，记录 `git status --short` 与关键文件 diff 摘要，只读不回退。
- [x] 建立中英/i18n、主题硬编码、层级 z-index、CSS pseudo 文本的扫描脚本或测试。
- [x] 建立最小可重复 QA baseline：typecheck、核心 Vitest、PDF adapter focused tests、现有 docs 检查。
- [ ] 给后续视觉修复准备明暗主题、中文/英文、桌面/移动、右侧 AI panel 开关的截图矩阵。

### P1 - 基础体验闭环

- [ ] 语言体系：修复乱码、补齐 key parity、移除硬编码中文/英文、让设置语言实时驱动 UI。
- [ ] 明暗主题：建立组件例外表，替换非画布类硬编码白底/灰色，补暗色截图回归。
- [x] 窗口与层级：统一右侧 panel、弹窗、popover、PDF 标注层、量子键盘 HUD 的 z-index 与 clipping contract。
- [x] AI 对话窗：确保宽度可调、垂直可滚、证据面板/消息/输入框互不遮挡。

### P2 - 核心功能质量

- [ ] PDF：修复下划线基线、拖选/滚动期间选区跳动、字符边界轻微漂移、OCR fallback 边界。
- [x] PDF 批注 Markdown：优化本地 `_annotations.md` 的可读性与 Markdown 渲染稳定性，area/ink 批注直接呈现截图，quote/comment 独立成段。
- [ ] Markdown：提升表格、颜色、callout、HTML inline、数学块、导出/预览 parity。
- [ ] HTML：提升 iframe 预览主题、滚动保持、源码/预览切换、Selection AI 菜单定位与 i18n。
- [x] Notebook/ipynb：修复任意 `.ipynb` 打开时的误报错、代码语言识别、cell 容错解析与阅读间距。
- [ ] 量子键盘：重做信息架构，让用户看见即可操作，减少记忆成本，清理重复 keymap 与乱码关键词。

### P3 - 收口与发布质量

- [ ] 跑完整 `npm run qa:gate`，整理剩余风险与不可闭合项。
- [ ] 更新相关本地文档，保留验证截图和 regression 结果索引。

## 2. 执行原则

- [ ] KISS：每个缺陷优先在已有模块内修复，不新增全局框架。
- [ ] YAGNI：不引入“未来可能用到”的配置中心、主题系统重写或新编辑器。
- [ ] DRY：i18n key、主题 token、z-index 层级统一建表，禁止同义常量散落。
- [ ] SOLID：窗口布局、PDF text kernel、Markdown extension、HUD store 各守职责，不跨层直接操作彼此内部状态。
- [ ] 每个功能区至少先补一个失败测试或扫描断言，再实现修复。
- [ ] 高风险操作不进入默认计划：不删除目录、不批量格式化全仓、不提交、不推送、不部署、不改生产 API。

## 3. 文件地图

### 语言体系

- `src/lib/i18n/index.ts`
- `src/lib/i18n/en-US.ts`
- `src/lib/i18n/zh-CN.ts`
- `src/hooks/use-i18n.ts`
- `src/stores/settings-store.ts`
- `src/components/settings/settings-dialog.tsx`
- `src/components/layout/app-layout.tsx`
- `src/components/ai/ai-chat-panel.tsx`
- `src/components/renderers/html-viewer.tsx`
- `src/components/hud/keyboard-hud.tsx`
- `src/config/quantum-keymap.ts`
- `src/app/globals.css`

### 主题与视觉 token

- `src/app/globals.css`
- `tailwind.config.ts`
- `src/components/ui/download-app-dialog.tsx`
- `src/components/editor/markdown-export-dialog.tsx`
- `src/components/renderers/html-viewer.tsx`
- `src/components/renderers/web-viewer.tsx`
- `src/components/renderers/pdf-highlighter-adapter.tsx`
- `src/components/editor/codemirror/live-preview/live-preview-theme.css`
- `src/components/editor/codemirror/live-preview/live-preview-theme.ts`

### 窗口、面板、弹窗、层级

- `src/components/layout/app-layout.tsx`
- `src/components/layout/desktop-workbench-layout.ts`
- `src/components/layout/desktop-window-frame.tsx`
- `src/components/ui/resizable.tsx`
- `src/components/ui/plugin-command-dialog.tsx`
- `src/components/ui/plugin-panel-dialog.tsx`
- `src/components/settings/settings-dialog.tsx`
- `src/components/prompt/prompt-editor-dialog.tsx`
- `src/components/renderers/annotation-color-picker.tsx`
- `src/components/renderers/mobile-color-picker.tsx`
- `src/components/hud/hud-provider.tsx`
- `src/components/hud/keyboard-hud.tsx`

### AI 对话窗

- `src/components/ai/ai-chat-panel.tsx`
- `src/components/ai/evidence-panel.tsx`
- `src/stores/ai-chat-store.ts`
- `src/components/ai/__tests__/ai-chat-panel.test.tsx`
- `src/components/layout/app-layout.tsx`

### PDF

- `src/components/renderers/pdf-highlighter-adapter.tsx`
- `src/lib/pdf-highlighter-adapter-utils.ts`
- `src/lib/pdf-item.ts`
- `src/lib/pdf-text-kernel.ts`
- `src/lib/pdf-text-rects.ts`
- `src/lib/pdf-selection-reconciler.ts`
- `src/lib/pdf-page-text-cache.ts`
- `src/lib/pdf-canonical-text-anchoring.ts`
- `src/lib/pdf-annotation-text-repair.ts`
- `src/lib/pdf-annotation-markdown-drafts.ts`
- `src/lib/pdf-search.ts`
- `src/components/renderers/pdf-search-overlay.tsx`
- `src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx`
- `src/lib/__tests__/pdf-item.test.ts`
- `src/lib/__tests__/pdf-annotation-markdown-drafts.test.ts`
- `src/lib/__tests__/pdf-text-rects.test.ts`
- `src/lib/__tests__/pdf-selection-reconciler.test.ts`

### Markdown / CodeMirror

- `src/components/editor/codemirror/live-preview/live-preview-editor.tsx`
- `src/components/editor/codemirror/live-preview/live-preview-theme.css`
- `src/components/editor/codemirror/live-preview/live-preview-theme.ts`
- `src/components/editor/codemirror/live-preview/table-editor.tsx`
- `src/components/editor/codemirror/live-preview/quantum-math-editing.ts`
- `src/components/editor/obsidian-markdown-viewer.tsx`
- `src/components/editor/markdown-renderer.tsx`
- `src/components/editor/markdown-export-dialog.tsx`
- `src/lib/markdown-reading.ts`
- `src/lib/markdown-export.tsx`

### HTML

- `src/components/renderers/html-viewer.tsx`
- `src/components/renderers/web-viewer.tsx`
- `src/lib/html-preview.ts`
- `src/components/ai/selection-context-menu.tsx`
- `src/components/ai/selection-ai-hub.tsx`

### Notebook / ipynb

- `src/components/renderers/jupyter-renderer.tsx`
- `src/components/renderers/__tests__/jupyter-renderer.test.tsx`
- `src/lib/notebook-utils.ts`
- `src/lib/__tests__/notebook-utils.test.ts`
- `src/components/notebook/notebook-editor.tsx`
- `src/components/notebook/notebook-cell.tsx`
- `src/components/notebook/code-cell.tsx`
- `src/components/notebook/markdown-cell.tsx`
- `src/components/notebook/output-area.tsx`
- `src/components/notebook/__tests__/code-cell-component.test.tsx`
- `src/components/notebook/__tests__/markdown-cell.test.tsx`
- `src/components/notebook/__tests__/output-area.test.tsx`
- `src/app/globals.css`

### 量子键盘

- `src/components/hud/keyboard-hud.tsx`
- `src/components/hud/shadow-keyboard.tsx`
- `src/components/hud/keycap.tsx`
- `src/components/hud/hud-provider.tsx`
- `src/stores/hud-store.ts`
- `src/stores/quantum-custom-store.ts`
- `src/config/quantum-keymap.ts`
- `src/lib/unified-input-handler.ts`
- `src/lib/formula-templates.ts`
- `src/lib/formula-utils.ts`
- `src/components/editor/codemirror/live-preview/quantum-math-editing.ts`

## 4. 详细实施计划

### P0.1 现场快照与测试基线

- [ ] 运行 `git status --short`，把未提交改动按功能区归类到本计划附录或执行日志。
- [ ] 只读抽样 `git diff -- <critical-file>`，确认哪些文件已有用户改动，执行时不得覆盖。
- [ ] 运行 `npm run typecheck`，记录当前是否通过。
- [ ] 运行 `npm run test:run -- src/components/ai/__tests__/ai-chat-panel.test.tsx`。
- [ ] 运行 `npm run test:run -- src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx`。
- [ ] 运行 `npm run test:run -- src/lib/__tests__/pdf-text-rects.test.ts src/lib/__tests__/pdf-selection-reconciler.test.ts`。
- [ ] 若 baseline 失败，按失败域创建 P0 blocker，不混入功能实现。

### P0.2 静态扫描护栏

- [x] 新增或扩展 docs/test 脚本，扫描 `src/**/*.{ts,tsx,css}` 中 UI 硬编码中文、乱码特征、CSS `content: "..."` 文案。
- [x] 扫描 i18n key parity：`en-US` 与 `zh-CN` key 集合必须一致。
- [x] 扫描非例外区域硬编码主题色：`bg-white`、`text-gray-*`、`#fff`、`rgba(255,255,255,...)`。
- [x] 扫描裸 z-index 数字，输出文件、行、用途，后续迁移到层级常量。
- [x] 给扫描加 allowlist：PDF/PPT/HTML 文档画布、导出离屏 host、canvas 渲染底色等允许白底，但外壳不允许。

### P1.1 语言体系闭环

- [x] 修复本批新增功能涉及的 `src/lib/i18n/en-US.ts`、`src/lib/i18n/zh-CN.ts` 缺失 key。
- [ ] 给 `getLocaleDisplayName` 增加测试：`zh-CN` 显示 `简体中文`，`en-US` 显示 `English`。
- [ ] 确认 `settings-store.setLanguage` 是否会同步 `setLocale`；若没有，在 `app-layout` 或 settings action 中建立单一同步路径。
- [x] 把 `src/components/hud/keyboard-hud.tsx` 中 `CORE_KEY_TILES`、`SYMBOL_KEY_TILES`、`currentStructureLabel`、帮助文案迁移到 i18n。
- [ ] 把 `src/components/renderers/html-viewer.tsx` 中 Selection AI disabled reason、菜单标题、模式标签迁移到 i18n。
- [ ] 把 `src/stores/ai-chat-store.ts` 中 `New Chat`、错误模板、状态文案迁移到 i18n 或 UI 层格式化。
- [ ] 移除 `src/app/globals.css` 中量子键盘相关 CSS pseudo 文案，改为 React 文本节点或 `aria-label`。
- [ ] 加测试：语言切换后 Settings、AI Chat、HTML selection menu、Quantum Keyboard 文案同步变化。

### P1.2 明暗主题闭环

- [ ] 在 `src/app/globals.css` 建立或补齐语义 token：surface、surface-muted、surface-elevated、overlay、canvas、document-page、selection、annotation、kbd、hud。
- [ ] 为“文档画布白底”建立例外注释：PDF page、PPT slide、HTML source export、打印/导出预览可以保留白底；周边 chrome、toolbar、popover 必须使用 token。
- [ ] 替换 `html-viewer.tsx` iframe 外壳 `bg-white`，iframe 内部通过 `previewDocument` 注入 light/dark-aware base CSS；对用户 HTML 原样内容保持隔离。
- [x] 检查并修复 `download-app-dialog.tsx` 的白底、灰色与硬编码文案。
- [ ] 修复 PDF 标注 handle 当前 `rgba(255,255,255,0.94)`、`#111827` 等在暗色主题下突兀的问题。
- [ ] 给量子键盘 HUD 暗色主题补对比度测试：主卡片、keycap、selector、drag handle、帮助区、active highlight。
- [ ] 用 Playwright 截图矩阵验证：light/dark + zh/en + AI panel open + quantum keyboard open + PDF annotation toolbar open。

### P1.3 窗口、面板与层级 contract

- [x] 新建 `src/lib/ui-layers.ts` 或等价常量模块，定义 app shell、desktop resize handles、dialogs、popovers、selection menus、PDF overlays、HUD、toasts 的层级顺序。
- [x] 将 `pdf-highlighter-adapter.tsx` 中散落 z-index 逐步迁移到语义常量；先迁移交互层，避免大面积机械改动。
- [ ] 检查 `DesktopWindowFrame` resize handles：Tauri 环境下确认 `startResizeDragging(direction)` 权限与方向映射；非 Tauri host 不抢占普通 web pointer。
- [ ] 在 `src/components/ui/resizable.tsx` 补 keyboard/a11y 或至少补拖拽边界测试：panel size 不低于 min，不高于 max，左右 panel 组合总和稳定。
- [ ] 在 `app-layout.tsx` 中确认 AI panel、plugin panel、sidebar 同时存在时 main panel min size 不被挤破。
- [ ] 统一 Dialog/Popover 的 portal 根或至少统一 `position: fixed`、`max-height`、`overflow-auto`，避免被父级 `overflow-hidden` 裁切。
- [x] 覆盖并迁移本批高频场景：Settings dialog、plugin/prompt dialogs、PDF floating UI、Selection AI hub、Quantum Keyboard selector。

### P1.4 AI 对话窗可调与可滚

- [x] 在 `ai-chat-panel.test.tsx` 补长对话滚动容器 contract 测试。
- [ ] 将自动滚到底逻辑改为“仅当用户接近底部或新消息来自当前用户时自动滚动”，避免阅读历史时跳动。
- [x] 确认并修复 `AiChatPanel` 根、`ChatMessages`、Evidence/Workbench 区域、composer 的 `min-h-0` / `overflow` contract。
- [ ] 在 `app-layout.tsx` 补桌面 panel 尺寸持久化测试：AI panel resize 后关闭再打开保留宽度。
- [ ] 检查移动端 AI panel 与 desktop 右侧 panel 是否共享状态但不共享不合理宽度。
- [ ] 用 Playwright 测试：AI panel 内 100 条消息，滚动到底、打开 evidence、关闭 evidence、resize 右侧 panel，输入框不被遮挡。

### P2.1 PDF 文本选择、标注与下划线

- [ ] 在 `pdf-text-rects.test.ts` 增加 baseline fixture：同一行不同字体高度、superscript/subscript、CJK、两栏文本时 `baselineTop` 不应跑到文本上方。
- [ ] 在 `pdf-highlighter-adapter.test.tsx` 增加 underline DOM style 测试：solid/wavy/double/dashed 均位于 segment baseline 下沿附近，而非 segment 顶部。
- [ ] 调整 `buildPdfUnderlineDecorationStyle`：以 text kernel segment 的 `baselineTop` 与 `baselineHeight` 为事实源，增加合理 offset clamp，避免 line 落在文字中上部。
- [ ] 检查 transient selection overlay 与 stored annotation overlay 是否共用同一 underline 逻辑，防止预览和保存后不一致。
- [ ] 在 `pdf-selection-reconciler.ts` 增加拖选/滚动状态下的 snapshot freeze 策略：DOM selection 提供手势，text kernel quote/rects 是事实源。
- [ ] 针对“前后选文小幅几个字符跳动”补 CJK、ligature、citation、hyphenation、two-column fixtures，调 reconciler scoring 阈值。
- [ ] 验证 OCR fallback 只在 born-digital 文本不足时触发，不覆盖高置信 native text。
- [ ] 运行：
  - [ ] `npm run test:run -- src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx`
  - [ ] `npm run test:run -- src/lib/__tests__/pdf-text-rects.test.ts src/lib/__tests__/pdf-selection-reconciler.test.ts`
  - [ ] `npm run test:browser-regression:pdf`
  - [ ] `npm run test:pdf-corpus:gate`

### P2.2 Markdown 专业编辑/渲染

- [ ] 按 CodeMirror 6 文档审查 live preview decorations：影响高度的 table/math/callout block 必须通过直接 decoration/state field 管理，不在 viewport 后计算阶段临时引入布局变化。
- [ ] 为 `table-editor.tsx` 增加专业编辑场景：单元格增删、列对齐、粘贴 TSV/CSV、键盘移动、撤销/重做、序列化不丢格式。
- [ ] 检查颜色/mark/callout/HTML inline 的读写：预览渲染、源码编辑、导出三者一致。
- [ ] 对 Markdown 表格和特殊格式补主题 token，避免暗色下表格边框/底色不可读。
- [ ] 加 fixtures：GFM table、nested emphasis、inline HTML color span、KaTeX block、callout、frontmatter。
- [ ] 运行：
  - [ ] `npm run test:run -- src/components/editor/codemirror/live-preview`
  - [ ] `npm run test:run -- src/lib/__tests__/markdown*`
  - [ ] `npm run typecheck`

### P2.3 HTML 阅读与编辑稳健性

- [ ] 检查 `src/lib/html-preview.ts`：确保 preview document 注入 theme base、viewport meta、selection bridge 脚本时不破坏用户 HTML。
- [ ] `html-viewer.tsx` 源码/预览切换保持 scroll position 和 selection context，不误触发保存。
- [ ] Selection context menu 在 iframe 内外坐标统一换算，并受统一层级常量控制。
- [ ] iframe sandbox 策略维持最小权限；如需脚本，仅允许项目注入的 selection bridge，不扩大不必要能力。
- [ ] 所有菜单、错误、disabled reason 迁移 i18n。
- [ ] 暗色模式下 iframe 外壳、加载态、错误态、source mode 与 preview chrome 统一。
- [ ] 运行 HTML viewer focused tests；如现有测试不足，新增 `html-viewer.test.tsx` 覆盖 source/preview/i18n/theme。

### P2.4 量子键盘“看得懂即可上手”

- [ ] 清理 `src/config/quantum-keymap.ts` 重复 variants：例如 `KeyT` 重复 `\otimes`，`KeyU` 重复 `\bigcup`。
- [ ] 将 keymap `keywords` 中乱码中文改成正常中英关键词，或拆分为 i18n metadata。
- [ ] 重构 `KeyboardHUD` 信息架构：
  - [ ] 顶部只显示当前目标、模式、关闭、拖动/重置。
  - [ ] 第一屏展示 8-10 个高频结构：上标、下标、根号、分式、求和、积分、极限、矩阵、分段、向量。
  - [ ] 每个 keycap 同时显示物理键、结果预览、短标签，不要求用户记忆映射。
  - [ ] Shift/长按/点击变体以“候选条”形式展开，直接可见。
  - [ ] 帮助信息改为上下文提示，不用大段说明文字。
- [ ] 统一点击插入与物理键插入路径，避免两套行为分叉。
- [ ] HUD 自动定位继续避开输入区域，但 selector/popover 不得被父容器裁切。
- [ ] 加测试：
  - [ ] keymap 无重复 variants。
  - [ ] zh/en 文案可切换。
  - [ ] 点击核心 tile 插入正确模板。
  - [ ] Shift variant selector 可键盘导航。
  - [ ] HUD clamp 不超出 viewport。

### P2.5 PDF 批注 Markdown 高可读持久化

- [x] 在 `src/lib/__tests__/pdf-item.test.ts` 增加失败测试：生成 `_annotations.md` 时，文本类批注的 `Quote` 使用 blockquote 或独立引用块，`Comment` 使用独立段落，不能把长 quote/comment 压在单行列表项里。
- [x] 在同一测试中覆盖 Markdown 语法评论：comment 包含列表、粗体、链接、行内代码时，输出必须另起一段并保持可被 Markdown 渲染器解释，不额外转义成不可读纯文本。
- [x] 在同一测试中覆盖 area/ink：截图必须以正常 Markdown image 块出现，alt 包含类型、批注 id、页码；截图尺寸说明放在图片下方说明文字，不嵌在破坏渲染的深层列表中。
- [x] 调整 `src/lib/pdf-item.ts` 的 `buildPdfAnnotationsMarkdown` 与 `buildAnnotationPreviewMarkdown`：
  - [x] 每条批注保持 `### N. Type` 标题。
  - [x] metadata 保持短列表：页面链接、批注链接、创建时间、backlinks。
  - [x] `Quote` 输出为 `#### Quote` + blockquote，多行 quote 每行以 `> ` 开头。
  - [x] `Comment` 输出为 `#### Comment` + 原始 Markdown 段落，前后保留空行。
  - [x] `Screenshot` 输出为 `#### Screenshot` + 图片 + italic caption。
- [x] 继续保留现有 preview 文件写入路径：`_annotation_previews/<annotation-id>.png`，并保持 unchanged preview 不重写的测试。
- [x] 运行：
  - [x] `npm run test:run -- src/lib/__tests__/pdf-item.test.ts`
  - [ ] `npm run test:run -- src/components/renderers/__tests__/annotation-markdown-renderer.test.tsx`

### P2.6 ipynb 稳健渲染、代码识别与阅读密度

- [x] 依据 Jupyter `nbformat` 文档补 renderer 结构校验：顶层必须是对象，`cells` 必须是数组，cell `source` 支持字符串或字符串数组，未知/坏 cell 不应导致整个 renderer 崩溃。
- [x] 在 `src/components/renderers/__tests__/jupyter-renderer.test.tsx` 新增失败测试：
  - [x] metadata `language_info.name: "javascript"` 或 `codemirror_mode` 时，代码块不再固定 Python。
  - [x] cell `source` 为非法值时显示 cell-level warning/raw fallback，不触发整页错误。
  - [x] JSON 非法或缺少 `cells` 时显示明确“不是有效 Notebook 文件”的错误，不伪装成空 notebook。
  - [x] read-only cell 间距使用紧凑 class，不再默认 `space-y-6 p-8` 的大空隙。
- [x] 将 notebook language resolver 从 `notebook-editor.tsx` 抽到 `src/lib/notebook-utils.ts`：
  - [x] `resolveNotebookLanguage(metadata)` 优先 `language_info.name`，再 `kernelspec.language`，最后 `python`。
  - [x] `resolveNotebookCodeEditorLanguage(language, codemirrorMode?)` 映射到项目支持的 `CodeEditorLanguage`。
  - [x] read-only `JupyterRenderer` 与 editable `NotebookEditor` 复用同一 resolver。
- [x] 改造 `JupyterRenderer`：
  - [x] 使用安全 parser 返回 `{ notebook, warnings }` 或 `{ error }`，不直接把 `JSON.parse` 结果强转为 notebook。
  - [x] code cell 使用解析出的语言。
  - [x] markdown/raw/code cell 都做 source 容错。
  - [x] 将外层布局调为更紧凑：例如 `px-4 py-4 md:px-6`、cell 列表 `space-y-3`，代码块内部 padding 保持可读。
- [ ] 检查 editable notebook 的视觉密度：`notebook-editor.tsx` 的 cell 列表、`notebook-cell.tsx` 的 toolbar `mb-2`、`code-cell.tsx` 的 `space-y-2`、`markdown-cell.tsx` 的 `px/py`，只做小步 token 化调整并用截图验证。
- [x] 运行：
  - [x] `npm run test:run -- src/components/renderers/__tests__/jupyter-renderer.test.tsx`
  - [x] `npm run test:run -- src/lib/__tests__/notebook-utils.test.ts`
  - [ ] `npm run test:run -- src/components/notebook/__tests__/code-cell-component.test.tsx src/components/notebook/__tests__/markdown-cell.test.tsx src/components/notebook/__tests__/output-area.test.tsx`
  - [ ] `npm run typecheck`

### P3.1 文档与 QA 收口

- [ ] 更新 `docs/UX_GUIDELINES.md`：补 i18n、theme、layer、HUD 可发现性约定。
- [ ] 更新 `docs/PDF_ZOTERO_LEVEL_TEXT_KERNEL_PLAN.md` 的完成状态，只记录已验证项。
- [ ] 修复本地文档乱码或明确标注编码来源。
- [ ] 最终运行：
  - [ ] `npm run lint`
  - [ ] `npm run typecheck`
  - [ ] `npm run test:run`
  - [ ] `npm run test:browser-regression`
  - [ ] `npm run test:browser-regression:pdf`
  - [ ] `npm run test:pdf-corpus:gate`
  - [ ] `npm run qa:gate`
- [ ] 输出最终闭环报告：已修复项、验证命令、剩余风险、建议后续小版本目标。

## 5. 验收标准

- [ ] 中英语言切换不需要刷新页面，主要 UI、弹窗、HUD、Selection AI、AI Chat、HTML/PDF/Markdown 工具条均同步切换。
- [ ] `en-US` 与 `zh-CN` key parity 通过，新增 UI 文案不能绕过 i18n。
- [ ] 暗色模式下除文档画布例外外，无明显白底残留；文字、边框、hover、active、disabled 状态均可读。
- [ ] AI 对话窗可横向调节，长对话可纵向滚动，打开证据面板或 Prompt dialog 不遮挡输入区。
- [ ] 弹窗、popover、HUD、PDF annotation toolbar 不被错误裁切，层级关系稳定。
- [ ] PDF 下划线位于文本下方；拖选、滚动、保存/恢复 annotation 后选区文本与 rects 稳定。
- [ ] PDF 本地 `_annotations.md` 对文本批注、comment、area/ink 截图均高可读，能被 MarkdownRenderer 正常渲染，长 quote/comment 不挤在单行列表项。
- [ ] Markdown 表格、颜色、特殊格式在编辑、预览、导出中保持一致。
- [ ] HTML 预览与源码切换稳定，Selection AI 坐标和语言正确，暗色外壳协调。
- [ ] `.ipynb` read-only 与 editable 模式均不会因单个坏 cell 或非 Python metadata 平白报错；代码语言识别正确，cell 间距紧凑但不拥挤。
- [ ] 量子键盘第一屏可以让新用户直接理解核心操作，物理键和点击路径一致，无乱码、无重复候选。

## 6. 风险与回滚策略

- i18n 字典乱码修复可能触碰大量文案，必须分批测试，不做全仓格式化。
- 主题替换容易误伤 PDF/PPT/HTML 文档画布，必须保留例外表。
- PDF selection 改动影响面大，每次只改一个事实源或 scoring 规则，并跑 focused tests。
- CodeMirror decorations 改动可能导致光标/滚动跳动，必须遵守官方布局约束并补交互测试。
- Tauri resize/drag 权限与 web host 行为不同，必须分别验证 Tauri host 和普通 browser。
- `_annotations.md` 格式升级会改变用户可见文件结构，必须保持链接、preview 文件路径与草稿 section 不丢失。
- `.ipynb` 容错解析不能静默吞掉真实 JSON 错误；read-only 渲染可以局部降级，编辑保存路径必须避免把坏 notebook 自动写成空 notebook。
- 本计划不包含 git 提交；若后续需要回滚，只回滚本次明确改动文件，不触碰用户已有未提交内容。

## 7. 阶段执行日志

### 2026-06-27 第一批落地

- 已建立 `scripts/ux-hygiene-audit.mjs` 与 `npm run test:ux-hygiene`，覆盖 i18n key parity、硬编码 UI 文案、主题硬编码、裸 z-index 扫描。
- 已新增 `src/lib/ui-layers.ts`，并迁移高频 dialog、popover、selection hub、PDF floating UI、HUD、desktop resize handle 的层级到语义 token；当前 UX hygiene 扫描中 `z-index-hardcode` 为 0。
- 已修复错误页、下载 App 弹窗、量子键盘 HUD / selector / variant menu 的本批 i18n 文案，`en-US` 与 `zh-CN` 当前 key parity 为 0 差异。
- 已修复 AI Chat 面板根节点、消息区、workbench/evidence 区、composer 的 `min-h-0` / `overflow` contract，并补充滚动容器测试。
- 已优化 PDF `_annotations.md` 导出格式：quote/comment 独立成段，area/ink 截图以 Markdown image 块呈现，保留 preview 路径和 unchanged preview 行为。
- 已提升 `.ipynb` read-only renderer 稳健性：安全解析、坏 cell 局部 warning、语言 resolver 复用、code cell 语言识别、紧凑阅读间距。
- 已通过聚焦验证：
  - `npm run test:run -- src/lib/__tests__/error-page-i18n.test.ts src/components/ai/__tests__/ai-chat-panel.test.tsx src/components/ui/__tests__/download-app-dialog.test.tsx src/lib/__tests__/ui-layers.test.ts src/__tests__/ux-hygiene-audit-script.test.ts src/components/layout/__tests__/command-bar.test.tsx src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx src/components/hud/__tests__/hud-logic.test.ts src/components/hud/__tests__/variant-menu.test.ts src/components/hud/__tests__/keycap.test.ts src/lib/__tests__/pdf-item.test.ts src/components/renderers/__tests__/jupyter-renderer.test.tsx src/lib/__tests__/notebook-utils.test.ts`，216 tests passed。
  - `npm run typecheck` 通过。
- 当前 UX hygiene 剩余：314 issues，其中 `hardcoded-ui-text: 199`、`theme-hardcode: 115`、`i18n-key-parity: 0`、`z-index-hardcode: 0`。
- 下一批优先级：
  1. `src/components/agent/agent-protocol-center.tsx`：硬编码 UI 文案集中迁移 i18n。
  2. `src/app/globals.css`：主题硬编码和 CSS pseudo 文案继续 token 化。
  3. `src/components/renderers/text-annotation-editor.tsx`、`src/components/renderers/text-annotation-picker.tsx`：PDF annotation 文案、主题、popover 交互一致性。
  4. `src/lib/markdown-export.tsx`、`src/components/editor/markdown-export-dialog.tsx`：Markdown 导出文案和暗色主题。
  5. `src/components/renderers/pdf-highlighter-adapter.tsx`：继续处理下划线基线、选择跳动、PDF 标注 handle 暗色主题。

### 2026-06-27 第二批落地

- 已将 `src/components/agent/agent-protocol-center.tsx` 的可见 UI 文案、tab、表单标签/placeholder、aria/title、toast、Co-work Inbox、QA Runner、证据/决策/交接面板迁移到 `agentProtocol.*` i18n key。
- 保留协议导出、历史默认模板和本地存储 id 的兼容边界；UI 显示层跟随当前语言切换，已有中文测试默认行为保持稳定。
- 已新增英文 locale 回归测试：`Agent Protocol Center`、Execution/Evidence tab、Task context、Stage progress、Copy protocol、英文 placeholder 可正确渲染，中文标题不再出现。
- 已通过聚焦验证：
  - `npm run test:run -- src/components/agent/__tests__/agent-protocol-center.test.tsx`，20 tests passed。
  - `npm run typecheck` 通过。
  - `src/components/agent/agent-protocol-center.tsx` UX hygiene issues 从 58 降为 0。
- 当前 UX hygiene 剩余：256 issues，其中 `hardcoded-ui-text: 141`、`theme-hardcode: 115`、`i18n-key-parity: 0`、`z-index-hardcode: 0`。
- 下一批优先级更新：
  1. `src/app/globals.css`：主题硬编码 60 处，需区分 CSS token、文档画布例外和 CSS pseudo 文案。
  2. `src/lib/markdown-export.tsx`：15 处导出文案硬编码，需兼顾 Markdown 输出语言和测试兼容。
  3. `src/components/renderers/text-annotation-editor.tsx`、`src/components/renderers/text-annotation-picker.tsx`：PDF annotation UI 文案、主题和弹层一致性。
  4. diagnostics 与 handwriting toolbar：测试/诊断页面可后置，但不应长期影响全局扫描。

### 2026-06-27 第三批落地

- 已清理 `src/app/globals.css` 中量子键盘/HUD、variant menu、symbol selector 的白色/rgba 主题硬编码，并补齐 `--quantum-glass-*` 语义 token，避免亮色/暗色主题下弹层文字、边框、hover、输入框仍残留暗底白字假设。
- 已移除量子键盘 CSS pseudo 文案：`.quantum-title::after`、`.quantum-subtitle::after`、`.quantum-mode-indicator::after`、`.quantum-hint::after` 不再承载中文 UI 文案，文案回归 React/i18n 显示层。
- 保留文档画布、PDF/PPT/Word 页面等白底渲染例外，不把内容保真区域误改成应用 chrome token。
- 已通过聚焦验证：
  - `npm run test:run -- src/components/hud/__tests__/hud-logic.test.ts src/components/hud/__tests__/variant-menu.test.ts src/components/hud/__tests__/keycap.test.ts src/stores/__tests__/hud-store.test.ts src/config/__tests__/quantum-keymap.test.ts`，87 tests passed。
  - `node scripts/ux-hygiene-audit.mjs --json`，全局 `0` issues。
  - `npm run typecheck` 通过。
- 下一批优先级更新：
  1. `src/lib/markdown-export.tsx`：导出文案硬编码与 Markdown 输出语言策略。
  2. `src/components/renderers/text-annotation-editor.tsx`、`src/components/renderers/text-annotation-picker.tsx`：PDF annotation UI 文案、主题、弹层一致性。
  3. PDF 下划线基线与选择稳定性：进入 P2.1 前先补失败/回归测试，再调整 underline/selection 事实源。

### 2026-06-27 第四批落地

- 已按 TDD 修复 PDF stored underline 位置：新增失败测试先复现 `backgroundPosition = left 0px`，确认下划线被渲染到 segment 顶部。
- 根因确认：`buildPdfUnderlineDecorationStyle` 将 page-relative 百分比 segment 几何与 px 最小线宽混算，`baselineTop` 被 clamp 到 `0`；修复后 solid/dashed/double/wavy 均以 CSS 盒子底部为锚点，使用 `calc(100% - strokeHeight)`，避免单位混算。
- 修复范围保持最小：只调整 underline stroke 的 CSS 定位策略，不改 PDF text kernel、selection reconciler 或持久化结构。
- 已通过聚焦验证：
  - `npm run test:run -- src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx -t "anchors stored underline strokes"`，1 test passed。
  - `npm run test:run -- src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx`，89 tests passed。
  - `npm run test:run -- src/lib/__tests__/pdf-text-rects.test.ts src/lib/__tests__/pdf-selection-reconciler.test.ts`，70 tests passed。
  - `npm run typecheck` 通过。
- 下一步继续 P2.1：补“拖动/滚动过程中选区快照不跳动”的回归测试，重点检查 DOM selection、drag geometry、text kernel anchor 三者的事实源切换时机。

### 2026-06-27 第五批落地

- 已修复 `src/lib/markdown-export.tsx` 的导出语言链路：导出构建入口读取当前 `locale`，HTML 根节点写入对应 `lang`，导出标题、meta、appendix/study-note chrome、annotation/evidence/note 标签、PDF/code locator 标签均随中英文切换。
- 已移除导出层旧的硬编码中文 `annotationTargetLabel`，改为 `getMarkdownExportCopy(locale)` 集中维护导出文案，避免中文默认值绕过语言设置。
- 已补 `src/lib/__tests__/markdown-export.test.tsx` 回归：中文导出包含 `批注附录`、`PDF 第 4 页`、`代码第 42 行` 且无常见 mojibake；英文导出包含 `Annotation Appendix`、`PDF page 4`、`Code line 42`、`Notes`；`getLocaleDisplayName("zh-CN")` 保持 `简体中文`。
- 已通过聚焦验证：
  - `npm run test:run -- src/lib/__tests__/markdown-export.test.tsx`，5 tests passed。
  - `npm run typecheck` 通过。

### 2026-06-27 第六批落地

- 已按 TDD 修复通用窗口分隔拖拽控件 `src/components/ui/resizable.tsx`：先新增失败测试证明 handle 不是可访问 separator、命中区域只有 `w-px` 且不支持 pointer/键盘调节。
- 根因确认：AI 右侧面板已在 `app-layout.tsx` 接入 `ResizablePanelGroup` 并持久化尺寸，但底层 `ResizableHandle` 只支持 mouse drag，缺少触控/笔输入、键盘调节与可访问语义，且默认 1px 命中区使用户很容易感知为“不可调节”。
- 修复后 handle 具备：
  - `role="separator"` 与正确 `aria-orientation`，可聚焦；
  - `ArrowLeft/Right` 或 `ArrowUp/Down` 细调，`Shift` 加速；
  - pointer drag 兼容触控笔/触屏，同时保留 mouse drag；
  - 横向/纵向命中区域从 1px 扩到 8px，并保留 min/max 约束与左右 panel 总和稳定。
- 影响面为通用基础能力：AI Chat 右栏、插件面板、桌面/主区域分屏、PDF 批注侧栏等复用该控件的窗口调节都会受益。
- 已通过聚焦验证：
  - `npm run test:run -- src/components/ui/__tests__/resizable.test.tsx`，2 tests passed。
  - `npm run test:run -- src/components/ui/__tests__/resizable.test.tsx src/components/layout/__tests__/desktop-workbench-layout.test.ts src/components/ai/__tests__/ai-chat-panel.test.tsx src/lib/__tests__/ui-layers.test.ts`，20 tests passed。
  - `npm run typecheck` 通过。

### 2026-06-27 第七批落地

- 已按 TDD 修复 AI Chat 长会话自动滚动跳动：先新增失败测试复现用户滚动到历史位置后，新增消息会把 `scrollTop` 从历史位置强制改成底部。
- 根因确认：`ChatMessages` 在 `conv?.messages` 变化时无条件执行 `scrollTop = scrollHeight`，没有区分“用户正在读历史消息”和“用户仍贴近底部等待新消息”。
- 修复策略保持最小：新增 `CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 48` 与 `shouldAutoScrollRef`；`onScroll` 记录当前是否接近底部；消息变化后仅在接近底部时自动滚到底部。
- 行为结果：
  - 用户离底部较远阅读历史时，新消息/流式更新不再打断阅读位置。
  - 用户本来就在底部附近时，仍然跟随新消息保持聊天体验连续。
- 已通过聚焦验证：
  - `npm run test:run -- src/components/ai/__tests__/ai-chat-panel.test.tsx -t "scroll"`，2 tests passed。
  - `npm run test:run -- src/components/ai/__tests__/ai-chat-panel.test.tsx`，16 tests passed。
  - `npm run typecheck` 通过。

### 2026-06-27 第八批落地

- 已按 React 官方 `createPortal` 模式修复 AI Chat 内嵌弹层被右侧面板 `overflow-hidden`/层级上下文裁切的风险。
- 根因确认：
  - `PromptPicker` / `PromptEditorDialog` 虽是 `fixed`，但仍作为 `AiChatPanel` 子树渲染，容易受右侧 dock 的裁切、层级和 stacking context 影响。
  - `MentionAutocomplete` 原本是 `absolute z-50`，挂在 `ChatInput` 的 `relative` 容器内，是最容易被 composer/右栏边界裁切的下拉。
- 修复内容：
  - 新增 `src/components/ui/portal.tsx`，客户端挂载后将 children 渲染到 `document.body`。
  - `AiChatPanel` 中的 `PromptPicker` 与 `PromptEditorDialog` 通过 `Portal` 挂到 body，避免被面板 shell 裁切。
  - `MentionAutocomplete` 自身通过 `Portal` 挂到 body，并使用 `fixed` + `UI_LAYER_CLASS.dialogElevated`，保持层级语义一致。
- 已补回归测试：打开 Prompt Picker 后，`prompt-picker-dock` 不再是 `ai-chat-panel` 的 DOM 子节点。
- 已通过聚焦验证：
  - `npm run test:run -- src/components/ai/__tests__/ai-chat-panel.test.tsx -t "mounts prompt docks"`，1 test passed。
  - `npm run test:run -- src/components/ai/__tests__/ai-chat-panel.test.tsx src/components/prompt/__tests__/prompt-picker.test.tsx src/components/prompt/__tests__/prompt-editor-dialog.test.tsx`，21 tests passed。
  - `npm run typecheck` 通过。

### 2026-06-27 第九批落地
- 已继续推进 P2.1 的 PDF 选区稳定性检查，重点复核 `resolvePdfSelectionFromNativeRange`、`choosePreferredNativeSelection`、`choosePreferredPointerSelection` 与 `PDFHighlighterAdapter` 的 frozen snapshot/finalize 链路。
- 已新增 `src/lib/__tests__/pdf-selection-reconciler.test.ts` 回归：同一行存在完全相同 repeated phrase 时，即使 DOM Range 漂移到后一个 occurrence，也必须以冻结几何保持用户实际选区位置。
- 已新增 `src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx` 回归：
  - frozen selection 在 PDF 滚动后、DOM Selection 消失后提交批注，rects 仍锚定原始文本位置；
  - DOM 文本可疑且必须信任拖拽几何时，滚动后提交仍保持选中单词和 page-relative rects 稳定。
- 复查确认 stored/transient underline 已共用 `buildPdfUnderlineDecorationStyle`，当前 solid/dashed/double/wavy 都以 segment 底部 `calc(100% - strokeHeight)` 定位，避免下划线落在文字上方。
- 本批次没有在未复现失败的情况下修改 production PDF selection scoring；新增测试作为后续重构和 PDF 引擎迭代的防回归护栏。
- 已通过聚焦验证：
  - `npm run test:run -- src/lib/__tests__/pdf-selection-reconciler.test.ts src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx -t "identical repeated text|scrolled before committing|geometry-trusted frozen selections|frozen selection geometry|underline strokes"`，6 tests passed。

### 2026-06-27 第十批落地
- 已继续推进 P2.6 的 editable notebook 稳健性与阅读密度闭环：read-only `JupyterRenderer` 已具备局部容错，本批重点补齐 editable `parseNotebook` 与 cell 布局。
- 已按 TDD 新增失败测试：
  - 非法 JSON 不再静默替换成空 Python notebook，而是作为 raw cell 保留原始内容；
  - 非 notebook JSON 作为 raw cell 保留格式化 JSON，避免误吞用户文件；
  - 单个坏 cell（非对象、非法 `source`、未知 `cell_type`）局部降级为 raw cell，不让整个 editable notebook 崩溃；
  - code cell 外层间距从 `space-y-2` 收紧到 `space-y-1.5`。
- 已改造 `src/lib/notebook-utils.ts`：
  - 增加结构守卫，解析 top-level、cells、metadata、source 时不再直接强制类型转换；
  - 坏文件/坏 cell 以 raw cell 保留可读内容和 `latticeInvalidNotebookReason` metadata；
  - 合法 notebook 保持原有 code/markdown/raw、outputs、execution_count、metadata 序列化路径。
- 已收紧 editable notebook 阅读密度：
  - `CodeCell` 外层间距改为 `space-y-1.5`；
  - `NotebookCellComponent` toolbar margin 从 `mb-2` 收紧到 `mb-1.5`；
  - `NotebookEditor` cell 列表从 `space-y-6 p-6` 收紧为 `space-y-3 px-4 py-4 md:px-6`，对齐 read-only renderer 的紧凑阅读体感。
- 已通过验证：
  - `npm run test:run -- src/lib/__tests__/notebook-utils.test.ts src/components/notebook/__tests__/code-cell-component.test.tsx`，32 tests passed；
  - `npm run test:run -- src/components/renderers/__tests__/jupyter-renderer.test.tsx src/lib/__tests__/notebook-utils.test.ts src/components/notebook/__tests__/code-cell-component.test.tsx src/components/notebook/__tests__/markdown-cell.test.tsx src/components/notebook/__tests__/output-area.test.tsx`，52 tests passed；
  - `npm run typecheck` 通过。

### 2026-06-27 第十一批落地
- 已启动并落地“万物互联”首批深链闭环，聚焦 Markdown/PDF/文件/网页链接的统一解析、打开与目标落点消费。
- 根因确认：
  - Markdown 点击层已通过 `AppMarkdownLink`/`UniversalFileViewer` 接入 `navigateLink`，但 Markdown Viewer 消费 pending navigation 时使用原始路径字符串比较，和 PDF/Code/Notebook Viewer 的归一化策略不一致，容易出现“文件打开但不滚到标题/行”的体验断裂。
  - `parseLinkTarget` 对 PDF fragment 缺少文件类型意识，`paper.pdf#uuid` 这类真实批注 ID 会被误判为 `workspace_heading`。
  - raw wiki link target（例如 `[[notes/Deep Work#Core Idea|read this]]`）未在路由层剥离 `[[...]]` 与 alias，导致插件、live preview widget 或外部面板直接传 raw target 时解析错误。
- 已按 TDD 新增并通过回归：
  - `src/lib/link-router/__tests__/parse-link-target.test.ts`：覆盖裸 PDF fragment 作为 annotation id、raw wiki alias target、原有 external/workspace/page/line/cell/system path。
  - `src/lib/__tests__/markdown-navigation.test.ts`：覆盖 Markdown heading 原文/slug/CJK fragment 匹配，以及 workspace root 前缀归一化。
- 已新增 `src/lib/markdown-navigation.ts`：
  - `findMarkdownHeadingLine` 支持 readable heading、URL decoded fragment、slug fragment、CJK heading。
  - `isPendingNavigationForFile` 支持 pending/current path 的 workspace root 前缀归一化，同时保留 `isSameWorkspacePath` 的严格路径语义，避免全局误判。
- 已改造 `src/components/editor/obsidian-markdown-viewer.tsx`：
  - 使用 `findMarkdownHeadingLine` 替代组件内私有 heading matcher。
  - 使用 `isPendingNavigationForFile(pending.filePath, filePath, rootHandle?.name)` 消费 pending navigation，提升跨文件/同文件 heading 与 line 跳转稳定性。
- 已改造 `src/lib/link-router/parse-link-target.ts`：
  - 支持 `[[target#heading|alias]]` / `![[target]]` raw wiki target 解析。
  - 对 `.pdf#fragment` 在非 `page`/`annotation` 参数场景下默认解析为 `pdf_annotation`，兼容 UUID、自定义 ID 和旧式裸批注链接。
- 已继续增强 PDF 组合深链：
  - `LinkTarget` 的 `pdf_annotation` 支持可选 `page` hint。
  - `papers/math.pdf#page=2&annotation=ann-123` 解析为带页码提示的 `pdf_annotation`。
  - `papers/math.pdf#page=2&ann=ann-123` 与 `annotation=...` 等价，和 AI/workbench evidence locator 的短参数保持一致。
  - PDF Viewer 在批注数据延迟加载时，会先利用 page hint 滚到目标页并闪烁页面；批注加载完成后继续选中并定位具体 annotation。
- 已修复 HTML 预览同页跳转：
  - 新增 `src/lib/html-navigation.ts`，将纯 `#section` 同页 anchor 留给 iframe 原生滚动处理。
  - `HTMLViewer` 不再把 iframe 内 `href="#..."` 错误派发到 workspace heading navigation；相对文件链接、外部 URL、带文件路径的 hash 仍继续走 `navigateLink`。
- 已落地 Markdown 链接健康检查首批能力：
  - `IndexedMarkdownLink` 新增 `resolution` 元数据，保留原有 `resolvedPath` / `broken` 兼容字段。
  - `resolution.kind` 区分 `external`、`system`、`exact`、`extensionless`、`basename`、`unresolved`，为 UI 呈现“为何可达/为何断链”提供稳定事实源。
  - `resolution.repairCandidates` 记录可解释修复候选：extensionless/basename 命中时给出可规范化目标；真正断链时可根据 display text 推断候选。
  - `MarkdownLinksPanel` 的坏链修复下拉优先展示 `resolution.repairCandidates`，没有候选时才回退全工作区文件列表，减少用户盲选。
- 已通过聚焦验证：
  - `npm run test:run -- src/lib/link-router/__tests__/parse-link-target.test.ts src/lib/__tests__/markdown-navigation.test.ts`：2 files / 12 tests passed。
  - `npm run test:run -- src/lib/link-router/__tests__/parse-link-target.test.ts src/lib/link-router/__tests__/navigate-link.test.ts src/lib/link-router/__tests__/path-utils.test.ts src/lib/__tests__/markdown-navigation.test.ts src/lib/__tests__/markdown-links.test.ts src/lib/__tests__/pdf-item.test.ts src/lib/__tests__/pdf-annotation-markdown-drafts.test.ts src/lib/__tests__/workspace-indexer-markdown.test.ts src/components/renderers/__tests__/markdown-renderer.test.tsx src/components/layout/__tests__/annotations-activity-panel.test.tsx`：10 files / 43 tests passed。
  - `npm run test:run -- src/lib/link-router/__tests__/parse-link-target.test.ts src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx -t "page hints|page hint|PDF annotation links|markdown annotation navigation"`：2 files / 4 tests passed。
  - `npm run test:run -- src/lib/link-router/__tests__/parse-link-target.test.ts src/lib/link-router/__tests__/navigate-link.test.ts src/lib/__tests__/markdown-navigation.test.ts src/lib/markdown/__tests__/link-index.test.ts src/lib/__tests__/pdf-item.test.ts src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx -t "parseLinkTarget|navigateLink|markdown navigation|PDF annotation|annotation navigation|page hint|markdown annotation navigation|renders persisted PDF annotations"`：5 files passed / 1 skipped，23 tests passed。
  - `npm run test:run -- src/lib/link-router/__tests__/parse-link-target.test.ts`：1 file / 12 tests passed。
  - `npm run test:run -- src/lib/__tests__/html-navigation.test.ts src/lib/link-router/__tests__/parse-link-target.test.ts`：2 files / 14 tests passed。
  - `npm run test:run -- src/lib/markdown/__tests__/link-index.test.ts src/components/editor/__tests__/markdown-links-panel.test.tsx -t "link health|repair candidates|prioritizes indexed"`：2 files / 2 tests passed。
  - `npm run test:run -- src/lib/markdown/__tests__/link-index.test.ts src/lib/markdown/__tests__/workspace-link-index.test.ts src/lib/markdown/__tests__/link-maintenance.test.ts src/lib/markdown/__tests__/graph.test.ts src/components/editor/__tests__/markdown-links-panel.test.tsx`：5 files / 26 tests passed。
  - `npm run typecheck` 通过。
- 后续“万物互联”继续推进优先级：
  1. 链接健康检查：将 `resolution.kind` 与候选原因接入坏链 UI 文案、toast 和批量修复入口。
  2. PDF 深链增强：批注加载失败的用户可见提示、area/ink preview 到 PDF annotation 的双向跳转。
  3. HTML/Web 深链：补外部网页 hash、workspace HTML 相对链接、HTML source/preview 切换后 anchor 保持的点击回归。
  4. Notebook 深链：补 `#cell=id` 从 Markdown/搜索/AI evidence 跳转到 cell 后的可见高亮与滚动测试。
  5. UI 反馈：跳转失败时 toast 明确区分“找不到文件”“文件存在但目标 heading/annotation/cell 不存在”“浏览器/系统路径打开失败”。

### 2026-06-27 第十二批落地
- 已重新明确 P2.4 量子键盘定位：它不是普通符号面板，而是最快、低记忆负担的公式输入法与公式管理器。第一阶段目标是让结构模板、符号、最近公式、Markdown/LaTeX 导出走同一条稳定链路。
- 已新增 `src/lib/formula-composer.ts`：
  - `buildFormulaInsertPayload` 将公式模板统一转换为 Markdown、MathLive placeholder、display mode、preview payload。
  - `buildFormulaRecord` 将任意 Markdown/LaTeX 输入规范化为可复用公式记录，保留 source、display mode、Markdown 与 MathLive 格式。
  - `buildFormulaClipboardText` 支持 LaTeX、当前 Markdown、强制 inline Markdown、强制 display Markdown 导出。
  - `updateRecentFormulaRecords` 提供最近公式去重、置顶和数量上限。
- 已新增 `src/lib/__tests__/formula-composer.test.ts`，按 TDD 覆盖模板 payload、Markdown/LaTeX 规范化、复制导出和最近公式去重。
- 已改造 `src/components/hud/keyboard-hud.tsx`：
  - 模板插入从零散对象改为 `buildFormulaInsertPayload`，MathLive/Markdown/CodeMirror 目标继续复用现有统一输入处理器。
  - 符号与模板插入都会生成 `FormulaRecord`，最近公式条可点击回填到当前输入目标。
  - 复制 MD / TeX 不再手写拼接，统一走 composer 导出逻辑。
  - 第一屏键帽显示优先使用 i18n label 与干净数学符号映射，规避旧常量乱码影响。
- 已补 `zh-CN` / `en-US` 的 `quantum.structure.*`、`quantum.recentFormulas`、`quantum.recentFormulaTitle` 词条，确保新增 UI 不绕过语言体系。
- 已补 `.quantum-recent-*` 样式，使用 `hsl(var(--...))` 主题 token，避免暗色模式出现白底/硬编码黑字。
- 已通过验证：
  - `npm run test:run -- src/lib/__tests__/formula-composer.test.ts`：1 file / 4 tests passed。
  - `npm run typecheck`：通过。
- 后续 P2.4 深化优先级：
  1. 清理 `src/config/quantum-keymap.ts` 中乱码 label/keywords 与重复 variants，并补 keymap schema 回归。
  2. 将最近公式扩展为轻量公式库：收藏、重命名、搜索、按 Markdown/LaTeX/MathLive 复制。
  3. 增强 MathLive 手写感：连续结构嵌套、placeholder 跳转、选区包裹、Tab/Shift+Tab/Enter 行为回归。
  4. 补 HUD Playwright/截图验证：light/dark + zh/en + Markdown/MathLive target + 最近公式回填。

### 2026-06-27 第十三批落地
- 已继续推进 P2.4 量子键盘数据质量闭环，目标是降低公式输入法学习成本：候选条不重复、标签/关键词可读、结构模板可被搜索和复用。
- 已增强 `src/config/__tests__/quantum-keymap.test.ts`：
  - 新增候选去重断言：同一物理键的 default、shift、variants 不能重复，防止 Shift/候选条出现相同公式。
  - 新增 keymap 可见元数据 mojibake 检查：label、title、preview、keywords 不允许残留乱码。
  - 新增公式模板 label/keywords 可读性检查，避免模板搜索和最近公式记录继续显示乱码。
  - 修正旧 invalid-command property generator：按 trim 后的首字符判断无效样本，避免 `" ^ "` 这类样本误伤测试本身。
- 已清理 `src/config/quantum-keymap.ts`：
  - `KeyT` 去掉重复 `\otimes`，补 `\triangle`。
  - `KeyU` 去掉与 Shift 重复的 `\bigcup`，补 `\bigvee`。
  - `KeyJ` 去掉与 default 重复的 `\jmath`，补 `\operatorname{Jac}`。
  - `KeyZ` 去掉与 default 重复的 `\zeta`，补 `\mathfrak{Z}`。
- 已重写 `src/lib/formula-templates.ts` 的展示元数据：保留模板 id、LaTeX、MathLive placeholder、preview 和 keymap 不变，仅将 label/keywords 修为可读英文 + 中文搜索词。
- 已通过验证：
  - `npm run test:run -- src/config/__tests__/quantum-keymap.test.ts`：1 file / 22 tests passed。
  - `npm run test:run -- src/config/__tests__/quantum-keymap.test.ts src/lib/__tests__/formula-templates.test.ts src/lib/__tests__/formula-composer.test.ts src/components/hud/__tests__/hud-logic.test.ts src/components/hud/__tests__/keycap.test.ts src/components/hud/__tests__/variant-menu.test.ts`：6 files / 73 tests passed。
  - `npm run typecheck`：通过。
- 后续 P2.4 深化优先级更新：
  1. 把最近公式扩展为轻量公式库：收藏、重命名、搜索、按 Markdown/LaTeX/MathLive 复制。
  2. 给 HUD 补 Playwright 交互验证：键帽点击、实体键输入、Shift 候选、最近公式回填、复制 MD/TeX。
  3. 深化 MathLive 手写感：选区包裹、连续嵌套、placeholder 跳转和 Enter 新公式行行为回归。

### 2026-06-27 第十四批落地
- 已把“最近公式”升级为轻量公式库首版，继续服务量子键盘的核心定位：公式输入法 + 公式管理器。
- 已按 TDD 扩展 `src/lib/__tests__/formula-composer.test.ts`：
  - 收藏/取消收藏必须保留公式 identity、payload、createdAt，并更新 updatedAt。
  - 重命名只改 label，不改变 LaTeX、Markdown、MathLive payload。
  - 搜索覆盖 label、LaTeX、Markdown、source；空查询按收藏优先、最近更新优先排序。
- 已扩展 `src/lib/formula-composer.ts`：
  - `FormulaRecord.favorite` 作为轻量收藏标记。
  - `toggleFavoriteFormulaRecord`、`renameFormulaRecord`、`searchFormulaRecords` 提供公式库核心纯逻辑。
  - 复制导出继续复用 `buildFormulaClipboardText`，并在 HUD 中新增 MathLive payload 复制入口。
- 已改造 `src/components/hud/keyboard-hud.tsx`：
  - 公式库提供搜索框，实时筛选最近/收藏公式。
  - 每条公式支持点击插入、收藏/取消收藏、重命名、复制 MD、复制 TeX、复制 MathLive。
  - 保持键盘输入不中断：公式库输入框拦截自身 keydown，不把搜索文本误转发到 MathLive。
- 已补 `zh-CN` / `en-US` 的公式库词条：搜索、收藏、取消收藏、重命名、MathLive 复制、空结果。
- 已补 `.quantum-formula-*` 样式：搜索条、公式卡片、图标按钮和复制按钮均使用主题 token，兼容暗色模式。
- 已通过验证：
  - `npm run test:run -- src/lib/__tests__/formula-composer.test.ts src/config/__tests__/quantum-keymap.test.ts src/lib/__tests__/formula-templates.test.ts src/components/hud/__tests__/hud-logic.test.ts src/components/hud/__tests__/keycap.test.ts src/components/hud/__tests__/variant-menu.test.ts`：6 files / 76 tests passed。
  - `npm run typecheck`：通过。
- 后续 P2.4 深化优先级更新：
  1. 增加 HUD Playwright 交互测试：公式库搜索、星标、重命名、复制 MathLive、点击回填。
  2. 将公式库持久化到本地 store，避免刷新/重开后收藏丢失。
  3. 优化 MathLive 手写感：选区包裹、嵌套结构、placeholder 跳转、Enter 新公式行。

### 2026-06-27 第十五批落地
- 已将量子键盘轻量公式库从 HUD 临时状态升级为本地持久化 store，避免刷新或重开后收藏、重命名和最近公式丢失。
- 已新增 `src/stores/__tests__/quantum-formula-library-store.test.ts` 并按 TDD 先验证失败：
  - upsert 同一公式不会重复，更新 label/updatedAt 时保留 createdAt。
  - rename 与 favorite 不改变 LaTeX、Markdown、MathLive payload。
  - query 支持收藏优先、最近优先、关键词搜索和结果上限。
- 已新增 `src/stores/quantum-formula-library-store.ts`：
  - 使用 `zustand persist` 与 `createSafeJSONStorage`，和 `quantum-custom-store` 的本地持久化风格一致。
  - `upsertFormulaRecord`、`renameFormulaRecord`、`toggleFormulaFavorite`、`queryFormulaRecords`、`clearFormulaLibrary` 构成当前公式库 API。
  - 默认保留最多 80 条公式，HUD 查询默认显示前 8 条。
- 已改造 `src/components/hud/keyboard-hud.tsx`：
  - `rememberFormula` 写入持久化公式库 store。
  - 公式库 UI 读取 store records，搜索、收藏、重命名、复制和点击回填均作用于持久化数据。
  - 保留 `lastInsertedLatex` 作为即时复制状态，公式库记录作为长期管理状态。
- 已通过验证：
  - `npm run test:run -- src/stores/__tests__/quantum-formula-library-store.test.ts src/lib/__tests__/formula-composer.test.ts src/config/__tests__/quantum-keymap.test.ts src/lib/__tests__/formula-templates.test.ts src/components/hud/__tests__/hud-logic.test.ts src/components/hud/__tests__/keycap.test.ts src/components/hud/__tests__/variant-menu.test.ts`：7 files / 79 tests passed。
  - `npm run typecheck`：通过。
- 后续 P2.4 深化优先级更新：
  1. 补 HUD Playwright 交互测试：搜索、星标、重命名、复制 MathLive、刷新后持久化恢复、点击回填。
  2. 清理 HUD 文件头部仍残留的旧乱码常量块，将结构键和符号键常量彻底迁移为干净 typed metadata。
  3. 优化 MathLive 手写感：选区包裹、嵌套结构、placeholder 跳转、Enter 新公式行。

### 2026-06-27 第十六批落地
- 已按 v2.3.1 发布目标完成桌面 / 网页同步闭环：
  - `package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 已统一更新到 `2.3.1`。
  - `next.config.ts` 继续将生产 Web 静态产物导出到 `web-dist`。
  - `src-tauri/tauri.conf.json` 继续通过 `beforeBuildCommand: "npm run build"` 与 `frontendDist: "../web-dist"` 把同一套最新 Web 产物打入桌面包。
- 已核验量子键盘 HUD 头部结构键与符号键常量：
  - UTF-8 code point 显示 `CORE_KEY_TILES` 真实为 `上标/下标/根号/分数/求和/积分/极限/矩阵/分段/向量`。
  - `SYMBOL_KEY_LABELS` 真实为 `θ/π/α/γ/δ/η`。
  - PowerShell 里看到的“乱码”属于终端编码显示误报，源码无需做破坏性重写。
- 已完成 v2.3.1 验证与构建：
  - `npm run test:run -- src/__tests__/prepare-release-script.test.ts src/lib/__tests__/formula-composer.test.ts src/stores/__tests__/quantum-formula-library-store.test.ts src/config/__tests__/quantum-keymap.test.ts`：4 files / 34 tests passed。
  - `npm run typecheck`：通过。
  - `npm run build`：通过，Next static export 成功刷新 `web-dist`。
  - `npm run tauri:build`：通过，生成 Windows 桌面可执行文件、MSI 与 NSIS 安装包。
  - `npm run release:prepare -- --version 2.3.1 --artifacts-dir src-tauri/target/release`：通过。
- 已生成本地 release 目录 `releases/v2.3.1/`：
  - `Lattice_2.3.1_x64_en-US.msi` SHA256 `35add243541ab35099f78c6bb3cf40404d6056a5dd25a1aa45987efbe7ca1888`
  - `Lattice_2.3.1_x64-setup.exe` SHA256 `c06a60f71d24ca01d509bf91d86417a328f8ea099ceaada5184b0a45b4cefa59`
  - `lattice.exe` SHA256 `f362b33ee86efd03dd6a0f53a506ceb1bf1d3f10dbc8a883702665100339a58c`
  - `checksums.txt`、`release-manifest.json`、`RELEASE_SUMMARY.md` 已同步生成。
- 已同步发布文档：
  - `CHANGELOG.md`
  - `docs/RELEASE_NOTES.md`
  - `docs/LATTICE_RELEASE_READINESS.md`
- 后续 P2.4 深化优先级更新：
  1. 补 HUD Playwright 交互测试：搜索、星标、重命名、复制 MathLive、刷新后持久化恢复、点击回填。
  2. 优化 MathLive 手写感：选区包裹、嵌套结构、placeholder 跳转、Enter 新公式行。
  3. 继续推进全量 `qa:gate` 与浏览器回归，把本轮 focused gate 扩展为完整发布闸门。

## 8. 建议执行顺序

- [x] 第 1 批：P0.1、P0.2，建立 baseline 与扫描护栏。
- [x] 第 2 批：P1.1、P1.2，语言和主题基础系统。
- [x] 第 3 批：P1.3、P1.4，窗口、层级、AI panel。
- [ ] 第 4 批：P2.1，PDF 文本/下划线/选区稳定性。下划线位置已完成，选区拖动/滚动稳定性继续推进。
- [x] 第 5 批：P2.5，PDF 批注 Markdown 高可读持久化。
- [x] 第 6 批：P2.6，ipynb 稳健渲染、代码识别与阅读密度。
- [ ] 第 7 批：P2.2、P2.3，Markdown 与 HTML。
- [x] 第 8 批：P2.4，量子键盘体验重构首阶段（公式输入法/管理器基础闭环）。
- [ ] 第 9 批：P3.1，全量 QA 与文档收口。
