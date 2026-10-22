# AI Review Workspace 设计规格

## 目标

彻底移除 AI Workspace 底部堆叠的 Memory、Trace、Evidence 和 Workbench 区域。普通状态下只显示对话与 Composer；审查发生时，AI Companion 的内容区整体切换为全高度 Review Workspace。PDF 在宽屏保持可见，窄窗口下 Review 升级为全内容区覆盖层。

## 已确认的信息架构

### Conversation 模式

- Header 只保留 AI Workspace、新对话、关闭。
- Status Strip 显示运行状态、Chat/Agent、模型摘要、上下文数、审批 badge，以及单一 Review 入口。
- 主体只显示当前对话。
- Composer 固定在底部，不受隐藏审查组件占位影响。
- 不渲染 Inspector tab strip、Evidence Tree、Trace、Memory 或 Workbench 摘要行。

### Review 模式

- Conversation 与 Review 互斥，不进行上下堆叠。
- Review 占据 Status Strip 下方至面板底部的完整可用高度；Review 打开时隐藏 Conversation 与 Composer。
- 顶部提供返回对话、当前审查类型和关闭按钮。
- Memory、Trace、Evidence、Workbench 只在 Review 内作为紧凑 tabs 出现。
- 点击回答引用打开 Evidence Review；点击审批 badge 打开 Trace Review；保存草稿或 Proposal 打开 Workbench Review；Memory review 打开 Memory Review。
- 关闭或返回后恢复原对话滚动位置与 Composer 草稿。

### 响应式行为

- 宽屏：PDF 主列与 AI Companion 并列；Review 使用完整 AI Companion 高度。
- 窄窗口：AI Workspace 本身覆盖主内容区；Review 继续使用该全高区域，不保留固定窄侧栏。
- 不使用居中 Modal 承载 Evidence，因为 Modal 会遮挡 PDF 来源核对。
- 不增加第三个并排审查列，避免再次压缩 PDF 和对话。

## Evidence 交互

1. 回答只显示编号引用 chip、来源 basename 和数量。
2. 点击引用切换到 Evidence Review，并尝试在 PDF 中定位来源。
3. 有页码/矩形锚点时显示临时 AI 高亮；只有点击“确认并注入”后才进入现有批注存储。
4. Evidence Review 默认展示选中来源的摘要与引用，不默认展开完整 Reference Tree。
5. 完整路径、批量选择、Template、Draft、Proposal 放在“更多操作”或详情区域。
6. 定位失败只在当前来源行显示紧凑错误和恢复动作，不使用遮挡 Composer 的全局错误 Toast。

## 证据路径解析

Workspace root 候选必须同时携带 directory handle 与其注册路径前缀。例如注册根为 `atom/Theoretical Research/taiyi/essay` 时，目标 `atom/Theoretical Research/taiyi/essay/paper.pdf` 应先剥离注册前缀，再相对该 handle 解析 `paper.pdf`。打开文件和 pending navigation 仍使用规范化的 workspace 路径。

## 权限边界

- 不新增 shell、network、MCP、direct-write、autonomous coding、自动 Git 或权限能力。
- Review 只展示已有 Evidence、Trace、Memory、Draft、Proposal 和 Approval。
- 临时 PDF 高亮不持久化；注入必须由用户显式确认。
- 设置与 Provider、模型、工作流、effort 等复杂配置继续位于 Settings，不回流到聊天主界面。

## 验收标准

- 默认 AI Workspace DOM 中不存在底部 Inspector tab strip。
- 打开 Evidence/Trace/Memory/Workbench 时，对话与 Composer 不与 Review 同时占据垂直空间。
- Review body 使用完整可用高度，不包含 `34rem`、`58dvh` 等小面板高度上限。
- 引用点击可打开 Evidence Review；嵌套 workspace root 可正确定位。
- 定位失败不产生全局红色 Toast，只显示紧凑行内恢复状态。
- pending approval badge 一眼可见并打开 Trace Review，但不自动展开全部 Trace 日志。
- 桌面与窄窗口无横向滚动灾难、Composer 遮挡或小窗口套小窗口。

