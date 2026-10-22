# 外观系统交接（开发中）

本窗口：01a10b03-b66d-74e3-97b9-9018f70c4b93。历史开发服务为 127.0.0.1:3217；最终真实矩阵使用主线程全新 cache 的 127.0.0.1:3528。不操作桌面 PID 59048。

## 提前公布的接口

`ThemePackage { schemaVersion:1, id, name, author, license, packageVersion, colors:{light:ThemeColors,dark:ThemeColors}, rules:{uiFont,readingFont,codeFont,density,radius,shadow,motion} }`。

ThemeColors 固定字段：background, foreground, surface, elevated, muted, mutedForeground, border, controlBorder, primary, primaryForeground, focus, selected, selectedForeground, success, warning, danger, info。全部 #RRGGBB；普通文字/状态 4.5:1，focus/controlBorder 3:1；禁止任意 CSS/URL。id 稳定内置 lattice/folio/breeze/atelier/nocturne；用户 id 采用 user- 前缀，内置不可覆盖。最大 64KiB 包，最多 20 自定义。

`AppearanceSettings {schemaVersion:1, activeThemeId:string, customThemes:ThemePackage[]}`；原 `settings.theme` 仍是 light/dark/system。预览不写 settings。

插件接口保留：`hsl(var(--background))`, `hsl(var(--foreground))`, `hsl(var(--card))`, `hsl(var(--popover))`, `hsl(var(--muted))`, `hsl(var(--muted-foreground))`, `hsl(var(--border))`, `hsl(var(--primary))`, `hsl(var(--primary-foreground))`, `hsl(var(--ring))`。补充 `var(--appearance-{success,warning,danger,info,control-border,selected,selected-foreground})` 为完整 CSS 色，`--appearance-font-ui/reading/code`, `--appearance-control-height`, `--appearance-radius`, `--appearance-shadow`, `--appearance-motion`。code/workbench 既有变量统一由 adapter 映射。iframe 独立文档仍须现有宿主传递 token（本窗口不修改 runtime）。

## RootLayout 首屏接入（接口稳定，可接入）

`src/lib/appearance/bootstrap.ts` 导出 server-safe `APPEARANCE_BOOTSTRAP_SCRIPT`。仅外观同步缓存 `lattice-appearance-v1`，由 settings durable 写入成功后更新；完整 CSS 白名单、值白名单、长度/版本检查，不读取/缓存 provider。Hook 等 hydration 初始化后才应用持久化数据。

主窗口在 `src/app/layout.tsx` 使用 Next 官方 `Script`，并把脚本放入 `body`：

```tsx
import Script from 'next/script';
import { APPEARANCE_BOOTSTRAP_SCRIPT } from '@/lib/appearance/bootstrap';
// html 会由首屏脚本设置 class/style/data，需仅对根节点抑制 hydration 提示
<html lang="zh-CN" suppressHydrationWarning>
  <body>
    <Script
      id="lattice-appearance-bootstrap"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP_SCRIPT }}
    />
    {/* existing app body */}
  </body>
```

不要在 React 树中使用原生 `<script dangerouslySetInnerHTML>`；Next DevTools 会将其报告为客户端渲染错误。 `beforeInteractive` 仅负责首屏外观缓存镜像，hydration 后仍由 runtime 根据 durable settings 应用完整主题。

无需新增 ThemeSelector 入口，已有 general 设置会直接显示编辑器。settings generic updateSetting/updateSettings 返回 boolean，失败不抛给未捕获既有 UI；appearance actions 抛出失败，由编辑器捕获并显示。插件授权如依赖 generic await 成功，请检查返回值。

## 真实矩阵运行记录

矩阵脚本：`C:/Users/XINGLUOYUNSHEN/.codex/visualizations/2026/10/05/01a10b03-b66d-74e3-97b9-9018f70c4b93/appearance-qa/matrix.cjs`。

2026-10-05 首轮结果：脚本能打开独立端口诊断页、真实 Settings/Appearance、合成 Markdown 公式、代码文件、文件树和 PDF 入口；在连续切换文件时被 Settings overlay 拦截，原因是通过 `Escape` 关闭后脚本没有等待当前 settings dialog 消失就继续双击 Notebook/代码文件。另一次运行在开发热更新后 fixture 尚未恢复，等待 `acceptance-notebook.ipynb` 时保持在 overlay。该轮产生的 `failure.png` 与 `concept.png` 在同一 QA 目录，首轮未宣称矩阵通过。

下一轮必须：

1. cold context 启动后等待四个合成文件和 `plugin-formulas.pdf` 按钮可见；源码热更新后点击 `Reload synthetic acceptance materials` 并重新等待文件树。
2. 通过 Settings dialog 内真实 Close 按钮或 `Escape` 后等待 `role=dialog` detached/hidden，再执行文件双击。
3. 每次打开文件等待对应 tab/viewer/editor 的确定性状态，不以 `Loading viewer...` 消失作为唯一条件；切换前关闭现有 dialog/浮层。
4. 每个皮肤/模式记录 settings、PDF、Markdown/公式、代码、Notebook、AI Chat、插件容器截图，并记录 html data attributes 与 UI/reading/code computed font。RootLayout 已把 Geist 字体变量移到 html，矩阵需确认 mono/read/UI 不为空。

修正版脚本已在同目录保留：`matrix.cjs` 使用 `Control+,`、`role=dialog` 等待和 Escape/Close 后的 hidden 等待；当前冷上下文仍被 Next DevTools overlay 覆盖 Settings 按钮，待共享 HMR 停止后先跑 lattice/light 烟测，再运行完整矩阵。

2026-10-05 洁净 profile 复跑失败日志：`appearance-qa/matrix.cjs` 已设置 `lattice-download-dismissed=true`、去除 force，并检查所有 dialog。页面出现真实 Next DevTools React Console Error overlay：`Encountered a script tag while rendering React component`，定位 `src/app/layout.tsx:41`（RootLayout 原生内联脚本注册）。完整 aria 文本为 `Console Error ... RootLayout ... <Script id="lattice-appearance-bootstrap" strategy="beforeInteractive" dangerouslySetInnerHTML=...>`；这不是推广 dialog，也不是 pageerror。console 同时有正常 HMR 连接、插件 OPFS NotFound fallback 警告和一次 500 resource，需在最终报告分类，不得把 `0 pageerror` 扩大为无 console 错误。

Root 已将 bootstrap 接入改为官方 `next/script strategy="beforeInteractive"`，保留脚本 ID、缓存、根字体变量与 `performance.mark('lattice-appearance-applied')`。收到修复后的 cold 验证信号后，必须重新执行无 force、已 dismiss profile 的 5×2 矩阵。

2026-10-05 3528 新 cache 最终复跑：通过 `QA_BASE_URL=http://127.0.0.1:3528 node appearance-qa/matrix.cjs` 执行，无 force，初始化时设置 `lattice-download-dismissed=true`。5 套主题 × light/dark 共 10 个组合，每个组合覆盖 settings、PDF、Markdown/公式、代码、Notebook、AI Chat、插件容器 7 个面，共 70 张截图；`matrix.json` 中 `rows=70`、`errors=[]`、`persistence=true`、`narrow=true`，关闭预览后主题仍为 `nocturne`，重载后持久化通过。矩阵脚本只统计 `pageerror`，因此这里结论是 0 page errors，不扩大为无 console 错误。主线程 cold smoke 另有 `consoleErrors=0`、`dialogErrors=0`，仅预期的 OPFS NotFound fallback warning。

## 交付文档与示例

主题包示例与代码原生概念板位于 `src/lib/appearance/examples/`；主题开发者接口、插件语义 token、AI 设计模板和 RootLayout bootstrap 接入方式均在本文件、`src/lib/appearance/README.md` 和 `docs/superpowers/specs/2026-10-05-appearance-skins-design.md` 中。完整矩阵截图与 `matrix.json` 已生成；主线程仍需完成整合后的最终检查后再将 Goal 标记 complete。

2026-10-05 编辑器无效草稿修复：`AppearanceEditor` 统一通过 `previewIfValid` 调用完整 `validateThemePackage`（包括对比度）后才触碰全局预览。`updateDraft` 仍会保留白底白字等无效草稿，显示 `role="alert"` 并允许继续修改；无效草稿不会覆盖上一个有效预览，也不会写入 storage。修正颜色后立即应用新预览，取消预览恢复 durable theme 且无写入。回归测试覆盖“白底白字草稿 → 保持当前有效主题 → 恢复有效 palette → 即时预览 → 取消无写入”；聚焦测试结果为 5 files / 38 tests passed，相关 ESLint 0 errors。该修复只影响无效草稿路径，70 张有效内置主题矩阵无需重跑。
