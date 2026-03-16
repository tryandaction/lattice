# Lattice v2.0.0 发布说明（阶段收尾补充）

发布日期：2026-03-15

## 本次重点

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
