import type { AgentToolExecutionResult } from './agent-tool-broker';
import type { ResearchAgentPlanStep } from './research-agent-planner';
import type { AgentSourceRead, AgentSourceSearchResult, AgentSourceSelection } from './source-index';
import { isFocusedDocumentRequest, isTargetedDocumentRequest, isTrivialQuery, isWholeDocumentRequest } from './request-intent';

/** Literal concept keys only; do not manufacture translations or expand the source scope. */
export function researchConceptTerm(query: string): string | undefined {
  const question = query.split('\n', 1)[0].replace(/@\S+/gu, '');
  const named = question.match(/[A-Za-z][A-Za-z0-9_-]{1,31}/g)?.filter(term =>
    !/^(?:what|which|when|where|why|how|explain|define|about|this|that|the|paper|document|article|pdf|page|pages|read|please|continue|does|are|and|for|with|from|is|in|of|its|it|me|to|an|as|on|detail|detailed|more|not|just|one|sentence|further|step|by|tell)$/i.test(term));
  if (named?.length) return named.find(term => /\d/.test(term)) ?? named[0];
  const quoted = question.match(/[“「《]([\p{Script=Han}]{2,24})[”」》]/u)?.[1];
  if (quoted) return quoted;
  const localQuestion = question.trim().replace(/^(?:(?:请|帮我|解释|讲解|说明|分析|本文|文中|这篇论文|该文|论文|文档)(?:的)?)+/u, '');
  const literal = localQuestion.match(/^([\p{Script=Han}]{2,24}?)(?:的)?(?:是如何|如何|怎么|为什么|为何|是什么|是什么意思|是啥|实现方案|实现方法|实现原理|的机制|的原理)/u)?.[1];
  return literal && !/^(?:主要内容|整体内容|研究内容|这篇论文|本文|论文|文档)$/u.test(literal) ? literal : undefined;
}

function singleFileTarget(filePath: string | undefined, selections: readonly AgentSourceSelection[] | undefined): filePath is string {
  return Boolean(filePath && selections?.length === 1 && selections[0].kind === 'file'
    && selections[0].path.replace(/\\/g, '/') === filePath.replace(/\\/g, '/'));
}

function hasPageRestriction(query: string): boolean {
  return /第[^。\n，,!?？!]{1,24}页|\bpages?\s*\d|#page=/iu.test(query);
}

function pageNumber(value: string): number | undefined {
  if (/^\d+$/u.test(value)) return Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : undefined;
  const digits: Record<string, number> = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  if (!/^[零〇一二两三四五六七八九十百千]+$/u.test(value)) return undefined;
  if (!/[十百千]/u.test(value)) return pageNumber([...value].map(char => digits[char]).join(''));
  let total = 0, digit = 0, previousUnit = 10000;
  for (const char of value) {
    if (char in digits) { digit = digits[char]; continue; }
    const unit = ({ '十': 10, '百': 100, '千': 1000 } as Record<string, number>)[char];
    if (unit >= previousUnit) return undefined;
    total += (digit || 1) * unit; digit = 0; previousUnit = unit;
  }
  return total + digit > 0 ? total + digit : undefined;
}

/** Explicit pages only; malformed/large ranges never fall back to orientation pages. */
function requestedPageUnits(query: string): number[] | undefined {
  const units = new Set<number>();
  const ranges = [
    ...query.matchAll(/第\s*([\d零〇一二两三四五六七八九十百千]+)(?:\s*[-–—到至]\s*([\d零〇一二两三四五六七八九十百千]+))?\s*页/gu),
    ...query.matchAll(/\bpages?\s+(\d+)(?:\s*(?:[-–—]|to)\s*(\d+))?/giu),
    ...query.matchAll(/#page=(\d+)(?=$|[&#\s,，。；;!?？!])/giu),
  ];
  for (const range of ranges) {
    const first = pageNumber(range[1]), last = range[2] ? pageNumber(range[2]) : first;
    if (!first || !last || last < first || last - first >= 32) return undefined;
    for (let page = first; page <= last; page++) units.add(page);
    if (units.size > 32) return undefined;
  }
  return units.size ? [...units] : undefined;
}

/** Replaces only a default orientation read, never explicit planned page/offset reads. */
export function targetedSourceSearchPlan(input: {
  query: string; sourceIntentQuery?: string; filePath?: string; selections?: readonly AgentSourceSelection[];
  steps: readonly ResearchAgentPlanStep[];
}): ResearchAgentPlanStep[] {
  const intent = input.sourceIntentQuery ?? input.query;
  const term = researchConceptTerm(input.query);
  if (!singleFileTarget(input.filePath, input.selections) || !/\.pdf$/iu.test(input.filePath)
    || isFocusedDocumentRequest(intent) || hasPageRestriction(intent) || isWholeDocumentRequest(intent)
    || !isTargetedDocumentRequest(input.query) && !(term && /\p{Script=Han}/u.test(term))
    || /总结|概括|概览|综述|\b(?:summari[sz]e|summary|overview)\b/iu.test(input.query)) return [...input.steps];
  if (!term || input.steps.some(step => step.toolName === 'lattice.sources.search'
    || ['lattice.sources.read', 'lattice.sources.active'].includes(step.toolName ?? '') && (step.status === 'completed' || hasExplicitReadBounds(step)))) return [...input.steps];
  const orientation = input.steps.find(step => step.status === 'pending' && (step.toolName === 'lattice.sources.read' || step.toolName === 'lattice.sources.active')
    && (!step.toolArgs || !('path' in step.toolArgs) || step.toolArgs.path === input.filePath));
  const search: ResearchAgentPlanStep = {
    id: orientation?.id ?? 'targeted-source-search', title: '检索问题对应的原文', description: '优先检索目标论文的问题关键词，仅返回有限命中片段。', status: 'pending',
    toolName: 'lattice.sources.search', toolArgs: { query: term, paths: [input.filePath], maxFiles: 1, maxUnits: 32, maxScanChars: 120000, maxChars: 120000, maxResults: 8, snippetChars: 1200 },
  };
  if (orientation) return input.steps.map(step => step.id === orientation.id ? search : step);
  // Do not re-inject into a recovery/replan call that already carries real work.
  if (input.steps.some(step => step.toolName && !['context.pack', 'evidence.resolve', 'answer.synthesize', 'session.compact'].includes(step.toolName))) return [...input.steps];
  const steps = [...input.steps];
  const insertion = steps.findIndex(step => step.id !== 'context-pack');
  steps.splice(insertion < 0 ? steps.length : insertion, 0, search);
  return steps;
}

function hasExplicitReadBounds(step: ResearchAgentPlanStep): boolean {
  const args = step.toolArgs;
  return Boolean(args && ['units', 'offsets', 'expectedVersion'].some(key => key in args));
}

export function isRecoverableSourceReadFailure(result: AgentToolExecutionResult): boolean {
  return result.status === 'failed' && ['lattice.sources.read', 'lattice.sources.active', 'lattice.sources.search'].includes(result.toolName)
    && !/permission|revoked|denied|unauthori[sz]ed|outside|scope|changed|revision|version|invalid|unsupported|budget|limit|cancel|abort|权限|授权|版本|取消/iu.test(result.error ?? '')
    && /temporar|timed?\s*out|timeout|network|fetch|econn|\bi\/o\b|read fail|failed to read|读取失败|暂时|超时/iu.test(result.error ?? '');
}

/** One recovery operation, charged to the existing tool budget, after ordinary planning. */
export function boundedSourceRecoveryStep(input: {
  query: string; filePath?: string; selections?: readonly AgentSourceSelection[];
  /** Latest user text before history expansion; old suggestions do not restrict pages. */
  sourceIntentQuery?: string;
  reads: AgentSourceRead[]; results: AgentToolExecutionResult[]; requireRead: boolean; steps?: readonly ResearchAgentPlanStep[];
}): ResearchAgentPlanStep | undefined {
  if (!singleFileTarget(input.filePath, input.selections) || isTrivialQuery(input.query)) return undefined;
  const failed = input.results.findLast(result => result.status === 'failed' || result.status === 'denied');
  if (failed) {
    // Retry only transient read failures, never scope, permission, revision or policy failures.
    if (!isRecoverableSourceReadFailure(failed)) return undefined;
    const step = input.steps?.findLast(item => item.status === 'failed' && item.toolName === failed.toolName);
    if (!step || (step.toolName === 'lattice.sources.read' && (!step.toolArgs || !('path' in step.toolArgs) || step.toolArgs.path !== input.filePath))) return undefined;
    return { ...step, id: 'recover-source-read', title: '重试同一来源的有限读取', description: '保持原路径、页码、版本与读取上限，仅恢复一次暂时性读取失败。', status: 'pending' };
  }
  const hasText = input.reads.some(read => read.chunks.some(chunk => chunk.text.trim()));
  const term = researchConceptTerm(input.query);
  const sourceIntentQuery = input.sourceIntentQuery ?? input.query;
  const focused = isFocusedDocumentRequest(sourceIntentQuery) || hasPageRestriction(sourceIntentQuery);
  const searched = input.results.some(result => result.toolName === 'lattice.sources.search');
  const missingConcept = term && hasText && !input.reads.some(read => read.chunks.some(chunk => chunk.text.toLocaleLowerCase().includes(term.toLocaleLowerCase())));
  const hasUnread = !input.reads.length || input.reads.some(read => !read.complete);
  if (term && !focused && !isWholeDocumentRequest(sourceIntentQuery) && searched && (!hasText || missingConcept)) {
    const latest = input.results.findLast(result => result.toolName === 'lattice.sources.search' && result.status === 'completed');
    const result = latest?.result as Partial<AgentSourceSearchResult> | undefined;
    const prior = input.steps?.findLast(step => step.toolName === 'lattice.sources.search' && step.status === 'completed');
    const args = prior?.toolArgs as Record<string, unknown> | undefined;
    if (result && Array.isArray(result.coverage)) {
      const cursor = result.nextCursor;
      // The index may resolve a root-prefixed/absolute input to its canonical
      // relative path. A single exact requested path still identifies one file.
      const target = result.coverage.length === 1 ? result.coverage[0] : result.coverage.find(item => item.path === input.filePath);
      const exactPaths = Array.isArray(args?.paths) && args.paths.length === 1 && args.paths[0] === input.filePath;
      if (!args || args.query !== term || !exactPaths) return undefined;
      // A complete literal scan can miss a concept expressed in a different
      // language. Read a few structural anchors, never a whole-document dump.
      if (result.complete && target?.complete && Number.isSafeInteger(target.totalUnits) && target.totalUnits > 0 && typeof target.version === 'string'
        && !hasText && input.requireRead && !result.hits?.length
        && !input.results.some(item => ['lattice.sources.read', 'lattice.sources.active'].includes(item.toolName))) {
        // Put the middle first so a long opening page cannot consume this
        // entire shared character budget before any later-page evidence.
        const units = [...new Set([Math.ceil(target.totalUnits / 2), target.totalUnits, 1])].filter(unit => Number.isSafeInteger(unit) && unit > 0);
        if (units.length) return { id: 'recover-source-structure', title: '核查有限结构页', description: '字面检索无命中后核查同版本首、中、末页，保留未读范围，不把扫描当作阅读全文。', status: 'pending',
          toolName: 'lattice.sources.read', toolArgs: { path: target.path, expectedVersion: target.version, units, maxUnits: units.length, maxChars: 6000 } };
      }
      // The opaque cursor is bound by the index to the original query, exact
      // path set and source revision. Never increment it or restart from page 1.
      if (result.complete || !Number.isSafeInteger(cursor) || !target || target.complete) return undefined;
      return { ...prior!, id: `recover-concept-cursor-${cursor}`, title: '继续检索目标论文', description: '沿同一查询与原文版本的游标继续有限检索，不把扫描页作为全文阅读证据。', status: 'pending',
        toolArgs: { ...args, cursor } };
    }
  }
  // Preserve a pending planned range. Once that exact range has been executed,
  // an ordinary question may still search the same authorized file for missing
  // evidence; only the user's explicit page/selection intent limits the task.
  if (input.steps?.some(step => ['lattice.sources.read', 'lattice.sources.active'].includes(step.toolName ?? '')
    && step.status !== 'completed' && hasExplicitReadBounds(step))) return undefined;
  if (term && !focused && !isWholeDocumentRequest(sourceIntentQuery) && searched && missingConcept && hasUnread) {
    const source = input.reads.find(read => read.snapshot.path === input.filePath && read.pendingUnits.length);
    if (source) {
      const sameRevision = input.reads.filter(read => read.snapshot.path === source.snapshot.path && read.snapshot.version === source.snapshot.version);
      const readUnits = new Set(sameRevision.flatMap(read => read.readUnits));
      const failedUnits = new Set(sameRevision.flatMap(read => read.unreadableUnits.map(item => item.unit)));
      const units = source.pendingUnits.filter(unit => !readUnits.has(unit) && !failedUnits.has(unit)).slice(0, 32);
      if (units.length) return { id: 'recover-pending-concept-source', title: '继续检查尚未检索的原文', description: '前次检索尚未覆盖概念所在位置，读取同一版本后续有限页面。', status: 'pending',
        toolName: 'lattice.sources.read', toolArgs: { path: source.snapshot.path, expectedVersion: source.snapshot.version, units, maxUnits: units.length, maxChars: 120000 } };
    }
  }
  if (term && !focused && !isWholeDocumentRequest(sourceIntentQuery) && !searched && hasUnread && (missingConcept || input.requireRead && !hasText)
    && input.selections?.length === 1 && input.selections[0].kind === 'file') {
    return { id: 'recover-concept-source', title: '检索问题对应的原文', description: '在已授权的原文中有界查找概念，优先提供命中页面。', status: 'pending',
      toolName: 'lattice.sources.search', toolArgs: { query: term, paths: [input.filePath], maxFiles: 1, maxUnits: 32, maxScanChars: 120000, maxChars: 120000, maxResults: 8, snippetChars: 1200 } };
  }
  if (input.requireRead && !hasText && !input.results.some(result => ['lattice.sources.read', 'lattice.sources.active'].includes(result.toolName))) {
    // Explicit page requests keep their page identity; otherwise start with a small orientation read.
    const units = requestedPageUnits(sourceIntentQuery);
    if (focused && !units) return undefined;
    return { id: 'recover-captured-source', title: '读取已授权来源正文', description: '补充规划遗漏的有限正文读取。', status: 'pending', toolName: 'lattice.sources.read',
      toolArgs: { path: input.filePath, ...(units ? { units } : {}), maxUnits: units?.length ?? 2, maxChars: 6000 } };
  }
  return undefined;
}

/** A bounded read can support a local answer, never a statement of unread coverage. */
export function assertSupportedSourceCoverage(answer: string, reads: readonly AgentSourceRead[], suppliedContextTruncated = false): void {
  const coverage = new Map<string, { total: number; units: Set<number> }>();
  for (const read of reads) {
    const key = read.snapshot.path + ':' + read.snapshot.version;
    const current = coverage.get(key) ?? { total: read.snapshot.totalUnits, units: new Set<number>() };
    read.readUnits.forEach(unit => current.units.add(unit));
    coverage.set(key, current);
  }
  if (!suppliedContextTruncated && ![...coverage.values()].some(item => item.units.size < item.total)) return;
  const prose = answer.replace(/```[\s\S]*?```|`[^`]*`|^>.*$/gmu, '');
  const completeClaim = prose.split(/[，。！？;；\n]|(?<=[.!?])\s+/u).some(clause => {
    if (/不能|无法|尚未|未能|并未|没有读|不(?:能|可)(?:据此)?|cannot|can't|have not|haven't|not yet/iu.test(clause)) return false;
    return /(?:我|我们|本次)?(?:已|已经|现已)(?:完成)?(?:通读|阅读全文|(?:读完|阅读完|核查完|阅读|核查)(?:了)?(?:整篇|整份|全部|完整(?:篇)?|全文))|(?:全文|全篇|整篇论文|所有页面)(?:均|都)?(?:已(?:经)?(?:读完|阅读|核查)|未(?:曾)?(?:提及|出现|包含)|没有(?:提及|出现|包含)|不存在)/u.test(clause)
      || /\b(?:I|we)\s+(?:have\s+)?(?:already\s+)?(?:read|reviewed|checked)\s+(?:the\s+)?(?:whole|entire|full)\s+(?:paper|document)|\b(?:the\s+)?(?:whole|entire|full)\s+(?:paper|document)\s+(?:has been (?:read|reviewed)|does not (?:mention|contain))/iu.test(clause);
  });
  if (completeClaim) throw new Error('阅读覆盖范围校验未通过：仍有未读取页面，不能宣称已通读全文或全文不存在相关内容。请说明实际已读范围与未核查部分。');
}
