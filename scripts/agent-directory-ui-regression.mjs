import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// Opt-in synthetic UI acceptance. The diagnostic provider is deterministic;
// this script refuses remote targets and blocks all non-loopback requests.
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:4317');
assert.equal(base.protocol, 'http:');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
const output = path.resolve(process.argv[3] ?? '.lattice-build/agent-directory-ui-20261022');
const storageOnly = process.argv.includes('--storage-only');
await mkdir(output, { recursive: true });
const report = { browserPath: 'Playwright: Browser plugin/skill not available', base: base.origin,
  syntheticOnly: true, realModelRequests: 0, systemClipboardTouched: false, stages: [], pageErrors: [], blockedRequests: [], consoleErrors: [] };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' });
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (['blob:', 'data:'].includes(url.protocol) || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return route.continue();
  report.blockedRequests.push(url.origin + url.pathname);
  return route.abort('blockedbyclient');
});
await context.routeWebSocket('**/*', socket => {
  const url = new URL(socket.url());
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) { socket.connectToServer(); return; }
  report.blockedRequests.push(url.origin + url.pathname);
  socket.close({ code: 1008, reason: 'Non-loopback fixture request blocked' });
});
await context.addInitScript(() => {
  // Exercise the real product click/Markdown handler without touching the user's
  // OS clipboard. This proves the browser DOM path, not native clipboard access.
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async text => { window.__latticeFixtureClipboard = text; },
  } });
});
const page = await context.newPage();
page.on('pageerror', error => report.pageErrors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
const ledger = async () => JSON.parse(await page.getByTestId('fixture-directory-ledger').textContent());
const step = async (name, action) => {
  console.log(name);
  await action(); report.stages.push({ name, passed: true });
  await writeFile(path.join(output, 'progress.json'), JSON.stringify(report, null, 2));
};
const waitForSettled = async (previousCalls = 0) => {
  await page.waitForFunction(calls => {
    const raw = document.querySelector('[data-testid="fixture-directory-ledger"]')?.textContent;
    const value = raw ? JSON.parse(raw) : null;
    return value && value.calls > calls && ['cancelled', 'failed', 'completed'].includes(value.status)
      && ['paused', 'ready'].includes(value.phase);
  }, previousCalls, { timeout: 180_000 });
  const value = await ledger();
  assert.notEqual(value.status, 'failed', await page.getByTestId('ai-chat-request-error').allTextContents());
  return value;
};

try {
  await step('load isolated diagnostic and verify its identity', async () => {
    await page.goto(new URL('/diagnostics/agent-context-harness', base).href, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.getByTestId('agent-context-harness-ready').waitFor({ timeout: 120_000 });
    assert.equal(new URL(page.url()).pathname, '/diagnostics/agent-context-harness');
    report.pageTitle = await page.title(); assert.match(report.pageTitle, /Lattice/iu);
    assert.ok((await page.locator('body').innerText()).includes('Agent 上下文与 Harness 隔离验收'));
    await page.screenshot({ path: path.join(output, 'initial-desktop.png') });
  });
  if (!storageOnly) {
  let state;
  await step('send all 101 papers through the actual chat UI and reach the shared 48-call pause', async () => {
    await page.getByTestId('fixture-folder-101').click();
    assert.match(await page.getByTestId('ai-chat-input').inputValue(), /全部文章/);
    await page.getByTestId('ai-chat-submit').click();
    state = await waitForSettled();
    assert.equal(state.discoveryComplete, true);
    assert.equal(state.files.length, 101);
    assert.equal(state.phase, 'paused');
    assert.equal(state.calls, 48);
    assert.ok(state.files.some(file => file.status === 'pending'));
    report.firstPause = state;
    await page.getByTestId('document-reading-resume').last().waitFor();
    await page.screenshot({ path: path.join(output, 'first-budget-pause.png') });
  });
  await step('close and reopen the panel without losing the directory task', async () => {
    const id = state.sessionId;
    await page.getByTestId('fixture-toggle-panel').click();
    assert.equal(await page.getByTestId('ai-chat-input').count(), 0);
    await page.getByTestId('fixture-toggle-panel').click();
    await page.getByTestId('ai-chat-input').waitFor();
    assert.equal((await ledger()).sessionId, id);
    await page.getByTestId('document-reading-resume').last().waitFor();
  });
  await step('resume with the product progress button and retain the original scope', async () => {
    const calls = state.calls;
    await page.getByTestId('document-reading-resume').last().click();
    state = await waitForSettled(calls);
    assert.equal(state.phase, 'paused');
    assert.equal(state.calls, 96);
    assert.deepEqual(state.selections, [{ kind: 'folder', path: 'collection-101' }]);
    report.secondPause = state;
  });
  await step('type continue and complete file 101 plus hierarchical summaries', async () => {
    const calls = state.calls;
    await page.getByTestId('ai-chat-input').fill('继续');
    await page.getByTestId('ai-chat-submit').click();
    state = await waitForSettled(calls);
    assert.equal(state.phase, 'ready');
    assert.equal(state.files.length, 101);
    assert.ok(state.files.every(file => file.status === 'complete' && file.batches > 0 && file.readUnits > 0));
    assert.equal(state.files.at(-1).path, 'collection-101/topic-100/paper.md');
    assert.ok(state.files.at(-1).summaries.some(summary => summary.includes('D100')));
    assert.ok(state.reductions.length > 0);
    assert.ok(state.reductions.some(node => node.summary.includes('D000')));
    assert.ok(state.reductions.some(node => node.summary.includes('D050')));
    assert.ok(state.reductions.some(node => node.summary.includes('D100')));
    report.finalLedger = state;
    await page.screenshot({ path: path.join(output, 'completed-desktop.png') });
  });
  await step('copy the actual final Markdown through its DOM control', async () => {
    await page.getByTestId('ai-chat-copy-message').last().click();
    const text = await page.evaluate(() => window.__latticeFixtureClipboard);
    assert.match(text, /^# Fixture 回答/);
    assert.ok(text.includes('$$E=mc^2$$'));
    assert.ok(text.includes('```ts'));
    assert.ok(text.includes('| Markdown |'));
    report.copiedMarkdownCharacters = text.length;
  });
  await step('verify English and Chinese controls at narrow width without input/toolbar overlap', async () => {
    await page.getByTestId('fixture-model-display').click();
    await page.setViewportSize({ width: 390, height: 1000 });
    for (const locale of ['en', 'zh']) {
      await page.getByTestId(`fixture-language-${locale}`).click();
      assert.equal(await page.locator('html').getAttribute('lang'), locale === 'en' ? 'en-US' : 'zh-CN');
      assert.match(await page.getByTestId('ai-chat-input').getAttribute('placeholder'), locale === 'en' ? /Type a message/iu : /输入消息/u);
      const input = await page.getByTestId('ai-chat-input').boundingBox();
      const toolbar = await page.getByTestId('ai-chat-composer-toolbar').boundingBox();
      const submit = await page.getByTestId('ai-chat-submit').boundingBox();
      const engine = await page.getByTestId('ai-runtime-engine').boundingBox();
      const model = await page.getByTestId('ai-chat-model-select').boundingBox();
      assert.ok(input && toolbar && submit && engine && model);
      assert.ok(input.y + input.height <= toolbar.y + 1);
      assert.ok(submit.x >= 0 && submit.x + submit.width <= 391);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.ok(engine.width >= 130 && model.width >= 130, `Source/model labels collapsed: ${engine.width}/${model.width}`);
      assert.equal(await page.getByTestId('ai-chat-model-select').inputValue(), 'agent-context-fixture');
      assert.equal(await page.getByTestId('ai-chat-model-select').locator('option:checked').innerText(), 'Local fixture (offline)');
      report[`${locale}NarrowGeometry`] = { input, toolbar, submit, engine, model };
      await page.screenshot({ path: path.join(output, `completed-narrow-${locale}.png`) });
    }
    await page.getByTestId('fixture-language-en').click();
    await page.getByRole('combobox', { name: 'AI source', exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'AI model', exact: true }).waitFor();
    await page.getByTestId('ai-runtime-engine').selectOption('codex');
    await page.getByRole('button', { name: 'AI connection settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'AI connection settings', exact: true });
    await dialog.waitFor();
    assert.equal(/\p{Script=Han}/u.test(await dialog.innerText()), false, 'English local settings contain Chinese labels');
    await page.screenshot({ path: path.join(output, 'narrow-english-local-settings.png') });
    await page.getByRole('button', { name: 'Close AI connection settings', exact: true }).click();
    await page.getByTestId('ai-runtime-engine').selectOption('api:display-only-fixture');
  });
  await step('keep the wide-panel source and selected model on the same readable row', async () => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    const wideEngine = await page.getByTestId('ai-runtime-engine').boundingBox();
    const wideModel = await page.getByTestId('ai-chat-model-select').boundingBox();
    assert.ok(wideEngine && wideModel && Math.abs(wideEngine.y - wideModel.y) < 1);
    assert.ok(wideEngine.width >= 130 && wideModel.width >= 130);
    report.wideRuntimeGeometry = { engine: wideEngine, model: wideModel };
  });
  const requests = JSON.parse(await page.getByTestId('fixture-requests').textContent());
  report.requestKinds = requests.reduce((counts, request) => ({ ...counts, [request.kind]: (counts[request.kind] ?? 0) + 1 }), {});
  assert.ok(report.requestKinds['directory-reduction'] > 0);
  }
  await step('strictly save a greater-than-6MB synthetic checkpoint then reload it through real IndexedDB', async () => {
    await page.getByTestId('fixture-large-storage').click();
    await page.waitForFunction(() => {
      const raw = document.querySelector('[data-testid="fixture-large-storage-state"]')?.textContent;
      return raw && /^(?:saved|error:)/.test(JSON.parse(raw).status);
    }, undefined, { timeout: 30_000 });
    const saved = JSON.parse(await page.getByTestId('fixture-large-storage-state').textContent());
    assert.equal(saved.status, 'saved', 'Strict synthetic checkpoint persistence failed: ' + saved.status);
    const capture = () => page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('lattice-agent-sessions-v2');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      let data;
      try { data = await new Promise((resolve, reject) => {
        const request = db.transaction('state', 'readonly').objectStore('state').get('sessions');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      }); } finally { db.close(); }
      const text = JSON.stringify(data);
      const bytes = new TextEncoder().encode(text);
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      const session = data.sessions.find(item => item.id === 'synthetic-large-storage-fixture');
      return { bytes: bytes.length, sha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''),
        summaries: session?.documentResearch?.checkpoint.summaries.length,
        first: session?.documentResearch?.checkpoint.summaries[0]?.slice(0, 40),
        last: session?.documentResearch?.checkpoint.summaries.at(-1)?.slice(0, 40) };
    });
    const before = await capture();
    assert.ok(before.bytes > 6_000_000, `Expected >6MB actual stored record, got ${before.bytes}`);
    assert.equal(before.summaries, 3200);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.getByTestId('agent-context-harness-ready').waitFor({ timeout: 120_000 });
    const loaded = JSON.parse(await page.getByTestId('fixture-large-storage-state').textContent());
    assert.equal(loaded.present, true);
    assert.equal(loaded.summaries, 3200);
    const after = await capture();
    assert.deepEqual(after, before);
    report.largeStorage = { before, after, restoredThroughProductStore: true };
    await page.evaluate(() => {
      const original = IDBDatabase.prototype.transaction;
      window.__latticeFixtureTransaction = original;
      window.__latticeFixtureAbortCount = 0;
      IDBDatabase.prototype.transaction = function (...args) {
        const tx = Reflect.apply(original, this, args);
        if (this.name === 'lattice-agent-sessions-v2' && args[1] === 'readwrite') {
          const objectStore = tx.objectStore.bind(tx);
          tx.objectStore = name => {
            const store = objectStore(name), put = store.put.bind(store);
            store.put = (...values) => {
              const request = put(...values);
              window.__latticeFixtureAbortCount++;
              tx.abort();
              return request;
            };
            return store;
          };
        }
        return tx;
      };
    });
    try {
      await page.getByTestId('fixture-large-storage').click();
      await page.waitForFunction(() => {
        const raw = document.querySelector('[data-testid="fixture-large-storage-state"]')?.textContent;
        return raw && JSON.parse(raw).status.startsWith('error:');
      }, undefined, { timeout: 30_000 });
      const abortedWrites = await page.evaluate(() => window.__latticeFixtureAbortCount);
      assert.ok(abortedWrites > 0, 'The real IndexedDB write was not reached');
      const afterAbort = await capture();
      assert.deepEqual(afterAbort, before);
      report.largeStorage.abort = { abortedWrites, actualTransactionRollback: true, originalRecordPreserved: true, afterAbort };
    } finally {
      await page.evaluate(() => { IDBDatabase.prototype.transaction = window.__latticeFixtureTransaction; delete window.__latticeFixtureTransaction; });
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.getByTestId('agent-context-harness-ready').waitFor({ timeout: 120_000 });
    const restored = JSON.parse(await page.getByTestId('fixture-large-storage-state').textContent());
    assert.equal(restored.present, true); assert.equal(restored.summaries, 3200);
    assert.deepEqual(await capture(), before);
    report.largeStorage.abort.restoredThroughProductStore = true;
  });
  assert.equal(report.pageErrors.length, 0, report.pageErrors.join('\n'));
  assert.equal(report.consoleErrors.length, 0, report.consoleErrors.join('\n'));
  assert.equal(await page.locator('nextjs-portal').evaluateAll(portals => portals.some(portal => portal.shadowRoot?.querySelector('[data-nextjs-dialog]'))), false, 'Unexpected framework error overlay');
  report.success = true;
} catch (error) {
  report.success = false; report.error = error.stack ?? String(error);
  report.body = await page.locator('body').innerText().catch(() => 'not available');
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  await context.close(); await browser.close();
}
console.log(JSON.stringify({ success: report.success, stages: report.stages.length, error: report.error, output }));
