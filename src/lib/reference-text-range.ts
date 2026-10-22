export interface ReferenceTextRange { from: number; to: number }

export interface ReferenceTextMatchOptions {
  /** Only for extracted PDF prose: never reinterpret hyphens in code or other source formats. */
  pdfTypography?: boolean;
}

function normalizedReferenceText(content: string, options: ReferenceTextMatchOptions) {
  let normalized = '';
  const offsets: ReferenceTextRange[] = [];
  // Require an actual line break and multi-letter prose fragments. Inline hyphens,
  // scientific subtraction, and flattened "devi- ations" remain significant.
  const omitted = options.pdfTypography
    ? Array.from(content.matchAll(/(?<=[A-Za-z]{2})-[\t ]*\r?\n[\t ]*(?=[a-z]{2})|\u00ad(?:[\t ]*\r?\n[\t ]*(?=[a-z]))?/g), (match) => ({ from: match.index, to: match.index + match[0].length }))
    : [];
  let omittedIndex = 0;
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(content);
  for (const { segment, index: from } of graphemes) {
    const to = from + segment.length;
    while (omitted[omittedIndex] && omitted[omittedIndex].to <= from) omittedIndex++;
    if (omitted[omittedIndex] && omitted[omittedIndex].from <= from) continue;
    for (const char of segment.normalize('NFKC')) {
      if (/\s/u.test(char)) {
        if (normalized && !normalized.endsWith(' ')) {
          normalized += ' ';
          offsets.push({ from, to });
        } else if (normalized.endsWith(' ')) offsets[offsets.length - 1].to = to;
      } else {
        normalized += char;
        for (let index = 0; index < char.length; index++) offsets.push({ from, to });
      }
    }
  }
  return { normalized, offsets };
}

/** Match unique normalized prose while retaining offsets into the original source. */
export function findReferenceTextRange(content: string, quote: string, options: ReferenceTextMatchOptions = {}): ReferenceTextRange | null {
  const needle = normalizedReferenceText(quote, options).normalized.trim();
  if (!needle) return null;
  const { normalized, offsets } = normalizedReferenceText(content, options);
  const match = normalized.indexOf(needle);
  if (match < 0 || normalized.indexOf(needle, match + 1) >= 0) return null;
  return { from: offsets[match].from, to: offsets[match + needle.length - 1].to };
}

/** Resolve visible text only; never wrap or mutate React/CodeMirror-owned nodes. */
export function findRenderedReferenceRange(root: HTMLElement, quote: string): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Array<{ node: Text; from: number; to: number }> = [];
  let content = '';
  let previousBlock: Element | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest('script, style, [aria-hidden="true"]')) continue;
    const block = node.parentElement?.closest('p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th, div') ?? null;
    if (content && previousBlock !== block) content += '\n';
    previousBlock = block;
    const from = content.length;
    content += node.data;
    nodes.push({ node, from, to: content.length });
  }
  const match = findReferenceTextRange(content, quote);
  if (!match) return null;
  const start = nodes.find((entry) => entry.to > match.from);
  const end = nodes.find((entry) => entry.to >= match.to);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, match.from - start.from);
  range.setEnd(end.node, match.to - end.from);
  return range;
}
