import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES } from '../registry';
import { validateThemePackage, parseThemeJSON, contrastRatio } from '../validation';
import { exportThemeJSON } from '../exchange';

describe('appearance theme packages', () => {
  it('ships five complete readable light/dark skins', () => {
    expect(BUILTIN_THEMES).toHaveLength(5);
    for (const theme of BUILTIN_THEMES) {
      expect(validateThemePackage(theme).ok, theme.id).toBe(true);
      for (const colors of Object.values(theme.colors)) {
        expect(contrastRatio(colors.foreground, colors.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.focus, colors.surface)).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it('roundtrips all package values', () => {
    const theme = {...BUILTIN_THEMES[1], id:'user-roundtrip'};
    expect(parseThemeJSON(exportThemeJSON(theme))).toEqual({ok:true, theme});
  });
  it('exports built-in themes as importable custom packages', () => {
    const imported = parseThemeJSON(exportThemeJSON(BUILTIN_THEMES[0]));
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.theme.id).toBe('user-import-lattice');
  });
  it.each([
    {css:'body{display:none}'}, {schemaVersion:2}, {id:'lattice'},
    {rules:{...{}, uiFont:'https://evil.test/font'}},
  ])('rejects incompatible, reserved, or unknown fields %j', (patch) => {
    expect(validateThemePackage({...BUILTIN_THEMES[0],id:'user-test',...patch}, {customOnly:true}).ok).toBe(false);
  });
  it('rejects executable colors and low contrast', () => {
    for (const color of ['url(https://evil.test)', '#ffffff', 'transparent', 'red;display:none']) {
      const theme = structuredClone(BUILTIN_THEMES[0]);
      theme.id = 'user-test'; theme.colors.light.foreground = color;
      expect(validateThemePackage(theme).ok).toBe(false);
    }
  });
  it('rejects oversized, malformed, null, prototype and nested unknown inputs', () => {
    expect(parseThemeJSON(' '.repeat(65537)).ok).toBe(false);
    expect(parseThemeJSON('{').ok).toBe(false);
    expect(parseThemeJSON('null').ok).toBe(false);
    const raw = exportThemeJSON({...BUILTIN_THEMES[0], id:'user-test'});
    expect(parseThemeJSON(raw.replace('"name":', '"__proto__":{}, "name":')).ok).toBe(false);
    expect(parseThemeJSON(raw.replace('"radius":', '"selector":"body", "radius":')).ok).toBe(false);
  });
});
