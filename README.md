# Lattice 格致

本地优先的科研工作台。Lattice 把 PDF 阅读、Markdown、代码、Notebook、AI 引用与证据整理、桌面本地运行，收口到同一个工作区里。

## 当前产品基线

- Markdown、代码文件、Notebook code cell、editable Markdown code block 已统一到 `Run / Problems` 反馈模型
- 代码文件与 editable Markdown 的 execution dock 已支持折叠、垂直拖拽调节高度，并按 pane 记忆打开状态与尺寸
- 桌面端默认优先使用本地 Python / 外部命令运行器，Runner Manager 与 Runner Diagnostics 已进入主链路
- 代码文件、editable Markdown 与 Notebook 现在都会明确标出运行器选择来源，例如 `当前入口选择 / 工作区默认 / 自动探测 / 回退`
- Notebook 已改为真实的本地持久 Python session：默认惰性启动，打开文件不自动起会话；只有用户点击 `Run` 或 `验证环境` 时才进行 runtime 校验与 `ready` 握手。非 Python `.ipynb` 明确禁跑
- `.ipynb` 现已保留 `raw` cell，不再伪装成 code cell
- PDF 现已升级为一等条目：首次打开会自动建立同级隐藏兄弟目录 `.basename.lattice/`，并投影为 PDF 下的系统子条目
- PDF 条目默认包含 `条目概览`、`批注索引`、阅读笔记与 Notebook 工作区，批注 Markdown 会自动去抖镜像同步
- PDF 批注支持相对路径深链、反链索引与从批注回跳到研究笔记，不再只是侧栏孤岛
- PDF 文本选择已改为“原生拖选 -> transient overlay”双阶段，复制优先取当前 PDF 原生选中文本，减少拖选闪烁与手感断裂
- PDF 左栏已改为可拖拽宽度的紧凑工具头 + 主批注工作区，批注列表重新占据主要高度
- Markdown 阅读态与系统索引页已继续收紧，frontmatter 在阅读渲染中默认隐藏
- 桌面端现在会恢复最近打开的工作区，不再每次重启都重新选择文件夹
- 只读 Markdown renderer 已关闭代码执行入口，避免保留半接通链路
- AI Chat、Evidence Panel、Workbench 已形成 `Conclusion / Evidence / Next Actions -> Draft / Proposal -> Writeback` 主路径
- Selection AI、diagnostics、browser regression、release prepare 脚本已形成阶段性工程闭环

## 快速开始

### Web 开发

```bash
npm install
npm run dev
```

### 桌面开发

```bash
npm install
npm run tauri:dev
```

### 完整质量门禁

```bash
npm run qa:gate
```

### 清理构建与回归产物

```bash
npm run clean
```

### 本地发布准备

```bash
npm run release:prepare
```

## 文档入口

### 产品与使用

- [用户指南](./docs/USER_GUIDE.md)
- [快速开始](./docs/guides/quick-start.md)
- [安装与更新](./docs/guides/installation.md)
- [桌面功能](./docs/DESKTOP_FEATURES.md)
- [发布说明](./docs/RELEASE_NOTES.md)

### 架构与开发

- [AI 开发指南](./AI_DEVELOPMENT_GUIDE.md)
- [架构说明](./docs/ARCHITECTURE.md)
- [桌面构建与产物指南](./docs/guides/desktop-app.md)
- [GitHub Pages / Release 部署指南](./docs/guides/github-deploy.md)
- [手动发布指南](./docs/MANUAL_RELEASE_GUIDE.md)

## 仓库结构

```text
src/                Next.js 应用与 UI 主代码
src-tauri/          Tauri 桌面壳与本地运行能力
public/             静态资源与诊断/测试样例
docs/               产品、架构、发布与开发文档
scripts/            发布、回归、生成辅助脚本
releases/           本地发布产物与元数据事实来源
```

## 发布与部署

- `web-dist/` 是统一的静态导出产物
- 线上站点当前发布到 Cloudflare Pages：<https://lattice-apq.pages.dev/>
- GitHub Pages workflow 仍保留为备用/镜像发布链路
- 桌面发布使用 `releases/vX.Y.Z/` 作为本地事实来源
- GitHub Actions 只创建 draft release，不自动 publish
- 平台侧若出现 GitHub billing / Actions 不可用，仍可通过本地 `release:prepare` 与 Cloudflare Pages CLI 完成闭环

## 项目整洁约定

- 不提交构建产物：`.next/`、`out/`、`web-dist/`、`output/`
- 不保留临时缓存：`*.tsbuildinfo`、本地回归输出日志
- 使用 `npm run clean` 清理本地构建/回归产物
- 使用 `npm run test:docs` 检查关键文档是否出现旧引用、乱码或失效结构
- 关键能力变化时，同时更新 `README`、相关用户文档、发布说明与发布指南

## 当前验证基线

- `npm run typecheck`
- `npm run test:run`
- `npm run build`

当前主线通过以上三项，作为执行链路与桌面运行能力的最低回归基线。
`/diagnostics/runner` 还支持显式验证 Notebook 本地 Python 会话启动，而不只是静态展示 health snapshot。

补充说明：
- `test:browser-regression` 当前已覆盖并跑通 PDF / 图片标注 / Selection AI / 性能基线四条浏览器级主链路。

## License

MIT
