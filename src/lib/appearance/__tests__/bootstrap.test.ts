import { beforeEach, describe, expect, it } from 'vitest';
import { APPEARANCE_BOOTSTRAP_SCRIPT, APPEARANCE_CACHE_KEY, writeAppearanceCache } from '../bootstrap';
import { DEFAULT_APPEARANCE_SETTINGS } from '../types';

const execute = (dark = false) => new Function('document', 'localStorage', 'matchMedia', APPEARANCE_BOOTSTRAP_SCRIPT)(document, localStorage, () => ({ matches: dark }));
describe('appearance pre-paint bootstrap', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.style.cssText = ''; document.documentElement.className = ''; });
  it('mirrors only appearance, restores after reopen and resolves system mode', () => {
    writeAppearanceCache({ ...DEFAULT_APPEARANCE_SETTINGS, activeThemeId: 'folio' }, 'system');
    expect(Object.keys(localStorage)).toEqual([APPEARANCE_CACHE_KEY]);
    execute(true);
    expect(document.documentElement.dataset.appearanceTheme).toBe('folio');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    execute(false);
    expect(document.documentElement.dataset.appearanceMode).toBe('light');
  });
  it.each(['{', JSON.stringify({version: 2}), 'x'.repeat(32769)])('falls back on a damaged mirror', (value) => {
    localStorage.setItem(APPEARANCE_CACHE_KEY, value); execute();
    expect(document.documentElement.dataset.appearanceTheme).toBe('lattice');
  });
  it.each(['url(https://evil.test/a)', 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif', '0 0% 0%'])('rejects malicious, wrong-type or unreadable CSS', (value) => {
    writeAppearanceCache({ ...DEFAULT_APPEARANCE_SETTINGS, activeThemeId: 'folio' }, 'light');
    const data = JSON.parse(localStorage.getItem(APPEARANCE_CACHE_KEY)!);
    data.light['--background'] = value;
    localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(data)); execute();
    expect(document.documentElement.dataset.appearanceTheme).toBe('lattice');
  });
});
