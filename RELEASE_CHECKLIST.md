# Lattice 发布前检查清单

用于发布前的**最小质量门禁**，确保功能可用、渲染稳定、插件与 AI 可跑通。

## 1) 构建与静态预览
- [ ] `npm run build`
- [ ] `npx --yes serve out -l 3000`
- [ ] 打开 `http://localhost:3000/`
- [ ] 打开诊断页 `http://localhost:3000/diagnostics/`

> 若 `next dev` 不稳定或报 Turbopack 错误，发布验证请优先使用 `build + serve`。

## 2) Markdown 诊断回归（诊断页）
- [ ] 依次点击：覆盖用例 / 高级渲染 / 公式渲染 / 光标定位 / 语法隐藏 / 嵌套格式 / 重复文本 / 超长文档  
- [ ] 每个用例点击「运行自检」后显示：`通过：未发现异常`

重点核对：
- [ ] HR：`---`、`- - -`、`* * *` 全宽可见
- [ ] 表格：无首尾 `|`、对齐分隔行、表格内 `**`/`$...$`/`` `code` ``
- [ ] 代码块：```/~~~、语言标识（如 `c++`）
- [ ] 公式：行内 `$...$`、块级 `$$...$$`、标题内/表格内公式
- [ ] 光标：在粗体/斜体/代码/链接/公式内点击不应错位

## 3) 插件体系回归
- [ ] 打开「设置」→「扩展」→ 启用插件系统
- [ ] 信任并启用 `Hello Plugin`
- [ ] 打开命令中心（`Ctrl/Cmd + K`），运行 `Say Hello`（控制台有日志）
- [ ] 打开插件面板（侧栏按钮），应出现 `Panel Demo` 面板且无报错

## 4) AI 上下文回归
- [ ] 打开「设置」→「AI」并启用
- [ ] 打开 `.md` 文件
- [ ] 打开 AI 上下文预览，尝试复制 Prompt/JSON/导出

## 5) 控制台与错误检查
- [ ] 浏览器 Console 无红色错误（允许字体 preload 等提示）
- [ ] 若有错误，记录完整堆栈与复现步骤

## 6) 可选自动化
- [ ] 诊断测试：  
  `npm run test:run -- src/components/editor/codemirror/live-preview/__tests__/live-preview-diagnostics.test.ts`

