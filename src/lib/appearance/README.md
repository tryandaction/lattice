# Appearance Theme Packages

Lattice 外观皮肤是版本化、离线可验证的 `ThemePackage`。内置皮肤位于 `registry.ts`；用户皮肤只能使用 `user-` 前缀，最多保存 20 套，单个 JSON 不超过 64 KiB。

## Package contract

每个包必须包含 `schemaVersion: 1`、稳定的 `id`、元数据、`colors.light`/`colors.dark` 两套完整颜色，以及 `rules`。颜色只接受六位十六进制值。`validation.ts` 会拒绝未知字段、CSS/URL/脚本内容和不满足对比度的组合：普通文字与状态色对四种表面至少 4.5:1，`focus` 与 `controlBorder` 至少 3:1，选择态文字与背景至少 4.5:1。

`rules` 控制 UI 字体、阅读字体、代码字体、密度、圆角、阴影和动效。代码字体只允许 `mono` 或 `system`，阅读字体可选择 `geist`、`system`、`serif` 或 `mono`。动效由 runtime 映射到 CSS，并遵守用户的 `prefers-reduced-motion` 设置。

## Runtime and plugin contract

`themeToCSS()` 把包转换成语义 CSS 变量；现有插件继续使用 `hsl(var(--background))`、`hsl(var(--foreground))`、`hsl(var(--card))`、`hsl(var(--popover))`、`hsl(var(--muted))`、`hsl(var(--muted-foreground))`、`hsl(var(--border))`、`hsl(var(--primary))`、`hsl(var(--primary-foreground))` 和 `hsl(var(--ring))`。新增状态色使用完整 CSS 色变量：`--appearance-success`、`--appearance-warning`、`--appearance-danger`、`--appearance-info`、`--appearance-control-border`、`--appearance-selected`、`--appearance-selected-foreground`。

插件不要覆盖主题变量，也不要把主题色写入 PDF `canvas`/`textLayer` 或 KaTeX 字形。iframe 仍由宿主传递所需 token。自定义 CSS、URL、外部字体和脚本不会进入主题包。

## Import, export, and AI

使用 `exportThemeJSON()` 导出。内置主题导出时会自动改成 `user-import-<id>`，所以导出的文件可以直接通过 `parseThemeJSON()` 再导入。编辑器在导入前执行 schema、字段、字节数与对比度验证；保存失败会保留草稿并回滚 durable settings。

AI 生成应以 `makeAIDesignPrompt()` 和 `makeAIThemeTemplate()` 为边界：模型只返回 JSON，不返回 markdown 围栏，最终仍必须经过同一验证器。示例包与代码原生概念板位位于 `examples/`。
