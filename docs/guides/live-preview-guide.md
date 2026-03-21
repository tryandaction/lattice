# Live Preview 指南

Lattice 的 Live Preview 既是日常 Markdown 编辑体验的一部分，也是诊断与回归验证的重要入口。

## 1. 这套能力解决什么问题

- 在编辑 Markdown 时保留接近 Obsidian 的实时预览体验
- 在需要精确修改时，可以快速回到 source 级输入
- 同一套引擎同时服务产品主链路、`/guide` 学习页和 `/diagnostics` 自检页

## 2. 当前支持的核心内容

### 文本与结构

- 标题、列表、引用块、任务列表
- 表格与表格编辑辅助
- Wiki Link 与常见 Markdown 链接
- Callout、Details 等块级结构

### 数学公式

- 行内公式：`$...$`
- 块级公式：`$$...$$`
- 自动标准化 `\(...\)` 与 `\[...\]`
- MathLive 交互式公式编辑

### 代码块

- fenced code block 渲染
- 只读与 editable Markdown 主链路中的运行入口
- 与底部 `Run / Problems` 反馈区联动

## 3. 学习与诊断入口

- 学习页：`/guide`
- 诊断页：`/diagnostics`
- 快捷键：`Ctrl+Shift+/`

如果你想理解某种语法在产品中的真实呈现，先看 `/guide`。  
如果你要排查渲染、定位、交互或复杂块级行为，再看 `/diagnostics`。

## 4. 当前验证重点

- 光标附近源码显隐是否自然
- 表格、公式、Callout 是否稳定渲染
- 点击、滚动、source mode reveal 是否回跳正确
- editable Markdown code block 的 `Run` 入口是否不破坏原有交互

## 5. 相关文档

- [用户指南](../USER_GUIDE.md)
- [架构说明](../ARCHITECTURE.md)
- [桌面功能指南](../DESKTOP_FEATURES.md)
