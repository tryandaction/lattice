# 量子键盘官方插件收尾与交接

日期：2026-10-28。范围：量子键盘插件及必要的编辑器、插件宿主和设置接入。

## 定稿状态

量子键盘以官方内置插件交付，ID `quantum-keyboard`、插件版本 `2.0.0`，注册方式与公式 OCR 一致。插件拥有键盘 UI、输入监听、编辑扩展、配置和命令，应用外壳只保留按运行状态挂载的 Host。用户已确认当前 UI；本轮仅做稳定性收尾，不再改变视觉方案。

本窗口未更新桌面安装包、产品版本或线上部署，未创建分支、提交或推送 Git。本记录用于产品收尾窗口归并代码和执行整产品发布门禁。

## 保留的产品行为

- 电脑 QWERTY 布局，每键每层 5–6 个可见官方候选；编号和公式由完整色块包住，保留流动彩色整板外框。
- 字母后按数字选择；Shift+字母进入扩展层。Ctrl+I+0/20/30 为闭合积分，Ctrl+M+34 为 3×4 矩阵；数字依次输入，松 Ctrl 确认。
- F2 候选/变量模式切换，结构插入后自动进入变量填写；Tab、Shift+Tab、方向键和矩阵加行加列可全键盘操作。
- Ctrl 矩阵行列为 1–9；矩阵尺寸表单为 1–20。键帽清楚展示括号类型和尺寸。
- Live Preview 中公式双击定位编辑，源码仍为 Markdown/LaTeX。Source 模式和普通输入目标可按源码插入。
- 双 Tab 开启、配置开关即时生效；停用提交当前公式并移除面板、监听和扩展，不需刷新即可再次启用。
- 官方/自定义映射切换、名称和 LaTeX 编辑、隐藏/增补符号、收藏、最近及公式库持久化；旧覆盖项和归档含义身份保留。
- 中英文与深浅色适配，桌面完整显示全部键和控制键；窄屏有横向滚动提示且末键可达。默认桌面底栏从 60px 压缩至 29px，说明靠左单行排列。
- 原生公式右键复制 Markdown/LaTeX 由核心渲染器提供，停用插件后仍存在。

## 本轮收尾修复

以下路径均先建立失败回归，再修复验证：

1. 无公式编辑消费者的 CodeMirror 插入不得建立悬空队列，防止 Source 模式或停用时第二个公式被吞掉。
2. 双 Tab 排除长按重复、IME 和修饰键组合；其它按键打断连续双击序列，停用清除计时状态。
3. 公式失焦、冷加载中转移焦点、停用时先冲刷已接受输入并提交，再关闭会话；不抢回用户新选择的输入位置。Ctrl+Enter 显式完成仍恢复编辑器焦点。
4. 候选和编号前缀绑定原编辑目标；跨编辑器或窗口失焦时清理，同一编辑器与插件控制间的合法往返保留。
5. 切换官方/自定义方案时清除旧选择；候选集合变短时限制当前编号，避免 Enter 静默失效。
6. 候选方向键可长按，重复符号键不会漏到原生输入；变量模式原生重复正常。
7. 已保存块级公式编辑或改名后保留 displayMode，不退化为行内公式。
8. 旧设置入口的兼容测试改为显式选择 I 键，并验证当前扩展积分及稳定 ID；不再依赖历史默认选中项。

## 最终验证

| 检查 | 结果与覆盖 |
| --- | --- |
| 插件与集成回归 | 29 个文件、314 项全部通过；机器结果见本机 `quantum-closeout-qa/vitest-final.json`，覆盖插件、键位、输入、设置、持久化、原生公式渲染与 OCR 注册兼容 |
| 类型 | `npx tsc --noEmit --incremental false`，exit 0 |
| 代码检查 | 插件目录及本轮共享输入/Hook/存储/键位文件，ESLint `--max-warnings=0`，exit 0 |
| 生命周期浏览器 | 10/10；编辑已有公式、分式填空、带未关闭公式停用、源码保留、原生输入、原生复制菜单、无刷新重启 |
| 界面浏览器 | 24/24；960×700、1280×720、1440×900 × 中英文 × 深浅色 × 常用/扩展层 |
| 双 Tab | 24/24 首次打开，按钮回退 0；等待客户端懒加载完成后开始输入 |
| 布局 | 桌面横向溢出最大 0px；全部 26 字母键、7 控制键及字形可见，编号不重叠，整板尾距最大 10px |
| 页面健康 | 生命周期与界面检查均无页面、控制台错误 |

浏览器为仓库 Playwright Chromium；当前没有 Browser 插件，因此使用仓库 Playwright。复制菜单验证其存在与动作名称，未调用系统剪贴板。此处的浏览器覆盖不等同于已验证打包后的 Tauri 安装包。

本机验收根目录：

`C:/Users/XINGLUOYUNSHEN/.codex/visualizations/2026/10/27/01a17c1a-9d79-7e41-a508-4c5af5b590b6/`

- `quantum-closeout-qa/result.json`：最终 10 步生命周期记录和同目录 4 张截图。
- `quantum-ui-qa/2026-10-28T08-04-16-418Z/report.json`：最终 24 组合记录和同目录 26 张截图。
- `quantum-footer-compact.png`：用户确认的底部紧凑版本截图。
- `quantum-closeout-qa/vitest-final.json`：最终合并回归机器可读报告。

UI 验收可重跑：先以独立输出目录启动本地服务，再执行 `node scripts/quantum-keyboard-ui-qa.mjs`。可用 `QUANTUM_QA_URL`、`QUANTUM_QA_OUTPUT` 指定本地 URL 和输出位置；脚本等待插件客户端就绪，按钮回退会记为双 Tab 验收失败。

## 产品窗口接入清单

归并时保留共享文件中其它窗口的并行改动；新增目录和文件尚未提交，不要遗漏：

| 层级 | 必须一起接入的文件 |
| --- | --- |
| 插件主体 | `src/plugins/quantum-keyboard/**` |
| 官方注册/设置默认值 | `src/lib/plugins/registry.ts`、`defaults.ts`，`src/types/settings.ts`、`src/stores/settings-store.ts` |
| 应用 Host | `src/app/layout.tsx` |
| 编辑器桥接 | `src/components/editor/codemirror/plugin-extensions.ts`、`live-preview/math-editor-range.ts`、`live-preview-editor.tsx`、`decoration-coordinator.ts` |
| Markdown 工具入口 | `src/components/editor/obsidian-markdown-viewer.tsx`；入口随插件运行状态显示并按当前语言命名 |
| 原生渲染与复制 | `src/components/editor/codemirror/live-preview/widgets.ts`；原生复制不依赖插件 |
| 统一输入与会话 | `src/lib/unified-input-handler.ts`、`quantum-input-session.ts`、`src/hooks/use-double-tap.ts` |
| 键位和模板 | `src/config/quantum-keymap.ts`、`quantum-formula-presets.ts`、`src/lib/formula-templates.ts` |
| 持久化 | `src/stores/quantum-keymap-store.ts`、`quantum-custom-store.ts`、`quantum-formula-library-store.ts` |
| 插件 UI 和语言接入 | `src/components/settings/plugins-panel.tsx`、`settings-dialog.tsx`、`src/components/ui/plugin-command-dialog.tsx`、`plugin-toolbar-slot.tsx`、`src/lib/i18n/zh-CN.ts`、`en-US.ts` |
| 兼容出口 | `src/components/hud/hud-provider.tsx`、`keyboard-hud.tsx`、`src/components/settings/quantum-keyboard-editor.tsx`、`src/components/editor/codemirror/live-preview/quantum-math-editing.ts` |
| 验证与文档 | 相关测试、`scripts/quantum-keyboard-ui-qa.mjs`、诊断路由和组件、用户指南、设计定稿及本记录 |

设置默认值使用内置插件版本迁移；归并时保留版本标记和“迁移后用户停用保持关闭”的行为。不要只添加插件 manifest 而漏掉 Host、动态编辑器扩展或持久化迁移。

整产品发布由产品窗口运行 `npm run qa:gate` 和项目规定的本地打包流程，再验证桌面插件列表、启停、自定义保存、已有 Markdown 文件编辑及原生复制。`web-dist-dev-quantum/`、`web-dist-quantum-final/` 等仅为本地开发输出，不是此功能的源代码或发布交付物。

用户操作说明见 `docs/guides/quantum-keyboard.md`；最终设计见 `docs/superpowers/specs/2026-10-27-quantum-keyboard-plugin-design.md`。
