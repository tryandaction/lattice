# AI PDF Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended; not used here because AGENTS.md requires a single primary implementation flow) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 PDF 阅读、AI 对话、证据定位和临时批注整合为可读、可审查、按需展开的 AI PDF Companion。

**Architecture:** 保留现有 AI 后端、Universal Annotation Manager、审批和 Workbench 权限。新增轻量的 transient annotation 纯函数/状态边界；Evidence 通过 workspace root resolver 导航到 PDF；桌面 AI 面板在 PDF 场景维持可读最小宽度，Inspector 在 Companion 内以受控 review surface 呈现。

**Tech Stack:** React 19, Next.js, TypeScript, Zustand, Vitest, Testing Library, Playwright, Tailwind utility classes, existing PDF.js highlighter and Universal Annotation storage.

---

## 文件边界

- Create: `src/lib/ai/transient-pdf-annotations.ts` — transient AI annotation 类型、去重、确认转换纯函数。
- Create: `src/components/ai/pdf-companion-review.tsx` — Evidence/annotation review surface，负责确认、全部确认、丢弃和定位回调。
- Modify: `src/components/ai/evidence-panel.tsx` — 使用 `findWorkspaceRootForPath`，显示 basename、定位恢复状态和 transient annotation actions。
- Modify: `src/lib/link-router/navigate-link.ts` — 支持候选 workspace roots，保持现有链接解析和权限边界。
- Modify: `src/components/ai/agent-inspector.tsx` — 将 review surface 改为 Companion 内受控高度，保留 tabs 与 approval badge。
- Modify: `src/components/layout/app-layout.tsx` and `src/components/layout/desktop-workbench-layout.ts` — PDF Companion 的桌面宽度约束与窄屏降级。
- Modify: `src/components/ai/ai-chat-panel.tsx` — 管理 transient annotation 生命周期、Evidence review 打开和 PDF companion mode。
- Modify: `src/components/renderers/pdf-highlighter-adapter.tsx` — 接收当前 PDF 的 transient annotations 并渲染为非持久 overlay，确认后复用已有 annotation API。
- Modify: `src/components/main-area/universal-file-viewer.tsx` — 将 transient annotation props 从 active AI workspace 传入 PDF renderer。
- Modify: `src/lib/ai/result-view-model.ts` and `src/components/ai/chat-timeline.tsx` — 保证 casual prompt 有短回答/可行动 fallback，引用保持 compact。
- Test: `src/lib/ai/__tests__/transient-pdf-annotations.test.ts`, `src/lib/link-router/__tests__/navigate-link.test.ts`, `src/components/ai/__tests__/evidence-panel.test.tsx`, `src/components/ai/__tests__/agent-inspector.test.tsx`, `src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx`, `src/components/layout/__tests__/app-layout.test.tsx`, `src/components/ai/__tests__/chat-timeline.test.tsx`.
- Modify: `docs/AI_AGENT_WORKBENCH_PLAN.md`, `docs/AI_CODING_AGENT_ROADMAP.md`, `docs/AI_AGENT_SYSTEM_TODO.md` — 统一 Phase 2 状态，说明只优化 UI/结果表达/审查流，不开放新执行权限。

## Task 1: 证据定位根因与可恢复错误

**Files:** `src/lib/link-router/navigate-link.ts`, `src/components/ai/evidence-panel.tsx`, `src/lib/link-router/__tests__/navigate-link.test.ts`, `src/components/ai/__tests__/evidence-panel.test.tsx`

- [ ] 写失败测试：当当前 `rootHandle` 不包含 `atom/...`，但 `workspaceRootHandle` 或 root history 包含目标时，`navigateLink` 必须成功打开文件；路径不存在时必须返回 false 且 Evidence panel 显示 basename 和恢复入口。
- [ ] 运行测试确认失败：`npm run test -- src/lib/link-router/__tests__/navigate-link.test.ts src/components/ai/__tests__/evidence-panel.test.tsx`，预期新断言失败。
- [ ] 最小实现：增加可选 `rootHandles`/resolver，Evidence panel 从 `findWorkspaceRootForPath(locator)` 取得根；候选 roots 按 workspace root、history、当前 root 去重尝试；不修改外部链接或系统路径权限。
- [ ] 运行同一测试并确认通过；再运行现有 link-router 与 Evidence 组件测试。

## Task 2: 普通问答的短回答与错误可行动化

**Files:** `src/lib/ai/result-view-model.ts`, `src/components/ai/chat-timeline.tsx`, relevant tests

- [ ] 写失败测试：`hi` 等无 evidence 的 Chat prompt 只能展示一个短直接回答；空模型输出必须展示可行动的重试/配置提示，不能只展示 evidence 或 next actions。
- [ ] 运行测试确认 RED。
- [ ] 实现最小 fallback 和 section filtering；不修改模型请求、证据或 Agent 权限。
- [ ] 运行 ChatTimeline/result-view-model 测试确认 GREEN，并覆盖有/无 concept/steps/example/evidence/next question 的 section。

## Task 3: Transient PDF annotation 数据边界

**Files:** `src/lib/ai/transient-pdf-annotations.ts`, its test

- [ ] 写失败测试：构造来自 evidence ref 的 transient highlight；同一 `documentPath/page/quote` 去重；确认后转换为有效 `AnnotationItem`；丢弃只返回空集合。
- [ ] 运行测试确认 RED。
- [ ] 实现纯函数和显式类型，字段包含来源 ref、置信度、临时状态；确认转换不触发保存。
- [ ] 运行测试确认 GREEN，并用现有 `validateAnnotationItem` 做 schema 验证。

## Task 4: PDF Companion review surface

**Files:** `src/components/ai/pdf-companion-review.tsx`, `src/components/ai/ai-chat-panel.tsx`, `src/components/ai/evidence-panel.tsx`

- [ ] 写失败组件测试：默认不渲染大面板；点击 evidence chip 才显示 review；transient annotation 显示“确认并注入/全部确认/丢弃”；路径显示 basename。
- [ ] 运行测试确认 RED。
- [ ] 实现 review surface 和 transient 生命周期；confirm 调用 PDF renderer 提供的 upsert callback，失败时保留 transient 并显示可恢复状态。
- [ ] 运行组件测试确认 GREEN；确保 pending approval 仍打开 Trace badge，不展开完整日志。

## Task 5: PDF renderer 接入临时 overlay

**Files:** `src/components/renderers/pdf-highlighter-adapter.tsx`, `src/components/main-area/universal-file-viewer.tsx`, renderer tests

- [ ] 写失败测试：给定当前 PDF 的 transient annotation，页面渲染临时高亮和来源标记；未确认前不进入持久 annotation 数量和 sidecar；确认 callback 将其 upsert 到现有 system。
- [ ] 运行 renderer 测试确认 RED。
- [ ] 实现 display annotation 合并层，仅将 transient 传给 overlay renderer；确认时调用现有 `upsertAnnotations`，清理对应 transient；不直接写文件。
- [ ] 运行 PDF renderer 测试确认 GREEN，并回归现有 selection/highlight tests。

## Task 6: Companion 宽度与 Inspector 分层

**Files:** `src/components/layout/app-layout.tsx`, `src/components/layout/desktop-workbench-layout.ts`, `src/components/ai/agent-inspector.tsx`, layout/inspector tests

- [ ] 写失败测试：PDF + AI 打开时 AI Companion 达到可读最小宽度；窄屏切换 full-width review sheet；Inspector 默认折叠，打开时不把 Composer 推出可视区。
- [ ] 运行测试确认 RED。
- [ ] 实现布局约束、`data-testid` 和 aria labels；保留真实 resize；不增加新的执行能力。
- [ ] 运行 layout/inspector 测试确认 GREEN，并检查不重叠、不横向溢出。

## Task 7: 文档与质量验证

**Files:** `docs/AI_AGENT_WORKBENCH_PLAN.md`, `docs/AI_CODING_AGENT_ROADMAP.md`, `docs/AI_AGENT_SYSTEM_TODO.md`

- [ ] 写文档断言/文本检查：Phase 2 只涉及 UI、结果表达和审查流；P4/P5/P6 状态一致；明确无新权限。
- [ ] 运行 `npm run qa:agent-smoke -- --unit-only`、相关 Vitest、`npm run typecheck`、`npm run test:docs`。
- [ ] 启动开发服务器，用真实浏览器验证 PDF + AI Companion 桌面/窄屏、证据跳转、临时批注确认/丢弃和 pending approval；截图检查无空白、重叠、横向滚动灾难。
- [ ] 运行完整 `npm run qa:gate`；生成 `releases/v2.3.1` 更新包。不得执行 git commit/push；替换已安装桌面程序前必须获得用户明确确认。

