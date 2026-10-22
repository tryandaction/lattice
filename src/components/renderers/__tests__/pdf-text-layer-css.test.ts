import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(process.cwd(), 'src/components/renderers/pdf-highlighter-adapter.css'),
  'utf8',
);

describe('PDF.js text layer CSS contract', () => {
  it('keeps PDF text items absolutely positioned with stable glyph metrics', () => {
    expect(css).toMatch(/\.lattice-pdf-viewer \.textLayer\s*\{[^}]*position:\s*absolute;/s);
    expect(css).toMatch(/\.lattice-pdf-viewer \.textLayer\s*\{[^}]*line-height:\s*1;/s);
    expect(css).toMatch(/\.lattice-pdf-viewer \.textLayer\s*\{[^}]*text-size-adjust:\s*none;/s);
    expect(css).toMatch(/\.lattice-pdf-viewer \.textLayer :is\(span, br\)\s*\{[^}]*position:\s*absolute;/s);
    expect(css).toMatch(/\.lattice-pdf-viewer \.textLayer :is\(span, br\)\s*\{[^}]*white-space:\s*pre;/s);
  });
});
