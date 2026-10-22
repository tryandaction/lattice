/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from 'vitest';
import { __pluginRuntimeTest } from '@/lib/plugins/runtime';

describe('plugin reveal pane scoping', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section data-testid="pdf-viewer-container-left"><div data-page-number="2" id="left-page"></div></section>
      <section data-testid="pdf-viewer-container-right"><div data-page-number="2" id="right-page"></div></section>
    `;
  });

  it('resolves a page number inside the active pane only', () => {
    expect(__pluginRuntimeTest.findPdfPageElement(2, 'right')?.id).toBe('right-page');
    expect(__pluginRuntimeTest.findPdfPageElement(2, 'left')?.id).toBe('left-page');
  });

  it('falls back to the document when pane metadata is unavailable', () => {
    expect(__pluginRuntimeTest.findPdfPageElement(2, null)?.id).toBe('left-page');
  });
});
