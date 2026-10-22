/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyAnswerButton } from '../copy-answer-button';

afterEach(() => vi.unstubAllGlobals());

describe('copy answer button', () => {
  it('reports clipboard denial and permits a concrete retry', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError')).mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<CopyAnswerButton message={{ id: 'm', role: 'assistant', content: '# Full\n\n$E=mc^2$', timestamp: 1 }} />);
    fireEvent.click(screen.getByTestId('ai-chat-copy-message'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('复制失败'));
    fireEvent.click(screen.getByTestId('ai-chat-copy-message'));
    await waitFor(() => expect(screen.getByTestId('ai-chat-copy-message').getAttribute('aria-label')).toBe('已复制 Markdown'));
    expect(writeText).toHaveBeenLastCalledWith('# Full\n\n$E=mc^2$');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is visibly reachable and describes a streaming checkpoint', () => {
    render(<CopyAnswerButton message={{ id: 'm2', role: 'assistant', content: 'partial', timestamp: 1, isStreaming: true }} />);
    const button = screen.getByTestId('ai-chat-copy-message');
    expect(button.className).not.toContain('opacity-0');
    expect(button.getAttribute('aria-label')).toContain('当前已生成');
  });
});
