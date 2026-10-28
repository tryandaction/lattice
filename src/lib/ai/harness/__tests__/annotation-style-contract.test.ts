import { describe, expect, it } from 'vitest';
import { canonicalizeHarnessAnnotationColor } from '../pdf-tool-helpers';
import { LATTICE_HARNESS_TOOLS, validateLatticeHarnessArgs } from '../lattice-tool-definitions';

const args = (style: Record<string, unknown>) => ({
  parentPath: 'synthetic-paper.pdf', annotations: [{ page: 1, quote: 'Original evidence.', type: 'highlight', ...style }],
});

describe('PDF annotation style tool contract', () => {
  it('documents the supported color forms and explicit default in the model schema', () => {
    const tool = LATTICE_HARNESS_TOOLS.find(tool => tool.name === 'lattice.pdf.proposeAnnotations')!;
    expect(JSON.stringify(tool.parameters)).toContain('#RGB');
    expect(JSON.stringify(tool.parameters)).toContain('#RRGGBB');
    expect(JSON.stringify(tool.parameters)).toContain('yellow');
    expect(JSON.stringify(tool.parameters)).toContain('omitted uses #FFD400');
  });

  it.each(['#FFE75E', ' #ffe75e ', '#abc', 'yellow', ' Yellow ', 'blue'])('accepts supported color %s in the runtime contract', color => {
    expect(validateLatticeHarnessArgs('lattice.pdf.proposeAnnotations', args({ color })).annotations).toEqual(args({ color }).annotations);
  });

  it.each(['not-a-color', 'transparent', '#FFE75E00', 'rgb(255,0,0)', 'var(--color)', 'url(javascript:alert(1))', 'constructor', '__proto__', ''])('rejects unsupported color %s before reading or proposing annotations', color => {
    expect(() => validateLatticeHarnessArgs('lattice.pdf.proposeAnnotations', args({ color }))).toThrow(/annotation color/i);
  });

  it('rejects unsupported annotation types without mapping them to another style', () => {
    expect(() => validateLatticeHarnessArgs('lattice.pdf.proposeAnnotations', args({ type: 'area' }))).toThrow(/annotation type/i);
  });

  it('never reinterprets explicit non-string or empty colors as the default', () => {
    for (const color of [null, 1, {}, [], '']) expect(() => canonicalizeHarnessAnnotationColor(color)).toThrow(/annotation color/i);
    expect(canonicalizeHarnessAnnotationColor(undefined)).toBe('#FFD400');
    expect(canonicalizeHarnessAnnotationColor('yellow')).toBe('#FFFF00');
    expect(canonicalizeHarnessAnnotationColor('#abc')).toBe('#AABBCC');
  });
});
