# Changelog

All notable changes to Lattice will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-01-04

### Added

#### 🌍 国际化支持
- ✨ **多语言系统**：完整的 i18n 支持，目前支持简体中文和英文
- ✨ **语言选择器**：在设置中切换语言，立即生效无需重启
- ✨ **系统语言检测**：首次启动自动检测系统语言
- ✨ **日期/数字格式化**：根据语言区域自动格式化日期和数字

#### 🎨 主题系统
- ✨ **三种主题模式**：浅色、深色、跟随系统
- ✨ **主题选择器**：可视化主题切换，实时预览
- ✨ **系统主题跟随**：自动响应系统主题变化
- ✨ **暗色模式优化**：文件预览保持白色背景，提升可读性
- ✨ **快捷键切换**：`Ctrl+Shift+T` 快速切换主题

#### 🚀 首次启动引导
- ✨ **引导向导**：首次启动显示欢迎引导
- ✨ **步骤式设置**：语言 → 主题 → 默认文件夹
- ✨ **跳过选项**：可随时跳过引导
- ✨ **重新引导**：设置中可重新开始引导

#### ⚙️ 全局设置界面
- ✨ **设置对话框**：按 `Ctrl+,` 打开设置
- ✨ **分区设计**：通用、外观、文件、快捷键、关于
- ✨ **即时生效**：设置更改立即生效
- ✨ **持久化存储**：设置自动保存到 localStorage

#### 📁 文件导出增强
- ✨ **导出适配器**：统一的导出接口，支持 Web 和桌面
- ✨ **原生保存对话框**：桌面版使用 Tauri 原生对话框
- ✨ **导出通知**：成功/失败通知，含"在文件夹中显示"按钮
- ✨ **防重复导出**：防止同一文件的多次同时导出
- ✨ **Web 降级处理**：使用 File System Access API 或默认下载

#### 🖥️ 桌面应用增强
- ✨ **默认文件夹设置**：支持设置默认工作目录，应用启动时自动打开
- ✨ **自动记忆功能**：自动记住上次打开的文件夹
- ✨ **文件夹验证**：检测默认文件夹是否存在，不存在时提示重新选择
- ✨ **坐标适配器**：弹出菜单自动适配窗口边界

#### 🏗️ 基础设施
- ✨ **存储适配器**：统一的存储接口，支持 Web 和 Tauri
- ✨ **设置状态管理**：Zustand store 管理全局设置
- ✨ **类型定义**：完整的 TypeScript 类型支持

### Changed

- 📝 批注侧边栏移至 PDF 查看器左侧
- 📝 侧边栏从左侧滑入/滑出动画
- 🔧 修复 flushSync 警告 (advanced-markdown-editor.tsx)

### Technical Details

#### 新增文件
- `src/lib/i18n/` - 国际化系统
- `src/lib/storage-adapter.ts` - 存储适配器
- `src/lib/export-adapter.ts` - 导出适配器
- `src/lib/coordinate-adapter.ts` - 坐标适配器
- `src/stores/settings-store.ts` - 设置状态管理
- `src/types/settings.ts` - 设置类型定义
- `src/hooks/use-theme.ts` - 主题 Hook
- `src/hooks/use-i18n.ts` - 国际化 Hook
- `src/hooks/use-auto-open-folder.ts` - 自动打开文件夹 Hook
- `src/components/settings/` - 设置组件
- `src/components/onboarding/` - 引导向导组件
- `src/components/ui/export-toast.tsx` - 导出通知组件

---

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
- 🔮 窗口状态保存/恢复
- 🔮 设置导出/导入
- 🔮 自定义快捷键
- 🔮 插件系统

---

[0.2.0]: https://github.com/tryandaction/lattice/releases/tag/v0.2.0
[0.1.0]: https://github.com/tryandaction/lattice/releases/tag/v0.1.0
