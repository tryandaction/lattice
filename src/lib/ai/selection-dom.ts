function normalizeBlockText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function blockLabelForElement(element: HTMLElement): string {
  const tagName = element.tagName.toLowerCase();
  const preview = normalizeBlockText(element.textContent || '').slice(0, 40);

  if (/^h[1-6]$/.test(tagName)) {
    return preview ? `标题 · ${preview}` : '标题';
  }
  if (tagName === 'p') {
    return preview ? `段落 · ${preview}` : '段落';
  }
  if (tagName === 'li') {
    return preview ? `列表项 · ${preview}` : '列表项';
  }
  if (tagName === 'blockquote') {
    return preview ? `引用块 · ${preview}` : '引用块';
  }
  if (tagName === 'pre' || tagName === 'code') {
    return '代码块';
  }
  if (tagName === 'td' || tagName === 'th') {
    return preview ? `表格单元 · ${preview}` : '表格单元';
  }
  return preview ? `内容块 · ${preview}` : '内容块';
}

function findBlockElement(startNode: Node | null): HTMLElement | null {
  const startElement = startNode instanceof HTMLElement ? startNode : startNode?.parentElement ?? null;
  if (!startElement) {
    return null;
  }

  return startElement.closest<HTMLElement>(
    'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, code, td, th, figcaption, article, section, div'
  );
}

export interface BlockSelectionContext {
  blockLabel?: string;
  contextText?: string;
}

export function buildBlockSelectionContext(eventTarget: EventTarget | null): BlockSelectionContext {
  const block = eventTarget instanceof Node ? findBlockElement(eventTarget) : null;
  if (!block) {
    return {};
  }

  const parent = block.parentElement;
  const siblings = parent
    ? Array.from(parent.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
    : [block];
  const blockIndex = siblings.indexOf(block);

  const candidateBlocks = siblings
    .slice(Math.max(0, blockIndex - 1), blockIndex + 2)
    .map((element) => normalizeBlockText(element.textContent || ''))
    .filter(Boolean);

  return {
    blockLabel: blockLabelForElement(block),
    contextText: candidateBlocks.length > 0 ? candidateBlocks.join('\n\n') : undefined,
  };
}
