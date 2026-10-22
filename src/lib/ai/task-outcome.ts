/** Intent is taken from the user's task, never from quoted source content. */
export function requestsCodeExecution(task: string): boolean {
  if (/(?:不要|无需|别|不必).{0,8}(?:执行|运行|计算)|(?:do not|don't|without).{0,16}(?:run|execut|comput)/iu.test(task)) return false;
  return /(?:运行|执行).{0,18}(?:代码|脚本|程序|测试|python|javascript)|(?:用|使用).{0,12}(?:python|javascript).{0,14}(?:计算|分析|验证)|(?:计算|算出|求解).{0,16}(?:数据|数值|结果|矩阵|方程)|\b(?:run|execute)\b.{0,30}\b(?:code|script|program|test|python|javascript)\b|\b(?:calculate|compute|simulate)\b/iu.test(task);
}

export function requestsDetailedAnswer(task: string): boolean {
  if (/无需详细|不要展开|只要结论|一句话即可|keep it brief|short answer only/iu.test(task)) return false;
  return /详细|深入|讲透|逐步|推导|不是一句话|不要摘要|in detail|thorough|step.by.step|not (?:just )?a summary/iu.test(task);
}

/** Explicit file requests are independent of the selected research workflow. */
export function requestsMarkdownDocument(task: string): boolean {
  const clauses = task.split(/[。；;，,\n]/u);
  return clauses.some(clause =>
    !/(?:不要|无需|不必|别|do not|don't).{0,16}(?:生成|创建|保存|写|输出|create|generate|save|write)/iu.test(clause)
    && /(?:生成|创建|保存|写|输出|create|generate|save|write).{0,35}(?:markdown|\bmd\b|\.md|md子文档)/iu.test(clause),
  );
}

export function parsePdfMarkdownChildRequest(task: string): { fileName?: string } | undefined {
  if (!requestsMarkdownDocument(task)
    || !/(?:markdown|\.md|\bmd)\s*(?:子文档|子文件|child(?:\s+(?:document|note))?|sub[ -]?document)|(?:pdf|论文|本文).{0,40}(?:子文件|子文档)/iu.test(task)
    || /(?:不要|无需|不必|别|do not|don't)[^，,。；;\n]{0,35}(?:markdown|md)\s*(?:子文档|子文件|child|sub[ -]?document)/iu.test(task)) return undefined;
  const requested = task.match(/(?:`([^`/\\]+\.md)`|"([^"/\\]+\.md)"|“([^”/\\]+\.md)”|([^\s/\\，。；,:;"`“”<>]+\.md))(?=\s|[，。；,:;]|$)/iu);
  return { fileName: requested?.slice(1).find(Boolean) };
}

/** This detects an obvious under-answer, not semantic truth or scientific quality. */
export function needsAnswerExpansion(task: string, answer: string): boolean {
  if (!requestsDetailedAnswer(task)) return false;
  if (/材料不足|缺少.{0,20}(?:原文|证据|文件)|无法.{0,10}(?:核实|判断)|not enough (?:evidence|context)|no (?:document|source).{0,10}provided/iu.test(answer)) return false;
  const prose = answer.replace(/^#{1,6}[^\n]*$/gm, '').replace(/\[[^\]]*\]\([^)]*\)/g, '').replace(/[\s*_#`\-]/g, '');
  return prose.length < 420;
}

export function taskDeliveryInstructions(task: string): string {
  return [
    'Treat source reading, answer delivery, tool execution, and file persistence as distinct outcomes. A plan is not an execution receipt; a draft is not a saved file.',
    'Check the actual requested deliverable before ending. State exact missing evidence, unavailable capabilities, required approval, or incomplete work. Do not claim actions from prose alone.',
    requestsDetailedAnswer(task) ? 'The user requests depth: explain the causal mechanism, necessary definitions and supported derivations, an applicable example, and limitations. Use only relevant sections; do not invent experimental details or pad absent evidence to meet a template.' : '',
  ].filter(Boolean).join(' ');
}
