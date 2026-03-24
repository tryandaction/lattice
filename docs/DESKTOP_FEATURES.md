# Lattice 桌面应用功能指南

## 桌面能力总览

### 1. 首次启动引导

首次启动应用时，会显示引导向导帮助你完成初始设置：

1. **欢迎页面**：介绍 Lattice 格致
2. **语言选择**：选择简体中文或英文
3. **主题选择**：选择浅色、深色或跟随系统
4. **默认文件夹**：设置默认工作目录

你可以随时跳过引导，也可以在设置中重新开始引导。

### 2. 多语言支持

- **支持语言**：简体中文、English
- **切换方式**：设置 → 通用 → 语言
- **即时生效**：切换后立即生效，无需重启
- **系统检测**：首次启动自动检测系统语言

### 3. 主题系统

- **浅色模式**：明亮的界面，适合白天使用
- **深色模式**：护眼的暗色界面，适合夜间使用
- **跟随系统**：自动跟随操作系统的主题设置
- **快捷切换**：`Ctrl+Shift+T` 快速切换主题

### 4. 默认文件夹设置

桌面应用支持设置默认工作文件夹，启动时自动打开该文件夹。

#### 如何设置

**方式一：通过设置面板**
1. 打开设置
2. 选择默认工作文件夹
3. 保存设置

**方式二：使用快捷键**
- 按 `Ctrl+,`（Windows/Linux）或 `Cmd+,`（macOS）打开设置
- 按照上述步骤设置

#### 功能说明

- **默认文件夹**：你手动固定的工作目录，作为恢复失败时的回退
- **上次打开的文件夹**：自动记录的最近工作区，桌面端启动时优先恢复
- **清除设置**：点击垃圾桶图标可以清除默认文件夹设置

### 5. 自动记住工作目录

应用会自动记住你上次打开的文件夹，下次启动时可以快速恢复工作状态。

### 6. 更好的文件系统访问

桌面应用拥有完整的文件系统访问权限，无需每次都授权。

### 7. 本地代码运行工作台 v1

桌面版现在默认优先走本地运行器，而不是浏览器内的 Pyodide。

#### 当前支持

- **Python 本地运行优先**：自动发现系统 Python、项目内 `.venv`、激活的 `venv` / `conda`
- **工作区运行器记忆**：会按 workspace 路径记住默认 Python 和最近一次运行选择，重启后继续恢复
- **Notebook 持久会话**：同一个 Notebook 中的 Python 单元格会复用本地会话，变量可跨单元保留
- **代码文件运行**：支持运行当前 `.py` 文件，并统一展示标准输出、错误输出、图片和 HTML 表格等结果
- **Markdown 代码块运行**：支持在工作区 Markdown 文件中直接运行 `python/js/r/julia` 代码块
- **外部命令运行**：支持通过外部命令运行 `.js/.mjs/.cjs`、`.jl`、`.R`
- **运行诊断**：外部命令缺失或本地 Python 未检测到时，会直接显示诊断与修复提示
- **Runner Manager**：Notebook、代码文件和 Markdown 编辑主链路现在都可以打开统一的 Workspace Runner Manager，查看解释器、切换工作区默认、恢复自动选择
- **来源标签**：执行反馈会标出当前运行器来自“当前入口选择 / 工作区默认 / 自动探测 / 回退”
- **Notebook 启动验证**：`Runner Diagnostics` 和 `Workspace Runner Manager` 都支持显式验证本地 Notebook Python 会话启动链路
- **Problems 分层**：代码文件、Notebook code cell、Markdown code block 现在把 Run 输出与 Problems 拆层展示，语法问题、运行前诊断、运行时错误和 runner health 使用同一问题模型
- **降级策略**：桌面端无本地 Python 时，只会把 Pyodide 作为“应急回退”显式展示；网页版继续以 Pyodide 为主

#### 当前不在本阶段范围

- 调试断点
- 调用栈
- LSP 补全 / hover
- 远程 kernel 管理

### 8. 外部链接与工作区深链

桌面应用会区分外部网址和工作区内部资源：

- 外部网页链接使用系统默认浏览器打开，不覆盖当前应用窗口
- 工作区文件链接继续在应用内打开
- 支持 PDF 页码、PDF 批注、Markdown 标题、代码行、Notebook 单元格的深链跳转

示例：

- `https://example.com`
- `papers/math.pdf#page=12`
- `[[papers/math.pdf#ann-123]]`
- `src/main.py#line=88`
- `analysis.ipynb#cell=cell-42`

### 9. 更顺滑的资源管理

最新版本的文件树交互已经补齐为更接近日常 IDE 的行为：

- 新建文件或文件夹后立即进入重命名
- 支持文件和文件夹的复制、剪切、粘贴
- 支持拖放移动文件和文件夹
- 目录重命名或移动后，已打开的标签路径会自动同步
- 刷新文件树后会保留原有展开状态

### 10. Markdown 成品导出

桌面版现在可以直接从 Markdown 编辑器顶栏导出成品文档，而不需要额外脚本。

#### 当前支持

- 直接导出 `.docx`
- 直接导出 `.pdf`
- 导出前支持标题配置与实时预览
- 支持 `clean` / `appendix` / `study-note` 三种标注策略
- 支持“文档版式”与“当前渲染视图”两种导出视觉模式
- 导出时尽量保留标题层级、列表、表格、代码块、引用块和公式渲染
- 当前文件若已有侧车标注，可在导出时一并带出并保留来源定位

#### 桌面版体验说明

- 保存目标路径走系统原生保存对话框
- 成功导出后可继续使用“在文件夹中显示”跳转到产物位置
- `.pdf` 更贴近应用内阅读效果，适合分享定稿
- `.docx` 更适合继续传阅和整理

### 11. 分屏阅读稳定性深化

桌面版当前已补强多 pane 阅读区的作用域与状态恢复：

- 分屏后 pane 宽度收缩时，阅读内容不会再把右侧区域挤出屏幕
- PDF 首次打开默认会以 `适宽` 方式填充当前阅读区域
- PDF 的 `Ctrl+滚轮`、缩放快捷键和适宽/适页操作只对当前 pane 生效
- 只要没有翻页，PDF 在缩放和窗口尺寸变化时会尽量保持当前阅读位置
- 切到其他已打开文件后再切回，PDF 阅读进度和缩放状态会在当前窗口会话内继续保留
- 桌面端现在提供 `/diagnostics/pdf-regression`，用于复检双分屏布局、缩放作用域和切文件恢复
- 桌面端现在提供 `/diagnostics/image-annotation`，用于复检真实 workspace handle 的图片标注链路
- 桌面端现在提供 `/diagnostics/selection-ai`，用于复检 Selection AI 三种模式的主链路落点
- 桌面端现在提供 `/diagnostics/runner`，用于复检 Python 解释器探测、外部命令探测和缺失依赖修复建议

### 12. PDF 条目工作区 v2

桌面端现在把 PDF 提升成“带工作区的条目”，不再只是一个孤立阅读文件。

#### 当前能力

- 首次在 Lattice 中打开 PDF 时，会自动建立同级隐藏兄弟目录 `.basename.lattice/`
- 隐藏目录内固定包含：
  - `manifest.json`
  - `_overview.md`
  - `_annotations.md`
- Explorer 会隐藏真实目录，并把这些文件投影到 PDF 条目下面
- PDF 条目右键可直接：
  - 打开概览
  - 新建阅读笔记
  - 新建 Notebook
  - 重建批注索引
- PDF 批注 sidecar 已改为稳定 `itemId` 存储，PDF 重命名/移动/复制/删除时会伴随处理
- `_annotations.md` 会自动镜像 PDF 批注，并支持 `#page=`、`#annotation=` 深链
- 批注评论、阅读笔记、Notebook Markdown 中的内部链接会继续在应用内打开
- 批注反链已接入：如果某条批注在笔记中被引用，PDF 批注侧栏可以显示并跳回来源笔记

## 🌐 网页版 vs 桌面版

| 特性 | 网页版 | 桌面版 |
|------|--------|--------|
| 启动速度 | 较慢（需要加载浏览器） | 快速（原生应用） |
| 体积大小 | 无需下载 | ~6-8 MB |
| 文件访问 | 需要每次授权 | 完整权限 |
| 默认文件夹 | 基础（句柄授权后可恢复） | ✅ |
| 记住工作目录 | 基础（IndexedDB 句柄恢复） | ✅ |
| Python 运行 | Pyodide | 本地 Python 优先，Pyodide 降级 |
| Notebook 变量持久化 | 浏览器会话内 | 本地持久 Python 会话 |
| 运行器偏好记忆 | 基础 | 工作区级跨重启记忆 |
| 外部链接打开 | 可能留在当前标签页 | 系统浏览器打开 |
| 资源拖放/剪贴板操作 | 受浏览器限制 | 完整支持 |
| Markdown 成品导出 | 浏览器下载/文件选择器 | 原生保存对话框 + 文件夹定位 |
| 离线使用 | 有限支持 | 完全支持 |
| 内存占用 | 较高（浏览器开销） | 较低（原生应用） |

## 💡 使用技巧

### 快捷键

- `Ctrl+B` / `Cmd+B`：切换侧边栏
- `Ctrl+,` / `Cmd+,`：打开设置
- `Ctrl+Shift+T` / `Cmd+Shift+T`：切换主题
- `F2`：重命名文件树中当前选中项
- `Ctrl/Cmd + C / X / V`：复制、剪切、粘贴文件树选中项

### 首次使用建议

1. **设置默认文件夹**：将你的常用工作目录设置为默认文件夹
2. **创建快捷方式**：将应用固定到任务栏或 Dock，方便快速启动
3. **关闭浏览器**：使用桌面应用后可以关闭浏览器，节省系统资源

## 🔧 技术实现

### 数据存储

桌面应用使用 `tauri-plugin-store` 插件来持久化用户设置：

- **存储位置**：
  - Windows: `%APPDATA%\com.lattice.editor\settings.json`
  - macOS: `~/Library/Application Support/com.lattice.editor/settings.json`
  - Linux: `~/.config/com.lattice.editor/settings.json`

- **存储内容**：
  ```json
  {
    "default_folder": "/path/to/your/folder",
    "last_opened_folder": "/path/to/last/folder"
  }
  ```

### API 接口

桌面应用提供以下 Tauri 命令：

- `get_default_folder()`: 获取默认文件夹
- `set_default_folder(folder: string)`: 设置默认文件夹
- `get_last_opened_folder()`: 获取上次打开的文件夹
- `set_last_opened_folder(folder: string)`: 保存上次打开的文件夹
- `clear_default_folder()`: 清除默认文件夹设置
- `detect_python_environments(cwd?)`: 发现本地 Python 解释器
- `probe_command_availability(command)`: 探测外部命令是否可用
- `start_local_execution(request)`: 启动一次性本地运行
- `terminate_local_execution(sessionId)`: 终止一次性本地运行
- `start_python_session(request)`: 启动持久 Python 会话
- `execute_python_session(request)`: 向持久 Python 会话发送单元代码
- `stop_python_session(sessionId)`: 停止持久 Python 会话

## 🚀 下载与安装

### Windows

推荐使用 NSIS 安装包（更现代的安装体验）：

```bash
# 下载并运行
Lattice_2.1.0_x64-setup.exe
```

或使用 MSI 安装包（适合企业部署）：

```bash
# 下载并运行
Lattice_2.1.0_x64_en-US.msi
```

### macOS

```bash
# 当前仓库发布目录暂未提供 macOS 产物
# 以实际 Release 页面为准
```

### Linux

**AppImage（推荐）**：

```bash
# 当前仓库发布目录暂未提供 Linux AppImage 产物
# 以实际 Release 页面为准
```

**DEB 包**：

```bash
# 当前仓库发布目录暂未提供 Linux DEB 产物
# 以实际 Release 页面为准
```

## 📝 常见问题

### Q: 如何更改默认文件夹？

A: 打开设置（Ctrl+,），选择新的文件夹并保存即可。

### Q: 默认文件夹和上次打开的文件夹有什么区别？

A: 
- **默认文件夹**：你手动设置的固定文件夹，作为恢复失败时的回退
- **上次打开的文件夹**：应用自动记录的最后一次打开的工作区，启动时优先恢复

当前桌面端默认优先恢复“上次打开的文件夹”；如果最近工作区失效，才回退到默认文件夹。

### Q: 如何重置所有设置？

A: 删除设置文件即可：
- Windows: `%APPDATA%\com.lattice.editor\settings.json`
- macOS: `~/Library/Application Support/com.lattice.editor/settings.json`
- Linux: `~/.config/com.lattice.editor/settings.json`

### Q: 桌面应用和网页版可以同时使用吗？

A: 可以，它们是独立的。但建议使用桌面应用以获得更好的体验。

## 🔄 更新日志

### v2.1.0 阶段收尾补充 (2026-03-21)

- ✅ 桌面端默认优先使用本地 Python 运行器
- ✅ Notebook 单元支持复用同一个本地 Python 会话
- ✅ 统一运行事件流覆盖代码文件、Notebook 与 Markdown 代码块
- ✅ 统一 Problems 模型覆盖代码文件、Notebook code cell 与 Markdown code block
- ✅ Workspace Runner Manager 与 Runner Diagnostics 已进入桌面主链路
- ✅ 支持 Python、Node、Julia、Rscript 的最小通用桌面运行能力
- ✅ QA 门禁补齐为 `lint` / `typecheck` / `test:run` / `test:browser-regression` / `build` / `tauri:build`

### v2.1.0 体验收口补充 (2026-03-24)

- ✅ 桌面端启动后优先恢复最近打开的工作区，不再每次重新选目录
- ✅ PDF 文本选区复制优先级收口为“原生选区 > transient overlay”
- ✅ PDF 左栏已收紧为紧凑工具头 + 主批注工作区
- ✅ Markdown 阅读态与系统索引页继续收紧，frontmatter 默认隐藏

### v2.0.0 (2026-03-14)

- ✅ 外部网页链接改为系统浏览器打开
- ✅ 支持 PDF 页码、PDF 批注、Markdown 标题、代码行、Notebook 单元格深链
- ✅ 修复 PDF 缩放或适宽时视图跳回第一页
- ✅ 调整 PDF 文本选区颜色，适配浅色与深色主题
- ✅ 文件树支持复制、剪切、粘贴、拖放移动
- ✅ 新建文件/文件夹后自动进入重命名
- ✅ 目录移动或重命名后自动同步已打开标签路径
- ✅ 文件树刷新后保留展开状态

### v0.2.0 (2026-01-04)

- ✅ 添加多语言支持（简体中文、英文）
- ✅ 添加主题系统（浅色、深色、跟随系统）
- ✅ 添加首次启动引导向导
- ✅ 添加全局设置界面
- ✅ 添加文件导出增强功能
- ✅ 添加导出成功通知和"在文件夹中显示"功能
- ✅ 批注侧边栏移至左侧
- ✅ 暗色模式下文件预览保持白色背景

### v0.1.0 (2026-01-04)

- ✅ 添加默认文件夹设置功能
- ✅ 自动记住上次打开的文件夹
- ✅ 添加设置界面（Ctrl+,）
- ✅ 网页版添加下载应用提醒
- ✅ 优化 README 下载链接展示

## 🎨 界面预览

### 设置界面

设置界面提供以下功能：
- 查看当前默认文件夹
- 设置新的默认文件夹
- 查看上次打开的文件夹
- 清除默认文件夹设置

### 下载提醒（网页版）

首次访问网页版时，会显示下载桌面应用的提醒，说明桌面应用的优势：
- 启动更快，体积更小
- 记住工作目录
- 原生窗口体验

用户可以选择"不再显示"来关闭提醒。

## 🤝 反馈与建议

如果你有任何问题或建议，欢迎：
- 提交 GitHub Issue
- 发送邮件反馈
- 参与社区讨论

---

**享受更高效的编辑体验！** 🚀
