# Lattice 桌面应用功能指南

## 桌面能力总览

### VS Code 原生代码调试（2026-07-20）

桌面端的 VS Code 工具现在包含一个固定的“运行和调试”左侧工具。对于
Python `launch` 配置，Lattice 会直接管理本地 `debugpy.adapter` DAP 会话，
支持断点、继续/暂停、单步、调用栈、作用域、变量、选中栈帧求值和有界输出。
代码文件仍在 Lattice 自己的 CodeMirror 编辑器中打开，并显示 VS Code 风格
断点标记和当前帧高亮，不需要用户再次在另一个 VS Code 窗口中打开文件夹。

Local `node` / `pwa-node` program launches now use the pinned Microsoft
vscode-js-debug 1.117.0 server with the same native breakpoint, stack, variable,
evaluation, and control surface. Remote attach, browser/terminal launches,
child/worker debugging, advanced breakpoints, and arbitrary extension-provided
debug adapters remain unsupported and are shown truthfully in the interface.

### VS Code 插件代码能力桥接（2026-07-21）

本地导入、具有桌面 `main` 入口并能在受支持 Host API 上注册语言 Provider
的 VS Code 插件，现在可以直接作用于 Lattice 的 CodeMirror 代码编辑器。
已接入补全、悬停、跳转定义、诊断、查找引用、格式化、当前文件重命名和
当前文件快速修复。打开代码文件会立即显示内容，匹配语言的插件在后台去重
预热；Provider 超时或异常只影响该插件，不会冻结编辑器。

重命名和快速修复若包含跨文件 WorkspaceEdit 会明确拒绝，避免只应用部分
修改。依赖 `vscode-languageclient`、Pylance、Rust Analyzer、ESLint server、
Volar、终端或远程服务的扩展仍需后续 LSP/服务进程适配，不能因为扩展图标或
清单可见就视为已经可用。

### VS Code 风格 Notebook 与扩展激活（2026-07-21）

可编辑 `.ipynb` 现在使用固定的运行工具栏集中显示全部运行、停止、重启内核、
添加代码/Markdown 单元、运行环境管理和内核选择。当前解释器路径、环境来源、
验证状态和单元格数量持续可见；代码单元使用左侧运行 gutter、执行计数、方形
编辑边界以及对齐的 Problems/Output 区域，不再把每个部分包装成独立卡片。

活动代码单元会作为工作区内的版本化虚拟文档同步到 Extension Host，因此能够
使用已兼容插件提供的补全、悬停和诊断。为避免同时同步整本 Notebook 导致卡顿，
只有活动代码单元建立该实时桥接。

扩展侧栏把具有桌面入口的“可运行扩展”和仅导入设置/主题/贡献元数据的项目分开。
可运行扩展支持直接激活和失败后重试，只有 Host 返回 `active` 才表示它已实际运行。
依赖未实现 API 或外部语言服务器的扩展仍可能失败，界面会显示具体错误和缺失 API。

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

### 6.1 桌面壳层与工作区入口

桌面端当前已经收口为更接近专业工作台的壳层结构：

- **顶栏**：只负责应用身份、工作区入口、breadcrumb、全局动作和窗口控制
- **左侧活动栏**：只负责 `文件 / 搜索 / 批注 / AI Chat`
- **Explorer**：只负责工作区浏览与文件树，不再承担重复壳层职责

当前顶部工作台行为：

- breadcrumb 只显示工作区根目录内的相对路径
- 根目录名称只出现在工作区入口，不再在 breadcrumb 中重复出现
- 当前文件常用操作以固定图标工具栏呈现
- 如动作数量超出主工具栏宽度，次级动作会进入 `更多操作` 菜单，而不是通过横向滑条暴露
- 标题栏主区域现在支持直接用鼠标拖动窗口，不再只依赖极窄的顶部拖动条
- 窗口四周的 invisible resize hit area 已加宽，四边和四角都可直接用鼠标调整窗口大小

### 6.3 桌面弹窗适配

桌面端主要弹窗和面板现在统一遵循更稳定的布局约束：

- 弹窗层级会覆盖标题栏，不再被顶部 Command Bar 压住
- 弹窗主体默认有最大高度限制，避免超出窗口后顶部或底部被裁切
- 内容较多时，主体区会独立滚动，而不是把底部操作区一起挤出可视范围
- 带预览区的弹窗会优先保证预览区域的最小可视高度，减少“预览只剩一小块”的问题

当前入口语义：

- **无工作区时**：主阅读区欢迎页保留唯一明显主 CTA
- **已有工作区时**：切换工作区统一从顶部工作区入口进入
- **设置页 FolderSelector**：只用于管理默认文件夹和最近工作区，不再承担桌面壳层主入口

### 6.2 AI Chat 右侧专业集成

桌面端 AI Chat 现在作为真正的右侧停靠面板集成到 Workbench：

- 从右侧展开，与主阅读区和 Plugin Panel 处于同一布局组
- 支持面板宽度记忆和打开状态记忆
- 关闭后会尽量把焦点还给触发它的壳层按钮
- 左侧活动栏 Bot 和命令面板命令会操作同一个右侧 AI panel

当前上下文策略：

- 普通 chat 不再根据自然语言 query 隐式检索整个工作区
- 默认不会自动把当前文件全文和全部批注塞进上下文
- 只有显式 `@引用`、Selection AI、Evidence 操作，以及 Prompt Run 里主动勾选的上下文才会带入更重的内容
- Chat Prompt Run 里的 `当前文件全文 / 当前文件批注 / 工作区摘要` 现在都是显式开关，且默认关闭

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

### 7.1 代码工作台兼容 VS Code 配置

VS Code 活动栏中的源代码管理现已支持本地 Git 闭环：识别真实仓库根目录与分支领先/落后状态，分组显示冲突、已暂存和工作区更改，可在 Lattice 内打开文件、查看有上限的差异、暂存/取消暂存单项或全部更改，并在明确确认后创建本地提交。Git 只通过桌面端白名单命令直接执行，不经过 shell；当前不提供 push/pull、discard/reset、分支改写、merge/rebase 或凭据操作。

桌面端现在支持导入常见 VS Code 工作区配置，并把它们映射到 Lattice 的代码编辑体验：

- `settings.json`
- `keybindings.json`
- `snippets`
- `tasks.json`
- `.vscode/extensions.json` 推荐扩展
- 本机已安装扩展清单
- 已安装扩展的语言、snippet、命令、视图、菜单、Notebook、Notebook renderer、grammar、theme、调试器和配置贡献

使用方式：

1. 打开 `Settings / 设置`。
2. 进入 `Files / 文件`。
3. 点击 `Import from VS Code / 一键导入`。
4. 等待 Lattice 自动扫描本机 VS Code / VS Code Insiders 的标准配置目录。
5. 导入成功后，兼容配置会自动启用；之后打开任意文件夹时，代码工作台会使用已导入的 VS Code 系配置。

普通用户不需要上传 JSON，也不需要选择 VS Code 配置目录。`Reset / 重置` 会清空已导入配置并关闭兼容配置。

导入后设置页会直接展示配置来源、导入时间、当前 VS Code 主题、扩展数量、任务数量、代码片段数量、文件关联数量、扩展贡献语言/命令/视图/Notebook/grammar/theme/调试器数量和已识别扩展。打开可执行代码文件或 `.ipynb` 时，内容区仍保持 Lattice 的原生编辑、Notebook 和输出体验，不出现 `VS Code Takeover / VS Code 接管` 顶部条。兼容模式会在专用 VS Code 活动栏中显示已注册的 Host 命令、视图与扩展生命周期；清单贡献只作为发现和按需激活元数据，不会被当作已经可运行的功能。扩展失败会显示扩展 ID、错误和缺失的 VS Code API；PDF、Markdown、图片、批注、AI 和子文档工作流不受影响。Run & Tasks 面板会把导入任务分成默认、构建、测试和其他任务。

导入后会影响：

- 编辑器选项
- 文件关联与语言识别
- Explorer 排除
- 工作区搜索排除
- 代码片段补全
- VS Code task 执行，输出进入 Lattice Run 面板
- `.vscode/launch.json` 运行配置导入，并在代码工作台 `Run & Tasks` 面板里显示可执行 launch 项
- `workbench.colorTheme` 识别和已安装扩展的 theme 贡献展示
- 已映射 VS Code 工作台命令可跳转到对应 Lattice 面板；扩展私有命令只在 Host 实际注册后进入活动栏和命令面板
- 扩展能力按可运行、命令、视图、调试、Notebook、grammar/theme 与纯清单分类，并明确区分清单发现与 Host 注册态
- 兼容诊断显示扩展激活中、失败、缺少 VS Code API 或尚未注册入口的真实原因
- VS Code tasks 按默认、构建、测试和其他任务分组，并标记默认任务
- 可执行代码文件和 `.ipynb` 的 VS Code 风格活动栏与插件/运行/Notebook 侧边面板
- 可执行代码文件和 `.ipynb` 的 VS Code 专用活动栏与本机 VS Code 打开入口，不覆盖内容区的原生界面
- 只读代码浏览和只读 `.ipynb` 保持 Lattice 原生阅读体验，同时向 Host 发送语言或 Notebook 激活事件
- `.ipynb` 的 kernel/runtime/cell/problems 状态，以及可用时的 `Run All Cells / 运行全部单元`
- 扩展/插件清单、名称、版本、分类和能力映射状态
- 已安装扩展贡献的文件关联、snippet JSON、commands、views、menus、notebooks、notebook renderers、grammars 和 themes
- 桌面端 `Extension Host / 扩展宿主`：会为带 `main` 入口的已导入 VS Code 扩展启动受限宿主，并仅把实际注册的命令和视图接入 Lattice；Python 代码与 `.ipynb` 会触发对应的按需激活事件
- 宿主当前已补到 P0.5：支持 `workspace.getConfiguration()`、`workspace.fs`、`workspace.openTextDocument()`、`workspace.findFiles()`、`window.showTextDocument()`、`extensions.getExtension/all`、`Disposable`、`EventEmitter`，并支持 `onStartupFinished`

完整设计边界见 `docs/VS_CODE_COMPATIBILITY_PLAN.md`。

这层兼容只服务于代码工作台体验，Lattice 的主场能力仍然优先保留给 PDF、Markdown、HTML、批注、公式、链接跳转、AI 和子文档体系。

#### 当前不在本阶段范围

- 调试断点
- 调用栈
- 完整 VS Code Extension Host API（当前仅实现受限的命令激活/执行桥接）
- 远程 extension host / remote kernel 管理

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

- 首次在 Lattice 中打开 PDF 时，会自动在工作区根目录建立 `.lattice/items/<fileId>/`
- 隐藏目录内容包括：
  - `manifest.json`
  - 用户创建的 `*.md` / `*.ipynb`
  - `_annotations.md`（仅在产生第一条 PDF 批注后惰性生成）
- Explorer 会隐藏真实目录，并把真实用户文件与惰性 `_annotations.md` 投影到 PDF 条目下面
- PDF 条目右键可直接：
  - 新建笔记
  - 新建 Notebook
  - 在 Explorer 定位
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
Lattice_2.3.0_x64-setup.exe
```

或使用 MSI 安装包（适合企业部署）：

```bash
# 下载并运行
Lattice_2.3.0_x64_en-US.msi
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
