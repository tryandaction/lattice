import { describe, expect, it } from 'vitest';
import { needsAnswerExpansion, requestsCodeExecution, requestsMarkdownDocument, taskDeliveryInstructions } from '../task-outcome';

describe('task outcome checks', () => {
  it.each(['阅读批注并生成一个md子文档详细讲解本文', 'Save a Markdown document', '创建 paper.md', '不要批注，生成一个md文档'])('recognizes explicit Markdown output: %s', task => expect(requestsMarkdownDocument(task)).toBe(true));
  it.each(['批注本文', '不要生成md子文档', 'Explain how Markdown works', 'Do not create a Markdown file', "Don't generate Markdown"])('does not invent file requests: %s', task => expect(requestsMarkdownDocument(task)).toBe(false));
  it.each(['执行这个 Python 脚本', '用 Python 计算均值', 'Calculate the variance', 'Run the code'])('recognizes explicit execution: %s', task => expect(requestsCodeExecution(task)).toBe(true));
  it.each(['解释本文实验装置', 'Explain the code', '不要运行代码，只解释', 'Write a plan without executing code'])('does not execute an explanation or forbidden action: %s', task => expect(requestsCodeExecution(task)).toBe(false));
  it('checks substantive answer text instead of accepting empty section headings as depth', () => {
    expect(needsAnswerExpansion('详细讲解，不是一句话', '## 原理\n很可靠。\n## 实验\n很好。\n## 局限\n未知。')).toBe(true);
    expect(needsAnswerExpansion('一句话即可', '简短结论')).toBe(false);
    expect(needsAnswerExpansion('详细讲解', '当前材料不足，缺少实验部分原文，无法核实稳定性的实验依据。')).toBe(false);
    expect(needsAnswerExpansion('详细讲解', '有实质性的因果机制、依据与局限。'.repeat(40))).toBe(false);
  });
  it('distinguishes generated prose from executed or saved deliverables', () => {
    expect(taskDeliveryInstructions('详细讲解')).toContain('A plan is not an execution receipt');
    expect(taskDeliveryInstructions('详细讲解')).toContain('a draft is not a saved file');
  });
});
