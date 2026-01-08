# Lattice 格致

<p align="center">
  <strong>本地优先 · 轻量高效 · 科研工作台</strong>
</p>

<p align="center">
  专为论文阅读、笔记和代码编辑设计的现代化工具
</p>

<p align="center">
  <a href="https://github.com/tryandaction/lattice/releases/latest">下载桌面版</a> ·
  <a href="https://lattice-apq.pages.dev/">在线体验</a> ·
  <a href="./docs/USER_GUIDE.md">用户指南</a>
</p>

---

## ✨ 特性

- **PDF 阅读与批注** — 高亮、区域选择、文字批注、评论
- **Markdown 实时预览** — 类 Obsidian 体验，Wiki 链接，大纲导航
- **手写笔记** — 压感支持，多种笔刷，平板优化
- **Jupyter Notebook** — 浏览器内运行 Python
- **多格式支持** — PowerPoint、Word、图片、代码
- **本地优先** — 直接读写本地文件，数据完全掌控

## 🚀 快速开始

### 桌面应用（推荐）

| 平台 | 下载 | 大小 |
|------|------|------|
| Windows | [安装包](https://github.com/tryandaction/lattice/releases/latest) | ~6 MB |
| macOS | 即将推出 | - |
| Linux | 即将推出 | - |

**桌面版优势：**
- 完全离线运行
- 启动快速，内存占用低
- 记住工作目录
- 原生文件系统访问

### Android 平板/手机

1. 用 Chrome 访问 [lattice-apq.pages.dev](https://lattice-apq.pages.dev/)
2. 点击「安装」或菜单 →「添加到主屏幕」
3. 从主屏幕启动，全屏 App 体验

### 在线版

访问 [lattice-apq.pages.dev](https://lattice-apq.pages.dev/) 立即使用

## 📖 文档

| 文档 | 说明 |
|------|------|
| [用户指南](./docs/USER_GUIDE.md) | 完整功能介绍和使用教程 |
| [快速上手](./QUICK_START.md) | 5 分钟入门 |
| [安装指南](./INSTALLATION.md) | 安装和故障排除 |
| [桌面应用](./DESKTOP_APP.md) | 桌面版构建指南 |
| [架构设计](./docs/ARCHITECTURE.md) | 技术架构文档 |
| [更新日志](./CHANGELOG.md) | 版本更新记录 |

## 🛠️ 开发

### 环境要求

- Node.js 18+
- Rust 1.70+（桌面应用）

### 运行

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

### 项目结构

```
├── src/                # Next.js 前端
│   ├── app/            # 页面
│   ├── components/     # React 组件
│   ├── hooks/          # 自定义 Hooks
│   ├── lib/            # 工具库
│   └── stores/         # 状态管理
├── src-tauri/          # Tauri 桌面后端
├── docs/               # 文档
└── public/             # 静态资源
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 License

MIT
