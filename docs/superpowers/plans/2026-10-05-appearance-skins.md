# Lattice Appearance Skins Implementation Plan

**Goal:** 完成五套浅深皮肤、持久化、自定义/预览、安全 JSON 和 AI 交换，并验证真实工作区。
**Architecture:** 独立 appearance schema/registry/CSS adapter/runtime；settings-store 仅负责 durable 数据，preview 是 owner-scoped 临时事务。ThemeSelector 集成独立编辑器；共享文件仅交付补丁。
**Tech Stack:** Next.js 16.3.4、React 19、Zustand 5、Tailwind 3、Vitest、IAB/Playwright。
**Spec:** docs/superpowers/specs/2026-10-05-appearance-skins-design.md

用户授权当前共享目录执行，禁止 worktree/分支/提交/远程部署/全量构建/更多窗口。采用 executing-plans 本窗口执行；技能默认额外确认和 Git 流程由此授权覆盖。

## Todo board

| 任务 | 状态 |
| --- | --- |
| 规则、Goal、基线分析 | completed |
| 规范、概念板、验收矩阵 | completed |
| schema/registry/CSS 映射与安全交换 | completed |
| settings 迁移、写入队列与运行时预览 | completed |
| ThemeSelector/编辑器与 AI 交换 | completed |
| focused tests/lint/typecheck/真实浏览器 | in_progress |
| 文档、样例、共享补丁和交接 | pending |

## 执行步骤

1. 保存基线 screenshot；制作代码原生五皮肤概念板，检查十套配色。
2. 新建 `src/lib/appearance/{types,registry,validation,css,runtime,exchange}.ts`，先测试 `validateThemePackage` 对 URL/未知字段/低对比拒绝和 roundtrip。运行 `npx vitest run src/lib/appearance --maxWorkers=1`。
3. 修改归属 settings types/store；测试 migrate `{theme:'dark'}` 保留 dark 并添加 lattice，异步写入顺序、load 期间字段更新、损坏包、删除 fallback。调用只接收验证数据的 appearance actions。
4. 用单例 runtime + useSyncExternalStore 替换 Hook 多 effect：owner 预览、system listener、DOM variables，不重挂载。测试 cancel/unmount/system 与 selection。
5. ThemeSelector 直接集成 AppearanceEditor，局部中英字典；字段以枚举限制，实时预览失败显示错误，保存需有效。测试保存/取消/导入/恢复。
6. 独立 3217 端口和 `.lattice-build/appearance-dev`；IAB 优先，失败则用户委托允许 Playwright 验证。合成文档/隔离存储，本地 mock，不碰真实 provider。
7. 运行归属 lint 和必要 `tsc --noEmit --incremental false`；记录他人文件错误。用 view_image 检查概念与截图。写 developer README、示例包、验收结果、RootLayout/其他只读共享文件最小补丁。

验收通过并写完 handoff 才可 complete；未测边界明确交主窗口。主窗口审查后的修正继续在归属范围完成。
