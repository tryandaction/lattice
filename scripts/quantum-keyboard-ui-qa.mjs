import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// Start the app separately, then run: node scripts/quantum-keyboard-ui-qa.mjs
// QUANTUM_QA_URL and QUANTUM_QA_OUTPUT override the diagnostic URL and output directory.
// QUANTUM_QA_CASES optionally selects comma-separated case IDs from an earlier report.
// --self-test exercises geometry assertions without launching a browser or contacting the app.
const VIEWPORTS = [{ width: 960, height: 700 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }];
const LOCALES = ['zh-CN', 'en-US'];
const THEMES = ['light', 'dark'];
const LAYERS = ['base', 'ctrl'];
const TOLERANCE = 1;
const PANEL_SELECTOR = '[data-quantum-keyboard]';
const TIMEOUT = 30_000;

function contained(inner, outer, tolerance = TOLERANCE) {
  return inner && outer && inner.width > 0 && inner.height > 0
    && inner.left >= outer.left - tolerance && inner.top >= outer.top - tolerance
    && inner.right <= outer.right + tolerance && inner.bottom <= outer.bottom + tolerance;
}

function overlaps(a, b, tolerance = TOLERANCE) {
  return a && b && Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance;
}

function clipRect(value, clip, horizontal = true, vertical = true) {
  const left = horizontal ? Math.max(value.left, clip.left) : value.left;
  const right = horizontal ? Math.min(value.right, clip.right) : value.right;
  const top = vertical ? Math.max(value.top, clip.top) : value.top;
  const bottom = vertical ? Math.min(value.bottom, clip.bottom) : value.bottom;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function validateQuantumGeometry(geometry) {
  const failures = [];
  const check = (condition, code, details) => { if (!condition) failures.push({ code, details }); };
  const { panel, scroll, deck, keys, rows, utilities, viewport } = geometry;
  check(contained(panel, viewport), 'panel-outside-viewport', { panel, viewport });
  check(scroll.overflowX <= TOLERANCE, 'horizontal-scroll', scroll);
  check(contained(deck, scroll), 'deck-outside-visible-scrollport', { deck, scroll });
  check(keys.length === 26, 'physical-key-count', { actual: keys.length, expected: 26 });
  check([...new Set(keys.map(key => key.code))].sort().join(',') === 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => `Key${letter}`).join(','),
    'physical-key-identity', keys.map(key => key.code));
  check(utilities.length === 7, 'utility-key-count', { actual: utilities.length, expected: 7 });
  for (const key of keys) {
    check(contained(key.rect, scroll), 'key-outside-visible-scrollport', { key: key.code, rect: key.rect, scroll });
    check(key.candidates.length >= 5 && key.candidates.length <= 6, 'official-candidate-count', { key: key.code, count: key.candidates.length });
    key.candidates.forEach((candidate, index) => {
      const detail = { key: key.code, id: candidate.id, ...candidate };
      check(candidate.numberText === String(index + 1), 'candidate-number-sequence', detail);
      check(contained(candidate.rect, key.rect), 'candidate-outside-key', detail);
      check(contained(candidate.rect, scroll), 'candidate-outside-visible-scrollport', detail);
      check(contained(candidate.number, candidate.rect), 'number-outside-button', detail);
      check(contained(candidate.glyph, candidate.rect), 'glyph-outside-button', detail);
      check(Boolean(candidate.glyphText?.trim()), 'empty-glyph', detail);
      check(candidate.glyphKind !== 'fallback', 'formula-render-fallback', detail);
      check(!overlaps(candidate.number, candidate.glyph), 'number-glyph-overlap', detail);
    });
    for (let i = 0; i < key.candidates.length; i++) for (let j = i + 1; j < key.candidates.length; j++) {
      check(!overlaps(key.candidates[i].rect, key.candidates[j].rect), 'candidate-buttons-overlap', { key: key.code, ids: [key.candidates[i].id, key.candidates[j].id] });
    }
  }
  for (const [index, row] of rows.entries()) {
    const bottoms = row.keys.map(key => key.bottom);
    check(bottoms.length === [10, 9, 7][index], 'row-key-count', { row: index, actual: bottoms.length });
    check(bottoms.length > 0 && Math.max(...bottoms) - Math.min(...bottoms) <= TOLERANCE,
      'row-bottom-misalignment', { row: index, bottoms });
    for (let i = 0; i < row.keys.length; i++) for (let j = i + 1; j < row.keys.length; j++) {
      check(!overlaps(row.keys[i], row.keys[j]), 'physical-keys-overlap', { row: index, keys: [i, j] });
    }
  }
  check(rows.length === 3, 'physical-row-count', { actual: rows.length });
  for (const utility of utilities) check(contained(utility.rect, scroll), 'utility-outside-visible-scrollport', utility);
  for (let i = 0; i < utilities.length; i++) for (let j = i + 1; j < utilities.length; j++) {
    check(!overlaps(utilities[i].rect, utilities[j].rect), 'utility-buttons-overlap', { utilities: [i, j] });
  }
  const lastContentBottom = Math.max(...keys.map(key => key.rect.bottom), ...utilities.map(key => key.rect.bottom));
  const tailGap = deck.bottom - lastContentBottom;
  check(Number.isFinite(tailGap) && tailGap >= -TOLERANCE && tailGap <= 20, 'deck-tail-whitespace', { pixels: tailGap, maximum: 20 });
  return failures;
}

// Evaluated in the page: all geometry is measured after CSS transforms, never offsetWidth.
function collectQuantumGeometry() {
  const panel = document.querySelector('[data-quantum-keyboard]');
  const scroll = panel?.querySelector('.qk-board-scroll');
  const deck = panel?.querySelector('.qk-physical-deck');
  if (!panel || !scroll || !deck) throw new Error('Missing keyboard panel, scrollport, or physical deck');
  const rect = node => {
    if (!node) return null;
    const value = node.getBoundingClientRect();
    return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
  };
  const glyphRect = node => {
    if (!node) return null;
    // KaTeX's zero-width baseline struts are layout scaffolding, not visible ink.
    // Union real text ranges and visible SVG/rule shapes, all after transforms.
    const bounds = [];
    const internalClip = (value, element) => {
      let measured = { left: value.left, top: value.top, right: value.right, bottom: value.bottom };
      // Clip only KaTeX-internal viewports such as .hide-tail. Never clip to the
      // product's .qk-formula/button: that would hide actual formula truncation.
      for (let parent = element.parentElement; parent && node.contains(parent); parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const clipX = ['hidden', 'clip'].includes(style.overflowX);
        const clipY = ['hidden', 'clip'].includes(style.overflowY);
        if (!clipX && !clipY) continue;
        const clip = parent.getBoundingClientRect();
        if (clipX) { measured.left = Math.max(measured.left, clip.left); measured.right = Math.min(measured.right, clip.right); }
        if (clipY) { measured.top = Math.max(measured.top, clip.top); measured.bottom = Math.min(measured.bottom, clip.bottom); }
      }
      return { ...measured, width: measured.right - measured.left, height: measured.bottom - measured.top };
    };
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (!text.textContent?.replace(/[\s\u200b\u200c\u200d\ufeff]/gu, '')) continue;
      if (text.parentElement?.closest('.strut, .pstrut, .katex-mathml')) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      bounds.push(...[...range.getClientRects()].map(value => internalClip(value, text.parentElement)).filter(value => value.width > 0 && value.height > 0));
    }
    for (const shape of node.querySelectorAll('svg, .frac-line, .overline-line, .sqrt-line, .rule')) {
      const value = internalClip(shape.getBoundingClientRect(), shape);
      if (value.width > 0 && value.height > 0) bounds.push(value);
    }
    if (!bounds.length) return null;
    const left = Math.min(...bounds.map(value => value.left));
    const top = Math.min(...bounds.map(value => value.top));
    const right = Math.max(...bounds.map(value => value.right));
    const bottom = Math.max(...bounds.map(value => value.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };
  const scrollRect = rect(scroll);
  // Exclude borders and scrollbar; this is the actual visible scrollable content rectangle.
  const scrollport = {
    left: scrollRect.left + scroll.clientLeft, top: scrollRect.top + scroll.clientTop,
    right: scrollRect.left + scroll.clientLeft + scroll.clientWidth,
    bottom: scrollRect.top + scroll.clientTop + scroll.clientHeight,
    width: scroll.clientWidth, height: scroll.clientHeight,
    scrollLeft: scroll.scrollLeft, scrollTop: scroll.scrollTop,
    scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth,
    scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight,
    overflowX: scroll.scrollWidth - scroll.clientWidth,
  };
  const keyNodes = [...deck.querySelectorAll('.qk-keycap')];
  return {
    panel: rect(panel), scroll: scrollport, deck: rect(deck),
    viewport: { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight },
    keys: keyNodes.map(key => ({
      code: key.getAttribute('data-keycode'), rect: rect(key),
      candidates: [...key.querySelectorAll('.qk-keycap-symbol')].map(button => {
        const number = button.querySelector(':scope > sup');
        const glyph = button.querySelector('.katex-html') ?? button.querySelector('.qk-keycap-label') ?? button.querySelector('.qk-formula-fallback');
        return {
          id: button.getAttribute('data-meaning-id'), rect: rect(button),
          number: rect(number), numberText: number?.textContent?.trim() ?? '', glyph: glyphRect(glyph),
          glyphText: glyph?.textContent ?? '',
          glyphKind: glyph?.classList.contains('katex-html') ? 'katex' : glyph?.classList.contains('qk-keycap-label') ? 'label' : 'fallback',
        };
      }),
    })),
    rows: [...deck.querySelectorAll('.qk-physical-row')].map(row => ({ rect: rect(row), keys: [...row.querySelectorAll('.qk-keycap')].map(rect) })),
    utilities: [...deck.querySelectorAll('.qk-utility-key')].map(button => ({ text: button.textContent?.trim(), rect: rect(button) })),
    rendering: { dark: document.documentElement.classList.contains('dark'), lang: document.documentElement.lang,
      formulaCount: deck.querySelectorAll('.katex').length, labelCount: deck.querySelectorAll('.qk-keycap-label').length,
      activeLayer: [...panel.querySelectorAll('.qk-layer-switch button')].find(button => button.getAttribute('aria-pressed') === 'true')?.textContent?.trim(),
      outlineAnimation: getComputedStyle(deck, '::before').animationName,
      documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      panelOverflowX: panel.scrollWidth - panel.clientWidth },
  };
}

async function settleRendering(page) {
  await page.evaluate(async () => {
    if (document.fonts) await document.fonts.ready;
    // Finish finite transitions, while leaving the continuous outline animation intact.
    const finite = document.getAnimations().filter(animation => {
      const timing = animation.effect?.getComputedTiming();
      return timing && Number.isFinite(timing.endTime) && timing.endTime <= 1500;
    });
    await Promise.all(finite.map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(200);
}

async function openKeyboard(page) {
  await page.getByTestId('quantum-diagnostics').waitFor({ timeout: TIMEOUT });
  await page.getByRole('button', { name: /^(停用插件|Disable plugin)$/u }).waitFor({ state: 'visible', timeout: TIMEOUT });
  // The active diagnostic button precedes the Host's dynamic Provider chunk.
  // Wait for its client-side listeners before testing the very first double Tab.
  await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
  const editor = page.locator('.cm-content[contenteditable="true"]').first();
  await editor.waitFor({ state: 'visible', timeout: TIMEOUT });
  await editor.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const panel = page.locator(PANEL_SELECTOR);
  try {
    await panel.waitFor({ state: 'visible', timeout: 3000 });
    return 'double-tab';
  } catch {
    // The explicit command button is the diagnostic's other supported opening path.
    await editor.focus();
    await page.getByRole('button', { name: /^(打开量子键盘|Open Quantum Keyboard)$/iu }).click();
    await panel.waitFor({ state: 'visible', timeout: TIMEOUT });
    return 'open-button';
  }
}

async function runCase(browser, scenario, output) {
  const { viewport, locale, theme, layer } = scenario;
  const id = `${viewport.width}x${viewport.height}-${locale}-${theme}-${layer}`;
  const result = { id, ...scenario, failures: [], consoleErrors: [], pageErrors: [], screenshot: null };
  const context = await browser.newContext({ viewport, locale, colorScheme: theme, reducedMotion: 'no-preference', deviceScaleFactor: 1, serviceWorkers: 'block' });
  let page;
  try {
    await context.addInitScript(({ locale, theme, layer }) => {
      // settings-store persists a plain object, while Zustand preferences use {state, version}.
      localStorage.setItem('lattice-settings', JSON.stringify({ language: locale, theme, onboardingCompleted: true,
        pluginsEnabled: true, enabledPlugins: ['quantum-keyboard'], trustedPlugins: ['quantum-keyboard'],
        appearance: { schemaVersion: 1, activeThemeId: 'lattice', customThemes: [] } }));
      localStorage.setItem('quantum-keyboard-preferences-v1', JSON.stringify({ version: 2,
        state: { view: 'keys', mappingSource: 'official', section: 'all', layer, selectedKey: 'KeyF', favorites: [], recent: [] } }));
    }, { locale, theme, layer });
    page = await context.newPage();
    page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
    page.on('pageerror', error => result.pageErrors.push(error.message));
    await page.goto(process.env.QUANTUM_QA_URL ?? 'http://127.0.0.1:3052/diagnostics/quantum-keyboard', { waitUntil: 'domcontentloaded', timeout: 120_000 });
    result.url = page.url();
    result.title = await page.title();
    // The diagnostic language control calls the real shared setLocale, independently
    // of settings hydration in the full application shell.
    await page.getByTestId('quantum-diagnostics').waitFor({ timeout: TIMEOUT });
    // The main element is server-rendered. Plugin activation proves the client
    // effect and diagnostic event handlers have hydrated before any UI change.
    await page.getByRole('button', { name: /^(停用插件|Disable plugin)$/u }).waitFor({ state: 'visible', timeout: TIMEOUT });
    if (await page.locator('html').evaluate((html, theme) => html.classList.contains('dark') !== (theme === 'dark'), theme)) {
      await page.getByRole('button', { name: theme === 'dark' ? /^(深色|Dark)$/u : /^(浅色|Light)$/u }).click();
    }
    await page.waitForFunction(theme => document.documentElement.classList.contains('dark') === (theme === 'dark'), theme, { timeout: TIMEOUT });
    // First setTheme may hydrate settings; choose the locale after that hydration.
    await page.getByLabel('界面语言', { exact: true }).selectOption(locale);
    await page.waitForFunction(locale => document.documentElement.lang === locale, locale, { timeout: TIMEOUT });
    result.openMethod = await openKeyboard(page);
    if (result.openMethod !== 'double-tab') result.failures.push({
      code: 'double-tab-required-fallback', details: 'The keyboard opened only through its command button after the first double Tab failed.',
    });
    const panel = page.locator(PANEL_SELECTOR);
    // Exercise the actual layer control as well as persisted restoration.
    const layerButton = panel.locator('.qk-layer-switch button').nth(layer === 'base' ? 0 : 1);
    await layerButton.click();
    await page.waitForFunction(({ selector, index }) => document.querySelector(selector)?.querySelectorAll('.qk-layer-switch button')[index]?.getAttribute('aria-pressed') === 'true', { selector: PANEL_SELECTOR, index: layer === 'base' ? 0 : 1 }, { timeout: TIMEOUT });
    // Do not let hover elevation contaminate row-bottom measurements.
    await page.mouse.move(1, 1);
    await settleRendering(page);
    result.geometry = await page.evaluate(collectQuantumGeometry);
    result.failures.push(...validateQuantumGeometry(result.geometry));
    const rendering = result.geometry.rendering;
    if (rendering.documentOverflowX > TOLERANCE) result.failures.push({ code: 'document-horizontal-scroll', details: rendering.documentOverflowX });
    if (rendering.panelOverflowX > TOLERANCE) result.failures.push({ code: 'panel-horizontal-scroll', details: rendering.panelOverflowX });
    if (rendering.dark !== (theme === 'dark')) result.failures.push({ code: 'theme-mismatch', details: rendering });
    if (rendering.lang !== locale) result.failures.push({ code: 'locale-mismatch', details: rendering });
    const expectedName = locale === 'zh-CN' ? '量子键盘' : 'Quantum Keyboard';
    if (await panel.getAttribute('aria-label') !== expectedName) result.failures.push({ code: 'panel-localization', details: await panel.getAttribute('aria-label') });
    if (await page.locator('nextjs-portal [data-nextjs-dialog], [data-nextjs-error-overlay]').count()) result.failures.push({ code: 'framework-error-overlay' });
    if (result.pageErrors.length) result.failures.push({ code: 'page-errors', details: result.pageErrors });
    if (result.consoleErrors.length) result.failures.push({ code: 'console-errors', details: result.consoleErrors });
    result.screenshot = path.join(output, `${id}.png`);
    await panel.screenshot({ path: result.screenshot, animations: 'allow' });
    // Required convenient review captures; all 24 scenarios retain their own image too.
    if (viewport.width === 1440 && layer === 'base' && ((locale === 'zh-CN' && theme === 'light') || (locale === 'en-US' && theme === 'dark'))) {
      await panel.screenshot({ path: path.join(output, `${theme}-${locale}-panel.png`), animations: 'allow' });
    }
  } catch (error) {
    result.failures.push({ code: 'scenario-error', details: error instanceof Error ? error.stack : String(error) });
    if (page) {
      result.screenshot = path.join(output, `${id}-failure.png`);
      await page.screenshot({ path: result.screenshot, fullPage: false }).catch(() => { result.screenshot = null; });
    }
  } finally {
    await context.close();
  }
  result.passed = result.failures.length === 0;
  return result;
}

function selfTest() {
  const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
  assert.equal(contained(rect(0, 0, 10, 10), rect(0, 0, 10, 10)), true);
  assert.equal(contained(rect(-2, 0, 10, 10), rect(0, 0, 10, 10)), false);
  assert.equal(contained(rect(0, 0, 0, 0), rect(0, 0, 10, 10)), false);
  assert.equal(overlaps(rect(0, 0, 8, 8), rect(7, 0, 8, 8)), false);
  assert.equal(overlaps(rect(0, 0, 8, 8), rect(6, 0, 8, 8)), true);
  assert.deepEqual(clipRect(rect(5, 5, 4000, 12), rect(5, 5, 24, 12)), rect(5, 5, 24, 12));
  const keys = 'QWERTYUIOPASDFGHJKLZXCVBNM'.split('').map((letter, index) => {
    const row = index < 10 ? 0 : index < 19 ? 1 : 2;
    const x = (index < 10 ? index : index < 19 ? index - 10 : index - 19) * 45 + 5;
    const top = row * 90 + 5;
    return { code: `Key${letter}`, rect: rect(x, top, 40, 80), candidates: Array.from({ length: 5 }, (_, number) => {
      const left = x + number % 2 * 20;
      const y = top + 16 + Math.floor(number / 2) * 18;
      return { id: `base-Key${letter}-${number + 1}`, numberText: String(number + 1), rect: rect(left, y, 19, 17),
        number: rect(left + 1, y + 1, 4, 8), glyph: rect(left + 7, y + 1, 8, 10), glyphText: 'x', glyphKind: 'katex' };
    }) };
  });
  const geometry = { panel: rect(0, 0, 500, 400), scroll: { ...rect(0, 0, 500, 350), overflowX: 0 }, deck: rect(0, 0, 500, 340),
    viewport: rect(0, 0, 960, 700), keys, rows: [keys.slice(0, 10), keys.slice(10, 19), keys.slice(19)].map(items => ({ keys: items.map(key => key.rect) })),
    utilities: Array.from({ length: 7 }, (_, index) => ({ rect: rect(5 + index * 45, 290, 40, 40) })) };
  assert.deepEqual(validateQuantumGeometry(geometry), []);
  const boundary = structuredClone(geometry);
  boundary.scroll.overflowX = 1;
  boundary.deck.bottom += 10;
  boundary.rows[0].keys[1].bottom -= 1;
  assert.deepEqual(validateQuantumGeometry(boundary), []);
  const broken = structuredClone(geometry);
  broken.scroll.overflowX = 2;
  broken.keys[0].candidates[0].glyph = { ...broken.keys[0].candidates[0].number };
  broken.keys[1].rect.bottom -= 2;
  broken.rows[0].keys[1].bottom -= 2;
  broken.keys[2].candidates[0].glyph.right = broken.keys[2].candidates[0].rect.right + 2;
  broken.deck.bottom += 11;
  const codes = validateQuantumGeometry(broken).map(failure => failure.code);
  for (const code of ['horizontal-scroll', 'number-glyph-overlap', 'glyph-outside-button', 'row-bottom-misalignment', 'deck-tail-whitespace']) assert.ok(codes.includes(code), code);
  console.log(JSON.stringify({ selfTest: 'passed', browserLaunched: false }));
}

async function main() {
  if (process.argv.includes('--self-test')) { selfTest(); return; }
  const outputRoot = path.resolve(process.env.QUANTUM_QA_OUTPUT ?? 'artifacts/quantum-keyboard-ui');
  const output = path.join(outputRoot, new Date().toISOString().replace(/[:.]/gu, '-'));
  await mkdir(output, { recursive: true });
  const report = { startedAt: new Date().toISOString(), url: process.env.QUANTUM_QA_URL ?? 'http://127.0.0.1:3052/diagnostics/quantum-keyboard',
    output, tolerancePixels: TOLERANCE, browserPath: 'Repository Playwright (Browser plugin unavailable)', cases: [], passed: false };
  let browser;
  const persistReport = async () => {
    const json = JSON.stringify(report, null, 2);
    await writeFile(path.join(output, 'report.json'), json);
    await writeFile(path.join(outputRoot, 'report.json'), json);
  };
  try {
    const allScenarios = VIEWPORTS.flatMap(viewport => LOCALES.flatMap(locale => THEMES.flatMap(theme => LAYERS.map(layer => ({ viewport, locale, theme, layer })))));
    const selected = (process.env.QUANTUM_QA_CASES ?? '').split(',').map(id => id.trim()).filter(Boolean);
    const caseId = scenario => `${scenario.viewport.width}x${scenario.viewport.height}-${scenario.locale}-${scenario.theme}-${scenario.layer}`;
    const scenarios = selected.length ? allScenarios.filter(scenario => selected.includes(caseId(scenario))) : allScenarios;
    const unknown = selected.filter(id => !allScenarios.some(scenario => caseId(scenario) === id));
    if (unknown.length) throw new Error(`Unknown QUANTUM_QA_CASES: ${unknown.join(', ')}`);
    report.plannedScenarios = scenarios.length;
    browser = await chromium.launch({ headless: true });
    for (const scenario of scenarios) {
      const result = await runCase(browser, scenario, output);
      report.cases.push(result);
      console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.id}${result.failures.length ? ': ' + result.failures.map(failure => failure.code).join(', ') : ''}`);
      await persistReport();
    }
    report.passed = report.cases.length === scenarios.length && report.cases.every(result => result.passed);
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error);
  } finally {
    if (browser) await browser.close();
    report.finishedAt = new Date().toISOString();
    report.summary = { scenarios: report.cases.length, passed: report.cases.filter(result => result.passed).length,
      failed: report.cases.filter(result => !result.passed).length };
    await persistReport();
    console.log(JSON.stringify({ passed: report.passed, summary: report.summary, report: path.join(output, 'report.json'), latestReport: path.join(outputRoot, 'report.json'), error: report.error ?? null }, null, 2));
    if (!report.passed) process.exitCode = 1;
  }
}

await main();
