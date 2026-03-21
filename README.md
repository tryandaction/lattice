# Lattice 格致

本地优先的科研工作台。Lattice 把 PDF 阅读、Markdown、代码、Notebook、AI 引用与证据整理、桌面本地运行，收口到同一个工作区里。

## 当前产品基线

- Markdown、代码文件、Notebook code cell、editable Markdown code block 已统一到 `Run / Problems` 反馈模型
- 桌面端默认优先使用本地 Python / 外部命令运行器，Runner Manager 与 Runner Diagnostics 已进入主链路
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

- GitHub Pages 使用 `web-dist/` 作为静态导出产物
- 桌面发布使用 `releases/vX.Y.Z/` 作为本地事实来源
- GitHub Actions 只创建 draft release，不自动 publish
- 平台侧若出现 GitHub billing / Actions 不可用，仍可通过本地 `release:prepare` 完成闭环

## 项目整洁约定

- 不提交构建产物：`.next/`、`out/`、`web-dist/`、`output/`
- 不保留临时缓存：`*.tsbuildinfo`、本地回归输出日志
- 使用 `npm run clean` 清理本地构建/回归产物
- 使用 `npm run test:docs` 检查关键文档是否出现旧引用、乱码或失效结构
- 关键能力变化时，同时更新 `README`、相关用户文档、发布说明与发布指南

## License

MIT
