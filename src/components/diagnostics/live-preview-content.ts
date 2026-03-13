export type LivePreviewFixture = {
  id: string;
  label: string;
  url: string;
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
  { id: 'test-render-interaction-agent.md', label: '交互回归', url: '/test-render-interaction-agent.md' },
  { id: 'test-rendering.md', label: '渲染回归', url: '/test-rendering.md' },
  { id: 'test-markdown-coverage.md', label: '语法覆盖', url: '/test-markdown-coverage.md' },
  { id: 'test-advanced-markdown.md', label: '高级块级元素', url: '/test-advanced-markdown.md' },
  { id: 'test-formula-rendering.md', label: '数学公式', url: '/test-formula-rendering.md' },
  { id: 'test-syntax-hiding.md', label: '语法隐藏', url: '/test-syntax-hiding.md' },
  { id: 'test-nested-formatting.md', label: '嵌套格式', url: '/test-nested-formatting.md' },
  { id: 'test-text-duplication.md', label: '文本重复', url: '/test-text-duplication.md' },
  { id: 'test-10000-lines.md', label: '超长文档', url: '/test-10000-lines.md' },
];

export const LIVE_PREVIEW_GUIDE_SCENARIOS: LivePreviewGuideScenario[] = [
  {
    id: 'basics',
    title: '基础 Markdown 交互',
    summary: '从标题、强调、引用和链接开始，理解 Lattice 的实时预览不是只读渲染，而是面向编辑的交互视图。',
    syntax: ['# 标题', '**粗体**', '*斜体*', '[链接](https://example.com)', '> 引用'],
    focus: [
      '输入 Markdown 语法后会立即渲染为用户看到的样子',
      '点击渲染区域附近时，光标会按渲染结果而不是按源码字符宽度响应',
      '继续编辑时会在源码和渲染状态之间自然切换'
    ],
    content: `# Lattice 实时预览

这是 **粗体**、这是 *斜体*、这是 [链接](https://example.com)。

> 实时预览不是阅读模式，而是“边编辑边渲染”。

- 你可以继续输入列表
- 也可以直接点击渲染后的文本附近定位光标
- 这让编辑体验更接近 Obsidian 一类的编辑器
`,
  },
  {
    id: 'math',
    title: '数学公式：点击渲染体进入编辑',
    summary: '行内公式和块级公式都以渲染态响应点击；点击公式本体会恢复源码并进入编辑，点击外部文本则保持光标定位准确。',
    syntax: ['$x^2$', '$r/r_d$', '$$\\nE=mc^2\\n$$'],
    focus: [
      '点击行内公式会进入源码模式，光标落在起始分隔符之后',
      '点击公式外部文本时，公式恢复渲染，后续文本的点击定位仍然准确',
      '块级公式渲染后的真实高度会参与命中测试和坐标计算'
    ],
    content: `行内公式示例：$x^2 + y^2 = z^2$ 与 $r/r_d$。

块级公式示例：
$$
E = mc^2
$$

公式下方这一行文字用于测试点击定位是否准确。
`,
  },
  {
    id: 'table',
    title: '表格：渲染态内直接编辑',
    summary: '表格不再只是替换成静态视图，而是可在实时预览中直接进入单元格编辑，同时保证表格下方光标定位正确。',
    syntax: ['| 列 1 | 列 2 |', '| --- | --- |', '| 内容 | 内容 |'],
    focus: [
      '点击单元格时直接编辑对应内容',
      '点击表格外部时回到渲染态',
      '表格后方和下方文本不会再出现垂直点击错位'
    ],
    content: `| 语法 | 示例 |
| --- | --- |
| 粗体 | **Bold** |
| 行内公式 | $x^2$ |
| 链接 | [OpenAI](https://openai.com) |

表格下方这一行文字用于验证点击定位。
`,
  },
  {
    id: 'blocks',
    title: 'Callout 与代码块：块级元素统一命中逻辑',
    summary: 'Callout、代码块、详情块等复杂块级元素共享同一套“按渲染态响应点击”的策略，避免看起来对齐、点击却错位。',
    syntax: ['> [!NOTE] 标题', '```ts', '<details>...</details>'],
    focus: [
      'Callout 渲染后会以真实高度参与点击定位',
      '代码块点击进入源码时更自然，块外点击恢复渲染态',
      '复杂块级元素下方文本的垂直命中不再偏移'
    ],
    content: `> [!NOTE] Callout 标题
> 第一行内容
> 第二行内容包含 **粗体** 和 $x+y$。

§§§ts
const energy = (m: number) => m * c ** 2;
console.log(energy(2));
§§§

上面两个块元素的下方这一行，用来测试点击是否准确落位。
`.replace(/§/g, '`'),
  },
];
