# 量子键盘与 Markdown 公式输入指南

量子键盘是 Lattice 的结构化公式输入层。它不是一块装满说明文字的工具面板，而是实体键盘的可视映射：用户看到电脑键盘上的 26 个英文字母排布，每个字母键直接显示它在公式输入中的含义。

当前目标是低记忆成本、高输入效率：看见键位即可上手，熟悉后用实体键盘高速输入。

## 当前产品模型

### 1. 只显示 26 个字母键

量子键盘使用 QWERTY 字母区布局：

- 第一行：Q W E R T Y U I O P
- 第二行：A S D F G H J K L
- 第三行：Z X C V B N M

数字键不显示在量子键盘界面中。数字键保留实体键盘本义，例如：

- `4` 仍输入数字 `4`
- `Shift+4` 仍是 `$`

### 2. 字母键承载公式含义

每个字母键都有默认候选和扩展候选：

- `I`：默认积分 `\int`
- `Shift+1+I`：选择 `I` 的第 1 个候选，也就是 `\int`
- `Shift+2+I`：选择 `I` 的第 2 个候选，例如 `\iint`
- `Shift+3+I`：选择 `I` 的第 3 个候选，例如 `\iiint`

如果只按 `Shift+字母`，会打开该字母的候选选择器，适合浏览或编辑该键的扩展含义。

### 3. 结构优先

高频结构通过容易联想的字母承载：

- `F`：fraction，默认分式 `\frac{}{}`
- `I`：integral，积分族
- `S`：sum/sigma/sqrt，求和与相关结构
- `M`：matrix，矩阵
- `V`：vector，向量/粗体/列向量
- `K`：ket/bra，量子态符号
- `B`：bracket，括号族：圆括号、方括号、大括号、cases

括号、分式、矩阵、cases 等结构在 MathLive 中会转换为空位占位符，插入后自动进入第一个空位；继续按 `Tab` / `Shift+Tab` 可在占位符之间移动。

### 4. 启动方式

- 在 Markdown/CodeMirror、MathLive、textarea、contenteditable 等编辑上下文中双击 `Tab` 打开。
- 在 Markdown 编辑器顶部更多菜单中选择 `Quantum keyboard` 打开。
- 双击 `Tab` 打开时会拦截第一次 Tab，避免在 Markdown 文件中留下多余缩进或空白。

### 5. 复制 Markdown 或 LaTeX

复制公式格式不属于量子键盘本体功能。用户应在渲染后的公式上右键，选择：

- `Copy Markdown formula`
- `Copy LaTeX formula`

这样复制动作发生在公式阅读/渲染位置，而不是把量子键盘界面变成复制工具箱。

## 实现边界

- 不新增独立公式语言。
- 不要求用户记忆长 LaTeX 命令。
- 不把数字键放入 HUD UI。
- 不在 HUD 中放大量说明文案。
- 不把复制、导出、公式库管理堆进量子键盘主界面。
- MathLive、CodeMirror、textarea、contenteditable 共享统一插入链路。

## 验收标准

- HUD 打开后只显示 26 个字母键和极简状态栏。
- `Shift+数字+字母` 能按一基索引选择候选。
- `Tab Tab` 打开 HUD 时不污染 Markdown 内容。
- 分式、括号、矩阵、cases 插入后进入可填写占位符。
- 渲染公式右键菜单可复制 Markdown 与 LaTeX。
- 明暗主题下 HUD 与右键菜单均使用主题 token，不残留硬编码白底/黑字。
- 相关类型检查与重点单元测试通过。
