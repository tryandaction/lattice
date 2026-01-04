# Changelog

All notable changes to Lattice will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-04

### Added

#### 桌面应用功能
- ✨ **默认文件夹设置**：支持设置默认工作目录，应用启动时自动打开
- ✨ **自动记忆功能**：自动记住上次打开的文件夹
- ✨ **可视化设置界面**：按 `Ctrl+,` 打开设置面板，管理默认文件夹
- ✨ **清除设置选项**：可以随时清除默认文件夹设置
- ✨ **Tauri 命令接口**：
  - `get_default_folder()` - 获取默认文件夹
  - `set_default_folder(folder)` - 设置默认文件夹
  - `get_last_opened_folder()` - 获取上次打开的文件夹
  - `set_last_opened_folder(folder)` - 保存上次打开的文件夹
  - `clear_default_folder()` - 清除默认文件夹

#### 网页版功能
- ✨ **下载提醒弹窗**：首次访问网页版时显示下载桌面应用的提醒
- ✨ **优势展示**：清晰展示桌面应用相比网页版的优势
- ✨ **不再显示选项**：用户可以选择不再显示下载提醒

#### 文档
- 📚 **桌面功能指南** (`docs/DESKTOP_FEATURES.md`)：详细的桌面应用功能使用说明
- 📚 **安装指南** (`INSTALLATION.md`)：完整的安装、更新和故障排除文档
- 📚 **发布模板** (`.github/RELEASE_TEMPLATE.md`)：标准化的发布说明模板
- 📚 **更新日志** (`CHANGELOG.md`)：记录所有版本变更

#### 开发工具
- 🛠️ **发布准备脚本**：
  - `scripts/prepare-release.sh` (Linux/macOS)
  - `scripts/prepare-release.bat` (Windows)
- 🛠️ **GitHub Actions 工作流** (`.github/workflows/release.yml`)：自动构建和发布

### Changed

#### README 优化
- 📝 重新组织 README 结构，将桌面应用下载链接放在最显眼位置
- 📝 添加桌面应用优势对比表格
- 📝 添加平台下载链接表格，包含文件大小信息
- 📝 更新文档链接，添加安装指南和桌面功能指南

#### 技术改进
- 🔧 修复 Tauri identifier 警告：从 `com.lattice.app` 改为 `com.lattice.editor`
- 🔧 集成 `tauri-plugin-store` 用于持久化用户设置
- 🔧 添加 Tauri 插件权限配置（fs, dialog, store）
- 🔧 优化前端 Tauri 集成，添加环境检测

### Fixed

- 🐛 修复 macOS 上的 Bundle identifier 冲突警告
- 🐛 修复桌面应用设置存储问题

### Technical Details

#### 新增依赖
- **前端**：
  - `@tauri-apps/plugin-store@^2.0.0` - 桌面应用设置存储

- **后端（Rust）**：
  - `tauri-plugin-store = "2"` - 持久化用户设置

#### 新增组件
- `src/hooks/use-tauri-settings.ts` - Tauri 设置管理 Hook
- `src/components/ui/download-app-dialog.tsx` - 下载应用提醒弹窗
- `src/components/ui/desktop-settings-dialog.tsx` - 桌面应用设置界面

#### 配置更新
- `src-tauri/tauri.conf.json` - 添加插件权限配置
- `src-tauri/Cargo.toml` - 添加 tauri-plugin-store 依赖
- `src-tauri/src/main.rs` - 实现设置管理命令

### Documentation

- 📖 [安装指南](./INSTALLATION.md) - 详细的安装和更新说明
- 📖 [桌面功能](./docs/DESKTOP_FEATURES.md) - 桌面应用独有功能说明
- 📖 [桌面应用打包](./DESKTOP_APP.md) - Tauri 桌面应用构建指南
- 📖 [发布模板](./.github/RELEASE_TEMPLATE.md) - GitHub Release 模板

### Migration Guide

如果你是从旧版本升级：

1. **桌面应用用户**：
   - 下载新版本安装包并安装
   - 你的设置会自动保留在新位置

2. **开发者**：
   ```bash
   # 拉取最新代码
   git pull origin main
   
   # 更新依赖
   npm install
   cd src-tauri
   cargo update
   cd ..
   
   # 重新构建
   npm run tauri:build
   ```

### Known Issues

无重大已知问题。如果遇到问题，请查看 [故障排除文档](./INSTALLATION.md#-故障排除)。

---

## [Unreleased]

### Planned Features

- 🔮 系统托盘图标支持
- 🔮 自动更新功能
- 🔮 多语言支持
- 🔮 自定义主题
- 🔮 插件系统

---

[0.1.0]: https://github.com/tryandaction/lattice/releases/tag/v0.1.0
