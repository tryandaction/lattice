export type LivePreviewFixture = {
  id: string;
  label: string;
  url: string;
};

export type SupportedGuideLocale = "zh-CN" | "en-US";

export type LocalizedText = Record<SupportedGuideLocale, string>;

export type LatticeGuideSection = {
  id: string;
  title: LocalizedText;
  summary: LocalizedText;
  entry: LocalizedText;
  actions: LocalizedText[];
  tips: LocalizedText[];
  related: LocalizedText[];
  demoMarkdown?: LocalizedText;
};

export type LivePreviewGuideScenario = {
  id: string;
  title: string;
  summary: string;
  syntax: string[];
  content: string;
  focus: string[];
};

export const LIVE_PREVIEW_DIAGNOSTIC_FIXTURES: LivePreviewFixture[] = [
  { id: "test-render-interaction-agent.md", label: "交互回归", url: "/test-render-interaction-agent.md" },
  { id: "test-rendering.md", label: "渲染回归", url: "/test-rendering.md" },
  { id: "test-markdown-coverage.md", label: "语法覆盖", url: "/test-markdown-coverage.md" },
  { id: "test-advanced-markdown.md", label: "高级块级元素", url: "/test-advanced-markdown.md" },
  { id: "test-formula-rendering.md", label: "数学公式", url: "/test-formula-rendering.md" },
  { id: "test-syntax-hiding.md", label: "语法隐藏", url: "/test-syntax-hiding.md" },
  { id: "test-nested-formatting.md", label: "嵌套格式", url: "/test-nested-formatting.md" },
  { id: "test-text-duplication.md", label: "文本重复", url: "/test-text-duplication.md" },
  { id: "test-10000-lines.md", label: "超长文档", url: "/test-10000-lines.md" },
];

export const LATTICE_GUIDE_SECTIONS: LatticeGuideSection[] = [
  {
    id: "quick-start",
    title: {
      "zh-CN": "快速开始",
      "en-US": "Quick Start",
    },
    summary: {
      "zh-CN": "先理解 Lattice 的基本工作方式：左侧管理知识库，中间编辑和阅读，右侧协作与智能辅助。",
      "en-US": "Understand the basic Lattice flow: manage your workspace on the left, read and edit in the center, and collaborate with AI on the right.",
    },
    entry: {
      "zh-CN": "从左侧文件树打开文件，用顶部命令栏切换视图、搜索、导出和工具。",
      "en-US": "Open files from the left tree, then use the top command bar for view modes, search, export, and tools.",
    },
    actions: [
      {
        "zh-CN": "打开一个 Markdown、PDF、HTML 或 Notebook 文件。",
        "en-US": "Open a Markdown, PDF, HTML, or notebook file.",
      },
      {
        "zh-CN": "使用标签页并排处理多个材料。",
        "en-US": "Use tabs to work across multiple materials.",
      },
      {
        "zh-CN": "拖动面板分割线调整阅读、批注和 AI 区域。",
        "en-US": "Drag panel splitters to resize reading, annotation, and AI areas.",
      },
    ],
    tips: [
      {
        "zh-CN": "先从文件、搜索、命令栏三个入口建立工作节奏。",
        "en-US": "Start with three anchors: files, search, and the command bar.",
      },
    ],
    related: [
      {
        "zh-CN": "入口：左侧文件树、顶部命令栏、右侧 AI Chat。",
        "en-US": "Entry points: left file tree, top command bar, right AI Chat.",
      },
    ],
  },
  {
    id: "markdown",
    title: {
      "zh-CN": "Markdown 编辑",
      "en-US": "Markdown Editing",
    },
    summary: {
      "zh-CN": "实时预览用于在渲染态直接编辑 Markdown，适合公式、表格、引用、链接和长笔记。",
      "en-US": "Live Preview lets you edit Markdown directly in its rendered form, including formulas, tables, quotes, links, and long notes.",
    },
    entry: {
      "zh-CN": "打开 `.md` 文件后，用顶部按钮切换实时预览、源码、阅读模式。",
      "en-US": "Open a `.md` file and switch between Live Preview, Source, and Reading modes from the top bar.",
    },
    actions: [
      {
        "zh-CN": "用搜索按钮打开文内查找与替换。",
        "en-US": "Use Search to find and replace inside the document.",
      },
      {
        "zh-CN": "用 Markdown Tools 插入表格、Callout、代码块、链接、媒体和符号。",
        "en-US": "Use Markdown Tools to insert tables, callouts, code blocks, links, media, and symbols.",
      },
      {
        "zh-CN": "右键选中文本可快速加粗、链接、引用或复制块内容。",
        "en-US": "Right-click selected text to format, link, quote, or copy block content.",
      },
    ],
    tips: [
      {
        "zh-CN": "表格先选择再编辑，避免误触；公式可用量子键盘快速输入。",
        "en-US": "Select tables before editing to avoid misclicks; use the Quantum Keyboard for fast formula input.",
      },
    ],
    related: [
      {
        "zh-CN": "入口：顶部 Markdown Tools、右键菜单、搜索按钮、导出按钮。",
        "en-US": "Entry points: Markdown Tools, context menu, search button, export button.",
      },
    ],
    demoMarkdown: {
      "zh-CN": `# Markdown 实时预览

这里可以直接编辑 **粗体**、$E=mc^2$、[链接](https://example.com)。

| 类型 | 示例 |
| --- | --- |
| 公式 | $x^2+y^2$ |
| Callout | > [!NOTE] 重点 |
`,
      "en-US": `# Markdown Live Preview

Edit **bold text**, $E=mc^2$, and [links](https://example.com) directly.

| Type | Example |
| --- | --- |
| Formula | $x^2+y^2$ |
| Callout | > [!NOTE] Key idea |
`,
    },
  },
  {
    id: "pdf",
    title: {
      "zh-CN": "PDF 批注与子文档",
      "en-US": "PDF Annotations And Sidecars",
    },
    summary: {
      "zh-CN": "PDF 工作区用于阅读论文、拖拽选文、添加高亮/区域批注，并生成可读的本地 Markdown 批注文档。",
      "en-US": "The PDF workspace is for reading papers, selecting text, adding highlights or area notes, and generating readable local Markdown annotation files.",
    },
    entry: {
      "zh-CN": "打开 PDF 后，左侧/侧边批注栏显示批注、相关文件、复制摘要和引用操作。",
      "en-US": "Open a PDF to use the annotation side panel for notes, related files, summaries, and citations.",
    },
    actions: [
      {
        "zh-CN": "拖拽文字创建高亮，或用区域工具保存截图式批注。",
        "en-US": "Drag text to create highlights, or use area tools for screenshot-style annotations.",
      },
      {
        "zh-CN": "在批注栏编辑长备注，不应被固定高度截断。",
        "en-US": "Edit long notes in the annotation panel without fixed-height clipping.",
      },
      {
        "zh-CN": "导出 `_annotations.md`，保留颜色、页面链接、批注链接和区域截图。",
        "en-US": "Export `_annotations.md` with color, page links, annotation links, and area captures.",
      },
    ],
    tips: [
      {
        "zh-CN": "PDF 批注链接应能跳回源 PDF 的页面或具体批注。",
        "en-US": "PDF annotation links should jump back to the source page or exact annotation.",
      },
    ],
    related: [
      {
        "zh-CN": "入口：PDF 工具栏、批注侧栏、复制摘要/引用按钮、在文件夹中定位。",
        "en-US": "Entry points: PDF toolbar, annotation side panel, copy summary/citation buttons, reveal in file tree.",
      },
    ],
  },
  {
    id: "quantum-keyboard",
    title: {
      "zh-CN": "量子键盘",
      "en-US": "Quantum Keyboard",
    },
    summary: {
      "zh-CN": "量子键盘是公式输入法与管理器，把实体键盘的 26 个字母映射为常用数学、物理和工程符号。",
      "en-US": "Quantum Keyboard is a formula input method and manager that maps the 26 letter keys to common math, physics, and engineering symbols.",
    },
    entry: {
      "zh-CN": "在 Markdown 中双击 Tab 启动，也可从 Markdown Tools 打开。",
      "en-US": "Double-tap Tab in Markdown, or open it from Markdown Tools.",
    },
    actions: [
      {
        "zh-CN": "直接按字母输入默认含义，例如 I 输入积分类符号。",
        "en-US": "Press a letter for its default meaning, such as I for integral symbols.",
      },
      {
        "zh-CN": "按住 Shift 或 Ctrl 查看并输入不同层级的含义。",
        "en-US": "Hold Shift or Ctrl to view and enter alternate layers.",
      },
      {
        "zh-CN": "在公式渲染处右键，可复制 Markdown 或 LaTeX 公式。",
        "en-US": "Right-click a rendered formula to copy it as Markdown or LaTeX.",
      },
    ],
    tips: [
      {
        "zh-CN": "它不是记忆题：按键上会显示含义，用户应看得懂再输入。",
        "en-US": "It is not a memory test: key meanings are shown directly on the keys.",
      },
    ],
    related: [
      {
        "zh-CN": "入口：Markdown Tools、双击 Tab、设置中的量子键盘配置。",
        "en-US": "Entry points: Markdown Tools, double-tap Tab, Quantum Keyboard settings.",
      },
    ],
  },
  {
    id: "ai",
    title: {
      "zh-CN": "AI 工作台",
      "en-US": "AI Workspace",
    },
    summary: {
      "zh-CN": "AI Chat 用于基于当前文件、选区和工作区上下文提问、总结、改写和生成行动建议。",
      "en-US": "AI Chat uses the current file, selection, and workspace context for questions, summaries, rewrites, and next actions.",
    },
    entry: {
      "zh-CN": "打开右侧 AI Chat，选择 Chat 或 Agent 模式，输入问题或使用模板。",
      "en-US": "Open AI Chat on the right, choose Chat or Agent mode, then ask a question or use a template.",
    },
    actions: [
      {
        "zh-CN": "基于当前文件生成摘要、证据和下一步。",
        "en-US": "Generate conclusions, evidence, and next actions from the current file.",
      },
      {
        "zh-CN": "选中文本后调用 AI 操作，减少复制粘贴。",
        "en-US": "Select text and invoke AI actions without copying and pasting.",
      },
      {
        "zh-CN": "使用 Agent Memory 保留长期偏好与项目上下文。",
        "en-US": "Use Agent Memory to retain long-term preferences and project context.",
      },
    ],
    tips: [
      {
        "zh-CN": "AI 应明确知道当前打开文件和选区；若上下文不足，应提示补充。",
        "en-US": "AI should know the active file and selection; if context is missing, it should ask for what it needs.",
      },
    ],
    related: [
      {
        "zh-CN": "入口：右侧 AI Chat、选区 AI 菜单、Templates、Agent Memory。",
        "en-US": "Entry points: right AI Chat, selection AI menu, Templates, Agent Memory.",
      },
    ],
  },
  {
    id: "plugins",
    title: {
      "zh-CN": "插件与命令",
      "en-US": "Plugins And Commands",
    },
    summary: {
      "zh-CN": "插件系统用于扩展工作流，命令面板用于快速打开工具、指南、诊断和插件动作。",
      "en-US": "Plugins extend workflows, while the command palette quickly opens tools, guides, diagnostics, and plugin actions.",
    },
    entry: {
      "zh-CN": "从左侧插件入口或命令按钮打开插件面板与命令面板。",
      "en-US": "Open plugin panels and the command palette from the left rail or command button.",
    },
    actions: [
      {
        "zh-CN": "用命令面板搜索工具，而不是记忆入口位置。",
        "en-US": "Search tools in the command palette instead of memorizing where they live.",
      },
      {
        "zh-CN": "插件可读取文档目标、显示面板并执行特定工作流。",
        "en-US": "Plugins can read document targets, show panels, and run specific workflows.",
      },
    ],
    tips: [
      {
        "zh-CN": "把高频动作放进命令面板和插件面板，比堆按钮更清晰。",
        "en-US": "Keep frequent actions in the command palette and plugin panels instead of crowding the toolbar.",
      },
    ],
    related: [
      {
        "zh-CN": "入口：命令按钮、插件面板、设置中的插件配置。",
        "en-US": "Entry points: command button, plugin panel, plugin settings.",
      },
    ],
  },
  {
    id: "links-files",
    title: {
      "zh-CN": "链接与文件体系",
      "en-US": "Links And Files",
    },
    summary: {
      "zh-CN": "Lattice 的链接体系用于在 Markdown、PDF、HTML、网页、批注和文件之间稳定跳转。",
      "en-US": "Lattice links connect Markdown, PDFs, HTML, web pages, annotations, and local files with stable navigation.",
    },
    entry: {
      "zh-CN": "点击文档中的链接，或打开 Links 面板查看当前文件的出链、反链和待修复链接。",
      "en-US": "Click document links, or open the Links panel to inspect outgoing links, backlinks, and broken links.",
    },
    actions: [
      {
        "zh-CN": "Markdown 链接可跳转到文件、标题、网页或 PDF 页面。",
        "en-US": "Markdown links can jump to files, headings, web pages, or PDF pages.",
      },
      {
        "zh-CN": "PDF 批注链接应能回到源页面或具体批注。",
        "en-US": "PDF annotation links should return to the source page or exact annotation.",
      },
      {
        "zh-CN": "Links 面板优先显示当前文件相关链接，避免无关链接干扰。",
        "en-US": "The Links panel prioritizes current-file links to reduce noise.",
      },
    ],
    tips: [
      {
        "zh-CN": "链接无响应就是 bug：应显示反馈、修复候选或清晰错误。",
        "en-US": "A dead click is a bug: links should show feedback, repair candidates, or a clear error.",
      },
    ],
    related: [
      {
        "zh-CN": "入口：Links 面板、文档内链接、PDF 批注文档、文件树。",
        "en-US": "Entry points: Links panel, document links, PDF annotation docs, file tree.",
      },
    ],
  },
];

export const LIVE_PREVIEW_GUIDE_SCENARIOS: LivePreviewGuideScenario[] = LATTICE_GUIDE_SECTIONS
  .filter((section) => section.demoMarkdown)
  .map((section) => ({
    id: section.id,
    title: section.title["zh-CN"],
    summary: section.summary["zh-CN"],
    syntax: section.actions.map((action) => action["zh-CN"]),
    content: section.demoMarkdown?.["zh-CN"] ?? "",
    focus: section.tips.map((tip) => tip["zh-CN"]),
  }));
