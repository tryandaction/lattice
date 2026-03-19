/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, cleanup } from '@testing-library/react';
import { useMemo } from 'react';
import { useObjectUrl } from '../use-object-url';

function Probe({ content, mimeType }: { content: string; mimeType: string }) {
  const blob = useMemo(() => new Blob([content], { type: mimeType }), [content, mimeType]);
  const objectUrl = useObjectUrl(blob);
  return <div data-testid="url">{objectUrl ?? 'null'}</div>;
}

describe('use-object-url', () => {
  const createObjectURL = vi.fn();
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createObjectURL.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    cleanup();
  });

  it('replaces and revokes object urls when content changes', async () => {
    const { rerender, unmount } = render(<Probe content="a" mimeType="text/plain" />);

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('url').textContent).toBe('blob:first');
    });

    rerender(<Probe content="b" mimeType="text/plain" />);

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('url').textContent).toBe('blob:second');
    });

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first');

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:second');
  });
});
