# Lattice

一个轻量级、高性能的现代编辑器，专为笔记、数学公式和代码编辑设计。

**🌐 在线体验：https://lattice-apq.pages.dev/** | [备用链接](https://lattice-three-alpha.vercel.app/)

## ✨ 特性

- **多格式支持** - Markdown、Jupyter Notebook、PowerPoint、Word、PDF、图片等
- **PDF 批注** - Zotero 风格的批注工具栏，支持高亮、下划线、便签、区域选择
- **数学公式编辑** - 基于 MathLive 的结构化数学编辑，支持 LaTeX
- **代码高亮** - 使用 CodeMirror 6 实现轻量级代码编辑
- **本地文件系统** - 通过 File System Access API 直接读写本地文件
- **灵活布局** - 可拖拽、可调整大小的多窗格布局
- **Python 执行** - 通过 Pyodide 在浏览器中运行 Python 代码（按需加载）

## 🛠️ 技术栈

| 技术 | 用途 |
|------|------|
| Next.js 15+ | 应用框架 (App Router) |
| React 19 | UI 库 |
| Tailwind CSS | 样式系统 |
| Zustand | 全局状态管理 |
| Jotai | 编辑器原子状态 |
| Tiptap | 富文本/Markdown 编辑 |
| CodeMirror 6 | 代码编辑 |
| MathLive | 数学公式编辑 |
| Pyodide | Python WASM 运行时 |

## 🚀 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn

### 安装

```bash
# 克隆项目
git clone <repository-url>
cd lattice

# 安装依赖
npm install
```

### 开发

```bash
npm run dev
```

访问 http://localhost:3000

### 构建

```bash
npm run build
npm run start
```

### 测试

```bash
npm run test        # 监听模式
npm run test:run    # 单次运行
```

## 📁 项目结构

```
src/
├── app/              # Next.js App Router 页面
├── components/       # React 组件
│   ├── dnd/          # 拖拽相关
│   ├── editor/       # 编辑器组件
│   ├── explorer/     # 文件浏览器
│   ├── hud/          # HUD 界面
│   ├── layout/       # 布局组件
│   ├── notebook/     # Notebook 组件
│   ├── renderers/    # 文件渲染器
│   └── ui/           # 通用 UI 组件
├── config/           # 配置文件
├── hooks/            # 自定义 Hooks
├── lib/              # 工具函数
├── stores/           # 状态管理
└── types/            # TypeScript 类型
```

## 📖 文档

- [架构设计](./docs/ARCHITECTURE.md) - 技术架构和组件关系
- [项目上下文](./docs/PROJECT_CONTEXT.md) - 当前状态和决策日志
- [UX 指南](./docs/UX_GUIDELINES.md) - 交互设计原则

## 🎯 设计理念

### 轻量高性能

- 优先考虑包体积和加载速度
- 重资源按需懒加载（如 Pyodide 20MB 运行时）
- 选择 CodeMirror 6 (~150KB) 而非 Monaco (2MB+)

### 结构优先的数学编辑

受 GNU TeXmacs 和 Mogan 启发，采用可视化结构编辑而非纯 LaTeX 源码编辑：

- 按 `/` 创建分数结构
- 按 `Tab` 在占位符间导航
- LaTeX 作为高级用户的备选方案

## 🌐 浏览器支持

推荐使用基于 Chromium 的浏览器（Chrome、Edge），以获得完整的 File System Access API 支持。

## 📄 License

MIT
