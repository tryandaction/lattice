# Lattice v0.1.0

## 🎉 新功能

### 桌面应用增强

- ✅ **默认文件夹设置**：可以设置默认工作目录，启动时自动打开
- ✅ **自动记忆功能**：自动记住上次打开的文件夹
- ✅ **可视化设置界面**：按 `Ctrl+,` 打开设置面板
- ✅ **清除设置选项**：可以随时清除默认文件夹设置

### 网页版改进

- ✅ **下载提醒弹窗**：首次访问时提示下载桌面应用
- ✅ **优势说明**：清晰展示桌面应用的优势
- ✅ **不再显示选项**：用户可以选择不再显示提醒

### 文档更新

- ✅ **README 优化**：添加明显的下载链接和对比表格
- ✅ **桌面功能指南**：详细的功能使用说明
- ✅ **安装指南**：完整的安装和故障排除文档

## 📥 下载

### Windows

| 安装包类型 | 大小 | 适用场景 | 下载链接 |
|-----------|------|---------|---------|
| NSIS 安装包 | ~6 MB | 普通用户（推荐） | [下载](https://github.com/tryandaction/lattice/releases/download/v0.1.0/Lattice_0.1.0_x64-setup.exe) |
| MSI 安装包 | ~7 MB | 企业部署 | [下载](https://github.com/tryandaction/lattice/releases/download/v0.1.0/Lattice_0.1.0_x64_en-US.msi) |

### macOS

| 安装包类型 | 大小 | 下载链接 |
|-----------|------|---------|
| DMG 镜像 | ~8 MB | [下载](https://github.com/tryandaction/lattice/releases/download/v0.1.0/Lattice_0.1.0_x64.dmg) |

### Linux

| 安装包类型 | 大小 | 适用系统 | 下载链接 |
|-----------|------|---------|---------|
| AppImage | ~7 MB | 所有发行版 | [下载](https://github.com/tryandaction/lattice/releases/download/v0.1.0/lattice_0.1.0_amd64.AppImage) |
| DEB 包 | ~7 MB | Debian/Ubuntu | [下载](https://github.com/tryandaction/lattice/releases/download/v0.1.0/lattice_0.1.0_amd64.deb) |

## 🌐 在线体验

不想下载？直接访问：**https://lattice-apq.pages.dev/**

## 🚀 桌面应用优势

| 特性 | 网页版 | 桌面版 |
|------|--------|--------|
| 启动速度 | 较慢 | ⚡ 快速 |
| 体积大小 | 无需下载 | 📦 仅 6-8 MB |
| 文件访问 | 需要授权 | ✅ 完整权限 |
| 默认文件夹 | ❌ | ✅ 支持 |
| 记住工作目录 | ❌ | ✅ 自动记忆 |
| 离线使用 | 有限 | ✅ 完全支持 |
| 内存占用 | 较高 | 💪 较低 |

## 📚 文档

- [安装指南](https://github.com/tryandaction/lattice/blob/main/INSTALLATION.md)
- [桌面功能说明](https://github.com/tryandaction/lattice/blob/main/docs/DESKTOP_FEATURES.md)
- [构建指南](https://github.com/tryandaction/lattice/blob/main/DESKTOP_APP.md)

## 🔧 技术栈

- **前端**: Next.js 15 + React 19 + TypeScript
- **桌面框架**: Tauri 2.0
- **状态管理**: Zustand + Jotai
- **编辑器**: Tiptap + CodeMirror 6 + MathLive
- **样式**: Tailwind CSS

## 📝 更新日志

### 新增功能

- 桌面应用默认文件夹设置
- 自动记住上次打开的文件夹
- 可视化设置界面（Ctrl+,）
- 网页版下载提醒弹窗

### 改进

- 优化 README 展示，添加明显的下载链接
- 修复 Tauri identifier 警告
- 添加完整的文档说明

### 技术更新

- 集成 `tauri-plugin-store` 用于持久化设置
- 添加 Tauri 命令接口
- 优化前端 Tauri 集成

## 🐛 已知问题

无重大已知问题。如果遇到问题，请查看 [故障排除文档](https://github.com/tryandaction/lattice/blob/main/INSTALLATION.md#-故障排除) 或提交 Issue。

## 🤝 贡献

欢迎贡献代码、报告问题或提出建议！

## 📄 许可证

MIT License

---

**感谢使用 Lattice！** 🎉

如果觉得有用，请给我们一个 ⭐ Star！
