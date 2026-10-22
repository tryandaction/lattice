# AI PDF Companion 设计规格

## 目标

将 Lattice 的 PDF 阅读与 AI 对话重组为一个可审查的文档工作区：PDF 是主内容，AI Companion 是可调宽度的并列工作区，来源、学习解释、Trace 和 Workbench 只在用户需要时出现。第一屏不再堆叠完整 Evidence Tree、长路径、调试信息或多组操作。

## 交互原则

1. **文档优先**：打开 PDF 时，阅读区保持主列；AI Companion 使用完整高度的可调整面板，最小宽度为可读的对话宽度，不使用右下角浮动小窗。
2. **回答先结论**：普通回答只展示真实存在的结论、核心思路、步骤、最小示例、来源和下一问；空回答必须显示可行动的错误或重试提示。
3. **引用可追溯**：回答只显示紧凑引用 chip 和编号。点击 chip 后打开 Evidence review，并将 PDF 导航到页码/批注/文本锚点；长路径显示 basename，详情中保留完整路径。
4. **渐进披露**：Evidence、Trace、Memory、Workbench 默认为折叠状态。pending approval 自动显示 badge 并打开 Trace review，但不自动展开完整日志。
5. **临时 AI 批注**：AI 来源定位可在当前 PDF 上显示为临时高亮/下划线和来源标记。临时批注不会写入 workspace sidecar；用户明确点击“确认并注入”后，才转换为现有 Universal Annotation Item 并调用现有保存流程。用户可逐条确认、全部确认或丢弃。
6. **错误可恢复**：证据定位失败时不只弹 toast；Evidence review 显示失败原因、basename、候选 workspace root 和“在当前文档中查找”入口，不阻塞聊天输入。

## 页面结构

```text
PDF 阅读主列                         AI Companion（可调整宽度）
┌──────────────────────────┬───────────────────────────────┐
│ PDF toolbar              │ Workspace header               │
│ PDF pages + transient    │ Status: idle/running/approval  │
│ AI annotation overlays   │ Conversation                   │
│                          │ Composer                       │
│                          │ Review surface (按需)           │
└──────────────────────────┴───────────────────────────────┘
```

Review surface 在 Companion 内使用受控高度；Evidence 需要查看原文时，优先触发 PDF 主列定位和短暂 flash，而不是把完整原文复制到聊天流。

## 数据与权限边界

- 不新增 shell、network、MCP、direct-write、autonomous coding 或新的权限能力。
- AI 只能产生 `TransientAiAnnotation` 展示数据：`id`、目标 PDF 路径、页码、矩形、引用文本、来源 ref、置信度和建议批注。
- 只有用户动作 `confirm/inject` 才调用 `upsertAnnotation(s)`；现有审批和 Workbench 行为保持不变。
- `TransientAiAnnotation` 生命周期绑定当前 PDF tab 和当前回答；切换文档、关闭回答或丢弃时清理。

## 验收标准

- 首屏没有完整 Evidence Tree、长路径横向溢出或默认展开 Inspector。
- 点击引用后，Evidence review 打开且 PDF 能定位；workspace root 不匹配时显示可恢复错误，不出现无上下文红色 toast。
- PDF 上的临时 AI 批注可见，确认/注入后进入现有批注列表并可被现有保存和撤销机制处理。
- Companion 在桌面有可读最小宽度，窄屏降级为全宽 review sheet；不会压在右下角或遮挡 Composer。
- Chat / Agent 模式、审批、Trace、Memory、Workbench 原有行为不回归。

