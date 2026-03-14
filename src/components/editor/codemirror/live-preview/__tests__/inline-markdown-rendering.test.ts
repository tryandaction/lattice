import { describe, expect, it } from 'vitest';
import { renderInlineMarkdownHtml } from '../widgets';

function mountRenderedHtml(html: string): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('inline markdown rendering for live preview table cells', () => {
  it('renders highlights, links and inline code as HTML', () => {
    const container = mountRenderedHtml(
      renderInlineMarkdownHtml('==重点== [OpenAI](https://openai.com) `const x = 1`')
    );

    expect(container.querySelector('mark')?.textContent).toBe('重点');

    const link = container.querySelector('.cm-link-table') as HTMLAnchorElement | null;
    expect(link?.textContent).toBe('OpenAI');
    expect(link?.getAttribute('href')).toBe('https://openai.com');

    expect(container.querySelector('code')?.textContent).toBe('const x = 1');
  });

  it('renders wiki links and multiple math delimiter forms inside a single cell', () => {
    const container = mountRenderedHtml(
      renderInlineMarkdownHtml(
        String.raw`[[Daily Note]] $x^2$ \(a+b\) $$E=mc^2$$ \[\int_0^1 x \, dx\] \begin{aligned}f(x)&=x^2\end{aligned}`
      )
    );

    const wikiLink = container.querySelector('.cm-wiki-link-table') as HTMLAnchorElement | null;
    expect(wikiLink?.textContent).toBe('Daily Note');
    expect(wikiLink?.dataset.target).toBe('Daily Note');

    const mathNodes = container.querySelectorAll(
      '.cm-math-inline-table, .cm-math-block-table, .katex, .katex-display'
    );
    expect(mathNodes.length).toBeGreaterThanOrEqual(5);
    expect(container.innerHTML).not.toContain('@@MATH');
    expect(container.innerHTML).not.toContain('@@ESC');
  });

  it('sanitizes unsafe HTML while preserving markdown output', () => {
    const html = renderInlineMarkdownHtml('<script>alert(1)</script> [safe](https://example.com)');

    expect(html).not.toContain('<script>');

    const container = mountRenderedHtml(html);
    expect(container.querySelector('.cm-link-table')?.textContent).toBe('safe');
  });
});
