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
    title: '基础排版与列表',
    summary: '从标题、强调、引用、列表开始，先建立“边编辑边渲染”的基本心智模型。',
    syntax: ['# 标题', '**粗体**', '*斜体*', '> 引用', '- 列表', '1. 有序列表'],
    focus: [
      '理解实时预览不是阅读模式，而是可继续编辑的渲染态',
      '点击渲染后的文本周边时，光标按渲染视觉结果落位',
      '列表、引用、标题都可以在渲染态和源码态之间自然切换'
    ],
    content: `# Lattice 实时预览

这是 **粗体**、这是 *斜体*、这是 ~~删除线~~、这是 ==高亮==。

> 实时预览的重点不是“好看”，而是“渲染后仍然好编辑”。

- 单击普通文本，直接落光标
- 单击渲染后的元素附近，定位也应符合视觉
- 继续输入时仍然保留 Markdown 原码

1. 有序列表第一项
2. 有序列表第二项
3. 有序列表第三项
`,
  },
  {
    id: 'inline-formatting',
    title: '行内格式、标签与链接',
    summary: '集中演练行内语法，包括代码、标签、普通链接、Wiki 链接、脚注和引用式链接。',
    syntax: ['`code`', '#tag', '[链接](url)', '[[Wiki]]', '[^1]', '[text][ref]'],
    focus: [
      '行内语法替换后仍需保持可精确点击与继续编辑',
      '链接类元素既要可识别，也要避免误触打断编辑流',
      '不同语法的视觉风格需要与普通文本有明确区分'
    ],
    content: `## 行内元素

这是 \`inline code\`，这是 #lattice/tag，这里有 [OpenAI](https://openai.com)。

这里还有 [[Daily Note]]、[[Knowledge Base#渲染逻辑|知识库跳转]] 和脚注引用[^preview]。

引用式链接：[设计文档][design]；引用式图片：![封面][cover]

[^preview]: 脚注正文也应该在实时预览中保持稳定布局。

[design]: https://example.com/design "设计说明"
[cover]: https://placehold.co/320x120/png
`,
  },
  {
    id: 'math',
    title: '数学公式与源码态切换',
    summary: '覆盖行内公式、块级公式、\\( \\)、\\[ \\] 与带环境的公式，验证点击、恢复源码和外部文本落点。',
    syntax: ['$x^2$', '$$E=mc^2$$', '\\(a+b\\)', '\\[\\int_0^1 x dx\\]', '\\begin{aligned}'],
    focus: [
      '单击公式本体应进入源码态，光标落在起始定界符后',
      '点击公式外部文本时，公式恢复渲染，后续文本定位仍准确',
      '不同定界符在源码态下要有清晰差异着色，并适配明暗主题'
    ],
    content: `行内公式：$x^2 + y^2 = z^2$、$r/r_d$、\\(\\alpha + \\beta\\)。

单行块级公式：
$$E = mc^2$$

多行块级公式：
$$
\\begin{aligned}
f(x) &= x^2 + 2x + 1 \\\\
g(x) &= \\int_0^1 x^2 \\, dx
\\end{aligned}
$$

另一种块定界符：
\\[
\\int_0^1 x^3 \\, dx = \\frac{1}{4}
\\]

公式下方这一行文字，用来测试点击与光标定位。
`,
  },
  {
    id: 'rules-callouts',
    title: '横线、引用与 Callout',
    summary: '验证块级渲染后的真实高度是否参与命中测试，避免“视觉在这里、光标跑下面”的错位。',
    syntax: ['---', '> 引用', '> [!NOTE]', '> [!TIP]'],
    focus: [
      '横线渲染后下方文本的点击位置必须与视觉一致',
      'Callout 的整体高度必须进入坐标测量，不允许下方点击偏移',
      'Callout 内部的行内格式和公式也必须按渲染态交互'
    ],
    content: `上一段文字用于测试横线上方的点击。

---

横线下方这一行，请直接点击行中文字中部，光标不应要求你“往上点一点”。

> 普通引用块也需要参与真实高度测量。
> 第二行用于验证多行块之后的光标是否仍然准确。

> [!NOTE] Callout 标题
> 第一行内容
> 第二行内容包含 **粗体**、[链接](https://example.com) 和 $x+y$。

Callout 下方这一行同样用于测试垂直方向点击定位。
`,
  },
  {
    id: 'tables',
    title: '表格：选择、编辑与单元格渲染',
    summary: '表格是实时预览里最复杂的块级元素，需要同时保证结构编辑、单元格渲染和表格外点击定位。',
    syntax: ['| A | B |', '| --- | --- |', '| $x^2$ | [link](url) |'],
    focus: [
      '单击单元格先选中，双击或 Enter/F2 再进入编辑，降低误触',
      '单元格展示态必须支持公式、链接、代码和高亮等内联渲染',
      '表格下方文本点击不能因为表格视觉高度变化而错位'
    ],
    content: `| 类型 | 示例 | 说明 |
| :--- | :---: | ---: |
| 行内公式 | $x^2$ | 单元格内应正常渲染 |
| 块公式 | $$E=mc^2$$ | 单行块公式也应可见 |
| 另一种定界符 | \\(a+b\\) | 不止支持 $ $ |
| 链接 | [OpenAI](https://openai.com) | 单击选择，Ctrl/Cmd+单击打开 |
| 代码 | \`const x = 1\` | 保持内联代码风格 |
| 高亮 | ==重点== | 与普通文本区分 |

表格下方这一行用于验证点击定位准确性。
`,
  },
  {
    id: 'code-details',
    title: '代码块、任务项与折叠块',
    summary: '复杂块级元素需要共享统一的进入源码态和恢复渲染态逻辑。',
    syntax: ['```ts', '- [ ] 任务', '<details>', '<summary>'],
    focus: [
      '代码块点击进入源码态时，不应破坏周围布局和命中区域',
      '折叠块、任务列表和代码块都要保持光标落点稳定',
      '复杂块之后的普通文本仍要可精确点击'
    ],
    content: `- [ ] 跟进公式交互
- [x] 修复表格下方点击错位

§§§ts
const energy = (mass: number) => mass * c ** 2;
console.log(energy(2));
§§§

<details>
<summary>点击展开详情</summary>

这里是折叠块内容，包含 **粗体**、$x^2$ 和 [链接](https://example.com)。

</details>

上面复杂块级元素的下方这一行，用于测试点击是否仍然精准。
`.replace(/§/g, '`'),
  },
  {
    id: 'mixed-document',
    title: '混合文档总回归',
    summary: '把常见语法混在一个真实文档里，检查不同块之间的切换、几何与编辑状态是否相互干扰。',
    syntax: ['---', '$$ $$', '| table |', '> [!TIP]', '```', '#tag'],
    focus: [
      '验证多种块级元素连续出现时，点击命中和光标定位依然稳定',
      '检查混合文档中公式、表格、横线、Callout 不互相污染',
      '作为最终体验回归，贴近真实笔记写作流程'
    ],
    content: `# 项目周报

今天处理了 #editor/live-preview 与 #math/rendering 两类问题。

> [!TIP] 本周重点
> 修复渲染态几何与源码态范围映射。

---

本段后面接一个公式：$f(x)=x^2+1$，然后继续写文字测试内联命中。

$$
\\begin{aligned}
S &= \\sum_{i=1}^{n} i \\\\
  &= \\frac{n(n+1)}{2}
\\end{aligned}
$$

| 模块 | 状态 | 备注 |
| --- | :---: | --- |
| 公式 | 正在优化 | \\(a+b\\)、$$E=mc^2$$ |
| 表格 | 已重构 | 支持选择、编辑、对齐 |
| 横线 | 已修复 | 下方点击不再错位 |

§§§md
> [!NOTE]
> 代码块之后点击普通文本，光标也必须稳定。
§§§

文档末尾这一段，请直接点击任意位置测试是否依然精准。
`.replace(/§/g, '`'),
  },
];
