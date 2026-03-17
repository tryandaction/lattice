# Lattice v2.0.0 发布说明（阶段收尾补充）

发布日期：2026-03-15

## 本次重点

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
- 当前完整测试门禁更新为 `75` 个测试文件、`911` 个测试全绿
- 本轮已顺序验证：
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:run`
  - `npm run build`
  - `npm run tauri:build`

### AI-Native 科研副驾 v1

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
- 新增统一 Evidence 面板，证据与上下文来源不再散落在消息卡片里
- assistant 消息现在以“摘要入口 + 面板浏览”的方式查看证据，更接近产品化的知识浏览体验
- assistant 回答现已支持结构化 `Conclusion / Evidence / Next Actions` 三段式结果视图
- 当模型输出带有明确章节时，结果会以分区卡片渲染，而不再只是连续聊天内容

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
