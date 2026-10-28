export function isTrivialQuery(query?: string): boolean {
  const text = query?.trim().replace(/[.!?。！？]+$/u, '').trim();
  return Boolean(text && /^(?:hi|hello|hey|thanks|thank you|ok|okay|test|你好|您好|嗨|哈喽|谢谢|好的)$/iu.test(text));
}

/** Short acknowledgements can confirm the immediately preceding resumable task. */
export function isShortContinuationAck(query?: string): boolean {
  const text = query?.trim().replace(/[.!?。！？]+$/u, '').trim();
  return Boolean(text && /^(?:做|继续|接着|好|好的|可以|行|嗯|是的|go on|continue|proceed|yes|ok|okay)$/iu.test(text));
}

/** Scope limitations must win over incidental mentions of "all" or "full text". */
function hasNarrowReadingScope(query: string): boolean {
  // "不要只读前两页，要读完所有论文" asks for more, not a two-page cap.
  const text = query.replace(/(?:不要|别|不能|不应|而不是)\s*(?:只|仅)(?:读|阅读|看|查看)[^，,；;。!?！？]*/gu, '')
    .replace(/\b(?:do not|don't|not)\s+(?:just|only)\s+(?:read|look at)\b[^,;.!?]*/giu, '');
  return /(?:只|仅)(?:需要|要|需)?(?:读|阅读|看|查看|分析|解释|回答)?[^，,；;。!?！？]{0,12}(?:(?:第|前)\s*[\d一二两三四五六七八九十百]+\s*(?:页|段|节|章)|选区|选中|这段|摘要|标题|相关(?:段落|片段|内容))/u.test(text)
    || /(?:只|仅)(?:需要|要|需)?(?:查找|搜索|检索|找)/u.test(text)
    || /\b(?:only|just)\s+(?:(?:read|analy[sz]e|review|look at)\s+)?(?:the\s+)?(?:first\s+(?:\d+|one|two|three)\s+(?:pages?|paragraphs?|sections?|chapters?)|(?:page|section|chapter)\s*\d+|abstracts?|titles?|selected\s+(?:text|passages?|pages?|sections?|chapters?)|relevant\s+(?:excerpts?|passages?|paragraphs?))/iu.test(text)
    || /\b(?:only|just)\s+(?:find|search|look for)\b/iu.test(text)
    || /(?:不要|无需|不用|不需要|不必|没有必要|别)(?:再|去|进行)?\s*(?:读(?:取|完)?|阅读|通读|综合|批注|分析|查看|检索|搜索)?\s*(?:所有|全部|每篇|每个|全文|全篇|整篇|完整阅读|通读|whole|entire|full)/iu.test(text)
    || /\b(?:do not|don't|no need to)\s+(?:read|review|analy[sz]e)\s+(?:(?:the|a)\s+)?(?:all|every|each|whole|entire|full)\b/iu.test(text);
}

function isReadingAdvice(query: string): boolean {
  return /^\s*(?:(?:please|tell me|explain)\s+)?how\s+(?:(?:can|do|should)\s+(?:i|we)|to)\b/iu.test(query)
    || /^\s*(?:请问|请|告诉我)?(?:怎么|如何)(?:才能|可以)?(?:读(?:取|完)?|阅读|通读|综合|批注)/u.test(query);
}

/** An explicit request to process the whole selected collection, not a search in it. */
export function isWholeDirectoryRequest(query: string): boolean {
  if (hasNarrowReadingScope(query) || isReadingAdvice(query)) return false;
  const clauses = query.split(/[，,；;。!?！？\n]/u);
  return clauses.some(clause => {
    if (/搜索|检索|查找/u.test(clause) && !/读取|阅读|读完|读一遍|通读|批注/u.test(clause)) return false;
    const chineseCollection = /(?:全部|所有)(?:的)?(?:文章|论文|文献|文件|文档|材料)|每(?:一)?(?:篇(?:文章|论文|文献)?|份(?:文档|材料)|个(?:文件|文档))|(?:文章|论文|文献|文件|文档|材料)(?:都|全部)/u.test(clause);
    if (chineseCollection && /读取|阅读|读完|读一遍|通读|综合|批注|分析|讲解|讲述|总结|梳理|逐篇|读\s*(?:所有|全部|每)|(?:文章|论文|文献|文件|文档|材料)(?:都|全部)读/u.test(clause)) return true;
    return /\b(?:read|review|analy[sz]e|summari[sz]e|annotate|explain)\s+(?:through\s+)?(?:all(?:\s+(?:of\s+)?(?:the|these|those))?|every|each)\s+(?:papers?|articles?|documents?|files?|publications?)\b/iu.test(clause)
      || /\b(?:papers|articles|documents|files)\s+(?:must|should)\s+all\s+be\s+(?:read|reviewed|analy[sz]ed|summari[sz]ed|annotated)\b/iu.test(clause);
  });
}

export function isWholeDocumentRequest(query: string): boolean {
  if (hasNarrowReadingScope(query) || isReadingAdvice(query)) return false;
  return isWholeDirectoryRequest(query)
    || /全文|全篇|整篇|全部阅读|完整阅读|通读|所有页面|所有正文|whole (?:paper|document)|entire (?:paper|document)|all pages|full (?:paper|document)|\bread (?:it )?all(?=\s*(?:$|[,;.!?])|\s+(?:of\s+)?(?:it|this|the\s+(?:paper|document))\b)/iu.test(query);
}

/** A document-level explanation request needs full reading when a source is in scope. */
export function isBroadDocumentExplanation(query: string): boolean {
  if (hasNarrowReadingScope(query) || isReadingAdvice(query) || isFocusedDocumentRequest(query)) return false;
  if (/(?:仅|只)(?:需|要|是)?(?:解释|讲解|分析|总结|讨论|回答)[^，,；;。!?！？\n]{0,28}(?:选中|所选|这段|该段|所选页面|selected (?:text|paragraph|section|passage)|this (?:paragraph|section|excerpt))/iu.test(query)
    || /\b(?:only|just)\s+(?:explain|analy[sz]e|summari[sz]e|discuss|answer)\b[^,;.!?\n]{0,48}\b(?:selected|this)\s+(?:text|paragraph|section|passage)\b/iu.test(query)) return false;
  if (!/(?:本文|这篇|这份|该文|报告|论文|文章|文档|材料|paper|document|report|article|pdf)/iu.test(query)) return false;
  if (!/(?:详细|深入|全面|完整|整体|原理|机制|方法|结果|贡献|结构|总结|概括|梳理|讲解|解释|分析|\b(?:detailed|in-depth|explain|analy[sz]e|summari[sz]e|review|overview)\b)/iu.test(query)) return false;
  return !isTargetedDocumentRequest(query);
}

export function isFocusedDocumentRequest(query: string): boolean {
  return /第\s*[\d一二三四五六七八九十百]+(?:\s*[-–—到至]\s*[\d一二三四五六七八九十百]+)?\s*页|\bpages?\s*\d|选中|选区|这段|this (?:passage|excerpt|selection)|#(?:page|section|line)=/iu.test(query);
}

/** Naming a source for one concept or parameter does not request an overview of every page. */
export function isTargetedDocumentRequest(query: string): boolean {
  if (isWholeDocumentRequest(query)) return false;
  const text = query.replace(/@\S+/gu, '');
  if (/总结|概括|梳理|概览|综述|\b(?:summari[sz]e|summary|overview|review the paper)\b/iu.test(text)) return false;
  if (/(?:本文|这篇论文|该文|文档)(?:的)?(?:主要内容|整体|原理|机制|实验结果|研究方法|贡献|结构)/u.test(text)) return false;
  const asksAbout = /是什么|什么意思|为何|为什么|如何|怎么|是否|多少|解释|讲解|说明|\b(?:what|why|how|explain|define)\b/iu.test(text);
  const namedTerms = text.match(/[a-z][a-z0-9_-]{1,31}/giu)?.filter(term =>
    !/^(?:what|which|when|where|why|how|explain|define|about|this|that|the|paper|document|article|pdf|page|pages|read|please|continue|does|are|and|for|with|from|is|in|of|its|it|me|to|an|as|on|detail|detailed|more|not|just|one|sentence|further|step|by|tell|mechanisms?|principles?|results?|methods?|main|content)$/iu.test(term));
  if (asksAbout && namedTerms?.length) return true;
  if (asksAbout && /[“「《][^”」》]{2,32}[”」》]/u.test(text)) return true;
  return /频率|时长|保真度|参数|功率|温度|数值|\b(?:frequency|duration|fidelity|parameters?)\b/iu.test(text)
    && /多少|哪些|分别|是什么|\b(?:what|which|how much)\b/iu.test(text);
}

/** A depth/style correction has no new subject; a fresh named subject must route independently. */
export function isDocumentFollowup(query: string, context: { hasDocumentContext: boolean }): boolean {
  if (!context.hasDocumentContext || isTrivialQuery(query) || isFocusedDocumentRequest(query)) return false;
  if (/换(?:个|一个)?话题|新(?:的)?(?:话题|问题|任务)|另(?:外)?(?:一|个|篇|份|项)|其他(?:论文|文档|问题)|\b(?:new|another|different)\s+(?:topic|question|task|paper|document)|\b(?:instead|switch topics)\b/iu.test(query)) return false;
  const clauses = query.trim().replace(/[。！？.!?]+$/u, '').split(/[,，;；。!?！？]+/u).map(clause => clause.trim()).filter(Boolean);
  if (!clauses.length) return false;
  let requestsMore = false;
  for (const clause of clauses) {
    const text = clause.replace(/^(?:(?:请你|请|麻烦|能否|可以|能不能|can you\s+|could you\s+|please\s+)\s*)+/iu, '').trim();
    const relativeAction = /^(?:(?:再|继续|进一步|接着|更|详细|深入|专业|具体|完整|逐步|一点|一些|地|的|说明|讲解|解释|分析|展开|讲|说|阅读|读|梳理|清楚|透彻))+$/u.test(text)
      || /^(?:continue|go on|elaborate|expand|explain|explain further|tell me more)(?:\s+(?:it|that|this|further|more|in detail|in more detail|in depth|step by step|explaining|reading))*$/iu.test(text)
      || /^(?:继续|进一步|再|详细|深入|展开).*(?:本文|文中|这篇论文|该文|刚才的(?:回答|解释)|上面的(?:回答|解释))/u.test(text);
    const qualityCorrection = /^(?:不是|不要|别|不能|而不是)(?:只|仅|给|用|有|是)*(?:一句话|结论|概括|摘要|总结|几句话|简略回答|简单总结)(?:就结束|了)?$/u.test(text)
      || /^(?:你|这|刚才|之前|上面)?(?:说|讲|解释|回答)?(?:得|的)?太(?:简略|简单|短|笼统)(?:了)?$/u.test(text)
      || /^(?:not|don't|do not)(?:\s+just)?\s+(?:one sentence|a single sentence|a summary|the conclusion|summarize)$/iu.test(text);
    if (!relativeAction && !qualityCorrection) return false;
    requestsMore ||= relativeAction;
  }
  return requestsMore;
}
