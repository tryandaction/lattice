# Changelog

All notable changes to Lattice will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- PDF item workspaces now accept folders and arbitrary file types, not only Markdown notes and notebooks.
- PDF item folders can now be expanded in both Explorer and the PDF Item panel, including nested arbitrary files such as images, CSVs, and unknown extensions.
- Explorer drag-and-drop can move files or folders directly onto a PDF to attach them to that PDF's item workspace.
- PDF item workspace routing now uses manifest/fingerprint recovery so moved, renamed, or copied PDFs can reopen their annotations and related files from any workspace root.
- Quantum Keyboard now follows the physical-keyboard model: the HUD shows only the 26 QWERTY letter keys, while number keys keep their native keyboard behavior.
- Letter candidates now support `Shift+number+letter` one-based selection, e.g. `Shift+2+I` inserts the second `I` candidate.
- Bracket and structure entry is more direct: `B` prioritizes parentheses, brackets, braces, cases, and beta.
- Rendered Markdown formulas now expose a right-click menu for copying either Markdown formula source or pure LaTeX.

### Fixed
- Double-Tab opening the Quantum Keyboard from Markdown/CodeMirror no longer leaves an unwanted tab/blank indentation in the document.
- MathLive formula insertion now converts empty structures into placeholders and moves into the first placeholder after insertion.

### Documentation
- Rewrote `docs/guides/quantum-keyboard.md` to match the current 26-letter HUD and formula-copy model.

## [2.3.1] - 2026-06-27

### 发布收口
- �?Web 端生产构建已刷新到最�?`web-dist`，Tauri 桌面构建继续通过 `frontendDist: "../web-dist"` 打包同一套静态前端�?- �?桌面版本已同步到 `package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` �?`2.3.1`�?- �?本地桌面 release 已生成到 `releases/v2.3.1/`，包含安装包、裸可执行文件、manifest、checksum �?summary�?- �?量子键盘 HUD 的结构键与符号键源码已按 UTF-8 code point 核验，PowerShell 乱码为终端显示问题，实际 UI 映射保持 `上标/下标/...` �?`θ/π/α/γ/δ/η`�?
### 桌面产物
- `releases/v2.3.1/Lattice_2.3.1_x64_en-US.msi` SHA256 `a058fed7fd4b1a3c2305e302b2b0f58971863acdeefa7e9d9b1737aa4f7bd5d5`
- `releases/v2.3.1/Lattice_2.3.1_x64-setup.exe` SHA256 `8ffe0b7f053a5476043b21fff1e6a46f838e591ae9f03e18cfcfab0c65198ef6`
- `releases/v2.3.1/lattice.exe` SHA256 `6b2039593ab01d6e89ed0b48f437619de6c3451589fcf5041f57feade2901dfc`

### 验证
- `npm run test:run -- src/__tests__/prepare-release-script.test.ts src/lib/__tests__/formula-composer.test.ts src/stores/__tests__/quantum-formula-library-store.test.ts src/config/__tests__/quantum-keymap.test.ts`�? files / 34 tests passed�?- `npm run typecheck`：通过�?- `npm run build`：通过，Next static export 成功�?- `npm run tauri:build`：通过，生�?Windows MSI �?NSIS 安装包�?- `npm run release:prepare -- --version 2.3.1 --artifacts-dir src-tauri/target/release`：通过�?
### 改进 (2026-03-26 阶段性收敛补�?
- **桌面工作区与 session 恢复**
  - �?workbench session 现已�?`workspaceRootPath` 独立持久�?  - �?关闭后重开可继续恢�?pane / split / 标签�?/ active pane / active tab / sidebar collapsed
  - �?工作区切换与自动恢复前会先清理旧 workbench / cache，避免旧标签短暂闪现
- **Notebook / PDF 结构收口**
  - �?Notebook 独立顶部动作带已移除，高频动作统一进入 `Command Bar`
  - �?Notebook 现已补顶�?scroll + `activeCellId` 恢复
  - �?PDF 现已继续持久�?`sidebarSize` 与最近选中�?annotation
  - �?PDF 反链 / deep link 跳回时会自动展开 sidebar 并同步选中目标批注
  - �?`PdfItemWorkspacePanel` 已改为可折叠 section，降低左栏网页感工具台堆�?- **主路�?i18n 收口**
  - �?AI Chat / Workbench �?badge、toast、审批动作、模型来源已统一进入 i18n
  - �?Markdown 导出对话框已移除组件�?`isZh ? ... : ...` 文案分支
  - �?PDF 批注侧栏的搜索、筛选、多选、空态与常用菜单动作已统一进入 i18n
  - �?Search / Settings / Notebook loading indicator 继续清理主路径硬编码文案
- **旧代码与文档同步**
  - �?删除未引用旧组件 `pdf-viewer-with-annotations.tsx`
  - �?`layout-persistence.ts` 已改造成真实接线�?workbench session 持久化层
  - �?`README`、`USER_GUIDE`、`RELEASE_NOTES`、`MANUAL_RELEASE_GUIDE`、`PRODUCT_STRATEGY` 已同步更�?- **发布与验�?*
  - �?本轮顺序通过 `lint / typecheck / test:docs / test:run / build / tauri:build / release:prepare / deploy:web`
  - �?桌面 release 已刷新到 `releases/v2.3.0/`
  - �?最�?Cloudflare Pages 预览地址：`https://47f3417d.lattice-apq.pages.dev`

### 改进 (2026-03-24 本轮体验收口)
- **PDF 选区 / 复制 / 侧栏体验**
  - �?PDF 文本选择已改为原生选区阶段�?Lattice transient overlay 阶段分离，不再过早清空原生选区
  - �?`Ctrl+C / Cmd+C` 现优先复制当�?PDF 原生选中文本，其次才回退�?transient selection
  - �?PDF 选区重复回调去重已改为阶段感知会话，不再误杀用户重新拖出的合法连续选区
  - �?PDF 左栏已收紧为可拖拽宽度的紧凑工具�?+ 主批注工作区，批注列表重新占据主要高�?- **Markdown 阅读态收�?*
  - �?普�?Markdown 阅读态字号和标题继续收紧，进一步靠�?Obsidian 分屏密度
  - �?系统索引�?`_overview.md / _annotations.md` 继续比普通文档更紧凑
  - �?frontmatter 在默认阅读渲染中隐藏，不再混入正文显�?- **工作区恢复与命名收口**
  - �?桌面端现可恢复最近打开的工作区，不再每次重启都重新选文件夹
  - �?Web 与桌面端都开始写�?`lastOpenedFolder`，runner preference scope 会跟随工作区路径恢复
  - �?`Untitled*.md` 首次保存时若存在首个 H1，会自动按标题重命名，并同步 tab / Explorer / 文件路径

### 改进 (2026-03-24)
- **PDF Item System v2**
  - �?PDF 首次打开会自动建立同级隐藏兄弟目�?`.basename.lattice/`
  - �?PDF 条目目录固定包含 `manifest.json`、`_overview.md`、`_annotations.md`
  - �?Explorer 隐藏真实目录，并把系统文�?用户笔记投影�?PDF 子条�?  - �?PDF 批注 sidecar 已改为稳�?`itemId` 存储，rename / move / copy / delete 时伴随迁�?  - �?`_annotations.md` 已改为自动去抖镜像，同步 `#page=` / `#annotation=` 深链与反链摘�?  - �?批注评论、只�?Markdown、Notebook 只读 Markdown、Notebook 编辑�?Markdown Cell 已统一到应用内链接路由
  - �?PDF 批注侧栏支持显示反链并跳回来源笔记行
  - �?Explorer 右键 PDF 新增：打开概览 / 新建阅读笔记 / 新建 Notebook / 重建批注索引
- **部署链路收口**
  - �?新增 `npm run deploy:cloudflare`
  - �?新增 `npm run deploy:web`
  - �?发布文档已统一�?`web-dist -> Cloudflare Pages (主站) / GitHub Pages (备用)`

## [2.1.0] - 2026-03-21

### 改进 (2026-03-21)
- **知识组织产品化收�?*
  - �?assistant 结果统一进入 `AiResultViewModel`，稳定对�?`Conclusion / Evidence / Next Actions`
  - �?`@引用` �?Evidence 浏览统一到共�?`ReferenceBrowser`
  - �?Evidence Panel 去掉重复平铺引用区，收口为消息切换器 + 引用�?+ 上下文分�?  - �?Workbench 草稿支持 `templateId / originMessageId / originProposalId`，可区分独立草稿�?proposal-linked drafts
- **发布工程闭环收口**
  - �?新增统一 `scripts/prepare-release.mjs`
  - �?`release:prepare --dry-run` 现可输出 `manifest / checksums / summary` payload
  - �?release 目录收集逻辑已过�?Rust build helper exe 与无关安装辅助文�?  - �?GitHub Pages / draft release workflow 已对齐统一元数据与 summary 输出
- **仓库整洁性治�?*
  - �?删除历史修复与重构总结文档，收口文档体�?  - �?重写 `README`、安装、桌面构建、Live Preview 等关键入口文�?  - �?新增 `npm run clean` �?`npm run test:docs`
  - �?`qa:gate` 现已纳入文档健康检�?
### 改进 (2026-03-20)
- **桌面 Notebook / 代码运行链路收口**
  - �?`KernelSelector` 现在会明确区分“桌面运行时 / 网页运行时”，并在桌面端优先选择本地 Python，而不再默认停�?`Pyodide (Web Fallback)`
  - �?桌面端一旦探测到本地 Python，会自动把当�?Notebook 内核切回本地解释器；如果只剩 Pyodide，则会明确标注为“应急回退�?  - �?`runner-manager` 已去�?`python-local` 的无声浏览器降级语义：桌面端本地运行器失败时会报错，不再悄悄改走 Pyodide
  - �?`use-notebook-executor` �?`CodeCell` 现在只在用户明确选择 Pyodide 或网页环境下才允�?Pyodide 回退，桌�?Notebook 持续优先走本地持�?Python 会话
  - �?工作区运行器偏好现已跨重启持久化，Notebook / 代码文件 / Markdown 代码块会复用同一套最近选择与默认解释器
  - �?外部命令与本�?Python 运行前会先给出更明确的环境诊断与修复提示，不再只报一坨执行失败文�?- **Notebook Markdown / Markdown 代码块体验收�?*
  - �?`ipynb` Markdown Cell 已切到同一�?Live Preview 内核，默�?`Live`，并支持显式切到 `Source`
  - �?非激�?Markdown Cell 保持只读预览，激活后直接进入可编辑状态，不再依赖旧的双击 textarea 二�?  - �?`markdown-renderer` 里的支持语言 fenced code block 已可直接运行，并接入统一输出面板
- **统一执行反馈面板**
  - �?`OutputArea` 已升级为共享执行面板，统一展示运行来源、诊断、stdout/stderr 分组、结构化错误、图片与 HTML 输出
  - �?代码文件、Notebook code cell、只�?Jupyter renderer 现已复用同一套输出渲染模�?- **PDF 默认打开体验收口**
  - �?`pdf-highlighter-adapter` 默认打开改为 `fit-width`，首次进�?PDF 不再固定停在手动 `120%`
  - �?�?`pdf-viewer` / `pdf-viewer-with-annotations` 分支也同步改为默认自适应宽度填充
  - �?对应 PDF 单测与浏览器回归基线已同步切换到“默认适宽�?
### QA 更新 (2026-03-20)
- �?新增 `KernelSelector` 回归测试，锁定“桌面优先本�?Python / 网页只暴露浏览器内核 / 桌面回退内核自动切回本地”的关键行为
- �?`use-notebook-executor.tauri` 持久会话测试已跟随新的桌面环境判定更�?- �?新增 `runner preferences` 持久化测试、`markdown-cell` Live/Source 测试、共�?`OutputArea` 来源/诊断测试
- �?`pdf-highlighter-adapter` 测试已同步覆盖“PDF 默认适宽打开”后�?pane 作用域缩放行�?- �?当前阶段性验证已通过�?  - `npm run lint`
  - `npm run typecheck`
  - `npx vitest run src/components/notebook/__tests__/kernel-selector.test.tsx src/components/notebook/__tests__/output-area.test.tsx src/components/notebook/__tests__/markdown-cell.test.tsx src/lib/runner/__tests__/preferences.test.ts src/__tests__/use-notebook-executor.tauri.test.ts src/__tests__/use-notebook-executor.test.ts`

### 改进 (2026-03-19)
- **PDF 双分屏回归与缩放状态收�?*
  - �?新增 `pdf-view-state` helper，统一收口 PDF pane 作用域判定、viewState 持久化和相对滚动恢复逻辑
  - �?`pdf-highlighter-adapter` 已补稳定�?pane 级测试钩子与回归逻辑，锁�?`Ctrl+滚轮`、键盘缩放和�?pane 缓存�?zoom state
  - �?PDF diagnostics 新增 `/diagnostics/pdf-regression`，可直接验证双分屏布局、缩放作用域、右侧文件切换和阅读进度诊断信息
- **图片标注链路进一步产品化**
  - �?新增 `image-tldraw-state` helper，锁住背�?asset 更新、背景缺失修复判定和区域中心定位
  - �?`ImageTldrawAdapter` 背景资源已从 `blob:` 切换�?`data:` URL，修�?Tldraw �?blob 协议不接受导致的 workspace handle 标注失败
  - �?新增 `/diagnostics/image-annotation`，使用真�?OPFS / workspace handle 复现图片标注与强制重渲染链路
- **Selection AI 回归主链路补�?*
  - �?新增 `selection-actions` 测试，覆�?`chat / agent / plan` 三种分流、origin metadata、evidenceRefs 透传�?Workbench proposal 高亮
  - �?`SelectionAiHub` 新增可注�?runner，支�?diagnostics 页面使用 mocked orchestrator 验证主链�?  - �?新增 `/diagnostics/selection-ai`，直接验�?Chat / Agent / Plan 三种模式进入 Chat / Evidence / Workbench 的差异化落点
- **浏览器级回归门禁**
  - �?新增 `scripts/browser-regression.mjs` �?`npm run test:browser-regression`
  - �?浏览器回归现已覆�?`PDF 双分屏`、`图片 workspace handle 标注`、`Selection AI mocked 主链路`
- **主路径调试输出清�?*
  - �?清理 HUD、live preview、PPT、markdown/export、Jupyter websocket �?plugin runtime 中一批无条件 `console.log/info/debug`

### QA 更新 (2026-03-19)
- �?本轮新增 `pdf-view-state`、`pdf-highlighter-adapter`、`selection-actions`、`image-tldraw-state`、`ImageViewer` 扩展回归测试
- �?`use-annotation-system` 已补图片 path sidecar 隔离测试
- �?新增浏览器级 `test:browser-regression`，当前覆�?3 条高风险产品主链�?- �?本轮顺序验证 `lint` / `typecheck` / `test:run` / `test:browser-regression` / `build` / `tauri:build` 全绿
- �?当前测试基线已更新为 `92` 个测试文件、`962` 个测试全�?
### 文档更新 (2026-03-19)
- 更新 `docs/RELEASE_NOTES.md`，补�?diagnostics/regression 页面、浏览器回归门禁和本轮收口结�?- 更新 `docs/roadmap.md`，同步当前基线已纳入 browser regression �?diagnostics harness
- 更新 `docs/USER_GUIDE.md`，补充新�?diagnostics 入口说明
- 更新 `docs/DESKTOP_FEATURES.md`，补充桌面端 browser regression 门禁�?diagnostics 验证方式
- 更新 `docs/MANUAL_RELEASE_GUIDE.md`，将 `test:browser-regression` �?diagnostics 人工复检纳入发布检�?- 更新根目�?`项目概况.md`，同�?Lattice 当前测试基线与发布收口状�?
### 改进 (2026-03-18)
- **Selection AI Hub Phase 2 产品化深�?*
  - �?新增独立 `selection-ai-store`，记住最近使用模式与轻量 prompt 历史
  - �?Selection AI Hub 现已明确区分 `快速问�?/ 深度分析 / 计划生成`
  - �?每个模式新增独立说明、执行去向、starter templates、最�?prompt 历史与快捷键
  - �?Selection AI 结果现已写入结构�?`origin` metadata，在 Chat / Workbench 中可识别来源
  - �?`Agent` 结果会自动衔�?Evidence Panel，`Plan` 结果会直接高亮对�?proposal
- **SelectionContext �?EvidenceRef 精细�?*
  - �?`SelectionSourceKind` 补齐 `html` / `word`
  - �?`SelectionContext` 新增 `anchor` / `contextSummary`
  - �?`EvidenceRef` 新增可�?`anchor` 元数据，支持 `lineStart/lineEnd`、`cellId/cellIndex`、`page/rects/snippet`、`blockLabel`
  - �?代码编辑器现已提供真实选区行范围，Code 选区 evidence 改为 `#line=start-end`
  - �?Notebook 选区同时保留 `cell id + cell index`
  - �?PDF 选区现已带出 `page + rects + snippet` 锚点，而不再只保留 page �?evidence
  - �?HTML / Word 选区现已提取最�?block/heading 与邻近上下文
- **PDF / 分屏阅读稳定性修�?*
  - �?修复分屏�?pane 宽度收缩后内容向右溢出的布局问题，右侧阅读区不再被挤出屏�?  - �?PDF �?`Ctrl+滚轮` 与缩放快捷键现已�?pane 作用域生效，不会再让两个分屏同时缩放
  - �?PDF 在放大、缩小、适宽、适页以及窗口尺寸变化时，会尽量保持当前阅读位�?  - �?PDF 阅读状态现已按 tab 缓存：切到其他文件再切回，不会自动跳回第一�?- **图片显示稳定性修�?*
  - �?Image Viewer 改为显式管理对象 URL 生命周期，避免图片资源在显示后被过早释放
  - �?Image Tldraw Adapter 现会校验并自动修复背景图�?asset / shape，一并覆盖“图片显示几秒后消失”的高风险链�?  - �?新增 `/diagnostics/image-viewer` 诊断页，支持心跳检测、强制重渲染和真实页面图片稳定性巡检
- **资源 URL 生命周期统一**
  - �?新增通用 `useObjectUrl` hook，并统一接入图片 / HTML / PDF 资源型渲染器
  - �?Markdown 本地图片 resolver 已补 URL 缓存与销毁回收，减少 blob URL 残留与潜在渲染异�?- **批注 sidecar 隔离修复**
  - �?`useAnnotationSystem` 现优先使用完整工作区路径派生 `fileId`，避免同名不同路径文件共�?annotation sidecar
  - �?新逻辑仍会兼容读取旧的“按文件名�?sidecar，并在命中时规范化到新的路径�?`fileId`
- **旧代码清�?*
  - �?删除已退出主路径�?`src/components/ai/pdf-ai-panel.tsx`
  - �?删除未使用的 `src/hooks/use-pane-file-content.ts`
- **旧入口收�?*
  - �?删除 PDF 主界面的重复 `PdfAiPanel` 主入口，统一回收�?Selection AI 主链�?
### QA 更新 (2026-03-18)
- �?新增 `selection-ui`、`selection-ai-store`、`selection-ai-hub`、`selection-context-menu`、`ai-chat-panel` 测试
- �?`selection-context` 测试已扩展到 code line range、notebook id/index、pdf rect/snippet、html/word block context
- �?`content-cache-store` 已补 viewState 回归测试，覆盖阅读进度恢复所需状�?- �?当前测试基线已更新为 `88` 个测试文件、`945` 个测试全�?
### 文档更新 (2026-03-18)
- 更新 `docs/RELEASE_NOTES.md`，补�?Selection AI Hub Phase 2 �?PDF/分屏阅读稳定性修�?- 更新 `docs/roadmap.md`，同步当前阶段新增完成项
- 更新 `docs/USER_GUIDE.md`，补充新�?Selection AI Hub 使用方式�?PDF 分屏阅读行为
- 更新 `docs/DESKTOP_FEATURES.md`，补充分屏作用域、阅读状态恢复与桌面�?PDF 稳定性说�?- 更新 `docs/MANUAL_RELEASE_GUIDE.md`，将分屏 PDF 行为�?Selection AI Hub 验收纳入发布检�?
### 新增 (2026-03-17)
- **Markdown 导出产品�?*
  - �?Markdown 编辑器顶栏新增可发现�?Export 入口，用户可直接从产�?UI 导出当前文档
  - �?新增 Markdown 导出对话框，支持选择 `.docx` / `.pdf`
  - �?导出对话框新增导出标题配置与实时预览，导出前即可确认成品结构
  - �?导出不再走低质量正则转换，改为统一渲染文档模型，尽量保留标题层级、列表、代码块、表格、引用块与公式渲�?  - �?新增统一标注导出策略：`clean` / `appendix` / `study-note`
  - �?支持“文档版式”与“当前渲染视图”两种导出视觉模�?  - �?当前文件侧车标注现可�?Markdown 导出带出，并保留 page / line / anchor 等来源定位信�?  - �?`.pdf` 导出采用渲染快照链路，保证最终分享稿尽量贴近产品内阅读效�?  - �?`.docx` 导出采用结构�?HTML 导入链路，兼顾文档结构与可交付�?
### 改进 (2026-03-17)
- **桌面折叠侧边栏体验深�?*
  - �?折叠侧边栏已从浮层覆盖改为真实参与桌面布局，不再遮挡标签栏和阅读区
  - �?折叠宽度策略已升级为“近似固定像�?+ 百分比钳制”，不同桌面宽度下更稳定
  - �?折叠窄栏新增统一 rail button、激活态、帮助入口和更明确的 Explorer 标识�?- **选区右键 AI Hub**
  - �?Markdown / Code / Notebook / PDF 现已支持“选中文本后右键”的统一 AI 菜单
  - �?只读 Markdown / Code / Jupyter / HTML / Word 渲染器现也已接入同一套右�?AI 入口
  - �?右键菜单统一提供 `Chat` / `Agent` / `Plan` 三种模式入口
  - �?新增 Selection AI Hub：展示选区原文、来源位置、本地上下文，并支持补充问题后再发起 AI 动作
  - �?`Chat` 模式直接进入 AI Chat，保留显�?evidence
  - �?`Agent` 模式默认走更强的结构化分析提示，强调 `Conclusion / Evidence / Next Actions`
  - �?`Plan` 模式直接进入 Workbench proposal 流程，而不是先绕普通聊�?- **AI Provider 与本地模型配置收�?*
  - �?修复 Web �?API key 在刷新后从本地存储恢复错误的问题，避免看似已配置但实�?key 无效
  - �?修复 AI 设置中的 URL 配置�?provider 实际读取源不一致的问题，统一改为同一条安全存储链�?  - �?Ollama 改为 OpenAI 兼容接口优先、原�?`/api/chat` 自动回退，提升本地版本兼容�?  - �?AI 设置页新增统一�?Base URL、连接测试和手输模型 ID 能力
  - �?连接测试现在会返回更具体的失败原因，而不再只有“成�?/ 失败�?  - �?新增常用兼容 API provider：DeepSeek、Kimi (Moonshot)、智�?AI、Custom (OpenAI Compatible)
- **导出基础设施统一**
  - �?新增统一 Markdown 导出服务，复用现�?Web/Tauri `export-adapter` 保存链路
  - �?导出时可自动内联本地 Markdown 图片，减少相对路径资源在成品文档中失�?  - �?导出模型已支持统一汇入当前文件标注与显式证据引用，后续可继续扩展到更广�?Evidence 工作�?- **AI 证据浏览与引用体验收�?*
  - �?`@引用` 两段式浏览新增“文�?/ 片段”阶段提示，并支持从片段选择一键返回文件层
  - �?`Conclusion / Evidence / Next Actions` 解析现已兼容同一行标�?内容，以�?`**Evidence:** ...` 这类模型常见输出
  - �?Evidence Panel 在消息切换时会重置证据选择状态，消息摘要按钮支持展开/收起切换
- **表格外围交互可达�?*
  - �?表格外围句柄现已支持键盘聚焦显现
  - �?支持 `Shift+F10` / 菜单键打开外围操作面板，提升键盘可用�?- **QA 门禁更新**
  - �?本轮新增 Markdown 导出测试，覆盖附录预览、统一来源模型�?DOCX 包结�?  - �?本轮新增 `structured-response` / `mention-browser` / 表格键盘交互测试补强
  - �?本轮新增 AI key storage �?provider registry 测试，锁�?provider 重构的核心回归点
  - �?本轮新增 `selection-context` 测试，锁住选区 evidence 与默认模式提�?  - �?当前完整门禁已更新为 `78` 个测试文件、`920` 个测试全�?  - �?本轮顺序验证 `lint` / `typecheck` / `test:run` / `build` / `tauri:build` 全绿

### 清理 (2026-03-17)
- **旧导出实现移�?*
  - �?删除未接入主路径且质量偏低的 `src/lib/export-utils.ts`
  - �?删除未被产品主界面使用的�?`src/components/editor/export-button.tsx`

### 文档更新 (2026-03-17)
- 更新 `docs/RELEASE_NOTES.md`，补�?Markdown 导出产品化能力与 QA 基线
- 更新 `docs/roadmap.md`，同步当前阶段已完成项与下一轮导出深化方�?- 更新 `docs/USER_GUIDE.md`，补�?Markdown 导出操作说明
- 更新 `docs/DESKTOP_FEATURES.md`，补充桌面端 DOCX / PDF 导出体验与验证点
- 更新 `docs/MANUAL_RELEASE_GUIDE.md`，将 Markdown 导出纳入发布前验收清�?
### 新增 (2026-03-15)
- **AI-Native 科研副驾 v1**
  - �?新增统一 `AiOrchestrator`，统一 Chat、选区动作、PDF 助手、Notebook 助手和代码解释入�?  - �?新增 `AiContextGraph`，统一文件、Markdown 标题、PDF 批注、Notebook 单元、代码符号、工作区索引和当前选区上下�?  - �?新增 `EvidenceRef` / `AiDraftArtifact` / `AiTaskProposal` / `AiActionApproval` 公共接口
  - �?科研回答默认携带证据引用，并支持“保存为草稿”和“生成整理计划”两类后续动�?- **工作�?AI 引用系统**
  - �?`@引用` 从“已打开标签页文件名”升级为“工作区文件路径”补�?  - �?支持�?fragment 的引用解析：Markdown 标题、代码行、Notebook 单元、PDF 页码/批注
  - �?引用解析结果自动转成 `explicitEvidenceRefs`，让用户显式引用直接进入 AI 证据�?  - �?`@引用` 支持可视�?fragment 选择：文件命中后可继续选择 heading / line / cell / page / annotation
  - �?`@引用` 现已支持真正的两段式浏览：先选文件，再自动进入片段选择模式
- **AI Workbench 产品化升�?*
  - �?`drafts` / `proposals` 持久化，刷新后不再丢失本�?AI 工作流状�?  - �?proposal 支持展开审阅步骤、审批项�?planned writes
  - �?proposal 支持批准 / 拒绝状态流�?  - �?proposal 支持一键生成“计划草稿”，�?AI 计划沉淀到可写回的草稿资�?  - �?proposal 审批状态、勾选审批项和勾�?planned writes 全部持久化保�?  - �?Workbench 具备“计�?-> 草稿 -> 写回”的连续链路，减�?AI 结果停留在聊天记录中的流�?  - �?approved proposal 现已支持按已勾�?`plannedWrites` 批量生成目标草稿集合
  - �?目标草稿会预填目标路径与写入模式，并对已生成目标去重，避免重复生�?  - �?proposal 现已支持从已批准 writes 批量派生目标草稿集，进一步形�?`Proposal -> Draft Set -> Writeback` 链路
  - �?proposal 现已支持批量写回目标草稿，成功后会同步刷新草稿状态并打开首个写回结果
  - �?Workbench 面板新增目标草稿状态汇总：待写�?/ 已写�?/ 阻塞
- **AI 结果视图产品�?*
  - �?assistant 回答现已支持结构�?`Conclusion / Evidence / Next Actions` 三段式结果视�?  - �?当模型输出带有显式章节时，结果会以分区卡片渲染，而不再只是连续聊天文�?  - �?新增统一 Evidence 面板，证据引用与上下文节点不再散落在消息卡片�?  - �?Evidence 面板支持在多�?assistant 结果之间切换浏览，开始形成统一知识浏览入口
  - �?Evidence 面板现已支持按文件路径聚合的引用树，证据不再只是平面列表
  - �?Evidence Panel 已开始具备“知识浏览器”形态：消息切换、引用树、上下文分组并存
  - �?Evidence Panel 现已支持直接发起“保存草�?/ 生成计划”动作，证据浏览开始与知识沉淀合流
  - �?Evidence Panel 现已支持文件分组级草稿与计划动作，以及节点级证据草稿动作
  - �?Evidence Panel 现已支持多证据选择后的合并草稿与合并计划动�?  - �?新增统一 Evidence 面板，证据引用与上下文节点不再分散在消息卡片�?  - �?assistant 消息现在只保留证据摘要入口，证据细节统一进入 Evidence 面板浏览
- **AI 结果视图产品�?*
  - �?assistant 消息现已支持结构�?`Conclusion / Evidence / Next Actions` 三段式结果视�?  - �?当模型输出符合结构化格式时，AI 结果会按分区卡片渲染，而不再只是连续聊天文�?- **AI 核心测试**
  - �?新增 `context-graph`、`model-router`、`orchestrator` 单测，覆盖证据链、模型来源路由、草稿与提案输出
- **桌面本地运行 v1**
  - �?新增统一 Runner 抽象，统一代码文件、Notebook 单元�?Markdown 代码块执行事件模�?  - �?桌面端默认优先使�?`python-local`
  - �?自动发现系统 Python、项�?`.venv`、激活的 `venv` / `conda`
  - �?外部命令运行器支�?`.js/.mjs/.cjs`、`.jl`、`.R`
- **Notebook 本地持久会话**
  - �?桌面 `python-local` Notebook 单元复用同一个本�?Python 会话
  - �?支持单元连续执行、停止、中断后重建会话、重�?kernel

### 改进 (2026-03-15)
- **科研输出统一�?*
  - �?Python 本地运行统一支持文本、错误、图片、HTML 表格、SVG 等输�?- **表格交互重构**
  - �?Markdown 表格不再默认激活首格，也不再在表格内部挤出操作�?  - �?行列操作控件已移到表格外围，通过外部句柄与外部菜单触发，不再遮挡文字
  - �?表格保留编辑/插入/删除/对齐能力，但交互方式更接�?Obsidian 的外围操作模�?- **AI Workbench 审批写回**
  - �?草稿写回支持自定义目标路�?  - �?支持�?AI 草稿 `append` 到现�?Markdown 笔记
  - �?写回后自动打开目标文件，并记录实际落地路径
  - �?proposal 新增证据来源 `sourceRefs`，计划草稿可保留原始证据上下�?- **证据回链可感知反�?*
  - �?Markdown 标题、代码行、Notebook 单元、PDF 页码/批注跳转后增加短时高亮反�?- **QA 门禁 v1**
  - �?门禁补齐�?`lint` / `typecheck` / `test:run` / `build` / `tauri:build`
  - �?本轮顺序验证 `lint` / `typecheck` / `test:run` / `build` / `tauri:build` 全绿
  - �?`lint` �?`0 error / 38 warnings` 继续压降�?`0 error / 0 warnings`
  - �?清理预期失败路径中的解析噪音日志，测试输出更可读
  - �?本轮新增 `mention-resolver` 测试，验证工作区文件引用、fragment 解析�?PDF 页码引用
  - �?本轮新增 Workbench store / proposal 草稿格式化测试，并将慢诊断测试超时调到稳定区�?  - �?本轮顺序验证 `lint` / `typecheck` / `test:run` / `build` 全绿，当前阶段可稳定跑�?  - �?本轮新增 fragment suggestion 测试，验�?`@引用` �?heading / line / cell / pdf page / annotation 候选生�?  - �?本轮新增目标草稿生成测试，验�?proposal -> drafts 的筛选与去重逻辑
  - �?本轮再次顺序验证 `lint` / `typecheck` / `test:run` / `build` 全绿，目标草稿集合能力已可稳定跑�?  - �?本轮新增批量写回测试与状态汇总逻辑，`Proposal -> Draft Set -> Writeback` 已具备阶段性完整�?  - �?`use-notebook-executor` 集成测试已改为确定�?fake kernel，完整测试门禁恢复稳�?  - �?本轮新增 Evidence 面板 helper 测试，并将完整门禁稳定在 `73` 个测试文件、`902` 个测试全�?  - �?本轮新增 mention browser 测试，并将完整门禁更新到 `74` 个测试文件、`905` 个测试全�?  - �?本轮继续顺序验证 `lint` / `typecheck` / `test:run` / `build` 全绿，引用树浏览能力已稳定可�?  - �?当前完整门禁保持 `74` 个测试文件、`905` 个测试全�?  - �?本轮继续顺序验证 `lint` / `typecheck` / `test:run` / `build` 全绿，当前完整门禁更新为 `74` 个测试文件、`907` 个测试全�?  - �?当前完整门禁已更新为 `74` 个测试文件、`908` 个测试全�?  - �?本轮新增 Evidence 面板 helper 测试，完整测试门禁当前稳定保持全�?  - �?`use-notebook-executor` 集成测试已切换到确定�?fake kernel，完整测试门禁恢复稳�?
### 清理 (2026-03-15)
- **会话临时产物清理**: 删除桌面持久 Python session 未使用的�?payload 临时文件生成逻辑
- **测试噪音压降**: 清理 Notebook 测试中的 `act(...)` 噪音，并�?live preview 代码块调试日志改为受控调试输�?- **旧实现重�?*:
  - 重构 `image-viewer` 的对�?URL 生命周期，移除渲染期 ref 读写和过度缓存逻辑
  - 重构 `use-popup-position`，移�?effect 驱动的派生状�?  - 精简 `plugin-command-dialog` 的活动索引同步逻辑，避�?effect 内部强制 setState
  - 收敛 kernel 协议�?`any`，补充共�?JSON/MIME 类型，并�?WebSocket 泛型边界与已实现消息子集一�?  - 删除 `generateUniqueEntryName` 等未使用旧实现和多处无用导入
  - �?`lint` warning �?`50` 压降�?`38` 后继续压�?`0`

### 文档更新 (2026-03-15)
- 更新 `docs/ARCHITECTURE.md`，明确当前阶段是本地优先的科研运行工作台而非完整 VS Code 克隆
- 更新 `docs/ARCHITECTURE.md`，补�?AI-Native 科研副驾 v1 �?orchestrator / context graph / evidence / draft 架构
- 更新 `docs/DESKTOP_FEATURES.md`，补充桌面本地运行能力、Notebook 持久会话�?QA 门禁
- 更新 `docs/USER_GUIDE.md`，修正文档中�?Notebook 主路径描述为 Pyodide 的过时表�?- 更新 `docs/RELEASE_NOTES.md` �?`docs/MANUAL_RELEASE_GUIDE.md`，同步桌面本地运�?v1、AI 副驾 v1 �?QA v1 状�?
### 新增 (2026-03-14)
- **统一链接路由**
  - �?外部网页链接在桌面端改为系统默认浏览器打开
  - �?工作区文件链接继续在应用内打开
  - �?支持 PDF 页码、PDF 批注、Markdown 标题、代码行、Notebook 单元格深�?- **Explorer 资源管理增强**
  - �?新建文件和文件夹后立即进入重命名
  - �?支持文件树复制、剪切、粘�?  - �?支持拖放移动文件和文件夹
  - �?目录重命名或移动后自动同步已打开标签路径

### 修复 (2026-03-14)
- **PDF 阅读稳定�?*: 修复放大、缩小或适宽时视图跳回第一页的问题
- **PDF 文本选区样式**: 选中文本改为浅蓝色高亮，并适配浅色/深色主题
- **文件树状态保�?*: 刷新工作区后保留目录展开状�?- **任意文件创建安全�?*: 通用新建文件逻辑改为唯一命名，避免同名覆盖已有文�?
### 文档更新 (2026-03-14)
- 更新 `docs/USER_GUIDE.md`，补充深链、PDF 缩放与文件树快捷键说�?- 更新 `docs/DESKTOP_FEATURES.md`，补充桌面端外链、深链与资源管理能力
- 重写 `docs/RELEASE_NOTES.md` �?`docs/MANUAL_RELEASE_GUIDE.md`，同步最新发布流程与产物路径

### 新增 (2026-03-06)
- **Jupyter Notebook 深度集成**
  - �?变量查看器（Variable Inspector�?
    - 实时显示 Python 命名空间中的所有变�?
    - 显示变量类型、值预览、内存大小、形状信�?
    - 支持搜索过滤和多种排序方式（名称、类型、大小）
    - 可展开查看详细信息
    - 侧边栏面板，可切换显�?隐藏
  - �?内核控制工具栏（Kernel Toolbar�?
    - 内核状态实时显示（Idle/Busy/Loading/Error�?
    - 性能指标显示（最后执行时间、平均时间、总执行次数）
    - Run All、Restart、Clear Outputs、Stop 按钮
    - 执行进度显示
  - �?执行时间统计
    - 每个单元格执行时间精确记�?
    - 全局执行历史追踪（保留最�?100 条）
    - 平均执行时间自动计算
  - �?状态管理重�?
    - 使用 Zustand + Immer 实现集中式状态管�?
    - 内核状态、变量命名空间、执行历史统一管理
  - �?Notebook 编辑器完整集�?
    - 分屏布局（编辑器 + 变量查看器）
    - 执行状态与 UI 实时同步
    - 变量自动更新

### 修复 (2026-03-06)
- **Jupyter Notebook 执行问题**: 修复 Python 代码执行时的字符串注入漏洞，使用 `js` 模块�?`pyodide.globals.set()` 安全传递参�?
- **HTML 嵌套错误**: 修复 Markdown 渲染�?`<p>` 标签包含 `<code>` 导致�?React hydration 警告
- **输出缓冲优化**: 改进 Python stdout/stderr 缓冲机制，使�?`str()` 替代 `repr()` 避免额外引号问题

### 文档更新 (2026-03-06)
- 更新 `AI_DEVELOPMENT_GUIDE.md`，标记已解决的问题，添加当前开发重�?
- 新增 `docs/DEVELOPMENT_ROADMAP_2026.md`，详细规�?2026 年开发路线图

## [1.0.0] - 2026-02-12

### Phase 1: 代码质量与稳定�?(v0.4.0)

#### 安全
- **XSS防护**: 新增 `src/lib/sanitize.ts`，所�?`innerHTML` 赋值通过 DOMPurify 消毒
- **JSON.parse验证**: 注解解析增加 try-catch + 结构验证，解析失败不崩溃

#### 修复
- **KaTeX错误处理**: 替换静默 `.catch(() => {})` 为带日志的错误处理，加载失败显示 fallback
- **注解存储错误信息**: 错误消息包含实际错误信息和文件ID
- **Auto-open-folder**: Web模式通过 IndexedDB 持久�?FileSystemDirectoryHandle；Tauri模式使用 plugin-dialog
- **防抖保存**: 添加 `flushPendingSaves()` 方法，`beforeunload` 时确保注解已保存

#### 改进
- **生产日志策略**: 新增 `src/lib/logger.ts`，按环境过滤日志级别，迁�?94�?console 语句
- **Tiptap死代码清�?*: 删除8个未使用�?Tiptap 扩展文件，移�?2�?`@tiptap/*` 依赖

### Phase 2: 插件系统扩展 (v0.5.0)

#### 新增
- **扩展�?*: 新增 `ui:sidebar`、`ui:toolbar`、`ui:statusbar`、`editor:extensions`、`themes` 权限
- **工作区事件钩�?*: `onFileOpen`、`onFileSave`、`onFileClose`、`onWorkspaceOpen`
- **UI插槽组件**: `PluginSidebarSlot`、`PluginToolbarSlot`、`PluginStatusBarSlot`
- **插件设置UI**: 设置对话框中新增"扩展"标签页，支持插件配置 schema
- **依赖解析**: 拓扑排序 + 循环依赖检�?
- **6个内置插�?*: word-count、table-of-contents、markdown-linter、code-formatter、template-library、citation-manager

### Phase 3: AI集成 (v0.6.0)

#### 新增
- **AI Provider接口**: 完整�?`AiProvider` 接口，支持流式生成、模型列表、token估算
- **4个AI Provider**: OpenAI、Anthropic、Google Gemini、Ollama（本地），全部使用原�?fetch + SSE
- **AI设置面板**: 设置对话框中新增"AI"标签页，API密钥管理、模型选择、温度调�?
- **AI Chat侧边�?*: 可切换的右侧聊天面板，流式响应，对话历史，自动包含文件上下文
- **内联AI功能**: 选中文本后浮现菜单，支持摘要、翻译、解释公式、改写、续写、生成大�?
- **PDF AI面板**: 论文摘要、关键发现提取、论文问�?
- **Notebook AI辅助**: 代码生成、错误解释、输出解读，集成到代码单元格
- **Context Builder增强**: 支持 selection 参数、多文件上下文、基于模型窗口的自动截断

---

## [0.3.0] - 2026-01-12

### Added

#### 📝 Live Preview 编辑器增�?(Obsidian 级别体验)
- �?**智能光标定位**：点击渲染内容时精确定位到源码位�?
- �?**嵌套格式支持**：支�?`***粗斜�?**` 和嵌套格式解�?
- �?**语法过渡动画**�?50ms 淡入淡出动画，平滑切换编�?预览
- �?**活动行高�?*：Obsidian 风格的淡蓝色当前行高�?
- �?**代码块增�?*：行号显示、语法高亮、复制按�?
- �?**表格编辑优化**：Tab 导航、自动列宽调�?
- �?**数学公式错误处理**：语法错误时显示指示但保留源�?

#### 📌 批注系统增强 (Zotero 级别体验)
- �?**批注搜索筛�?*：按颜色、类型、关键词筛选批�?
- �?**批注导出功能**：支�?Markdown、纯文本、JSON 格式导出
- �?**分组导出选项**：按页码、颜色、类型分�?
- �?**单条批注复制**：一键复制批注到剪贴�?
- �?**批注引用语法**：支�?`[[file.pdf#ann-uuid]]` 语法链接到批�?
- �?**批注反向链接**：追踪笔记中的批注引用关�?

#### ⌨️ 量子键盘优化
- �?**位置记忆**：记住用户拖动后的位置，下次打开时恢�?
- �?**智能定位**：自动检测输入区域，定位到不遮挡的位�?
- �?**活动 math-field 指示**：高亮当前活动的数学输入�?

#### 🎨 主题和样�?
- �?**批注链接样式**：琥珀色高亮的批注引用链接
- �?**数学错误样式**：增强的错误显示，包含错误指示器

### Changed

- 🔧 优化装饰器更新性能，添加防抖处�?
- 🔧 优化大文档处理，使用 CodeMirror 内置虚拟�?
- 🔧 优化渲染性能，添加行解析缓存

### Technical Details

#### 新增文件
- `src/lib/annotation-export.ts` - 批注导出工具
- `src/lib/annotation-backlinks.ts` - 批注反向链接服务
- `src/components/editor/codemirror/live-preview/types.ts` - 添加 `annotationlink` 类型

#### 更新文件
- `src/components/renderers/pdf-annotation-sidebar.tsx` - 添加搜索筛选功�?
- `src/components/renderers/annotation-export-dialog.tsx` - 使用新的导出 API
- `src/components/editor/codemirror/live-preview/inline-decoration-plugin.ts` - 添加批注链接解析
- `src/components/editor/codemirror/live-preview/live-preview-theme.ts` - 添加批注链接样式
- `src/stores/hud-store.ts` - 添加位置持久�?

---

## [0.2.0] - 2026-01-04

### Added

#### 🌍 国际化支�?
- �?**多语言系统**：完整的 i18n 支持，目前支持简体中文和英文
- �?**语言选择�?*：在设置中切换语言，立即生效无需重启
- �?**系统语言检�?*：首次启动自动检测系统语言
- �?**日期/数字格式�?*：根据语言区域自动格式化日期和数字

#### 🎨 主题系统
- �?**三种主题模式**：浅色、深色、跟随系�?
- �?**主题选择�?*：可视化主题切换，实时预�?
- �?**系统主题跟随**：自动响应系统主题变�?
- �?**暗色模式优化**：文件预览保持白色背景，提升可读�?
- �?**快捷键切�?*：`Ctrl+Shift+T` 快速切换主�?

#### 🚀 首次启动引导
- �?**引导向导**：首次启动显示欢迎引�?
- �?**步骤式设�?*：语言 �?主题 �?默认文件�?
- �?**跳过选项**：可随时跳过引导
- �?**重新引导**：设置中可重新开始引�?

#### ⚙️ 全局设置界面
- �?**设置对话�?*：按 `Ctrl+,` 打开设置
- �?**分区设计**：通用、外观、文件、快捷键、关�?
- �?**即时生效**：设置更改立即生�?
- �?**持久化存�?*：设置自动保存到 localStorage

#### 📁 文件导出增强
- �?**导出适配�?*：统一的导出接口，支持 Web 和桌�?
- �?**原生保存对话�?*：桌面版使用 Tauri 原生对话�?
- �?**导出通知**：成�?失败通知，含"在文件夹中显�?按钮
- �?**防重复导�?*：防止同一文件的多次同时导�?
- �?**Web 降级处理**：使�?File System Access API 或默认下�?

#### 🖥�?桌面应用增强
- �?**默认文件夹设�?*：支持设置默认工作目录，应用启动时自动打开
- �?**自动记忆功能**：自动记住上次打开的文件夹
- �?**文件夹验�?*：检测默认文件夹是否存在，不存在时提示重新选择
- �?**坐标适配�?*：弹出菜单自动适配窗口边界

#### 🏗�?基础设施
- �?**存储适配�?*：统一的存储接口，支持 Web �?Tauri
- �?**设置状态管�?*：Zustand store 管理全局设置
- �?**类型定义**：完整的 TypeScript 类型支持

### Changed

- 📝 批注侧边栏移�?PDF 查看器左�?
- 📝 侧边栏从左侧滑入/滑出动画
- 🔧 修复 flushSync 警告 (advanced-markdown-editor.tsx)

### Technical Details

#### 新增文件
- `src/lib/i18n/` - 国际化系�?
- `src/lib/storage-adapter.ts` - 存储适配�?
- `src/lib/export-adapter.ts` - 导出适配�?
- `src/lib/coordinate-adapter.ts` - 坐标适配�?
- `src/stores/settings-store.ts` - 设置状态管�?
- `src/types/settings.ts` - 设置类型定义
- `src/hooks/use-theme.ts` - 主题 Hook
- `src/hooks/use-i18n.ts` - 国际�?Hook
- `src/hooks/use-auto-open-folder.ts` - 自动打开文件�?Hook
- `src/components/settings/` - 设置组件
- `src/components/onboarding/` - 引导向导组件
- `src/components/ui/export-toast.tsx` - 导出通知组件

---

## [0.1.0] - 2026-01-04

### Added

#### 桌面应用功能
- �?**默认文件夹设�?*：支持设置默认工作目录，应用启动时自动打开
- �?**自动记忆功能**：自动记住上次打开的文件夹
- �?**可视化设置界�?*：按 `Ctrl+,` 打开设置面板，管理默认文件夹
- �?**清除设置选项**：可以随时清除默认文件夹设置
- �?**Tauri 命令接口**�?
  - `get_default_folder()` - 获取默认文件�?
  - `set_default_folder(folder)` - 设置默认文件�?
  - `get_last_opened_folder()` - 获取上次打开的文件夹
  - `set_last_opened_folder(folder)` - 保存上次打开的文件夹
  - `clear_default_folder()` - 清除默认文件�?

#### 网页版功�?
- �?**下载提醒弹窗**：首次访问网页版时显示下载桌面应用的提醒
- �?**优势展示**：清晰展示桌面应用相比网页版的优�?
- �?**不再显示选项**：用户可以选择不再显示下载提醒

#### 文档
- 📚 **桌面功能指南** (`docs/DESKTOP_FEATURES.md`)：详细的桌面应用功能使用说明
- 📚 **安装指南** (`INSTALLATION.md`)：完整的安装、更新和故障排除文档
- 📚 **发布模板** (`.github/RELEASE_TEMPLATE.md`)：标准化的发布说明模�?
- 📚 **更新日志** (`CHANGELOG.md`)：记录所有版本变�?

#### 开发工�?
- 🛠�?**发布准备脚本**�?
  - `scripts/prepare-release.sh` (Linux/macOS)
  - `scripts/prepare-release.bat` (Windows)
- 🛠�?**GitHub Actions 工作�?* (`.github/workflows/release.yml`)：自动构建和发布

### Changed

#### README 优化
- 📝 重新组织 README 结构，将桌面应用下载链接放在最显眼位置
- 📝 添加桌面应用优势对比表格
- 📝 添加平台下载链接表格，包含文件大小信�?
- 📝 更新文档链接，添加安装指南和桌面功能指南

#### 技术改�?
- 🔧 修复 Tauri identifier 警告：从 `com.lattice.app` 改为 `com.lattice.editor`
- 🔧 集成 `tauri-plugin-store` 用于持久化用户设�?
- 🔧 添加 Tauri 插件权限配置（fs, dialog, store�?
- 🔧 优化前端 Tauri 集成，添加环境检�?

### Fixed

- 🐛 修复 macOS 上的 Bundle identifier 冲突警告
- 🐛 修复桌面应用设置存储问题

### Technical Details

#### 新增依赖
- **前端**�?
  - `@tauri-apps/plugin-store@^2.0.0` - 桌面应用设置存储

- **后端（Rust�?*�?
  - `tauri-plugin-store = "2"` - 持久化用户设�?

#### 新增组件
- `src/hooks/use-tauri-settings.ts` - Tauri 设置管理 Hook
- `src/components/ui/download-app-dialog.tsx` - 下载应用提醒弹窗
- `src/components/ui/desktop-settings-dialog.tsx` - 桌面应用设置界面

#### 配置更新
- `src-tauri/tauri.conf.json` - 添加插件权限配置
- `src-tauri/Cargo.toml` - 添加 tauri-plugin-store 依赖
- `src-tauri/src/main.rs` - 实现设置管理命令

### Documentation

- 📖 [安装指南](./INSTALLATION.md) - 详细的安装和更新说明
- 📖 [桌面功能](./docs/DESKTOP_FEATURES.md) - 桌面应用独有功能说明
- 📖 [桌面应用打包](./DESKTOP_APP.md) - Tauri 桌面应用构建指南
- 📖 [发布模板](./.github/RELEASE_TEMPLATE.md) - GitHub Release 模板

### Migration Guide

如果你是从旧版本升级�?

1. **桌面应用用户**�?
   - 下载新版本安装包并安�?
   - 你的设置会自动保留在新位�?

2. **开发�?*�?
   ```bash
   # 拉取最新代�?
   git pull origin main
   
   # 更新依赖
   npm install
   cd src-tauri
   cargo update
   cd ..
   
   # 重新构建
   npm run tauri:build
   ```

### Known Issues

无重大已知问题。如果遇到问题，请查�?[故障排除文档](./INSTALLATION.md#-故障排除)�?

---

## [Planned]

### Planned Features

- 系统托盘图标支持
- 自动更新功能
- 窗口状态保�?恢复
- 设置导出/导入

---

[1.0.0]: https://github.com/tryandaction/lattice/releases/tag/v1.0.0
[0.3.0]: https://github.com/tryandaction/lattice/releases/tag/v0.3.0
[0.2.0]: https://github.com/tryandaction/lattice/releases/tag/v0.2.0
[0.1.0]: https://github.com/tryandaction/lattice/releases/tag/v0.1.0
