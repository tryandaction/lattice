# Changelog

All notable changes to Lattice will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 新增 (2026-03-17)
- **Markdown 导出产品化**
  - ✅ Markdown 编辑器顶栏新增可发现的 Export 入口，用户可直接从产品 UI 导出当前文档
  - ✅ 新增 Markdown 导出对话框，支持选择 `.docx` / `.pdf`
  - ✅ 导出对话框新增导出标题配置与实时预览，导出前即可确认成品结构
  - ✅ 导出不再走低质量正则转换，改为统一渲染文档模型，尽量保留标题层级、列表、代码块、表格、引用块与公式渲染
  - ✅ 新增统一标注导出策略：`clean` / `appendix` / `study-note`
  - ✅ 支持“文档版式”与“当前渲染视图”两种导出视觉模式
  - ✅ 当前文件侧车标注现可随 Markdown 导出带出，并保留 page / line / anchor 等来源定位信息
  - ✅ `.pdf` 导出采用渲染快照链路，保证最终分享稿尽量贴近产品内阅读效果
  - ✅ `.docx` 导出采用结构化 HTML 导入链路，兼顾文档结构与可交付性

### 改进 (2026-03-17)
- **导出基础设施统一**
  - ✅ 新增统一 Markdown 导出服务，复用现有 Web/Tauri `export-adapter` 保存链路
  - ✅ 导出时可自动内联本地 Markdown 图片，减少相对路径资源在成品文档中失效
  - ✅ 导出模型已支持统一汇入当前文件标注与显式证据引用，后续可继续扩展到更广的 Evidence 工作流
- **QA 门禁更新**
  - ✅ 本轮新增 Markdown 导出测试，覆盖附录预览、统一来源模型与 DOCX 包结构
  - ✅ 当前完整门禁已更新为 `75` 个测试文件、`911` 个测试全绿
  - ✅ 本轮顺序验证 `lint` / `typecheck` / `test:run` / `build` / `tauri:build` 全绿

### 清理 (2026-03-17)
- **旧导出实现移除**
  - ✅ 删除未接入主路径且质量偏低的 `src/lib/export-utils.ts`
  - ✅ 删除未被产品主界面使用的旧 `src/components/editor/export-button.tsx`

### 文档更新 (2026-03-17)
- 更新 `docs/RELEASE_NOTES.md`，补充 Markdown 导出产品化能力与 QA 基线
- 更新 `docs/roadmap.md`，同步当前阶段已完成项与下一轮导出深化方向
- 更新 `docs/USER_GUIDE.md`，补充 Markdown 导出操作说明
- 更新 `docs/DESKTOP_FEATURES.md`，补充桌面端 DOCX / PDF 导出体验与验证点
- 更新 `docs/MANUAL_RELEASE_GUIDE.md`，将 Markdown 导出纳入发布前验收清单

### 新增 (2026-03-15)
- **AI-Native 科研副驾 v1**
  - ✅ 新增统一 `AiOrchestrator`，统一 Chat、选区动作、PDF 助手、Notebook 助手和代码解释入口
  - ✅ 新增 `AiContextGraph`，统一文件、Markdown 标题、PDF 批注、Notebook 单元、代码符号、工作区索引和当前选区上下文
  - ✅ 新增 `EvidenceRef` / `AiDraftArtifact` / `AiTaskProposal` / `AiActionApproval` 公共接口
  - ✅ 科研回答默认携带证据引用，并支持“保存为草稿”和“生成整理计划”两类后续动作
- **工作区 AI 引用系统**
  - ✅ `@引用` 从“已打开标签页文件名”升级为“工作区文件路径”补全
  - ✅ 支持带 fragment 的引用解析：Markdown 标题、代码行、Notebook 单元、PDF 页码/批注
  - ✅ 引用解析结果自动转成 `explicitEvidenceRefs`，让用户显式引用直接进入 AI 证据链
  - ✅ `@引用` 支持可视化 fragment 选择：文件命中后可继续选择 heading / line / cell / page / annotation
  - ✅ `@引用` 现已支持真正的两段式浏览：先选文件，再自动进入片段选择模式
- **AI Workbench 产品化升级**
  - ✅ `drafts` / `proposals` 持久化，刷新后不再丢失本次 AI 工作流状态
  - ✅ proposal 支持展开审阅步骤、审批项和 planned writes
  - ✅ proposal 支持批准 / 拒绝状态流转
  - ✅ proposal 支持一键生成“计划草稿”，把 AI 计划沉淀到可写回的草稿资产
  - ✅ proposal 审批状态、勾选审批项和勾选 planned writes 全部持久化保存
  - ✅ Workbench 具备“计划 -> 草稿 -> 写回”的连续链路，减少 AI 结果停留在聊天记录中的流失
  - ✅ approved proposal 现已支持按已勾选 `plannedWrites` 批量生成目标草稿集合
  - ✅ 目标草稿会预填目标路径与写入模式，并对已生成目标去重，避免重复生成
  - ✅ proposal 现已支持从已批准 writes 批量派生目标草稿集，进一步形成 `Proposal -> Draft Set -> Writeback` 链路
  - ✅ proposal 现已支持批量写回目标草稿，成功后会同步刷新草稿状态并打开首个写回结果
  - ✅ Workbench 面板新增目标草稿状态汇总：待写回 / 已写回 / 阻塞
- **AI 结果视图产品化**
  - ✅ assistant 回答现已支持结构化 `Conclusion / Evidence / Next Actions` 三段式结果视图
  - ✅ 当模型输出带有显式章节时，结果会以分区卡片渲染，而不再只是连续聊天文本
  - ✅ 新增统一 Evidence 面板，证据引用与上下文节点不再散落在消息卡片中
  - ✅ Evidence 面板支持在多条 assistant 结果之间切换浏览，开始形成统一知识浏览入口
  - ✅ Evidence 面板现已支持按文件路径聚合的引用树，证据不再只是平面列表
  - ✅ Evidence Panel 已开始具备“知识浏览器”形态：消息切换、引用树、上下文分组并存
  - ✅ Evidence Panel 现已支持直接发起“保存草稿 / 生成计划”动作，证据浏览开始与知识沉淀合流
  - ✅ Evidence Panel 现已支持文件分组级草稿与计划动作，以及节点级证据草稿动作
  - ✅ Evidence Panel 现已支持多证据选择后的合并草稿与合并计划动作
  - ✅ 新增统一 Evidence 面板，证据引用与上下文节点不再分散在消息卡片中
  - ✅ assistant 消息现在只保留证据摘要入口，证据细节统一进入 Evidence 面板浏览
- **AI 结果视图产品化**
  - ✅ assistant 消息现已支持结构化 `Conclusion / Evidence / Next Actions` 三段式结果视图
  - ✅ 当模型输出符合结构化格式时，AI 结果会按分区卡片渲染，而不再只是连续聊天文本
- **AI 核心测试**
  - ✅ 新增 `context-graph`、`model-router`、`orchestrator` 单测，覆盖证据链、模型来源路由、草稿与提案输出
- **桌面本地运行 v1**
  - ✅ 新增统一 Runner 抽象，统一代码文件、Notebook 单元和 Markdown 代码块执行事件模型
  - ✅ 桌面端默认优先使用 `python-local`
  - ✅ 自动发现系统 Python、项目 `.venv`、激活的 `venv` / `conda`
  - ✅ 外部命令运行器支持 `.js/.mjs/.cjs`、`.jl`、`.R`
- **Notebook 本地持久会话**
  - ✅ 桌面 `python-local` Notebook 单元复用同一个本地 Python 会话
  - ✅ 支持单元连续执行、停止、中断后重建会话、重启 kernel

### 改进 (2026-03-15)
- **科研输出统一化**
  - ✅ Python 本地运行统一支持文本、错误、图片、HTML 表格、SVG 等输出
- **表格交互重构**
  - ✅ Markdown 表格不再默认激活首格，也不再在表格内部挤出操作位
  - ✅ 行列操作控件已移到表格外围，通过外部句柄与外部菜单触发，不再遮挡文字
  - ✅ 表格保留编辑/插入/删除/对齐能力，但交互方式更接近 Obsidian 的外围操作模型
- **AI Workbench 审批写回**
  - ✅ 草稿写回支持自定义目标路径
  - ✅ 支持将 AI 草稿 `append` 到现有 Markdown 笔记
  - ✅ 写回后自动打开目标文件，并记录实际落地路径
  - ✅ proposal 新增证据来源 `sourceRefs`，计划草稿可保留原始证据上下文
- **证据回链可感知反馈**
  - ✅ Markdown 标题、代码行、Notebook 单元、PDF 页码/批注跳转后增加短时高亮反馈
- **QA 门禁 v1**
  - ✅ 门禁补齐为 `lint` / `typecheck` / `test:run` / `build` / `tauri:build`
  - ✅ 本轮顺序验证 `lint` / `typecheck` / `test:run` / `build` / `tauri:build` 全绿
  - ✅ `lint` 从 `0 error / 38 warnings` 继续压降到 `0 error / 0 warnings`
  - ✅ 清理预期失败路径中的解析噪音日志，测试输出更可读
  - ✅ 本轮新增 `mention-resolver` 测试，验证工作区文件引用、fragment 解析和 PDF 页码引用
  - ✅ 本轮新增 Workbench store / proposal 草稿格式化测试，并将慢诊断测试超时调到稳定区间
  - ✅ 本轮顺序验证 `lint` / `typecheck` / `test:run` / `build` 全绿，当前阶段可稳定跑通
  - ✅ 本轮新增 fragment suggestion 测试，验证 `@引用` 的 heading / line / cell / pdf page / annotation 候选生成
  - ✅ 本轮新增目标草稿生成测试，验证 proposal -> drafts 的筛选与去重逻辑
  - ✅ 本轮再次顺序验证 `lint` / `typecheck` / `test:run` / `build` 全绿，目标草稿集合能力已可稳定跑通
  - ✅ 本轮新增批量写回测试与状态汇总逻辑，`Proposal -> Draft Set -> Writeback` 已具备阶段性完整性
  - ✅ `use-notebook-executor` 集成测试已改为确定性 fake kernel，完整测试门禁恢复稳定
  - ✅ 本轮新增 Evidence 面板 helper 测试，并将完整门禁稳定在 `73` 个测试文件、`902` 个测试全绿
  - ✅ 本轮新增 mention browser 测试，并将完整门禁更新到 `74` 个测试文件、`905` 个测试全绿
  - ✅ 本轮继续顺序验证 `lint` / `typecheck` / `test:run` / `build` 全绿，引用树浏览能力已稳定可用
  - ✅ 当前完整门禁保持 `74` 个测试文件、`905` 个测试全绿
  - ✅ 本轮继续顺序验证 `lint` / `typecheck` / `test:run` / `build` 全绿，当前完整门禁更新为 `74` 个测试文件、`907` 个测试全绿
  - ✅ 当前完整门禁已更新为 `74` 个测试文件、`908` 个测试全绿
  - ✅ 本轮新增 Evidence 面板 helper 测试，完整测试门禁当前稳定保持全绿
  - ✅ `use-notebook-executor` 集成测试已切换到确定性 fake kernel，完整测试门禁恢复稳定

### 清理 (2026-03-15)
- **会话临时产物清理**: 删除桌面持久 Python session 未使用的空 payload 临时文件生成逻辑
- **测试噪音压降**: 清理 Notebook 测试中的 `act(...)` 噪音，并将 live preview 代码块调试日志改为受控调试输出
- **旧实现重构**:
  - 重构 `image-viewer` 的对象 URL 生命周期，移除渲染期 ref 读写和过度缓存逻辑
  - 重构 `use-popup-position`，移除 effect 驱动的派生状态
  - 精简 `plugin-command-dialog` 的活动索引同步逻辑，避免 effect 内部强制 setState
  - 收敛 kernel 协议层 `any`，补充共享 JSON/MIME 类型，并让 WebSocket 泛型边界与已实现消息子集一致
  - 删除 `generateUniqueEntryName` 等未使用旧实现和多处无用导入
  - 将 `lint` warning 从 `50` 压降到 `38` 后继续压到 `0`

### 文档更新 (2026-03-15)
- 更新 `docs/ARCHITECTURE.md`，明确当前阶段是本地优先的科研运行工作台而非完整 VS Code 克隆
- 更新 `docs/ARCHITECTURE.md`，补充 AI-Native 科研副驾 v1 的 orchestrator / context graph / evidence / draft 架构
- 更新 `docs/DESKTOP_FEATURES.md`，补充桌面本地运行能力、Notebook 持久会话和 QA 门禁
- 更新 `docs/USER_GUIDE.md`，修正文档中将 Notebook 主路径描述为 Pyodide 的过时表述
- 更新 `docs/RELEASE_NOTES.md` 与 `docs/MANUAL_RELEASE_GUIDE.md`，同步桌面本地运行 v1、AI 副驾 v1 与 QA v1 状态

### 新增 (2026-03-14)
- **统一链接路由**
  - ✅ 外部网页链接在桌面端改为系统默认浏览器打开
  - ✅ 工作区文件链接继续在应用内打开
  - ✅ 支持 PDF 页码、PDF 批注、Markdown 标题、代码行、Notebook 单元格深链
- **Explorer 资源管理增强**
  - ✅ 新建文件和文件夹后立即进入重命名
  - ✅ 支持文件树复制、剪切、粘贴
  - ✅ 支持拖放移动文件和文件夹
  - ✅ 目录重命名或移动后自动同步已打开标签路径

### 修复 (2026-03-14)
- **PDF 阅读稳定性**: 修复放大、缩小或适宽时视图跳回第一页的问题
- **PDF 文本选区样式**: 选中文本改为浅蓝色高亮，并适配浅色/深色主题
- **文件树状态保持**: 刷新工作区后保留目录展开状态
- **任意文件创建安全性**: 通用新建文件逻辑改为唯一命名，避免同名覆盖已有文件

### 文档更新 (2026-03-14)
- 更新 `docs/USER_GUIDE.md`，补充深链、PDF 缩放与文件树快捷键说明
- 更新 `docs/DESKTOP_FEATURES.md`，补充桌面端外链、深链与资源管理能力
- 重写 `docs/RELEASE_NOTES.md` 与 `docs/MANUAL_RELEASE_GUIDE.md`，同步最新发布流程与产物路径

### 新增 (2026-03-06)
- **Jupyter Notebook 深度集成**
  - ✅ 变量查看器（Variable Inspector）
    - 实时显示 Python 命名空间中的所有变量
    - 显示变量类型、值预览、内存大小、形状信息
    - 支持搜索过滤和多种排序方式（名称、类型、大小）
    - 可展开查看详细信息
    - 侧边栏面板，可切换显示/隐藏
  - ✅ 内核控制工具栏（Kernel Toolbar）
    - 内核状态实时显示（Idle/Busy/Loading/Error）
    - 性能指标显示（最后执行时间、平均时间、总执行次数）
    - Run All、Restart、Clear Outputs、Stop 按钮
    - 执行进度显示
  - ✅ 执行时间统计
    - 每个单元格执行时间精确记录
    - 全局执行历史追踪（保留最近 100 条）
    - 平均执行时间自动计算
  - ✅ 状态管理重构
    - 使用 Zustand + Immer 实现集中式状态管理
    - 内核状态、变量命名空间、执行历史统一管理
  - ✅ Notebook 编辑器完整集成
    - 分屏布局（编辑器 + 变量查看器）
    - 执行状态与 UI 实时同步
    - 变量自动更新

### 修复 (2026-03-06)
- **Jupyter Notebook 执行问题**: 修复 Python 代码执行时的字符串注入漏洞，使用 `js` 模块和 `pyodide.globals.set()` 安全传递参数
- **HTML 嵌套错误**: 修复 Markdown 渲染中 `<p>` 标签包含 `<code>` 导致的 React hydration 警告
- **输出缓冲优化**: 改进 Python stdout/stderr 缓冲机制，使用 `str()` 替代 `repr()` 避免额外引号问题

### 文档更新 (2026-03-06)
- 更新 `AI_DEVELOPMENT_GUIDE.md`，标记已解决的问题，添加当前开发重点
- 新增 `docs/DEVELOPMENT_ROADMAP_2026.md`，详细规划 2026 年开发路线图

## [1.0.0] - 2026-02-12

### Phase 1: 代码质量与稳定性 (v0.4.0)

#### 安全
- **XSS防护**: 新增 `src/lib/sanitize.ts`，所有 `innerHTML` 赋值通过 DOMPurify 消毒
- **JSON.parse验证**: 注解解析增加 try-catch + 结构验证，解析失败不崩溃

#### 修复
- **KaTeX错误处理**: 替换静默 `.catch(() => {})` 为带日志的错误处理，加载失败显示 fallback
- **注解存储错误信息**: 错误消息包含实际错误信息和文件ID
- **Auto-open-folder**: Web模式通过 IndexedDB 持久化 FileSystemDirectoryHandle；Tauri模式使用 plugin-dialog
- **防抖保存**: 添加 `flushPendingSaves()` 方法，`beforeunload` 时确保注解已保存

#### 改进
- **生产日志策略**: 新增 `src/lib/logger.ts`，按环境过滤日志级别，迁移294条 console 语句
- **Tiptap死代码清理**: 删除8个未使用的 Tiptap 扩展文件，移除12个 `@tiptap/*` 依赖

### Phase 2: 插件系统扩展 (v0.5.0)

#### 新增
- **扩展点**: 新增 `ui:sidebar`、`ui:toolbar`、`ui:statusbar`、`editor:extensions`、`themes` 权限
- **工作区事件钩子**: `onFileOpen`、`onFileSave`、`onFileClose`、`onWorkspaceOpen`
- **UI插槽组件**: `PluginSidebarSlot`、`PluginToolbarSlot`、`PluginStatusBarSlot`
- **插件设置UI**: 设置对话框中新增"扩展"标签页，支持插件配置 schema
- **依赖解析**: 拓扑排序 + 循环依赖检测
- **6个内置插件**: word-count、table-of-contents、markdown-linter、code-formatter、template-library、citation-manager

### Phase 3: AI集成 (v0.6.0)

#### 新增
- **AI Provider接口**: 完整的 `AiProvider` 接口，支持流式生成、模型列表、token估算
- **4个AI Provider**: OpenAI、Anthropic、Google Gemini、Ollama（本地），全部使用原生 fetch + SSE
- **AI设置面板**: 设置对话框中新增"AI"标签页，API密钥管理、模型选择、温度调节
- **AI Chat侧边栏**: 可切换的右侧聊天面板，流式响应，对话历史，自动包含文件上下文
- **内联AI功能**: 选中文本后浮现菜单，支持摘要、翻译、解释公式、改写、续写、生成大纲
- **PDF AI面板**: 论文摘要、关键发现提取、论文问答
- **Notebook AI辅助**: 代码生成、错误解释、输出解读，集成到代码单元格
- **Context Builder增强**: 支持 selection 参数、多文件上下文、基于模型窗口的自动截断

---

## [0.3.0] - 2026-01-12

### Added

#### 📝 Live Preview 编辑器增强 (Obsidian 级别体验)
- ✨ **智能光标定位**：点击渲染内容时精确定位到源码位置
- ✨ **嵌套格式支持**：支持 `***粗斜体***` 和嵌套格式解析
- ✨ **语法过渡动画**：150ms 淡入淡出动画，平滑切换编辑/预览
- ✨ **活动行高亮**：Obsidian 风格的淡蓝色当前行高亮
- ✨ **代码块增强**：行号显示、语法高亮、复制按钮
- ✨ **表格编辑优化**：Tab 导航、自动列宽调整
- ✨ **数学公式错误处理**：语法错误时显示指示但保留源码

#### 📌 批注系统增强 (Zotero 级别体验)
- ✨ **批注搜索筛选**：按颜色、类型、关键词筛选批注
- ✨ **批注导出功能**：支持 Markdown、纯文本、JSON 格式导出
- ✨ **分组导出选项**：按页码、颜色、类型分组
- ✨ **单条批注复制**：一键复制批注到剪贴板
- ✨ **批注引用语法**：支持 `[[file.pdf#ann-uuid]]` 语法链接到批注
- ✨ **批注反向链接**：追踪笔记中的批注引用关系

#### ⌨️ 量子键盘优化
- ✨ **位置记忆**：记住用户拖动后的位置，下次打开时恢复
- ✨ **智能定位**：自动检测输入区域，定位到不遮挡的位置
- ✨ **活动 math-field 指示**：高亮当前活动的数学输入框

#### 🎨 主题和样式
- ✨ **批注链接样式**：琥珀色高亮的批注引用链接
- ✨ **数学错误样式**：增强的错误显示，包含错误指示器

### Changed

- 🔧 优化装饰器更新性能，添加防抖处理
- 🔧 优化大文档处理，使用 CodeMirror 内置虚拟化
- 🔧 优化渲染性能，添加行解析缓存

### Technical Details

#### 新增文件
- `src/lib/annotation-export.ts` - 批注导出工具
- `src/lib/annotation-backlinks.ts` - 批注反向链接服务
- `src/components/editor/codemirror/live-preview/types.ts` - 添加 `annotationlink` 类型

#### 更新文件
- `src/components/renderers/pdf-annotation-sidebar.tsx` - 添加搜索筛选功能
- `src/components/renderers/annotation-export-dialog.tsx` - 使用新的导出 API
- `src/components/editor/codemirror/live-preview/inline-decoration-plugin.ts` - 添加批注链接解析
- `src/components/editor/codemirror/live-preview/live-preview-theme.ts` - 添加批注链接样式
- `src/stores/hud-store.ts` - 添加位置持久化

---

## [0.2.0] - 2026-01-04

### Added

#### 🌍 国际化支持
- ✨ **多语言系统**：完整的 i18n 支持，目前支持简体中文和英文
- ✨ **语言选择器**：在设置中切换语言，立即生效无需重启
- ✨ **系统语言检测**：首次启动自动检测系统语言
- ✨ **日期/数字格式化**：根据语言区域自动格式化日期和数字

#### 🎨 主题系统
- ✨ **三种主题模式**：浅色、深色、跟随系统
- ✨ **主题选择器**：可视化主题切换，实时预览
- ✨ **系统主题跟随**：自动响应系统主题变化
- ✨ **暗色模式优化**：文件预览保持白色背景，提升可读性
- ✨ **快捷键切换**：`Ctrl+Shift+T` 快速切换主题

#### 🚀 首次启动引导
- ✨ **引导向导**：首次启动显示欢迎引导
- ✨ **步骤式设置**：语言 → 主题 → 默认文件夹
- ✨ **跳过选项**：可随时跳过引导
- ✨ **重新引导**：设置中可重新开始引导

#### ⚙️ 全局设置界面
- ✨ **设置对话框**：按 `Ctrl+,` 打开设置
- ✨ **分区设计**：通用、外观、文件、快捷键、关于
- ✨ **即时生效**：设置更改立即生效
- ✨ **持久化存储**：设置自动保存到 localStorage

#### 📁 文件导出增强
- ✨ **导出适配器**：统一的导出接口，支持 Web 和桌面
- ✨ **原生保存对话框**：桌面版使用 Tauri 原生对话框
- ✨ **导出通知**：成功/失败通知，含"在文件夹中显示"按钮
- ✨ **防重复导出**：防止同一文件的多次同时导出
- ✨ **Web 降级处理**：使用 File System Access API 或默认下载

#### 🖥️ 桌面应用增强
- ✨ **默认文件夹设置**：支持设置默认工作目录，应用启动时自动打开
- ✨ **自动记忆功能**：自动记住上次打开的文件夹
- ✨ **文件夹验证**：检测默认文件夹是否存在，不存在时提示重新选择
- ✨ **坐标适配器**：弹出菜单自动适配窗口边界

#### 🏗️ 基础设施
- ✨ **存储适配器**：统一的存储接口，支持 Web 和 Tauri
- ✨ **设置状态管理**：Zustand store 管理全局设置
- ✨ **类型定义**：完整的 TypeScript 类型支持

### Changed

- 📝 批注侧边栏移至 PDF 查看器左侧
- 📝 侧边栏从左侧滑入/滑出动画
- 🔧 修复 flushSync 警告 (advanced-markdown-editor.tsx)

### Technical Details

#### 新增文件
- `src/lib/i18n/` - 国际化系统
- `src/lib/storage-adapter.ts` - 存储适配器
- `src/lib/export-adapter.ts` - 导出适配器
- `src/lib/coordinate-adapter.ts` - 坐标适配器
- `src/stores/settings-store.ts` - 设置状态管理
- `src/types/settings.ts` - 设置类型定义
- `src/hooks/use-theme.ts` - 主题 Hook
- `src/hooks/use-i18n.ts` - 国际化 Hook
- `src/hooks/use-auto-open-folder.ts` - 自动打开文件夹 Hook
- `src/components/settings/` - 设置组件
- `src/components/onboarding/` - 引导向导组件
- `src/components/ui/export-toast.tsx` - 导出通知组件

---

## [0.1.0] - 2026-01-04

### Added

#### 桌面应用功能
- ✨ **默认文件夹设置**：支持设置默认工作目录，应用启动时自动打开
- ✨ **自动记忆功能**：自动记住上次打开的文件夹
- ✨ **可视化设置界面**：按 `Ctrl+,` 打开设置面板，管理默认文件夹
- ✨ **清除设置选项**：可以随时清除默认文件夹设置
- ✨ **Tauri 命令接口**：
  - `get_default_folder()` - 获取默认文件夹
  - `set_default_folder(folder)` - 设置默认文件夹
  - `get_last_opened_folder()` - 获取上次打开的文件夹
  - `set_last_opened_folder(folder)` - 保存上次打开的文件夹
  - `clear_default_folder()` - 清除默认文件夹

#### 网页版功能
- ✨ **下载提醒弹窗**：首次访问网页版时显示下载桌面应用的提醒
- ✨ **优势展示**：清晰展示桌面应用相比网页版的优势
- ✨ **不再显示选项**：用户可以选择不再显示下载提醒

#### 文档
- 📚 **桌面功能指南** (`docs/DESKTOP_FEATURES.md`)：详细的桌面应用功能使用说明
- 📚 **安装指南** (`INSTALLATION.md`)：完整的安装、更新和故障排除文档
- 📚 **发布模板** (`.github/RELEASE_TEMPLATE.md`)：标准化的发布说明模板
- 📚 **更新日志** (`CHANGELOG.md`)：记录所有版本变更

#### 开发工具
- 🛠️ **发布准备脚本**：
  - `scripts/prepare-release.sh` (Linux/macOS)
  - `scripts/prepare-release.bat` (Windows)
- 🛠️ **GitHub Actions 工作流** (`.github/workflows/release.yml`)：自动构建和发布

### Changed

#### README 优化
- 📝 重新组织 README 结构，将桌面应用下载链接放在最显眼位置
- 📝 添加桌面应用优势对比表格
- 📝 添加平台下载链接表格，包含文件大小信息
- 📝 更新文档链接，添加安装指南和桌面功能指南

#### 技术改进
- 🔧 修复 Tauri identifier 警告：从 `com.lattice.app` 改为 `com.lattice.editor`
- 🔧 集成 `tauri-plugin-store` 用于持久化用户设置
- 🔧 添加 Tauri 插件权限配置（fs, dialog, store）
- 🔧 优化前端 Tauri 集成，添加环境检测

### Fixed

- 🐛 修复 macOS 上的 Bundle identifier 冲突警告
- 🐛 修复桌面应用设置存储问题

### Technical Details

#### 新增依赖
- **前端**：
  - `@tauri-apps/plugin-store@^2.0.0` - 桌面应用设置存储

- **后端（Rust）**：
  - `tauri-plugin-store = "2"` - 持久化用户设置

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

如果你是从旧版本升级：

1. **桌面应用用户**：
   - 下载新版本安装包并安装
   - 你的设置会自动保留在新位置

2. **开发者**：
   ```bash
   # 拉取最新代码
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

无重大已知问题。如果遇到问题，请查看 [故障排除文档](./INSTALLATION.md#-故障排除)。

---

## [Planned]

### Planned Features

- 系统托盘图标支持
- 自动更新功能
- 窗口状态保存/恢复
- 设置导出/导入

---

[1.0.0]: https://github.com/tryandaction/lattice/releases/tag/v1.0.0
[0.3.0]: https://github.com/tryandaction/lattice/releases/tag/v0.3.0
[0.2.0]: https://github.com/tryandaction/lattice/releases/tag/v0.2.0
[0.1.0]: https://github.com/tryandaction/lattice/releases/tag/v0.1.0
