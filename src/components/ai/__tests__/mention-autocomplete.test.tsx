import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { MentionAutocomplete, calculateMentionPopupLayout } from '../mention-autocomplete';
import { SourceTestDirectory, SourceTestFile } from '@/lib/ai/__tests__/fixtures/source-workspace';

vi.mock('@/components/ui/portal', () => ({ Portal: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../reference-browser', () => ({
  ReferenceBrowser: ({ nodes, onActivateNode }: { nodes: Array<{ id: string; label: string; value?: string }>; onActivateNode?: (node: { id: string; label: string; value?: string }) => void }) => (
    <div>{nodes.map(node => <button type="button" key={node.id} onClick={() => onActivateNode?.(node)}>{node.label}</button>)}</div>
  ),
}));
const mocks = vi.hoisted(() => ({ getAnnotationsForFile: vi.fn(() => []), rootHandle: null as unknown }));
vi.mock('@/stores/workspace-store', () => ({ useWorkspaceStore: (selector: (state: { rootHandle: unknown }) => unknown) => selector(mocks) }));
vi.mock('@/stores/annotation-store', () => ({ useAnnotationStore: (selector: (state: { getAnnotationsForFile: typeof mocks.getAnnotationsForFile }) => unknown) => selector(mocks) }));
vi.mock('@/lib/ai/mention-resolver', () => ({
  getAvailableFiles: () => [], getAvailableWorkspaceDirectories: () => [],
  getMentionFragmentSuggestions: vi.fn(async () => []), resolveWorkspaceFilePath: (path: string) => path,
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('chat mention autocomplete', () => {
  it('places the menu beside the composer and clamps it to the viewport', () => {
    const layout = calculateMentionPopupLayout(new DOMRect(1538, 959, 360, 48), { width: 320, height: 280 }, { width: 1992, height: 1248 });
    expect(layout.left).toBe(1538);
    expect(layout.top).toBe(671);
    const narrow = calculateMentionPopupLayout(new DOMRect(2, 740, 240, 48), { width: 320, height: 360 }, { width: 360, height: 800 });
    expect(narrow.left).toBe(8);
    expect(narrow.top).toBeGreaterThanOrEqual(8);
    expect(narrow.top + Math.min(360, narrow.maxHeight)).toBeLessThanOrEqual(792);
  });

  it('consumes Enter in capture phase to select a mention without bubbling a composer submit', async () => {
    const anchor = createRef<HTMLTextAreaElement>();
    const selected = vi.fn();
    const submitted = vi.fn();
    render(<div onKeyDown={submitted}><textarea ref={anchor} aria-label="prompt" /><MentionAutocomplete query="" anchorRef={anchor} onSelect={selected} onClose={vi.fn()} /></div>);
    const textarea = screen.getByRole('textbox', { name: 'prompt' });
    textarea.focus();
    await waitFor(() => expect(screen.getByRole('button', { name: '当前选区' })).toBeTruthy());
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    expect(selected).toHaveBeenCalledWith({ value: '@selection', continueSelection: false, nextQuery: null });
    expect(submitted).not.toHaveBeenCalled();
  });

  it('anchors the real portal beside a right-docked composer textarea', async () => {
    const anchor = createRef<HTMLTextAreaElement>();
    const originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    const originalHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1992 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1248 });
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.tagName === 'TEXTAREA' ? new DOMRect(1538, 959, 360, 48) : new DOMRect(0, 0, 320, 310);
    });
    try {
      render(<><textarea ref={anchor} aria-label="right composer" /><MentionAutocomplete query="" anchorRef={anchor} onSelect={vi.fn()} onClose={vi.fn()} /></>);
      const popup = await screen.findByTestId('mention-autocomplete');
      await waitFor(() => expect(popup.style.left).toBe('1538px'));
      expect(Number.parseFloat(popup.style.top)).toBeGreaterThan(0);
      expect(Number.parseFloat(popup.style.top)).toBeLessThan(959);
    } finally {
      bounds.mockRestore();
      if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth);
      else Reflect.deleteProperty(window, 'innerWidth');
      if (originalHeight) Object.defineProperty(window, 'innerHeight', originalHeight);
      else Reflect.deleteProperty(window, 'innerHeight');
    }
  });

  it('browses authorized directories one level at a time and can insert a folder reference', async () => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestDirectory('Research Notes')).add(new SourceTestDirectory('gates'))
      .add(new SourceTestFile('Paper.md', '# Synthesis'));
    mocks.rootHandle = root.handle();
    const anchor = createRef<HTMLTextAreaElement>();
    const selected = vi.fn();
    const { rerender } = render(<><textarea ref={anchor} aria-label="folder composer" /><MentionAutocomplete query="" anchorRef={anchor} onSelect={selected} onClose={vi.fn()} /></>);
    fireEvent.click(await screen.findByRole('button', { name: 'Research Notes' }));
    expect(selected).toHaveBeenCalledWith({ value: '@folder:Research%20Notes/', continueSelection: true, nextQuery: 'folder:Research%20Notes/' });
    rerender(<><textarea ref={anchor} aria-label="folder composer" /><MentionAutocomplete query="folder:Research%20Notes/" anchorRef={anchor} onSelect={selected} onClose={vi.fn()} /></>);
    await screen.findByRole('button', { name: 'gates' });
    fireEvent.click(screen.getByRole('button', { name: '引用此文件夹' }));
    expect(selected).toHaveBeenLastCalledWith({ value: '@folder:Research%20Notes', continueSelection: false, nextQuery: null });
  });

  it('opens a folder from the keyboard without treating it as a final mention selection', async () => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestDirectory('Research Notes')).add(new SourceTestFile('Paper.md', '# Synthesis'));
    mocks.rootHandle = root.handle();
    const anchor = createRef<HTMLTextAreaElement>();
    const selected = vi.fn();
    render(<><textarea ref={anchor} aria-label="keyboard composer" /><MentionAutocomplete query="" anchorRef={anchor} onSelect={selected} onClose={vi.fn()} /></>);
    const textarea = screen.getByRole('textbox', { name: 'keyboard composer' });
    textarea.focus();
    await screen.findByRole('button', { name: 'Research Notes' });
    fireEvent.keyDown(textarea, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    expect(selected).toHaveBeenCalledWith({ value: '@folder:Research%20Notes/', continueSelection: true, nextQuery: 'folder:Research%20Notes/' });
  });

  it('searches the current folder when text is typed after its mention path', async () => {
    const root = new SourceTestDirectory('workspace');
    const folder = root.add(new SourceTestDirectory('Research Notes'));
    folder.add(new SourceTestFile('Paper.md', '# Synthesis'));
    folder.add(new SourceTestFile('Other.md', '# Other'));
    mocks.rootHandle = root.handle();
    const anchor = createRef<HTMLTextAreaElement>();
    render(<><textarea ref={anchor} aria-label="search composer" /><MentionAutocomplete query="folder:Research%20Notes/Pap" anchorRef={anchor} onSelect={vi.fn()} onClose={vi.fn()} /></>);
    await screen.findByRole('button', { name: 'Paper.md' });
    expect(screen.queryByRole('button', { name: 'Other.md' })).toBeNull();
    expect(screen.getByText('Research Notes')).toBeTruthy();
  });

  it('selects the matching file, not Current selection, while typing its encoded path', async () => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestDirectory('Research Notes')).add(new SourceTestFile('Paper.md', '# Synthesis'));
    mocks.rootHandle = root.handle();
    const anchor = createRef<HTMLTextAreaElement>();
    const selected = vi.fn();
    render(<><textarea ref={anchor} aria-label="typed path" /><MentionAutocomplete query="Research%20Notes/Pap" anchorRef={anchor} onSelect={selected} onClose={vi.fn()} /></>);
    await screen.findByRole('button', { name: 'Paper.md' });
    expect(screen.queryByRole('button', { name: '当前选区' })).toBeNull();
    const input = screen.getByRole('textbox', { name: 'typed path' });
    input.focus();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(selected).toHaveBeenCalledWith({ value: '@Research%20Notes/Paper.md', continueSelection: false, nextQuery: null });
  });

  it('filters top-level folders and returns to a consistent root query', async () => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestDirectory('Research Notes'));
    mocks.rootHandle = root.handle();
    const anchor = createRef<HTMLTextAreaElement>();
    const selected = vi.fn();
    const { rerender } = render(<><textarea ref={anchor} /><MentionAutocomplete query="folder:Res" anchorRef={anchor} onSelect={selected} onClose={vi.fn()} /></>);
    await screen.findByRole('button', { name: 'Research Notes' });
    rerender(<><textarea ref={anchor} /><MentionAutocomplete query="folder:Research%20Notes/" anchorRef={anchor} onSelect={selected} onClose={vi.fn()} /></>);
    fireEvent.click(await screen.findByRole('button', { name: '上级文件夹' }));
    expect(selected).toHaveBeenCalledWith({ value: '@folder:./', continueSelection: true, nextQuery: 'folder:./' });
  });

  it('keeps malformed in-progress encoding renderable and does not trap Enter with an empty list', async () => {
    const anchor = createRef<HTMLTextAreaElement>();
    const submitted = vi.fn(), close = vi.fn();
    render(<div onKeyDown={submitted}><textarea ref={anchor} aria-label="partial encoding" /><MentionAutocomplete query="bad%#" anchorRef={anchor} onSelect={vi.fn()} onClose={close} /></div>);
    const input = screen.getByRole('textbox', { name: 'partial encoding' });
    input.focus();
    await screen.findByRole('button', { name: '返回文件' });
    await waitFor(() => expect(screen.queryByText('正在读取此文件夹…')).toBeNull());
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(close).toHaveBeenCalled();
    expect(submitted).toHaveBeenCalled();
  });

  it('clears a pending folder load when the user switches to an incomplete fragment query', async () => {
    const root = new SourceTestDirectory('workspace');
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    root.values = async function* () { await pending; };
    mocks.rootHandle = root.handle();
    const anchor = createRef<HTMLTextAreaElement>();
    const { rerender } = render(<><textarea ref={anchor} /><MentionAutocomplete query="" anchorRef={anchor} onSelect={vi.fn()} onClose={vi.fn()} /></>);
    await screen.findByText('正在读取此文件夹…');
    rerender(<><textarea ref={anchor} /><MentionAutocomplete query="bad%#" anchorRef={anchor} onSelect={vi.fn()} onClose={vi.fn()} /></>);
    try { await waitFor(() => expect(screen.queryByText('正在读取此文件夹…')).toBeNull()); }
    finally { finish(); }
  });
});
