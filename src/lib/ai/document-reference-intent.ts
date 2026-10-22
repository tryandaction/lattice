/** File identity, scientific terminology and topic changes are distinct request signals. */
const CURRENT_DOCUMENT = /(?:当前|现在|刚刚?|新)(?:正?在)?(?:打开|阅读|选中)?的?(?:这[份篇个])?(?:文件|文档|论文|笔记|PDF)|这个(?:正?在)?打开的(?:文件|文档|论文|笔记|PDF)|这份(?:文件|文档|论文)?|选中|选区|这条批注|\b(?:current(?:ly)?(?: open(?:ed)?)?|newly opened|just opened|active)\s+(?:file|document|paper|note|pdf)\b|\b(?:this|current|selected)\s+(?:annotation|selection|excerpt|passage|pdf)\b/iu;
const PREVIOUS_DOCUMENT = /上一[份篇个]|之前|前面|刚才|本文|文中|该(?:文|文件|文档|论文)|这篇(?:论文|文档)|它(?:的|们)?|其(?:中|方法|结论|假设)|\b(?:previous|earlier|prior)\s+(?:file|document|paper)|\b(?:it|its|this paper|this document)\b/iu;
const NEW_DOCUMENT_TOPIC = /换(?:个|一个)?话题|新(?:的)?(?:话题|问题|任务)|另(?:外)?(?:一)?[篇份个]\s*(?:论文|文档|文件|文章|笔记)|其他(?:论文|文档|文件)|\b(?:new|another|different|other)\s+(?:topic|question|task|paper|document|file)|\b(?:instead|switch topics)\b/iu;
const INDEPENDENT_ANSWER = /(?:不|无需|不用|不要)(?:需要)?(?:结合|参考|依据|依赖|读取|使用)(?:当前|这篇|该|任何|打开的)?(?:论文|文档|文件|PDF)|(?:仅|只)(?:从)?(?:通用|一般)(?:角度|原理|知识)|\bwithout\s+(?:(?:using|reading|referring to)\s+)?(?:the\s+)?(?:(?:current|open|active)\s+)?(?:paper|document|file|pdf)\b/iu;
const FILENAME = /\.(?:pdf|md|mdx|markdown|txt|docx?|pptx?|ipynb|tex|py|[cm]?[jt]sx?)(?![a-z0-9])/iu;
export const DOCUMENT_REQUEST_ACTION = /总结|摘要|阅读|通读|读一下|分析|解释|讲解|比较|对比|梳理|\b(?:summari[sz]e|read|analy[sz]e|explain|compare|review)\b/iu;
const DOCUMENT_NOUN = /文件|文档|论文|文章|笔记|\b(?:files?|documents?|papers?|articles?|notes?)\b/iu;

/** Keep source discovery separate from operation identifiers and explicit new-file targets. */
export function documentSourceReferenceQuery(query: string): string {
  const withoutTools = query.replace(/(?<![\p{L}\p{N}_./\\-])lattice\.(?:sources\.(?:list|search|read|active)|pdf\.(?:proposeChild|listChildren|readAnnotations|proposeAnnotations)|workspace\.proposeWrite|skills\.(?:list|get)|compute\.evaluate)(?![\p{L}\p{N}_./\\-])/giu,
    token => ' '.repeat(token.length));
  const outputTarget = /((?:新建|创建|生成|输出|准备|写成|保存为|另存为|\b(?:create|generate|prepare|write|save\s+as)\b)\s*(?:(?:一个|一份|名为|命名为|完整|新的?|子文件|子文档|子笔记|文件|文档|笔记|草稿|markdown|\b(?:a|an|the|new|complete|child|file|document|note|named|called)\b)\s*)*)(`[^`\r\n]+\.(?:mdx?|markdown|txt|json|ya?ml|csv|tsv|tsx?|jsx?|py|tex|html?|css|ipynb)`|"[^"\r\n]+\.(?:mdx?|markdown|txt|json|ya?ml|csv|tsv|tsx?|jsx?|py|tex|html?|css|ipynb)"|“[^”\r\n]+\.(?:mdx?|markdown|txt|json|ya?ml|csv|tsv|tsx?|jsx?|py|tex|html?|css|ipynb)”|[^\s@，。；,:;"`“”<>]+\.(?:mdx?|markdown|txt|json|ya?ml|csv|tsv|tsx?|jsx?|py|tex|html?|css|ipynb))(?=\s|[的，。；,:;.!?！？]|$)/giu;
  return withoutTools.replace(outputTarget, (match: string, prefix: string, target: string, offset: number) => {
    if (/(?:不要|无需|不必|别|\bdo\s+not|\bdon't)\s*$/iu.test(withoutTools.slice(0, offset))) return match;
    // A non-filename placeholder also makes repeated normalization idempotent.
    return prefix + '_'.repeat(target.length);
  });
}

export const isCurrentDocumentReference = (query: string): boolean => CURRENT_DOCUMENT.test(query);
export const isPreviousDocumentReference = (query: string): boolean => PREVIOUS_DOCUMENT.test(query);
export const startsNewDocumentTopic = (query: string): boolean => NEW_DOCUMENT_TOPIC.test(query);
export const requestsIndependentAnswer = (query: string): boolean => INDEPENDENT_ANSWER.test(query);
export const isDocumentComparison = (query: string): boolean => /比较|对比|区别|差异|\b(?:compar\w*|versus|vs\.?|difference)\b/iu.test(query);

/** Bare titles need a reading command or an explicit document noun; task verbs alone do not name files. */
export function isDocumentTitleRequest(query: string): boolean {
  if (isCurrentDocumentReference(query) || isPreviousDocumentReference(query) || requestsIndependentAnswer(query)) return false;
  const text = query.trim().replace(/^(?:(?:请你|请|帮我|麻烦你?|please)\s*)+/iu, '');
  const action = DOCUMENT_REQUEST_ACTION.exec(text);
  const subject = action ? text.slice(action.index + action[0].length).trim() : text;
  const noun = DOCUMENT_NOUN.exec(subject);
  if (noun) {
    const before = subject.slice(0, noun.index).trim()
      .replace(/(?:这|那|当前|上述|所有|全部|另(?:外)?)?(?:[一二两三四五六七八九十\d]+)?[篇份个]?$/u, '').trim()
      .replace(/\b(?:(?:the|a|an|these|those|two|both|all|whole|entire|another|different|other)\s*)+$/iu, '').trim();
    if (before) return true;
    if (/^(?:名为|叫作|标题(?:是|为))\s*\S|^\s*(?:named|titled|called)\s+\S/iu.test(subject.slice(noun.index + noun[0].length))) return true;
    return false;
  }
  return Boolean(subject && /^(?:阅读|通读|读一下|总结|摘要|\b(?:read|summari[sz]e)\b)/iu.test(action?.[0] ?? ''));
}

/** Quotes select sources only when they contain a filename or are framed as a document name. */
export function quotedDocumentNames(query: string): string[] {
  query = documentSourceReferenceQuery(query);
  const titleRequest = isDocumentTitleRequest(query);
  return [...query.matchAll(/["'`“「《]([^"'`”」》\r\n]+)["'`”」》]/gu)].flatMap(match => {
    return FILENAME.test(match[1]) || titleRequest ? [match[1]] : [];
  });
}

export function hasNamedDocumentReference(query: string): boolean {
  query = documentSourceReferenceQuery(query);
  return /@(?:folder:|cloud(?:-folder)?:)?\S/u.test(query) || FILENAME.test(query) || quotedDocumentNames(query).length > 0;
}
