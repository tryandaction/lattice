# Lattice v2.0.0 发布说明（阶段收尾补充）

发布日期：2026-03-15

## 本次重点

### 2026-03-20 阶段性收敛补充

- 桌面 Notebook / 代码运行链路继续收口：
  - `KernelSelector` 现在会明确标出“桌面运行时 / 网页运行时”
  - 桌面探测到本地 Python 后，会自动优先切到本地解释器
  - `Pyodide` 在桌面端只再作为“应急回退”出现，不再伪装成默认主运行器
  - 桌面 `python-local` 失败时不再无声掉回 Pyodide，而是显式报错
  - 工作区运行器偏好会按 workspace 路径跨重启记住，Notebook / 代码文件 / Markdown 代码块共用同一套最近选择与默认解释器
  - 外部命令与本地 Python 运行前会先给出环境诊断与修复提示
- Notebook / Markdown 体验继续收口：
  - `ipynb` Markdown Cell 已复用现有 Live Preview / Obsidian 级编辑内核，默认 `Live`，并支持切到 `Source`
  - Markdown fenced code block 已支持直接运行，并接入统一执行反馈面板
- 统一执行反馈已升级：
  - 输出面板会明确标出 `本地解释器 / 浏览器回退 / 外部命令`
  - 连续 `stdout/stderr` 会分组展示
  - 错误会区分错误名、错误值和 traceback
- PDF 默认打开体验已调整：
  - PDF 首次打开默认 `适宽`
  - 旧 PDF 查看器分支也同步改成默认自适应宽度填充
  - 对应 PDF 单测和浏览器回归基线已同步切换
- 本轮阶段性验证已完成：
  - `npm run lint`
  - `npm run typecheck`
  - `npx vitest run src/components/notebook/__tests__/kernel-selector.test.tsx src/components/notebook/__tests__/output-area.test.tsx src/components/notebook/__tests__/markdown-cell.test.tsx src/lib/runner/__tests__/preferences.test.ts src/__tests__/use-notebook-executor.tauri.test.ts src/__tests__/use-notebook-executor.test.ts`

### 当前阶段仍需继续收敛

- 代码渲染与运行离 VS Code / IDE 级体验仍有明显差距：
  - 代码编辑的 hover / 补全 / 诊断 / 调试器尚未接入
  - 代码文件 / Notebook / Markdown 代码块虽然已统一到共享执行面板，但更完整的调试、任务面板和问题面板仍未到位
  - 本地 Python 运行器已有基础环境诊断，但解释器切换、深入健康检查和修复自动化仍需继续补强

### 2026-03-19 阶段收口补充

- 新增 `PDF Split Regression` diagnostics 页面：`/diagnostics/pdf-regression`
- 新增 `Image Annotation Handle Diagnostics`：`/diagnostics/image-annotation`
- 新增 `Selection AI Regression`：`/diagnostics/selection-ai`
- 新增浏览器级门禁命令：`npm run test:browser-regression`
- 本轮浏览器回归已覆盖：
  - PDF 双分屏布局与 pane 作用域缩放
  - 图片真实 workspace handle 标注与强制重渲染
  - Selection AI 的 Chat / Agent / Plan 差异化主链路
- PDF 回归逻辑新增 `pdf-view-state` helper，统一处理 pane 作用域、viewState 持久化和相对滚动恢复
- `ImageTldrawAdapter` 背景资源改为 `data:` URL，修复真实 workspace handle 标注时 Tldraw 不接受 `blob:` 协议的问题
- 主路径已继续清理一轮无条件调试输出，重点覆盖 HUD、live preview、PPT、export adapter、Jupyter websocket 与 plugin runtime
- 当前完整测试基线更新为 `92` 个测试文件、`962` 个测试全绿
- 本轮已顺序验证：
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:run`
  - `npm run test:browser-regression`
  - `npm run build`
  - `npm run tauri:build`

### 已知残余风险

- 在 `/diagnostics/pdf-regression` 中，右侧 PDF 深页切文件切回后的可见页快照仍建议做一次人工复检。当前缩放标签和会话恢复链路已稳定，但深页可见页探针在 diagnostics 环境下仍存在边界抖动。

### Selection AI Hub Phase 2

- Selection AI Hub 现在不再只是基础弹层，而是明确区分：
  - `快速问答`
  - `深度分析`
  - `计划生成`
- Hub 会记住最近使用模式，并保存轻量 prompt 历史
- 每种模式都新增：
  - 独立说明
  - 执行去向
  - 3 个 starter templates
  - 最近 prompt 历史
  - 快捷键：`Alt+1/2/3` 切模式，`Ctrl/Cmd+Enter` 提交
- Selection AI 结果现在会在 Chat / Workbench 中显示来源 badge，而不再混成普通聊天
- `Agent` 结果会自动衔接 Evidence Panel
- `Plan` 结果会直接高亮对应 proposal，并更快进入目标草稿链路

### SelectionContext 精细化

- 代码选区现在会保留真实 `lineStart/lineEnd`
- Notebook 选区会同时记录 `cell id + cell index`
- PDF 选区现在会带出 `page + rects + snippet` 锚点
- HTML / Word 选区会抽取最近 block/heading 与邻近上下文
- `SelectionContext -> EvidenceRef` 映射现在更统一，也更适合进入 Evidence / Workbench 主链路

### PDF 分屏与阅读稳定性

- 修复分屏后右侧 pane 内容被挤出屏幕、最右侧看不到的问题
- 修复 PDF `Ctrl+滚轮` / 缩放快捷键在双 pane 下同时作用于两个 PDF 的问题
- PDF 放大、缩小、适宽、适页时，现在会尽量保持当前阅读位置，不再无故跳回第一页
- 只要窗口不关闭，切到别的文件再切回，PDF 的阅读进度和缩放状态会继续保留

### 图片显示稳定性

- 修复了“图片显示几秒后消失”的高优先级问题
- Image Viewer 现在显式管理对象 URL 生命周期，避免资源被过早释放
- Image Tldraw Adapter 现在会检查背景图片 asset 与 background shape 是否同时存在，并在异常时自动恢复
- 新增 `/diagnostics/image-viewer` 诊断页，可持续观察图片心跳、当前 blob URL 与强制重渲染后的稳定性

### 资源 URL 生命周期统一

- 新增统一 `useObjectUrl` hook
- 图片、HTML、PDF 等资源型渲染器开始复用同一套 object URL 生命周期管理
- Markdown 本地图片解析已补 blob URL 缓存与销毁回收，降低隐藏资源泄漏和渲染异常风险

### 批注 sidecar 隔离修复

- `useAnnotationSystem` 现在优先使用完整工作区路径派生 `fileId`
- 同名不同路径的 PDF / 图片文件，不会再共用同一份 annotation sidecar
- 历史上按“文件名”生成的 sidecar 仍可被自动读取并规范化到新 `fileId`

### 选区右键 AI Hub

- Markdown、代码文件、Notebook、PDF 现在都支持“选中文本后右键”的统一 AI 菜单
- 只读 Markdown、只读代码、只读 Jupyter、HTML、Word 预览也已并入同一套右键 AI 能力
- 右键后可直接选择：
  - `Chat`
  - `Agent`
  - `Plan`
- 新增 Selection AI Hub，统一展示：
  - 选中文本
  - 来源文件/位置
  - 本地上下文片段
  - 当前模式下的补充问题输入框
- `Chat` 模式会把当前选区作为显式上下文送进 AI Chat
- `Agent` 模式会默认强调结构化分析输出：`Conclusion / Evidence / Next Actions`
- `Plan` 模式会直接进入 Workbench proposal 流程，而不是先发送普通聊天

### 桌面折叠侧边栏深化

- 折叠态侧边栏现在不再以浮层方式覆盖主内容，而是作为真实窄栏参与桌面布局
- 文件标签栏和阅读区现在会紧贴在窄栏右边，不再被遮住
- 折叠宽度改为更稳定的“近似固定像素”策略，不同桌面尺寸下观感更一致
- 折叠窄栏补上了统一快捷按钮、激活态和帮助入口

### Markdown 导出产品化

- Markdown 编辑器顶栏新增可发现的 `Export` 入口，不再依赖零散脚本或隐藏能力
- 现在可直接从产品 UI 导出当前 Markdown 为 `.docx` 或 `.pdf`
- 导出走统一渲染文档模型，尽量保留标题层级、列表、表格、代码块、引用块和公式
- 导出支持三种标注策略：
  - `clean`：纯正文导出
  - `appendix`：正文纯净，标注和来源放到文末附录
  - `study-note`：把正文与标注整理成更适合学习/科研复盘的导出稿
- 支持“文档版式”与“当前渲染视图”两种视觉模式
- 导出前提供实时预览与导出标题配置，用户可以先确认最终成品结构再落盘
- 当前文件已有的侧车标注会在导出时带出，并保留来源定位信息（例如 PDF 页码、代码行、文本锚点）
- `.pdf` 导出采用渲染快照链路，尽量贴近应用内实际阅读效果
- `.docx` 导出采用结构化 HTML 导入链路，兼顾文档结构和交付稳定性

### QA 基线更新

- 本轮新增 Markdown 导出测试，覆盖附录预览、统一来源模型与 DOCX 包结构
- 本轮补强了 `structured-response`、`mention-browser` 和 Markdown 表格键盘交互测试
- 本轮新增 AI key storage 与 provider registry 测试，锁住 provider 配置链路回归
- 本轮新增 Selection AI Hub / SelectionContext / ai-chat-panel 相关测试
- 当前完整测试门禁更新为 `88` 个测试文件、`945` 个测试全绿
- 本轮已顺序验证：
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:run`
  - `npm run build`
  - `npm run tauri:build`

### AI-Native 科研副驾 v1

### AI Provider 配置升级

- 修复了 Web 端 API key 刷新后恢复错误的问题，避免 provider 看似已配置但实际 key 已损坏
- 修复了 AI 设置里的 URL 配置与 provider 实际读取源不一致的问题
- Ollama 现在优先走 OpenAI 兼容接口，并在兼容接口不可用时自动回退到原生 `/api/chat`
- AI 设置页新增统一的 Base URL 配置、连接测试与手输模型 ID
- 连接测试会显示更具体的失败原因，便于判断是 API key、Base URL、网络还是 Ollama/CORS 问题
- 新增常用 provider：
  - DeepSeek
  - Kimi (Moonshot)
  - 智谱 AI
  - Custom (OpenAI Compatible)

- 统一 AI 入口到同一套 orchestrator，不再让 Chat、PDF、Notebook、选区动作各自维护独立 prompt 逻辑
- 新增统一上下文图，覆盖文件、标题、PDF 批注、Notebook 单元、代码片段、工作区索引和当前选区
- 科研型回答默认返回证据引用，支持文件路径、Markdown 标题、PDF 页码/批注、代码行和 Notebook 单元回链
- AI 回写默认只生成结构化草稿，不直接覆盖正式内容
- 新增“生成整理计划”能力，先展示 planned writes 和审批项，再进入后续执行
- AI Workbench 现已支持自定义草稿写回目标路径
- AI Workbench 现已支持将草稿追加写入现有 Markdown 笔记
- 证据跳转后会对 Markdown 标题、代码行、Notebook 单元、PDF 页码/批注提供短时高亮反馈
- AI Chat 的 `@引用` 现已使用真实工作区文件路径补全，而不是只依赖已打开标签页
- `@引用` 支持 fragment 解析：Markdown 标题、代码行、Notebook 单元、PDF 页码/批注
- 用户显式输入的 `@引用` 会直接注入 `explicitEvidenceRefs`，提升回答的可追溯性和证据优先级
- 现在选中文件型 `@引用` 后，可以继续可视化选择 heading / line / cell / page / annotation，而不必手写全部 fragment
- 现在 `@引用` 已支持真正的两段式浏览：先选文件，再自动进入片段选择
- AI Workbench 现已持久化保存 `drafts` 与 `proposals`，刷新后仍可继续当前 AI 工作流
- proposal 卡片现已支持展开查看 steps、required approvals、planned writes
- proposal 现已支持批准 / 拒绝，并可一键生成计划草稿，形成更接近 Notion 的“计划-审阅-沉淀”闭环
- proposal 的审批勾选状态和 write 选择状态也会随 Workbench 一起持久化，避免中断后丢失审阅进度
- 当前 Workbench 已形成 `Chat -> Proposal -> Draft -> Workspace Writeback` 的连续主路径
- approved proposal 现已支持按已选择的 planned writes 批量生成目标草稿集合
- 这些目标草稿会预填 target path / write mode，并对已生成目标自动去重，进一步接近可执行工作流
- 当前主工作流已进一步收敛为 `Chat -> Proposal -> Target Draft Set -> Workspace Writeback`
- proposal 现已支持批量写回目标草稿，减少逐条手动批准写回的摩擦
- Workbench 会显示目标草稿状态汇总，便于判断当前计划是否已经真正落地
- assistant 回答现已支持结构化 `Conclusion / Evidence / Next Actions` 三段式结果视图
- 当模型输出存在明确章节时，结果会以分区卡片呈现，而不再只是普通聊天长文本
- 新增统一 Evidence 面板，证据与上下文来源不再分散在消息卡片里
- Evidence 面板支持在多条 assistant 结果之间切换浏览，开始具备统一知识浏览入口的雏形
- Evidence 面板现已支持按文件路径聚合的引用树，开始接近真正的知识浏览器
- 当前 Evidence Panel 已同时具备消息切换、引用树浏览和上下文分组，开始形成独立知识浏览界面
- Evidence Panel 现已支持直接发起“保存草稿 / 生成计划”，证据浏览与知识沉淀开始接入同一入口
- Evidence Panel 现已支持文件分组级草稿/计划动作，以及节点级证据草稿动作
- Evidence Panel 现已支持多证据选择后的合并草稿与合并计划动作
- `@引用` 两段式浏览现在会明确提示当前处于“选文件”还是“选片段”阶段，并支持从片段层快速返回文件层
- Evidence 摘要按钮现在支持展开 / 收起切换，Evidence Panel 在切换消息时会重置上一条消息的临时多选状态
- 新增统一 Evidence 面板，证据与上下文来源不再散落在消息卡片里
- assistant 消息现在以“摘要入口 + 面板浏览”的方式查看证据，更接近产品化的知识浏览体验
- assistant 回答现已支持结构化 `Conclusion / Evidence / Next Actions` 三段式结果视图
- 当模型输出带有明确章节时，结果会以分区卡片渲染，而不再只是连续聊天内容
- 结构化回答解析现在兼容 `**Evidence:** ...`、`结论：结果稳定。` 这种同一行标题+内容格式，减少模型输出抖动对 UI 的影响

### 桌面本地运行 v1

- 桌面端默认优先使用本地运行器，而不是 Pyodide 主路径
- Python 支持本地解释器发现：系统 Python、项目 `.venv`、激活的 `venv` / `conda`
- Notebook 单元在桌面 `python-local` 路径下复用同一个本地 Python 会话
- 代码文件、Notebook 单元、Markdown 代码块统一走同一套 runner 事件模型
- 外部命令运行器支持 `.js/.mjs/.cjs`、`.jl`、`.R` 的最小可用执行链路

### 科研输出与运行反馈

- 统一展示 `stdout` / `stderr`
- 错误输出保留结构化 traceback
- Python 本地运行支持图片、HTML 表格、SVG 等常见科研输出
- 支持停止、重跑和 Notebook kernel restart 的基础交互

### 产品级 QA v1

- 已补齐并验证以下门禁：
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:run`
  - `npm run build`
  - `npm run tauri:build`
- `lint` 当前保持 **0 error / 0 warnings**
- 本轮重新顺序验证 `typecheck`、`test:run`、`build` 和 `tauri:build`，桌面与 Web 构建链路都已确认可用
- 清理了预期失败路径的高噪音解析日志，QA 输出更干净、更适合做门禁记录
- 新增 `mention-resolver` 测试覆盖，确认工作区 AI 引用链路可稳定解析
- 新增 AI Workbench store / proposal 相关测试，并修正慢测试超时设置，完整测试现可稳定全绿
- 本轮再次顺序确认 `lint`、`typecheck`、`test:run`、`build` 全部通过
- 新增 fragment suggestion 测试覆盖，确认可视化片段候选生成稳定可用
- 新增目标草稿生成测试覆盖，确认 proposal 批量转草稿逻辑稳定可用
- 本轮再次顺序确认 `lint`、`typecheck`、`test:run`、`build` 全部通过，目标草稿集合链路已具备阶段性可交付状态
- 本轮继续顺序确认 `lint`、`typecheck`、`test:run`、`build` 全部通过，批量写回链路已可稳定跑通
- `use-notebook-executor` 集成测试已改为确定性 fake kernel，完整测试稳定性显著提升
- 当前完整门禁为 `73` 个测试文件、`902` 个测试全绿
- 当前完整门禁已更新为 `74` 个测试文件、`905` 个测试全绿
- 本轮继续顺序确认 `lint`、`typecheck`、`test:run`、`build` 全部通过，引用树浏览能力已稳定可用
- 当前完整门禁已更新为 `74` 个测试文件、`907` 个测试全绿
- 当前完整门禁已更新为 `74` 个测试文件、`908` 个测试全绿
- 当前完整门禁保持 `74` 个测试文件、`905` 个测试全绿
- 新增 Evidence 面板 helper 测试，当前完整门禁为 `72` 个测试文件、`902` 个测试全绿
- `use-notebook-executor` 集成测试已改为确定性 fake kernel，完整测试稳定性显著提升

### 统一链接路由

- 外部网页链接在桌面端会交给系统默认浏览器打开，不再覆盖应用页面
- 工作区内部文件链接继续在应用内打开
- 支持以下深链跳转：
  - Markdown 标题：`#结论`
  - PDF 页码：`papers/math.pdf#page=12`
  - PDF 批注：`[[papers/math.pdf#ann-123]]`
  - 代码行：`src/main.py#line=88`
  - Notebook 单元格：`analysis.ipynb#cell=cell-42`

### PDF 阅读与批注体验

- 修复放大、缩小、适宽时视图自动跳回第一页的问题
- 调整 PDF 文本选区颜色为更自然的淡蓝色
- 保留原有 PDF 批注跳转、定位与高亮链路

### 文件树与资源管理

- 新建文件或文件夹后自动进入重命名
- 支持文件树复制、剪切、粘贴
- 支持拖放移动文件和文件夹
- 目录重命名或移动后自动同步已打开标签页路径
- 刷新文件树后保留目录展开状态
- 通用新建文件逻辑改为唯一命名，避免同名覆盖

### Markdown 表格编辑体验

- 表格不再默认让首格处于激活/高亮状态
- 行列操作控件已移到表格外围，不再侵入表格内容区域
- 现在外围句柄支持键盘聚焦显现，并可通过 `Shift+F10` / 菜单键打开外围操作面板
- 现在通过外部句柄打开操作菜单，避免遮挡文字或压缩单元格空间

## 发布产物

以下文件已经通过构建验证：

- `releases/v2.0.0/lattice.exe`
- `releases/v2.0.0/Lattice_2.0.0_x64_en-US.msi`
- `releases/v2.0.0/Lattice_2.0.0_x64-setup.exe`

原始构建输出位于：

- `src-tauri/target/release/lattice.exe`
- `src-tauri/target/release/bundle/msi/Lattice_2.0.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/Lattice_2.0.0_x64-setup.exe`

## 验证结果

- `npm run lint` 通过
- `npm run typecheck` 通过
- `npm run test:run` 通过
- `npm run build` 通过
- `npm run tauri:build` 通过

已知非阻塞警告：

- Tauri bundler 会提示 `__TAURI_BUNDLE_TYPE` 缺失
- 该警告不影响本次 Windows 可执行文件和安装包生成

## 升级建议

- 若你通过 GitHub Releases 分发桌面版，请上传 `releases/v2.0.0/` 中的最新产物
- 若你在团队内部分发，请优先使用 NSIS 安装包，MSI 保留给企业或受管环境
