# Lattice 操作指引（插件/AI/命令中心）

本文档用于你在本地完成新功能的验证与体验配置。如果你需要进一步排查问题，请按此步骤复测并提供结果。

## 1) 启用插件系统并验证命令
1. 打开「设置」→「扩展」。
2. 开启“启用插件系统”。
3. 勾选“信任”，再勾选 `Hello Plugin` 启用。
4. 打开命令中心：
   - 侧边栏按钮：命令图标
   - 快捷键：`Ctrl/Cmd + K`
5. 搜索 `hello` 并运行 `Say Hello`，控制台应输出 `hello from plugin`。
6. 打开插件面板（侧边栏「插件面板」图标），应出现 `Panel Demo` 面板且页面不报错。

## 2) 启用 AI 上下文预览
1. 打开「设置」→「AI」并启用 AI。
2. 打开任意文本文件（如 `.md`）。
3. 点击侧边栏 AI 图标进入“AI 上下文预览”。
4. 可切换“包含批注”，并尝试：
   - 复制（Prompt 文本）
   - 复制 JSON
   - 导出 JSON（本地下载）

## 3) 可选验证（建议）
1. 在命令中心输入关键字，验证搜索过滤是否生效。
2. 用 `↑/↓` 在命令列表中移动高亮，按 `Enter` 运行选中命令。
3. 运行命令后检查“最近使用”是否出现记录。

## 4) 若出现问题，请提供
- 出错页面截图
- 复现步骤（按上文步骤写）
- 控制台日志（如有）

## 5) Markdown 渲染/编辑回归测试（诊断页 + 自动化）

### A. 构建并启动静态站点（推荐）
1. 构建静态导出（产物在 `out/`）：
   - `npm run build`
2. 启动静态服务（二选一）：
   - Python：`python -m http.server 3000 --directory out`
   - Node：`npx --yes serve out -l 3000`
3. 打开诊断页：
   - `http://localhost:3000/diagnostics/`

### B. 诊断页回归用例（手动）
1. 依次点击：覆盖用例 / 高级渲染 / 公式渲染 / 光标定位 / 语法隐藏 / 嵌套格式 / 重复文本 / 超长文档
2. 每个用例都点击「运行自检」，应显示：`通过：未发现异常`
3. 建议重点复测：
   - HR：`---`、`- - -`、`* * *`
   - 表格：无首尾 `|`、对齐分隔行、表格内 `**`/`$...$`/`` `code` ``
   - 代码块：```/~~~、语言标识（如 `c++`）
   - 公式：行内 `$...$`、块级 `$$...$$`、标题内/表格内公式
   - 光标：在粗体/斜体/代码/链接/公式内点击，光标落点不应“跳行/错位”

### C. Playwright 自动化（我已用此方式回归）
在仓库根目录执行（示例）：
```powershell
cd "c:/universe/software development/Lattice/output/playwright"
npx --yes --package @playwright/cli playwright-cli -s=md open "http://localhost:3000/diagnostics/" --headed
npx --yes --package @playwright/cli playwright-cli -s=md snapshot
```
自动化工件会落在当前目录的 `.playwright-cli/`（截图/快照/console log）。
