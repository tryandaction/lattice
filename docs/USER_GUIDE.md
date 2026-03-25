# Lattice 格致 - 用户指南

> 本地优先的科研工作台，专为论文阅读、笔记和代码编辑设计

---

## 目录

1. [快速开始](#快速开始)
2. [核心功能](#核心功能)
3. [PDF 阅读与批注](#pdf-阅读与批注)
4. [Markdown 编辑](#markdown-编辑)
5. [手写笔记](#手写笔记)
6. [代码与 Notebook](#代码与-notebook)
7. [文件管理](#文件管理)
8. [快捷键](#快捷键)
9. [常见问题](#常见问题)

---

## 快速开始

### 安装

**桌面应用（推荐）**

| 平台 | 下载 | 大小 |
|------|------|------|
| Windows | [下载安装包](https://github.com/tryandaction/lattice/releases/latest) | ~6 MB |
| macOS | 即将推出 | - |
| Linux | 即将推出 | - |

**Android 平板/手机**

1. 用 Chrome 浏览器访问 https://lattice-apq.pages.dev/
2. 点击弹出的「安装」提示，或点击菜单 → 「添加到主屏幕」
3. 从主屏幕启动，获得全屏 App 体验
4. 支持完整的文件夹访问和编辑功能

**在线版**

直接访问：https://lattice-apq.pages.dev/

### 首次使用

1. 启动应用
2. 点击「Open Local Folder」选择工作目录
3. 在文件树中双击文件打开
4. 开始阅读、编辑或批注

补充说明：
- 桌面版会优先恢复你上次打开的工作区，通常不需要每次重启都重新选择文件夹
- 网页版在浏览器仍保有目录句柄授权时，也会尽量恢复上次工作区

---

## 核心功能

### 支持的文件格式

| 格式 | 功能 |
|------|------|
| **PDF** | 阅读、高亮、区域选择、文字批注、评论 |
| **Markdown** | 实时预览编辑、Wiki 链接、大纲导航 |
| **手写笔记** (.ink) | 手写绘图、多种笔刷、图层管理 |
| **Jupyter Notebook** | 查看、编辑、运行 Python 代码 |
| **PowerPoint** | 幻灯片预览 |
| **Word** | 文档预览 |
| **图片** | PNG, JPG, GIF, SVG 等 |
| **代码** | 语法高亮、多语言支持 |

### 界面布局

```
┌─────────────────────────────────────────────────────────┐
│  [文件] [编辑] [视图]                    [设置] [帮助]  │
├──────────┬──────────────────────────────────────────────┤
│          │  [标签页1] [标签页2] [+]                     │
│  文件树  │ ┌──────────────────────────────────────────┐ │
│          │ │                                          │ │
│  📁 项目 │ │              主编辑区域                   │ │
│  ├─ 📄   │ │                                          │ │
│  ├─ 📄   │ │                                          │ │
│  └─ 📁   │ │                                          │ │
│          │ └──────────────────────────────────────────┘ │
└──────────┴──────────────────────────────────────────────┘
```

补充说明：

- 桌面端侧边栏折叠后，会保留一个窄的 Explorer 导航轨
- 这个窄栏现在会真实参与布局，不再覆盖右侧文件标签栏和阅读区
- 在不同桌面宽度下，折叠栏会尽量保持接近固定的窄宽度，减少忽宽忽窄的感觉

---

## PDF 阅读与批注

### 工具栏

| 工具 | 图标 | 功能 |
|------|------|------|
| 选择 | 🖱️ | 点击批注进行编辑 |
| 高亮 | 🖍️ | 选中文字添加高亮 |
| 区域 | ⬜ | 框选区域添加标记 |
| 文字 | T | 点击添加文字批注 |

### 高亮文本

1. 切换到「高亮」模式
2. 用鼠标选中要高亮的文字
3. 选择高亮颜色
4. 点击高亮区域可添加评论

补充说明：
- 选中文本后，Lattice 会尽量用自己的临时高亮反馈替代浏览器原生蓝选区
- 只有在需要切换到 Lattice 自己的 transient overlay 时，才会清理原生蓝选区，减少拖选手感断裂
- `Ctrl+C / Cmd+C` 会优先复制当前 PDF 原生文本选区，其次才回退到临时选区

### 区域选择

1. 切换到「区域」模式（或按住 Alt 键）
2. 拖动鼠标框选区域
3. 选择标记颜色
4. 可添加评论说明

### 文字批注

1. 切换到「文字」模式
2. 在页面上点击要添加批注的位置
3. 输入批注内容
4. 可调整颜色、字号

### 缩放控制

| 操作 | 快捷键 |
|------|--------|
| 放大 | Ctrl + + |
| 缩小 | Ctrl + - |
| 重置 | Ctrl + 0 |
| 滚轮缩放 | Ctrl + 滚轮 |

补充说明：
- PDF 首次打开默认会以 `适宽` 方式填充当前阅读区，减少手动调缩放的初始操作
- 在 PDF 中切换放大、缩小、适宽时，阅读位置会尽量保持在当前视口附近，不会再自动跳回第一页
- 文字选择高亮使用更自然的淡蓝色，并适配浅色/深色主题
- 在分屏模式下，鼠标位于哪个 PDF pane，`Ctrl+滚轮` 与缩放快捷键就只作用于哪个 pane
- 只要窗口未关闭，切换到其他已打开文件再切回，PDF 会尽量恢复之前的阅读进度与缩放状态

### PDF 条目工作区

Lattice 现在把单个 PDF 提升成一个可扩展的“条目工作区”，而不是只把它当成一个孤立阅读文件。

你现在可以直接在 PDF 左侧条目区执行这些动作：

- 建立 PDF 对应的 companion item folder
- 首次打开时自动建立 PDF 对应的隐藏兄弟条目目录
- 新建 `Markdown` 阅读笔记
- 新建 `Notebook (.ipynb)`
- 把当前 PDF 批注同步到独立 `Markdown` 文件
- 直接打开这些关联文件
- 在 Explorer 中定位当前 PDF 的条目目录

当前实现约定：

- companion item folder 默认建立在 PDF 同级目录下，例如 `papers/.rydberg-review.lattice/`
- 条目元数据保存在 PDF 同级隐藏目录内的 `manifest.json`
- 批注 Markdown 只会在出现第一条 PDF 批注后，惰性生成到隐藏条目目录下的 `_annotations.md`
- PDF 首次在 Lattice 中打开时，只会确保隐藏条目目录与 `manifest.json` 就绪，不再默认生成概览文件
- Explorer 会隐藏真实的 `.lattice` 兄弟目录，并把其中的用户笔记、Notebook 与惰性 `_annotations.md` 投影到 PDF 条目下面
- `Markdown / Notebook / 批注评论` 中指向 PDF 的链接会优先在应用内打开，并支持 `#page=` 与 `#annotation=` 深链
- `_annotations.md` 会自动镜像同步，并汇入“哪些笔记引用了这条批注”的反链摘要

这意味着 PDF 不再只是“被阅读”，而是可以像文献条目一样挂接阅读笔记、实验 notebook 和批注沉淀文件。

---

## Markdown 编辑

### 实时预览

Lattice 提供类似 Obsidian 的实时预览体验：

- 编辑时自动渲染格式
- 光标所在行显示源码
- 支持 GFM（GitHub Flavored Markdown）

### Wiki 链接

使用 `[[文件名]]` 创建内部链接：

```markdown
参见 [[研究笔记]] 了解更多
```

支持的深链示例：
- `[[papers/math.pdf#ann-123]]` 跳转到 PDF 批注
- `papers/math.pdf#page=12` 跳转到 PDF 指定页
- `src/main.py#line=88` 跳转到代码指定行
- `analysis.ipynb#cell=cell-42` 跳转到 Notebook 指定单元格
- `#结论` 跳转到当前文档标题

桌面版行为：
- 外部网页链接会交给系统默认浏览器打开，不会覆盖当前应用页面
- 工作区内文件链接会继续在应用内打开

### 数学公式

行内公式：`$E = mc^2$`

块级公式：
```markdown
$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$
```

更多输入方式：
- `\(...\)` 与 `\[...\]` 会自动标准化为 `$...$` / `$$...$$`
- `\begin{align}...\end{align}` 等环境自动作为块级公式处理

交互与复制：
- 双击公式打开可视化公式编辑器（MathLive）
- 右键公式复制 **Markdown 公式**
- Shift/Alt + 右键复制 **纯 LaTeX**

粘贴：
- 粘贴纯 LaTeX / MathML / OMML 会自动识别为公式并插入 Markdown 公式

### 代码块

支持语法高亮：

```python
def hello():
    print("Hello, Lattice!")
```

如果当前 Markdown 文件位于工作区中，支持语言的 fenced code block 现在还可以直接运行：

- `python / py`
- `javascript / js / node`
- `r`
- `julia`

运行后的完整反馈会统一进入编辑器底部的 `Run / Problems` 区域，而不是把大段输出直接塞回 Live Preview 代码块本体。这里会明确标出当前来源是 `本地解释器`、`浏览器回退` 还是 `外部命令`，并把语法问题、运行前诊断和运行时错误拆分到 `Problems`。

### 导出为 DOCX / PDF

Markdown 编辑器右上角现在提供 `Export` 入口，可直接导出当前文档。

可选项包括：

- **导出标题**：控制导出文档首页标题
- **导出格式**：`DOCX` 或 `PDF`
- **标注策略**：
  - `Clean`：只导出正文
  - `Appendix`：正文纯净，标注和来源放到文末附录
  - `Study Note`：把正文与标注整理成更适合学习/科研复盘的导出稿
- **视觉模式**：
  - `文档版式`：更适合正式阅读、提交与打印
  - `当前渲染视图`：更贴近应用内实际阅读效果

补充说明：

- 如果当前 Markdown 文件存在侧车标注，导出时可以一并带出
- 导出结果会尽量保留标题层级、列表、表格、代码块、引用块和公式渲染
- 对话框右侧会显示实时预览，方便在真正写出文件前确认结构是否符合预期
- PDF 更适合最终分享稿；DOCX 更适合继续传阅和整理

---

## AI 科研副驾

### 选区右键 AI Hub

在以下文件类型中，选中文本后右键，现在会出现统一 AI 菜单：

- Markdown
- 代码文件
- Notebook
- PDF
- 只读 Markdown / Code / Jupyter
- HTML 预览
- Word 预览

菜单会统一提供三种模式：

- `Chat`：把当前选区发到 AI Chat
- `Agent`：围绕当前选区做更深入分析
- `Plan`：直接基于当前选区生成整理计划

现在这三种模式已经不再只是“同一个 prompt 换按钮”：

- `快速问答`：适合立即得到明确答案和关键证据
- `深度分析`：更强调 `Conclusion / Evidence / Next Actions`
- `计划生成`：直接进入 Workbench proposal / target draft set 主链路

点进后会打开 Selection AI Hub，在真正发送前可以看到：

- 当前选中的原文
- 来源文件/位置
- 本地上下文片段
- 当前模式下可补充的问题或指令
- 当前模式对应的 starter templates
- 当前模式最近提交过的 prompt 历史

快捷键：

- `Alt+1 / Alt+2 / Alt+3`：切换 `快速问答 / 深度分析 / 计划生成`
- `Ctrl/Cmd + Enter`：直接提交当前模式
- `Shift+F10` 或键盘菜单键：在支持的阅读区打开 Selection AI 菜单

### `@引用` 两段式浏览

在 AI Chat 输入框中输入 `@` 后，可以直接浏览工作区文件，而不是只靠记忆路径。

当前交互分为两步：

1. 先选择文件
2. 再选择片段（heading / line / cell / page / annotation）

补充说明：

- 片段选择阶段会明确显示当前正在选择哪个文件的片段
- 如果进入片段层后想返回文件层，可以直接使用面板里的“返回文件”
- 选中的引用会进入 AI 证据链，后续回答、草稿和计划都会保留来源

### Evidence Panel

当 assistant 回答包含证据或上下文来源时，可以打开统一的 Evidence Panel。

当前支持：

- 在多条 assistant 回答之间切换浏览
- 按文件路径查看引用树
- 多选证据后保存合并草稿
- 多选证据后生成整理计划
- 从证据直接跳回原始文件位置

### Workbench 草稿与计划

AI Chat 与 Evidence Panel 生成的草稿现在会统一进入 Workbench，并保留来源关系：

- 普通草稿会进入 `Standalone Drafts`
- 由计划生成的草稿会按 `originProposalId` 归到对应 proposal 下
- 草稿会保留模板类型，例如 `reading-note / research-summary / task-plan`
- proposal 卡片内可以直接看到 `Linked Drafts`、目标写回状态和批量写回入口

### 结构化回答

科研型回答会优先整理成三段式：

- `Conclusion`
- `Evidence`
- `Next Actions`

即使模型把内容写成 `结论：结果稳定。` 或 `**Evidence:** ...` 这种同一行格式，界面也会尽量继续按结构化结果展示。

---

## AI Provider 配置

Lattice 现在支持以下常用 provider：

- OpenAI
- Anthropic
- Google Gemini
- Ollama（本地）
- DeepSeek
- Kimi（Moonshot）
- 智谱 AI
- Custom（OpenAI Compatible）

### 配置建议

- 云端 provider：填写 API Key，必要时可覆盖 Base URL
- Ollama：优先使用默认地址 `http://localhost:11434`
- 自定义兼容 API：填写 Base URL、API Key 和模型 ID

### 连接测试

AI 设置页现在提供连接测试：

- 会直接检查当前 provider、API Key、Base URL 是否真的可用
- 不再只有“成功 / 失败”，而会尽量给出更具体的失败原因
- 对于 Ollama，会额外提示本地服务和 Web CORS 配置方向

### 模型输入

- 可以直接从可用模型列表中选择
- 如果列表拉取失败，仍可手动输入模型 ID
- 对 DeepSeek、Kimi、智谱以及自定义兼容 API，这一点尤其重要

---

## 手写笔记

### 创建手写笔记

1. 右键文件夹 → 新建文件
2. 命名为 `笔记.ink` 或 `笔记.lattice`
3. 双击打开进入手写模式

### 工具栏

| 工具 | 功能 |
|------|------|
| 🖊️ 钢笔 | 平滑笔迹，适合书写 |
| ✏️ 铅笔 | 纹理笔迹，适合素描 |
| 🖍️ 荧光笔 | 半透明，适合标记 |
| 🧹 橡皮擦 | 擦除笔迹 |
| ⭕ 套索 | 选择并移动笔迹 |
| ✋ 平移 | 移动画布 |

### 手势操作（平板）

| 手势 | 功能 |
|------|------|
| 双指捏合 | 缩放画布 |
| 双指拖动 | 平移画布 |
| 双击 | 重置视图 |
| Apple Pencil 双击 | 切换工具 |

### 背景样式

- 空白
- 网格
- 横线
- 点阵

---

## 代码与 Notebook

### Jupyter Notebook

**运行代码**

1. 打开 `.ipynb` 文件
2. 默认只恢复上次已知运行器状态，不会在打开瞬间自动启动本地会话
3. 点击代码单元格的「运行」按钮或顶部「验证环境」
4. 桌面版会优先使用本地 Python；网页版会加载 Pyodide

**Markdown 单元格**

- Markdown Cell 现在默认使用 `Live Preview`
- 激活后可直接编辑，不再依赖旧的双击纯文本框
- 顶部可切换 `Live / Source`
- 非激活状态会保持只读预览

运行说明：
- **桌面版**：优先发现系统 Python、`.venv`、`venv`、`conda`，并复用同一个本地 Python 会话运行 Notebook 单元
- **网页版**：继续使用 Pyodide 作为浏览器内 Python 运行时
- **无本地 Python 的桌面环境**：会明确提示当前只剩 Pyodide 应急回退，不再默认把浏览器内核伪装成本地主运行器
- **打开文件时**：Notebook 默认不会自动起本地 Python 会话，也不会一上来用大面积错误污染首屏
- **工作区偏好记忆**：会按当前工作区记住最近选择的解释器与默认运行器偏好，重开后继续恢复
- **运行器管理**：`KernelSelector`、代码文件运行区和 Markdown 代码块运行区都可以打开统一的 Workspace Runner Manager，查看解释器、切换工作区默认解释器、恢复自动选择
- **来源标签**：运行面板会明确标出当前运行器来自“当前入口选择 / 工作区默认 / 自动探测 / 回退”
- **问题分层**：代码文件、Notebook code cell、Markdown code block 现在会把 `Run` 输出与 `Problems` 分开展示；语法问题、运行前诊断、运行时错误和运行器健康问题会进入 `Problems`
- **启动验证**：`/diagnostics/runner` 与 `Workspace Runner Manager` 都支持显式验证本地 Notebook Python 会话能否成功启动

**快捷键**

| 快捷键 | 功能 |
|--------|------|
| Shift + Enter | 运行并跳转下一单元格 |
| Ctrl + Enter | 运行当前单元格 |
| A | 在上方插入单元格 |
| B | 在下方插入单元格 |
| M | 转为 Markdown |
| Y | 转为代码 |

### 代码文件

支持的语言：Python, JavaScript, TypeScript, Rust, Go, Java, C/C++, HTML, CSS, JSON, YAML 等

功能：
- 语法高亮
- 代码折叠
- 括号匹配
- 行号显示

桌面版运行能力：
- `.py` 文件优先使用本地 Python 运行
- `.js/.mjs/.cjs` 可通过 Node 运行
- `.jl` 可通过 Julia 运行
- `.R` 可通过 Rscript 运行
- 运行输出支持文本、错误堆栈、图片、HTML 表格等常见科研结果
- 运行面板会统一展示来源 badge、stdout/stderr 分组和结构化 traceback

---

## 文件管理

### 打开文件夹

1. 点击侧边栏「Open Local Folder」
2. 选择包含研究文件的文件夹
3. 授权访问（仅网页版需要）

补充说明：
- 桌面版会自动记录最近打开的工作区，并在下次启动时优先恢复
- 如果最近工作区失效，桌面版会回退到你设置的默认文件夹

### 文件操作

| 操作 | 方法 |
|------|------|
| 新建 Markdown / Notebook | 工具栏按钮，或右键文件夹创建 |
| 新建任意文件 | 右键文件夹 → 新建文件 |
| 新建文件夹 | 工具栏按钮，或右键文件夹创建 |
| 立即重命名 | 新建后自动进入命名状态 |
| 重命名 | 右键 → 重命名 / F2 |
| 删除 | 右键 → 删除 |
| 复制 / 剪切 / 粘贴 | 右键菜单，或 Ctrl/Cmd + C / X / V |
| 拖放移动 | 将文件或文件夹拖到目标文件夹 |

### 标签页

| 操作 | 方法 |
|------|------|
| 关闭标签 | 点击 × / 中键点击 / Ctrl+W |
| 切换标签 | 点击 / Ctrl+Tab |
| 快速切换 | Ctrl+1~9 |

---

## 快捷键

### 全局

| 快捷键 | 功能 |
|--------|------|
| Ctrl + B | 切换侧边栏 |
| Ctrl + S | 保存文件 |
| Ctrl + W | 关闭标签页 |
| Ctrl + Tab | 下一个标签 |
| Ctrl + Shift + Tab | 上一个标签 |
| Ctrl + , | 打开设置（桌面版）|

### 文件树

| 快捷键 | 功能 |
|--------|------|
| F2 | 重命名当前选中项 |
| Ctrl/Cmd + C | 复制当前选中项 |
| Ctrl/Cmd + X | 剪切当前选中项 |
| Ctrl/Cmd + V | 粘贴到当前文件夹或当前项所在目录 |

### 编辑器

| 快捷键 | 功能 |
|--------|------|
| Ctrl + Z | 撤销 |
| Ctrl + Y | 重做 |
| Ctrl + F | 查找 |
| Ctrl + H | 替换 |
| Ctrl + / | 注释/取消注释 |

### PDF

| 快捷键 | 功能 |
|--------|------|
| Ctrl + + | 放大 |
| Ctrl + - | 缩小 |
| Ctrl + 0 | 重置缩放 |

### 手写

| 快捷键 | 功能 |
|--------|------|
| P | 钢笔工具 |
| N | 铅笔工具 |
| H | 荧光笔 |
| E | 橡皮擦 |
| S | 套索选择 |
| V | 平移工具 |
| Ctrl + Z | 撤销 |
| Ctrl + Y | 重做 |
| Delete | 删除选中 |

---

## 常见问题

### 应用无法启动

**Windows**
- 确保 Windows 10 1803 或更高版本
- 尝试以管理员身份运行
- 检查杀毒软件是否拦截

### 文件无法打开

- 确认文件格式受支持
- 检查文件是否损坏
- 尝试重新打开文件夹

### PDF 批注不显示

- 批注保存在 `.lattice/annotations/` 目录
- 确保有写入权限
- 检查是否在正确的文件夹中打开

### PDF 条目文件在哪里

- PDF 原始批注仍保存在 `.lattice/annotations/`
- PDF 条目 manifest 保存在 PDF 同级隐藏目录 `.basename.lattice/manifest.json`
- 与 PDF 关联的 `Markdown / Notebook / 批注 Markdown` 默认保存在 PDF 同级隐藏目录 `.basename.lattice/`
- 在 Explorer 中不会直接显示这个隐藏目录，而是显示为 PDF 下的真实用户子条目，以及按需出现的 `_annotations.md`

### Python 代码无法运行

- **桌面版**：
  - 优先确认系统已安装 Python，或项目目录下存在 `.venv`
  - 如果使用 conda / venv，请先激活对应环境或在工作区中选择正确解释器
  - 无本地 Python 时，Lattice 会提示缺失，部分场景可回退到 Pyodide
  - 可直接在 `/diagnostics/runner` 或 `Workspace Runner Manager` 中验证 Notebook 本地会话启动
- **网页版**：
  - 首次运行需要加载 Pyodide 环境（约 20MB）
  - 检查网络连接
  - 等待加载完成后重试

### 手写延迟

- 确保使用支持压感的触控笔
- 关闭不必要的后台程序
- 尝试降低画布缩放级别

---

## 获取帮助

- **GitHub Issues**: [报告问题](https://github.com/tryandaction/lattice/issues)
- **文档**: [完整文档](https://github.com/tryandaction/lattice)
- **更新日志**: [CHANGELOG.md](../CHANGELOG.md)

---

**享受高效的科研工作流！** 🚀


---

## 实时预览学习入口

Lattice 现在将实时预览学习页与自检页同时纳入产品体验：用户可以通过示例学习 Markdown、表格、公式、Callout 等交互，而开发者也可以继续使用同一套引擎做回归验证。

- 用户指南入口：`/guide`
- 开发自检入口：`/diagnostics`
- 运行器诊断页：`/diagnostics/runner`
- PDF 双分屏回归页：`/diagnostics/pdf-regression`
- 图片 workspace handle 标注回归页：`/diagnostics/image-annotation`
- Selection AI 主链路回归页：`/diagnostics/selection-ai`
- 学习页与自检页共用同一套实时预览引擎与示例数据
- 快捷键：`Ctrl+Shift+/`

如果你在编辑过程中想快速理解某种语法的实时预览行为，优先打开 `/guide`；如果你需要排查渲染、点击定位和复杂块级交互问题，再进入 `/diagnostics`。其中：

- `/diagnostics/pdf-regression` 适合复检 PDF 双分屏缩放、布局和切文件恢复
- `/diagnostics/image-annotation` 适合复检真实 workspace handle 的图片标注链路
- `/diagnostics/selection-ai` 适合复检 Chat / Agent / Plan 三种 Selection AI 主链路
- `/diagnostics/runner` 适合复检本地 Python 探测、外部命令可用性和缺失依赖建议
