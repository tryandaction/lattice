# Lattice 格致

一个本地优先、轻量级的科研工作台，专为论文阅读、笔记和代码编辑设计。

## 🚀 快速开始

### 🖥️ 桌面应用（推荐）

**体积小巧 · 启动快速 · 完全离线**

| 平台 | 下载链接 | 大小 |
|------|---------|------|
| 🪟 **Windows** | [安装包 (.exe)](https://github.com/tryandaction/lattice/releases/latest) | ~6 MB |
| 🍎 **macOS** | 即将推出 | - |
| 🐧 **Linux** | 即将推出 | - |

**桌面应用优势：**
- ✅ 完全离线运行，无需网络
- ✅ 双击即用，无需浏览器
- ✅ 记住工作目录，下次自动打开
- ✅ 原生文件系统访问
- ✅ 启动快速，内存占用低

### 🌐 在线体验

[https://lattice-apq.pages.dev/](https://lattice-apq.pages.dev/)

> 在线版功能完整，但推荐下载桌面应用获得最佳体验

## ✨ 核心功能

- **PDF 阅读与批注** - 高亮、区域选择、文字批注、评论
- **多格式支持** - Markdown、Jupyter Notebook、PowerPoint、Word、图片
- **数学公式** - 基于 MathLive 的可视化公式编辑
- **代码高亮** - CodeMirror 6 轻量级代码编辑器
- **本地文件系统** - 直接读写本地文件夹
- **灵活布局** - 可拖拽、可调整的多窗格布局

## 🛠️ 开发

### 环境要求

- Node.js 18+
- Rust 1.70+（桌面应用）

### 安装与运行

```bash
# 安装依赖
npm install

# Web 开发
npm run dev

# 桌面应用开发
npm run tauri:dev

# 构建桌面应用
npm run tauri:build
```

## 📁 项目结构

```
├── src/                # Next.js 前端源码
│   ├── app/            # 页面
│   ├── components/     # React 组件
│   ├── hooks/          # 自定义 Hooks
│   ├── lib/            # 工具函数
│   └── stores/         # 状态管理
├── src-tauri/          # Tauri 桌面应用后端
│   ├── src/main.rs     # Rust 入口
│   └── tauri.conf.json # Tauri 配置
└── out/                # 静态导出目录
```

## 📖 文档

- [快速上手](./QUICK_START.md)
- [安装指南](./INSTALLATION.md)
- [桌面应用](./DESKTOP_APP.md)
- [架构设计](./docs/ARCHITECTURE.md)
- [更新日志](./CHANGELOG.md)

## 📄 License

MIT
