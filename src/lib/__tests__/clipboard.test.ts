import { afterEach, expect, it, vi } from 'vitest';
import { copyToClipboard } from '../clipboard';

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(document, 'execCommand');
  vi.restoreAllMocks();
});

function denyAsyncClipboard() {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  });
}

it('returns the actual fallback result and removes its temporary field', async () => {
  denyAsyncClipboard();
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
  expect(await copyToClipboard('formula')).toBe(false);
  expect(document.querySelector('textarea')).toBeNull();
});

it('restores the focused input and its selection after a successful fallback', async () => {
  denyAsyncClipboard();
  const input = document.createElement('input');
  input.value = 'existing draft';
  document.body.appendChild(input);
  input.focus();
  input.setSelectionRange(2, 7, 'backward');
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => true) });

  expect(await copyToClipboard('formula')).toBe(true);
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([2, 7, 'backward']);
  expect(document.querySelector('textarea')).toBeNull();
});

it('restores document selection and removes its field even when fallback throws', async () => {
  denyAsyncClipboard();
  const quote = document.createElement('p');
  quote.textContent = 'selected formula source';
  document.body.appendChild(quote);
  const range = document.createRange();
  range.setStart(quote.firstChild!, 0);
  range.setEnd(quote.firstChild!, 8);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => { throw new Error('blocked'); }) });

  expect(await copyToClipboard('formula')).toBe(false);
  expect(document.querySelector('textarea')).toBeNull();
  expect(selection.toString()).toBe('selected');
});

it('keeps explicit clipboard content when a document copy handler would replace the active selection', async () => {
  denyAsyncClipboard();
  const selectedCopy = (event: Event) => {
    (event as ClipboardEvent).clipboardData?.setData('text/plain', 'flattened PDF selection');
    event.preventDefault();
  };
  document.addEventListener('copy', selectedCopy, true);
  const clipboardData = { setData: vi.fn() };
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => {
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: clipboardData });
    document.querySelector('textarea')!.dispatchEvent(event);
    return true;
  }) });
  try {
    expect(await copyToClipboard('E=mc^{2}')).toBe(true);
    expect(clipboardData.setData).toHaveBeenLastCalledWith('text/plain', 'E=mc^{2}');
  } finally {
    document.removeEventListener('copy', selectedCopy, true);
  }
});
