# Lattice 快速开始

这份文档面向第一次接触 Lattice 的用户，帮助你在几分钟内跑通核心体验。

## 1. 选择使用方式

### 在线版

直接访问：<https://lattice-apq.pages.dev/>

### 桌面版

- 优先从 GitHub Releases 下载最新安装包
- 当前本地发布目录基线为 `releases/v2.1.0/`
- Windows 推荐使用 `Lattice_2.1.0_x64-setup.exe`

## 2. 第一次打开后做什么

1. 打开工作区文件夹
2. 选一个 Markdown、PDF、代码文件或 Notebook 打开
3. 尝试右键选区 AI、Evidence Panel、Workbench 草稿写回
4. 若是桌面版，再尝试运行代码文件、Notebook code cell 或 Markdown code block

## 3. 建议优先体验的三条路径

### Markdown / 文档流

- 编辑 Markdown
- 切换 Live Preview
- 体验 Wiki Link、公式、表格、导出

### 代码 / Notebook 流

- 打开 `.py` 或 `.ipynb`
- 运行代码并观察底部 `Run / Problems`
- 在桌面端打开 Runner Manager，检查解释器选择与健康状态

### AI / 知识组织流

- 在 AI Chat 中使用 `@引用`
- 打开 Evidence Panel 浏览引用树
- 把回答转成 Draft 或 Proposal，再写回工作区

### PDF / 文献工作流

- 打开一个 PDF
- 确认 Explorer 中该 PDF 下只显示你创建的笔记 / Notebook；未产生批注前不会默认出现 `_annotations.md`
- 在 PDF 侧栏创建阅读笔记或 Notebook
- 添加一条批注，确认 `_annotations.md` 会自动同步
- 在阅读笔记里引用批注后，再回到 PDF 侧栏确认反链可见

## 4. 常用入口

- 学习入口：`/guide`
- 诊断入口：`/diagnostics`
- 运行器诊断：`/diagnostics/runner`

## 5. 继续阅读

- [用户指南](../USER_GUIDE.md)
- [安装与更新](./installation.md)
- [桌面构建与产物指南](./desktop-app.md)
- [发布说明](../RELEASE_NOTES.md)
