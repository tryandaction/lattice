# Changelog

All notable changes to Lattice will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-02-12

### Phase 1: 代码质量与稳定性 (v0.4.0)

#### 安全
- **XSS防护**: 新增 `src/lib/sanitize.ts`，所有 `innerHTML` 赋值通过 DOMPurify 消毒
- **JSON.parse验证**: 注解解析增加 try-catch + 结构验证，解析失败不崩溃

#### 修复
- **KaTeX错误处理**: 替换静默 `.catch(() => {})` 为带日志的错误处理，加载失败显示 fallback
- **注解存储错误信息**: 错误消息包含实际错误信息和文件ID
- **Auto-open-folder**: Web模式通过 IndexedDB 持久化 FileSystemDirectoryHandle；Tauri模式使用 plugin-dialog
- **防抖保存**: 添加 `flushPendingSaves()` 方法，`beforeunload` 时确保注解已保存

#### 改进
- **生产日志策略**: 新增 `src/lib/logger.ts`，按环境过滤日志级别，迁移294条 console 语句
- **Tiptap死代码清理**: 删除8个未使用的 Tiptap 扩展文件，移除12个 `@tiptap/*` 依赖

### Phase 2: 插件系统扩展 (v0.5.0)

#### 新增
- **扩展点**: 新增 `ui:sidebar`、`ui:toolbar`、`ui:statusbar`、`editor:extensions`、`themes` 权限
- **工作区事件钩子**: `onFileOpen`、`onFileSave`、`onFileClose`、`onWorkspaceOpen`
- **UI插槽组件**: `PluginSidebarSlot`、`PluginToolbarSlot`、`PluginStatusBarSlot`
- **插件设置UI**: 设置对话框中新增"扩展"标签页，支持插件配置 schema
- **依赖解析**: 拓扑排序 + 循环依赖检测
- **6个内置插件**: word-count、table-of-contents、markdown-linter、code-formatter、template-library、citation-manager

### Phase 3: AI集成 (v0.6.0)

#### 新增
- **AI Provider接口**: 完整的 `AiProvider` 接口，支持流式生成、模型列表、token估算
- **4个AI Provider**: OpenAI、Anthropic、Google Gemini、Ollama（本地），全部使用原生 fetch + SSE
- **AI设置面板**: 设置对话框中新增"AI"标签页，API密钥管理、模型选择、温度调节
- **AI Chat侧边栏**: 可切换的右侧聊天面板，流式响应，对话历史，自动包含文件上下文
- **内联AI功能**: 选中文本后浮现菜单，支持摘要、翻译、解释公式、改写、续写、生成大纲
- **PDF AI面板**: 论文摘要、关键发现提取、论文问答
- **Notebook AI辅助**: 代码生成、错误解释、输出解读，集成到代码单元格
- **Context Builder增强**: 支持 selection 参数、多文件上下文、基于模型窗口的自动截断

---

## [0.3.0] - 2026-01-12

### Added

#### 📝 Live Preview 编辑器增强 (Obsidian 级别体验)
- ✨ **智能光标定位**：点击渲染内容时精确定位到源码位置
- ✨ **嵌套格式支持**：支持 `***粗斜体***` 和嵌套格式解析
- ✨ **语法过渡动画**：150ms 淡入淡出动画，平滑切换编辑/预览
- ✨ **活动行高亮**：Obsidian 风格的淡蓝色当前行高亮
- ✨ **代码块增强**：行号显示、语法高亮、复制按钮
- ✨ **表格编辑优化**：Tab 导航、自动列宽调整
- ✨ **数学公式错误处理**：语法错误时显示指示但保留源码

#### 📌 批注系统增强 (Zotero 级别体验)
- ✨ **批注搜索筛选**：按颜色、类型、关键词筛选批注
- ✨ **批注导出功能**：支持 Markdown、纯文本、JSON 格式导出
- ✨ **分组导出选项**：按页码、颜色、类型分组
- ✨ **单条批注复制**：一键复制批注到剪贴板
- ✨ **批注引用语法**：支持 `[[file.pdf#ann-uuid]]` 语法链接到批注
- ✨ **批注反向链接**：追踪笔记中的批注引用关系

#### ⌨️ 量子键盘优化
- ✨ **位置记忆**：记住用户拖动后的位置，下次打开时恢复
- ✨ **智能定位**：自动检测输入区域，定位到不遮挡的位置
- ✨ **活动 math-field 指示**：高亮当前活动的数学输入框

#### 🎨 主题和样式
- ✨ **批注链接样式**：琥珀色高亮的批注引用链接
- ✨ **数学错误样式**：增强的错误显示，包含错误指示器

### Changed

- 🔧 优化装饰器更新性能，添加防抖处理
- 🔧 优化大文档处理，使用 CodeMirror 内置虚拟化
- 🔧 优化渲染性能，添加行解析缓存

### Technical Details

#### 新增文件
- `src/lib/annotation-export.ts` - 批注导出工具
- `src/lib/annotation-backlinks.ts` - 批注反向链接服务
- `src/components/editor/codemirror/live-preview/types.ts` - 添加 `annotationlink` 类型

#### 更新文件
- `src/components/renderers/pdf-annotation-sidebar.tsx` - 添加搜索筛选功能
- `src/components/renderers/annotation-export-dialog.tsx` - 使用新的导出 API
- `src/components/editor/codemirror/live-preview/inline-decoration-plugin.ts` - 添加批注链接解析
- `src/components/editor/codemirror/live-preview/live-preview-theme.ts` - 添加批注链接样式
- `src/stores/hud-store.ts` - 添加位置持久化

---

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

- 系统托盘图标支持
- 自动更新功能
- 窗口状态保存/恢复
- 设置导出/导入

---

[1.0.0]: https://github.com/tryandaction/lattice/releases/tag/v1.0.0
[0.3.0]: https://github.com/tryandaction/lattice/releases/tag/v0.3.0
[0.2.0]: https://github.com/tryandaction/lattice/releases/tag/v0.2.0
[0.1.0]: https://github.com/tryandaction/lattice/releases/tag/v0.1.0
