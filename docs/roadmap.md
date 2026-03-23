# 开发路线图

## 当前基线：v2.1.0

### 当前阶段已完成

- 桌面端本地运行主链路已可用，Python / 外部命令运行、Notebook 连续执行、运行结果展示已跑通
- 桌面运行器选择链路已进一步收口：桌面端现在会优先选择本地 Python，`Pyodide` 仅保留为应急回退而不再静默伪装主运行器
- 工作区运行器偏好已进入主链路：按 workspace 路径跨重启记住默认解释器与最近选择
- `Workspace Runner Manager` 已进入主链路：Notebook、代码文件和 Markdown 编辑主链路共用同一套解释器管理与恢复自动选择入口
- 代码文件与 editable Markdown 的 execution dock 已支持折叠、拖拽调整高度与 pane 级记忆
- Notebook Markdown Cell 已复用现有 Live Preview / Obsidian 级编辑内核，默认 `Live` 并支持切到 `Source`
- Notebook 已收口到真实的本地持久 Python session，运行前先做 runtime 校验与 `ready` 握手
- Notebook 首屏已调整为惰性启动：打开 `.ipynb` 只恢复已知运行器状态，不自动探测/起会话/抢占主界面报错
- `.ipynb` 已保留 `raw` cell，非 Python Notebook 明确禁跑
- editable Markdown 主链路里的 Live Preview code block 已具备运行入口，并统一接到底部 `Run / Problems` dock
- 代码文件、Notebook code cell、editable Markdown code block 已统一到 `ExecutionProblem` 问题模型与 surface-local runner health
- 当前主链路已能显式表达运行器选择来源，而不是只显示解释器/命令本身
- `Runner Diagnostics` 已支持主动验证 Notebook 本地 Python 会话启动，不再只是静态健康信息页
- 只读 Markdown renderer 的代码执行入口已关闭，避免继续维护半接通路径
- PDF 首次打开默认改为自适应宽度填充，避免阅读入口停在固定手动缩放
- PDF 已进入条目工作区阶段：单个 PDF 可建立 companion item folder，并直接创建关联 `Markdown` 阅读笔记、`Notebook (.ipynb)` 与批注 Markdown
- PDF 批注已支持同步成独立 Markdown 文件并从条目区直接打开
- PDF 文本选区与复制链已开始产品化收口：临时 overlay 与 `Ctrl+C / Cmd+C` 文本复制优先级已进入主链
- QA 基线已收敛到 `lint` / `typecheck` / `test:run` / `build` / `tauri:build` 可稳定通过
- Markdown 导出已产品化进入主界面，支持 `.docx` / `.pdf`、`clean` / `appendix` / `study-note` 和“当前渲染视图”导出
- AI Workbench 已形成主闭环：
  - `Chat -> Proposal -> Target Draft Set -> Batch Writeback -> Workspace`
- `@引用` 已升级到工作区级引用，并支持 heading / line / cell / page / annotation 片段选择
- 当前 `@引用` 与 Evidence Panel 已进入产品化收口阶段：两段式浏览、消息切换、证据多选和后续动作链路都已具备可持续深化的基线
- AI 结果视图已收口到统一派生层：
  - `AiResultViewModel` 稳定提供 `Conclusion / Evidence / Next Actions`
  - `AiChatPanel` 与 `EvidencePanel` 共用同一套结果结构
- `ReferenceBrowser` 已成为共享引用浏览器：
  - `@引用` 输入与 Evidence 浏览共用统一树节点模型
  - 文件与片段浏览不再维护两套独立展示逻辑
- Workbench 草稿已具备模板与来源分组：
  - `templateId / originMessageId / originProposalId`
  - proposal 卡片内可查看 `Linked Drafts`
- 发布工程已形成可复用闭环：
  - `scripts/prepare-release.mjs`
  - `releases/vX.Y.Z/` 事实来源
  - `checksums.txt / release-manifest.json / RELEASE_SUMMARY.md`
  - GitHub Actions draft release 与本地手动 upload 双通路
- Selection AI Hub 已完成 Phase 2 收口：最近模式/轻量 prompt 历史、模式差异化、结果来源识别、SelectionContext 精细化已具备产品基线
- 分屏 PDF 阅读稳定性已补强：pane 作用域缩放、阅读位置保持、切文件后恢复阅读进度、布局不再把右侧内容挤出屏幕
- 当前 diagnostics / regression 基础设施已补齐：
  - `/diagnostics/pdf-regression`
  - `/diagnostics/image-annotation`
  - `/diagnostics/selection-ai`
  - `/diagnostics/runner`
- QA 基线已进一步收敛到 `lint` / `typecheck` / `test:run` / `build` / `tauri:build`；`test:browser-regression` 中 PDF 深页切文件恢复仍在继续收口

### 当前阶段仍然刻意不做

- 完整 IDE 级调试器
- 复杂多步自治 Agent
- 多人协作与云权限系统
- 移动端与多平台桌面适配

---

## 下一阶段：IDE 级代码渲染与运行体验深化

### 阶段目标

把 Lattice 的代码文件与 Notebook 体验，从“已经能执行”继续推进到更接近 VS Code / 本地 IDE 的工作流质量。重点不是再补一条能跑的命令链，而是把 **运行器选择、运行反馈、Notebook Markdown Cell、编辑期渲染与环境诊断** 做成稳定、可预期、可恢复的产品体验。

### 核心交付

- 代码运行与 Notebook 内核链路继续专业化：
  - 本地 Python 环境诊断页 / 健康探针
  - 缺失解释器时的明确修复指引
  - 不同工作区的运行器偏好持久化
  - 运行失败后的更清晰错误分层与恢复动作
- Notebook Markdown Cell 复用现有 Markdown / Live Preview / Obsidian 级编辑链路：
  - 实时渲染
  - 实时编辑
  - 与普通 `.md` 文件尽可能一致的交互
- 代码编辑体验继续向 IDE 靠拢：
  - hover / 诊断 / 补全 / 执行入口统一
  - 更强的输出面板结构
  - 更可靠的 Notebook / code file / markdown code block 统一运行事件流

### 完成定义

- 桌面端不再把本地运行失败静默伪装成浏览器回退
- 用户能明确知道当前运行的是本地解释器还是浏览器回退
- Notebook Markdown Cell 体验明显接近 Obsidian / Live Preview，而不再只是静态 markdown 块
- Markdown 代码块、代码文件、Notebook code cell 的运行反馈使用统一面板模型
- 代码运行问题可通过产品内诊断信息定位，而不是只能靠猜测环境

---

## 下一阶段：知识组织与研究工作流深化

### 阶段目标

知识组织产品化 v1 已经进入主链路。下一步不再是从零补齐基础组件，而是继续深化 **跨会话知识浏览、批量整理恢复、模板复用与更强的研究工作流闭环**。

这一阶段要直接对标 Notion 的知识组织体验，同时保留并强化 Lattice 在科研阅读、证据回链、Notebook / 代码 / PDF 混合工作流上的优势。

---

## 目标一：多级引用浏览器

### 要解决的问题

当前 `@引用` 与 Evidence Panel 已共用 `ReferenceBrowser`。下一步重点变成把这套浏览器继续扩到更多入口，并强化跨消息、跨草稿、跨 proposal 的连续浏览。

### 计划交付

- 在更多 AI 入口复用同一套引用浏览器
- 增加更稳定的键盘导航与跨层级定位
- 强化 proposal / draft / evidence 之间的回跳与联动

### 验收标准

- 用户不需要手写大部分 fragment
- 引用后能直接生成 `EvidenceRef`
- 引用结果能稳定回链到对应位置

---

## 目标二：证据浏览与 AI 结果视图统一化

### 要解决的问题

当前 AI 结果视图已经统一，但 Evidence 浏览、上下文切换和后续动作还可以继续深化。

### 计划交付

- 强化多条结果之间的并行比较与切换
- 让 `Next Actions` 与更多 Workbench 动作直接联动
- 继续减少消息卡片中的重复入口

### 验收标准

- 研究型回答默认可追溯
- 同一回答中多个证据来源可稳定展示
- 用户能从结果视图快速进入 Workbench 或原文位置

---

## 目标三：知识沉淀模板化

### 要解决的问题

现在 draft/writeback 已有模板基线。下一步重点是提高模板复用、一致性和批量整理恢复能力。

### 计划交付

- 为以下类型提供标准草稿模板：
  - 论文阅读笔记
  - 研究问题清单
  - 方法对比摘要
  - 实验记录
  - 代码解读卡片
- Workbench 创建草稿时自动带模板头部和来源证据
- 支持将多份草稿继续合成为更高层摘要

### 验收标准

- 同类 AI 结果的沉淀结构保持一致
- 草稿写回后能直接进入后续人工整理
- 跨文档总结不再只是一次性聊天回答

---

## 目标四：批量整理工作流 v1

### 要解决的问题

现在已经有 `Proposal -> Draft Set -> Batch Writeback`，但还缺少更强的批量整理体验。

### 计划交付

- 在 Workbench 中展示一组目标草稿的写回前预览
- 支持：
  - 批量批准
  - 批量写回
  - 失败项重试
  - 部分成功后的状态恢复
- 为每个写回结果保留状态与目标路径

### 验收标准

- 多草稿写回不会把用户带回“逐条手工操作”的低效流程
- 写回失败项可重新处理
- 刷新后批量执行状态不丢失

---

## 暂不进入下一阶段的事项

- macOS / Linux 桌面版
- 自动更新系统
- 云同步
- 插件生态开放
- 协作编辑

这些不是不做，而是当前优先级低于“把 AI + 知识组织主线做成完整产品”。

---

## 下一阶段完成定义

满足以下条件时，才认为下一阶段完成：

- 引用器已经不依赖用户手写 fragment
- AI 结果视图已经统一为稳定产品结构
- 草稿沉淀已经模板化
- 批量整理工作流从 proposal 到 writeback 可以稳定连续完成
- `lint` / `typecheck` / `test:run` / `build` / `tauri:build` 继续全绿
- `test:browser-regression` 重新回到稳定通过，尤其是 PDF 深页切文件恢复不再受 `react-pdf-highlighter / pdfjs` teardown race 影响

---

## 更后续阶段

下一阶段完成后，再进入这些方向：

- 更完整的知识图谱与跨文档关系可视化
- 更强的 Agent 工具编排
- Markdown 导出继续深化到真正的 `annotated` inline 视图、跨文件 Evidence 导出和更强的桌面原生排版能力
- 多平台桌面与自动更新
- 插件生态与外部扩展

---

详细任务落地应继续以当前仓库代码和门禁状态为准，而不是沿用早期 `v0.x` 时代的路线图。
