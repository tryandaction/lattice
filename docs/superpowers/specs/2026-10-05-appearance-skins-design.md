# Lattice 外观系统设计规范

用户已授权按委托自主设计、开发和迭代；不设额外设计确认、Git 或部署步骤。ImageGen 未提供工具，且本窗口禁止付费 API；采用可检查的代码原生概念板。

## 产品面与基线

现状：useTheme 多处 effect 仅改 `.dark`；globals.css 独立定义 workbench/code 固定色板；异步 settings 整快照写入可乱序。ThemeSelector 仅三个模式按钮。PDF 原文 canvas/textLayer 不纳入皮肤变换。

| 产品面 | 接口/实现方式 | 保留内容 |
| --- | --- | --- |
| 文件树、标签、工具栏 | workbench 变量 + 共享控件规则 | 文档/标签实例、滚动位置 |
| PDF、批注、菜单 | 背景/边界/弹层语义变量 | 原文、透明 textLayer、高亮颜色 |
| Markdown、公式 | 阅读字体 + prose 语义色 | KaTeX 字体、用户色彩/图片 |
| 代码、Notebook | code 变量和独立等宽字体 | 语法类别、选择与编辑实例 |
| AI Chat/Agent/证据/审查 | foreground/surface/status 变量 | 任务生命周期、证据状态 |
| 设置、对话框、插件容器 | 语义 CSS 和插件接口 | runtime 隔离和现有功能 |

## 五套皮肤

| ID | 名称/受众 | 表面、文字与字体 | 几何/密度/阴影/动效 |
| --- | --- | --- | --- |
| lattice | 格致 / 通用科研办公 | 中性白与石墨，Geist UI，系统阅读 | 8px/标准/柔和/120ms |
| folio | 书页 / 论文与长篇阅读 | 暖纸与深棕，系统 UI，本机衬线阅读 | 4px/舒适/细微/100ms |
| breeze | 微风 / 学习与创作 | 鼠尾草与深绿，圆润系统 UI，系统阅读 | 12px/舒适/柔和/160ms |
| atelier | 工坊 / 开发与数据 | 冷灰与工业石墨，系统 UI，等宽局部控件 | 2px/紧凑/无/0ms |
| nocturne | 夜航 / 专注与数字工作 | 冷靛白与午夜蓝，Geist UI，系统阅读 | 6px/标准/细微/140ms |

每套有完整 light/dark palette。不得远程加载字体；使用已打包 Geist 或本机 system/serif/mono 字体栈。字号使用 rem，不修改阅读/代码字号以模拟密度。控件密度只改变 chrome padding/min-height，正文独立行高。换肤不对全页面颜色做动画，尊重 reduced-motion。

## 模型与数据

ThemePackage v1 包含稳定 id、name、author、license、packageVersion、完整 light/dark colors 与 rules。颜色仅 #RRGGBB，字体/阴影/密度/动效为枚举，radius 为 0–16 数字。严格限制未知字段、元数据长度、ID 命名和 64KiB UTF-8 JSON。禁止 URL、CSS、脚本、任意选择器。普通文字及 muted/status 色与各适用表面 >=4.5:1，主按钮文本 >=4.5:1，focus 与 control border >=3:1。装饰分割线单独定义。导入不改持久化，预览成功仍需显式应用/保存。

AppearanceSettings v1 独立于 ThemeMode；存储 activeThemeId/customThemes。旧设置默认 lattice，保留原模式；损坏包跳过、未知 active ID 回退 lattice。最多 20 自定义皮肤，内置不可覆写。删除当前自定义主题原子回退默认。写入队列避免旧快照覆盖新字段；hydrate 期间更新需保留。

## 交互

ThemeSelector 保留模式控制；五皮肤用紧凑行式选择，局部样片只预览视觉特征。独立 AppearanceEditor 从现有皮肤克隆；选择 light/dark 编辑关键色、密度、圆角、UI/阅读/代码字体、阴影与动效。预览全工作区可撤销；取消/卸载释放 owner，恢复最新持久化配置。保存自定义后应用；应用内置为独立动作。恢复默认只重置外观与 system，不清除其他设置。JSON 文件/文本导入、JSON 导出、复制 AI 提示词/模板形成离线交换，不接入收费生成器。

启动使用仅含外观的安全同步缓存（不含 AI 配置），运行时等待 settings hydrated，避免临时默认覆盖。首次绘制脚本由主窗口在只读 RootLayout 接入，提供最小补丁；缓存须校验后写入。

## 验收

5×2×6 产品面矩阵；unit 覆盖 schema、对比、迁移、删除、导出导入、损坏输入、写入乱序/hydrate race、preview cancel/unmount/system。真实页面验证设置/菜单/公式笔记/代码/Notebook/AI/插件容器，桌面与窄窗、focus/reduced motion、selection/scroll 保持。原生 Tauri/WebView 由主窗口最终安装验证。

## 依据

- Next.js 16.3.4 本地 `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md` 与 `13-fonts.md`：全局 CSS 在根入口集中导入，使用已有本地字体。
- Zustand 5 官方订阅/持久化文档：https://github.com/pmndrs/zustand/blob/main/docs/reference/middlewares/persist.md ，通过 Context7 核实 hydrate 与订阅模式。
- WCAG 2.2 文本对比：https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- WCAG 非文本对比：https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- reduced-motion：https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
