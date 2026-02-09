const fn = async (page) => {
  const start = Date.now();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('text=Live Preview 自检面板', { timeout: 30000 });

  async function waitForViewerReady() {
    await page.waitForSelector('.live-preview-editor .cm-content', { timeout: 30000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('.live-preview-editor .cm-content');
      return Boolean(el && (el.textContent || '').length > 50);
    }, { timeout: 30000 });
  }

  async function selectFile(label) {
    await page.getByRole('button', { name: label }).click();
    await page.waitForSelector('text=加载中...', { timeout: 2000 }).catch(() => {});
    await waitForViewerReady();
  }

  function collectCounts() {
    return {
      hr: document.querySelectorAll('.cm-horizontal-rule').length,
      table: document.querySelectorAll('.cm-table-widget').length,
      codeBlock: document.querySelectorAll('.cm-code-block-widget').length,
      mathInline: document.querySelectorAll('.cm-math-inline').length,
      mathBlock: document.querySelectorAll('.cm-math-block').length,
      wikiLink: document.querySelectorAll('.cm-wiki-link').length,
      mdLink: document.querySelectorAll('.cm-link').length,
    };
  }

  async function runDiagnosticsOnce(label) {
    await selectFile(label);
    await page.getByRole('button', { name: '运行自检' }).click();

    await page.waitForFunction(() => {
      const text = document.body?.innerText || '';
      return text.includes('通过：未发现异常') || text.includes('失败：存在异常');
    }, { timeout: 60000 });

    const ok = await page.evaluate(() => (document.body?.innerText || '').includes('通过：未发现异常'));
    const counts = await page.evaluate(collectCounts);

    const errorsText = await page.evaluate(() => {
      const pres = Array.from(document.querySelectorAll('section pre'));
      const errorBlock = pres.find((pre) => (pre.textContent || '').includes('非法范围'))
        || pres.find((pre) => (pre.textContent || '').includes('嵌套冲突'))
        || pres.find((pre) => (pre.textContent || '').includes('转义误匹配'))
        || null;
      return (errorBlock?.textContent || '').trim();
    });

    return {
      label,
      ok,
      counts,
      errorsSnippet: errorsText ? errorsText.slice(0, 400) : '',
    };
  }

  const diagResults = [];
  for (const label of ['语法隐藏', '嵌套格式', '超长文档']) {
    diagResults.push(await runDiagnosticsOnce(label));
  }

  // Editing + rendering smoke on the first case.
  await selectFile('语法隐藏');
  const beforeEditCounts = await page.evaluate(collectCounts);

  await page.click('.live-preview-editor .cm-content');
  await page.keyboard.press('Control+End').catch(() => {});
  await page.keyboard.type(
    "\n\n## Smoke Section\n\n---\n\n|a|b|\n|-|-|\n|1|2|\n\n```c++\nint x = 0;\n```\n\n$a+b$\n",
    { delay: 2 }
  );
  await page.waitForTimeout(900);

  const afterEdit = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    return {
      smokeVisible: text.includes('Smoke Section'),
      counts: collectCounts(),
    };
  });

  // Link behavior: single-click opens, double-click edits (should NOT open).
  const linkTest = {
    hasLink: false,
    singleClickPopupUrl: null,
    doubleClickOpenedPopup: false,
  };

  const link = page.locator('.cm-link').first();
  if (await link.count()) {
    linkTest.hasLink = true;

    const popupPromise = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
    await link.click({ button: 'left' });
    await page.waitForTimeout(900);
    const popup = await popupPromise;
    if (popup) {
      await popup.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      linkTest.singleClickPopupUrl = popup.url();
      await popup.close().catch(() => {});
    }

    const popupPromise2 = page.waitForEvent('popup', { timeout: 800 }).catch(() => null);
    await link.dblclick({ button: 'left' });
    await page.waitForTimeout(900);
    const popup2 = await popupPromise2;
    if (popup2) {
      linkTest.doubleClickOpenedPopup = true;
      await popup2.close().catch(() => {});
    }
  }

  await page.screenshot({ path: 'diagnostics-smoke.png', fullPage: true });

  return {
    tookMs: Date.now() - start,
    diagResults,
    beforeEditCounts,
    afterEdit,
    linkTest,
  };
};
console.log('PARSE_OK');
