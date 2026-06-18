# 量子键盘与 Markdown 编辑指南

量子键盘是 Lattice 面向 Markdown、HTML、LaTeX、PDF/DOCX 提取结果的统一公式输入与复制体系。它的目标不是让用户记住更多 LaTeX 命令，而是让用户在写作时看见结构、按下直觉键、得到可复制和可导出的标准公式。

本文是当前保留的最终说明，已合并原 Markdown/Obsidian 编辑升级草稿与量子键盘升级草稿中的有效结论；过时的阶段性方案文档不再保留。

## 设计结论

### 核心原则

- 结构优先：先插入分数、根号、求和、积分、矩阵、分段函数等结构，再填空。
- 低记忆负担：常用结构可见，字母键按读音或语义映射，Shift 打开变体，不要求背长命令。
- 输出可控：同一套输入可写入 MathLive、Markdown、普通文本区和内容可编辑区域。
- 复制可靠：公式可复制为 Markdown 或纯 LaTeX；提取插件可批量导出 `.md`、`.tex`、`.json`。
- 渐进增强：新手点按钮，熟手按键，专家仍可直接输入 LaTeX。
- AI 自动调用默认关闭：量子键盘和 Markdown 增强不会静默触发模型请求，也不会在后台消耗 token。

### 竞品和技术依据

- Mogan STEM / GNU TeXmacs：独立数学模式、结构编辑、Tab 循环和丰富符号库是高效科学写作的核心。
- Liii STEM：把快速数学输入、Magic Paste、矩阵/上下标/分段函数等常见任务做成直接入口。
- MathLive：`MathfieldElement` 原生支持可视化公式、插入 LaTeX、占位符和自定义快捷键。
- CodeMirror 6：通过 transaction/dispatch 原子替换选区，适合 Markdown Live Preview 中的公式写入。

## 产品形态

### 1. 量子 HUD

打开方式：在公式或编辑输入上下文内双击 `Tab`。

打开后显示三层能力：

- 常用结构条：分数、根号、上下标、求和、积分、极限、矩阵、分段函数、向量、括号。
- 可见键盘：QWERTY 键位直接显示默认公式符号。
- 变体选择：`Shift + 键` 打开该键的完整候选，例如 `I` 包含积分、二重积分、环路积分、无穷。

HUD 保持紧凑，不遮挡当前输入点。用户可以拖动位置，`Esc` 关闭。
单击 `Tab` 仍优先保留给编辑器本身；只有在 HUD 已打开时，`Tab` / `Shift+Tab` 才切换 HUD 输出模式。

### 2. 符号与结构搜索

Math Editor 内的符号面板提供搜索和分类：

- 常用
- 结构
- 希腊字母
- 微积分
- 线性代数
- 关系
- 集合
- 逻辑
- 箭头
- 物理

搜索支持 LaTeX 命令、英文关键词和分类关键词。点击结果直接插入。

### 3. 输出模式

量子 HUD 有两个切换：

- 行内 / 块级：控制 Markdown 写入 `$...$` 或 `$$...$$`。
- Markdown / LaTeX：控制写入完整 Markdown 公式，还是纯 LaTeX。

在 MathLive 输入框内始终插入结构化 LaTeX；在 Markdown/HTML/普通文本区按当前输出模式写入文本。

### 4. 复制与导出

- Markdown Live Preview：右键复制 Markdown 公式，`Shift/Alt + 右键` 复制纯 LaTeX。
- Math Editor：提供 Copy MD 和 Copy LaTeX。
- Formula Extractor 插件：从当前文档或选区提取公式，支持复制 Markdown、导出 `.md`、`.tex`、`.json`。

## 键位策略

### 结构优先键

数字行保留给高频结构和边界：

| 键 | 默认 | 用途 |
| --- | --- | --- |
| 1 | `^{}` | 上标 |
| 2 | `_{}` | 下标 |
| 3 | `\sqrt{}` | 根号 |
| 4 | `\frac{}{}` | 分数 |
| 5 | `\sum` | 求和 |
| 6 | `\int` | 积分 |
| 7 | `\lim` | 极限 |
| 8 | `\infty` | 无穷 |
| 9 | `\left(` | 左边界 |
| 0 | `\right)` | 右边界 |

### 字母助记键

- A/E/G/L/M/N/P/Q/R/S/T/W/X/Z：优先希腊字母或近似读音。
- F：fraction，默认分数。
- I：integral，默认积分。
- V：vector，默认向量。
- C/U：cap/cup，集合交并。
- D：delta，同时提供 partial/nabla。
- H：hbar/hat。

### 变体规则

- 默认键：最快插入最常见项。
- `Shift + 键`：打开变体列表。
- 变体列表可用方向键、空格和 Enter 选择。
- 自定义符号保留，但不压过默认符号。

## 使用方式

### Markdown / Obsidian 风格增强

- 表格在阅读时保持干净，hover/focus 后显示行列、对齐、复制 Markdown/HTML 等操作。
- 右键菜单和 Markdown Tools 提供表格、属性、callout、任务列表、脚注、代码块、数学块、图片、GIF、emoji、wiki link、embed 等标准 Markdown 写入动作。
- URL 粘贴、wiki link、callout、properties/frontmatter 等动作通过 CodeMirror transaction 写回文档，不直接改 DOM。
- Emoji/GIF/图片命令必须真实写入 Markdown 内容，例如 `![alt](url.gif)`。
- 只保留低冲突编辑器快捷键；高冲突公式组合优先交给量子键盘物理键完成。

### 新手路径

1. 在编辑器或公式输入处双击 `Tab` 打开量子键盘。
2. 点击常用结构，例如 Fraction。
3. 在 MathLive 中填空，按 `Tab` 到下一个占位。
4. 右键公式复制 Markdown，或用 Copy LaTeX 导出纯公式。

### 熟手路径

1. 在编辑器或公式输入处双击 `Tab`。
2. 按 `F` 插入分数，按 `I` 插入积分，按 `Shift + S` 选择求和变体。
3. HUD 打开后，用 `Tab` 切行内/块级，`Shift + Tab` 切 Markdown/LaTeX 输出。
4. `Esc` 收起 HUD，继续写正文。

### 编辑器快捷键

- `Ctrl+Shift+M`：行内公式
- `Ctrl+Alt+M`：块级公式
- `Ctrl+Shift+F`：分数
- `Ctrl+Shift+R`：根号
- `Ctrl+Shift+I`：积分
- `Ctrl+Shift+U`：求和
- `Ctrl+Shift+L`：极限
- `Ctrl+Shift+X`：矩阵
- `Ctrl+Shift+V`：向量
- `Ctrl+Alt+P`：偏导

这些快捷键只在编辑器上下文生效。应用级 `Ctrl+B`、`Ctrl+K`、`Ctrl+Shift+P` 不会再压过正在编辑的 Markdown/公式输入。

### 专家路径

直接输入 LaTeX、粘贴 MathML/OMML/LaTeX，系统会规范化为 Lattice 支持的公式格式。需要批量迁移时使用 Formula Extractor。

## 实现边界

- 不引入新公式语言，不要求用户学习复杂规则。
- 不替代 MathLive；量子键盘是 MathLive 与 Markdown 编辑器之上的低摩擦输入层。
- 不把所有罕见符号塞进第一屏；罕见符号通过搜索和变体承载。
- 不自动写文件或更新桌面发行产物；复制和导出保持用户触发。
- 不绕过 AI 设置策略；自动补全、自动摘要和插件触发 AI 都必须有显式开关与权限边界。

## 验收标准

- 打开 HUD 后，常用结构和键盘一屏可见。
- 无乱码文案，无明显重叠，无过度装饰。
- MathLive、CodeMirror、textarea、contenteditable 都能插入公式。
- Markdown 和 LaTeX 输出模式可预测。
- 公式面板搜索可覆盖常用数学、物理、集合、逻辑、箭头符号。
- 相关单元测试、类型检查通过。
