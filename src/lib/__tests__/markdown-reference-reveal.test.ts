import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleMarkdownReferenceReveal } from '../markdown-reference-reveal';
import { resolveMarkdownReference } from '../reference-navigation';
import { normalizeScientificText } from '../markdown-converter';
import { getRendererForExtension, isTextFile, isEditableFile } from '../file-utils';
import { isAllowedExtension } from '../constants';

afterEach(() => vi.useRealTimers());

function revealInput() {
  const content = String.raw`Text \(x^2\) and evidence.`;
  const cleanup = vi.fn();
  return {
    content, line: 1, range: { from: 5, to: 12 },
    editor: { getContent: vi.fn(() => content), scrollToLine: vi.fn(), flashLine: vi.fn(), flashRange: vi.fn<() => (() => void) | null>(() => cleanup) },
    isCurrent: vi.fn(() => true), onFlash: vi.fn(), onComplete: vi.fn(),
  };
}

describe('Markdown citation source and delayed reveal', () => {
  it.each(['md', 'mdx', 'markdown'])('routes .%s consistently through editable Markdown', (extension) => {
    expect(getRendererForExtension(extension)).toBe('markdown');
    expect(isAllowedExtension(extension)).toBe(true);
    expect(isTextFile(extension)).toBe(true);
    expect(isEditableFile(extension)).toBe(true);
  });

  it('locates original math syntax even when the reading projection transforms it', () => {
    const source = String.raw`Before. Text \(x^2\) and evidence. After.`;
    const quote = String.raw`Text \(x^2\) and evidence.`;
    expect(normalizeScientificText(source)).not.toContain(quote);
    const resolution = resolveMarkdownReference({ type: 'workspace_text', path: 'paper.md', snippet: quote }, [], 1, source);
    expect(resolution).toMatchObject({ status: 'success', range: { from: 8, to: 34 } });
    if (resolution?.status === 'success' && resolution.range) expect(source.slice(resolution.range.from, resolution.range.to)).toBe(quote);
  });

  it('reports success only after a current-source range has actually been revealed', () => {
    vi.useFakeTimers();
    const input = revealInput();
    scheduleMarkdownReferenceReveal(input);
    expect(input.onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    expect(input.editor.flashRange).toHaveBeenCalledWith(5, 12);
    expect(input.onFlash).toHaveBeenCalledOnce();
    expect(input.onComplete).toHaveBeenCalledWith('success');
  });

  it('does not paint stale offsets after unsaved source changes', () => {
    vi.useFakeTimers();
    const input = revealInput();
    scheduleMarkdownReferenceReveal(input);
    input.editor.getContent.mockReturnValue('Changed document');
    vi.advanceTimersByTime(120);
    expect(input.editor.flashRange).not.toHaveBeenCalled();
    expect(input.onComplete).toHaveBeenCalledWith('quote_not_found');
  });

  it('cancels superseded or unmounted navigation before revealing or reporting success', () => {
    vi.useFakeTimers();
    const input = revealInput();
    scheduleMarkdownReferenceReveal(input);
    input.isCurrent.mockReturnValue(false);
    vi.advanceTimersByTime(120);
    expect(input.editor.flashRange).not.toHaveBeenCalled();
    expect(input.onComplete).not.toHaveBeenCalled();
    input.isCurrent.mockReturnValue(true);
    const cancel = scheduleMarkdownReferenceReveal(input);
    cancel();
    vi.advanceTimersByTime(120);
    expect(input.editor.flashRange).not.toHaveBeenCalled();
  });

  it('reports quote_not_found when virtualized target text has no real DOM range', () => {
    vi.useFakeTimers();
    const input = revealInput();
    input.editor.flashRange.mockReturnValue(null);
    scheduleMarkdownReferenceReveal(input);
    vi.advanceTimersByTime(120);
    expect(input.onFlash).not.toHaveBeenCalled();
    expect(input.onComplete).toHaveBeenCalledWith('quote_not_found');
  });
});
