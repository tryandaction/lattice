import type { ThemeMode, ThemePackage } from './types';

export function hexToHsl(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return `0 0% ${(l * 100).toFixed(6)}%`;
  const delta = max - min, s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const h = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return `${(h * 60).toFixed(6)} ${(s * 100).toFixed(6)}% ${(l * 100).toFixed(6)}%`;
}

export const FONT_STACKS = {
  geist: 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif',
  system: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Consolas, monospace',
} as const;
const density = { comfortable: '2.5rem', standard: '2.25rem', compact: '2rem' };
const radius = { sharp: '2px', soft: '6px', round: '12px' };
const shadow = { none: 'none', subtle: '0 1px 2px rgb(15 23 42 / 0.08)', soft: '0 8px 24px rgb(15 23 42 / 0.12)' };
const motion = { none: '0ms', subtle: '120ms', standard: '180ms' };

/** One allowlisted mapping drives DOM application, rollback and pre-paint cache. */
export function themeToCSS(theme: ThemePackage, mode: ThemeMode): Record<string, string> {
  const c = theme.colors[mode];
  const h = (key: keyof typeof c) => hexToHsl(c[key]);
  const result: Record<string, string> = {
    '--appearance-font-ui': FONT_STACKS[theme.rules.uiFont],
    '--appearance-font-reading': FONT_STACKS[theme.rules.readingFont],
    '--appearance-font-code': theme.rules.codeFont === 'system' ? 'ui-monospace, Consolas, monospace' : FONT_STACKS.mono,
    '--appearance-control-height': density[theme.rules.density],
    '--appearance-radius': radius[theme.rules.radius], '--radius': radius[theme.rules.radius],
    '--appearance-shadow': shadow[theme.rules.shadow], '--appearance-motion': motion[theme.rules.motion],
    '--appearance-background': c.background, '--appearance-foreground': c.foreground,
    '--appearance-surface': c.surface, '--appearance-border': c.border,
    '--background': h('background'), '--foreground': h('foreground'),
    '--card': h('surface'), '--card-foreground': h('foreground'),
    '--popover': h('elevated'), '--popover-foreground': h('foreground'),
    '--primary': h('primary'), '--primary-foreground': h('primaryForeground'),
    '--secondary': h('muted'), '--secondary-foreground': h('foreground'),
    '--muted': h('muted'), '--muted-foreground': h('mutedForeground'),
    '--accent': h('selected'), '--accent-foreground': h('selectedForeground'),
    '--destructive': h('danger'), '--destructive-foreground': h('surface'),
    '--border': h('border'), '--input': h('controlBorder'), '--ring': h('focus'),
    '--appearance-control-border': c.controlBorder, '--appearance-selected': c.selected,
    '--appearance-selected-foreground': c.selectedForeground,
    '--appearance-success': c.success, '--appearance-warning': c.warning,
    '--appearance-danger': c.danger, '--appearance-info': c.info,
    '--workbench-shell': c.background, '--workbench-rail': c.muted,
    '--workbench-panel': c.surface, '--workbench-panel-subtle': c.muted,
    '--workbench-tab': c.muted, '--workbench-tab-active': c.elevated,
    '--workbench-hover': c.selected, '--workbench-selected': c.selected,
    '--workbench-focus': c.focus, '--workbench-shadow': `${c.foreground}1f`,
    '--code-shell-bg': c.background, '--code-surface': c.surface,
    '--code-surface-elevated': c.elevated, '--code-surface-muted': c.muted,
    '--code-surface-hover': c.selected, '--code-gutter-bg': c.muted,
    '--code-gutter-active-bg': c.selected, '--code-border': c.border,
    '--code-border-strong': c.controlBorder, '--code-fg': c.foreground,
    '--code-fg-muted': c.mutedForeground, '--code-fg-soft': c.mutedForeground,
    '--code-selection': c.selected, '--code-selection-focused': c.selected,
    '--code-active-line': `${c.selected}55`, '--code-cursor': c.focus,
    '--code-badge-bg': c.muted, '--code-badge-fg': c.foreground,
    '--code-token-keyword': c.info, '--code-token-string': c.success,
    '--code-token-number': c.warning, '--code-token-comment': c.mutedForeground,
    '--code-token-function': c.primary, '--code-token-variable': c.foreground,
    '--code-token-type': c.info, '--code-token-operator': c.mutedForeground,
    '--code-token-bracket': c.foreground,
  };
  for (const state of ['info', 'success', 'warning', 'error'] as const) {
    const color = state === 'error' ? c.danger : c[state];
    result[`--code-status-${state}-bg`] = c.surface;
    result[`--code-status-${state}-fg`] = color;
  }
  return result;
}

const appliedVariables = new WeakMap<HTMLElement, string[]>();
export function applyThemePackage(theme: ThemePackage, mode: ThemeMode, root: HTMLElement = document.documentElement): void {
  const css = themeToCSS(theme, mode);
  for (const [name, value] of Object.entries(css)) root.style.setProperty(name, value);
  appliedVariables.set(root, Object.keys(css));
  root.dataset.appearanceTheme = theme.id;
  root.dataset.appearanceMode = mode;
  root.dataset.appearanceDensity = theme.rules.density;
}
export function clearThemePackage(root: HTMLElement = document.documentElement): void {
  for (const name of appliedVariables.get(root) ?? []) root.style.removeProperty(name);
  appliedVariables.delete(root);
  delete root.dataset.appearanceTheme; delete root.dataset.appearanceMode; delete root.dataset.appearanceDensity;
}
