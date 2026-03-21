import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const DEFAULT_PORT = Number(process.env.LATTICE_BROWSER_REGRESSION_PORT ?? 3217);
const HOST = "127.0.0.1";
const OUTPUT_DIR = path.resolve(process.cwd(), "output", "playwright");

async function ensureOutputDir() {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

function startNextDevServer(port) {
  const nextBin = path.resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", "-H", HOST, "-p", String(port)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "development",
    },
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[next] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[next] ${chunk}`);
  });

  return child;
}

async function probePort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(null));
    server.once("listening", () => {
      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : null;
      server.close(() => resolve(resolvedPort));
    });
    server.listen(port, HOST);
  });
}

async function findAvailablePort(startPort, maxAttempts = 10) {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = startPort + offset;
    const resolvedPort = await probePort(port);
    if (resolvedPort) {
      return resolvedPort;
    }
  }

  const ephemeralPort = await probePort(0);
  if (ephemeralPort) {
    return ephemeralPort;
  }

  throw new Error(`No available port found starting from ${startPort}, and failed to acquire an ephemeral port.`);
}

async function stopServer(child) {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
    await once(killer, "exit");
    return;
  }

  child.kill("SIGTERM");
  await once(child, "exit");
}

async function waitForServer(url, timeoutMs = 120000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.ok || response.status === 307 || response.status === 308) {
        return;
      }
      lastError = new Error(`Unexpected status: ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw lastError ?? new Error("Timed out waiting for Next dev server.");
}

async function screenshotOnFailure(page, name) {
  const filePath = path.join(OUTPUT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
}

async function expectText(locator, expected, message) {
  const received = (await locator.textContent())?.trim() ?? "";
  if (received !== expected) {
    throw new Error(`${message}: expected "${expected}" but received "${received}"`);
  }
}

async function waitForNumericTextAtLeast(page, testId, minimum, message) {
  await page.waitForFunction(({ id, threshold }) => {
    const value = Number(document.querySelector(`[data-testid="${id}"]`)?.textContent ?? "0");
    return value >= threshold;
  }, { id: testId, threshold: minimum }, { timeout: 120000 });

  const received = Number((await page.getByTestId(testId).textContent())?.trim() ?? "0");
  if (received < minimum) {
    throw new Error(`${message}: expected >= ${minimum} but received ${received}`);
  }
}

async function waitForNumericTextAtMost(page, testId, maximum, message) {
  await page.waitForFunction(({ id, limit }) => {
    const value = Number(document.querySelector(`[data-testid="${id}"]`)?.textContent ?? "999");
    return value <= limit;
  }, { id: testId, limit: maximum }, { timeout: 120000 });

  const received = Number((await page.getByTestId(testId).textContent())?.trim() ?? "999");
  if (received > maximum) {
    throw new Error(`${message}: expected <= ${maximum} but received ${received}`);
  }
}

async function waitForTruthyText(page, testId, message) {
  await page.waitForFunction((id) => {
    const value = document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim();
    return value && value !== "无" && value !== "0" && value !== "false";
  }, testId, { timeout: 120000 });

  const received = (await page.getByTestId(testId).textContent())?.trim() ?? "";
  if (!received || received === "无" || received === "0" || received === "false") {
    throw new Error(`${message}: expected truthy text but received "${received}"`);
  }
}

async function waitForExactText(page, testId, expected, message) {
  await page.waitForFunction(({ id, value }) => {
    const received = document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim();
    return received === value;
  }, { id: testId, value: expected }, { timeout: 120000 });

  await expectText(page.getByTestId(testId), expected, message);
}

async function runWithRetries(label, attempts, fn) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fn(attempt);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`${label} failed`);
}

async function ensureSelectionAiHubOpen(page) {
  const reopenButton = page.getByTestId("reopen-selection-ai-hub");
  if (await reopenButton.isVisible().catch(() => false)) {
    await reopenButton.click();
  }

  await page.getByRole("button", { name: "发送到快速问答" }).waitFor({ timeout: 30000 });
}

async function runSelectionAiFlow(page, options) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await ensureSelectionAiHubOpen(page);

      if (options.modeButtonName) {
        await page.getByRole("button", { name: options.modeButtonName }).click();
      }

      const promptBox = page.locator("textarea").first();
      await promptBox.fill(options.prompt);
      await page.waitForFunction(
        ({ selector, value }) => {
          const element = document.querySelector(selector);
          return element instanceof HTMLTextAreaElement && element.value === value;
        },
        { selector: "textarea", value: options.prompt },
        { timeout: 15000 },
      );

      await page.getByRole("button", { name: options.submitButtonName }).click();
      for (const assertion of options.assertions) {
        await assertion();
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await page.getByTestId("reset-selection-ai-diagnostics").click();
        await page.waitForTimeout(1000);
      }
    }
  }

  throw lastError ?? new Error("Selection AI browser regression failed.");
}

async function ensurePdfPaneVisiblePage(page, shellTestId, pageTestId, activateTestId, minimum = 1) {
  let lastError = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      if (activateTestId) {
        await page.getByTestId(activateTestId).click();
      }
      await page.getByTestId(shellTestId).hover();
      await page.waitForFunction(({ id, threshold }) => {
        const value = Number(document.querySelector(`[data-testid="${id}"]`)?.textContent ?? "0");
        return value >= threshold;
      }, { id: pageTestId, threshold: minimum }, { timeout: 30000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1500);
    }
  }

  throw lastError ?? new Error(`Timed out waiting for ${pageTestId} to reach ${minimum}.`);
}

async function testPdfRegression(page, baseUrl) {
  await runWithRetries("pdf-regression", 3, async () => {
    await page.goto(`${baseUrl}/diagnostics/pdf-regression`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("pdf-regression-ready").waitFor({ timeout: 120000 });
    await ensurePdfPaneVisiblePage(page, "pdf-left-shell", "pdf-left-state-visible-page", "activate-left-pane", 1);
    await ensurePdfPaneVisiblePage(page, "pdf-right-shell", "pdf-right-state-visible-page", "activate-right-pane", 1);
    await page.getByTestId("activate-left-pane").click();
    await expectText(page.getByTestId("pdf-right-state-visible-page"), "1", "Right pane initial visible page");

    const rightShell = await page.getByTestId("pdf-right-shell").boundingBox();
    const viewport = page.viewportSize();
    if (!rightShell || !viewport || rightShell.x + rightShell.width > viewport.width + 1) {
      throw new Error("Right PDF pane overflowed the viewport.");
    }

    await expectText(page.getByTestId("pdf-zoom-label-pdf-left-pane"), "适宽", "Left pane initial zoom");
    await expectText(page.getByTestId("pdf-zoom-label-pdf-right-pane"), "适宽", "Right pane initial zoom");

    await page.keyboard.press("Control+=");
    await expectText(page.getByTestId("pdf-zoom-label-pdf-left-pane"), "145%", "Left pane keyboard zoom");
    await expectText(page.getByTestId("pdf-zoom-label-pdf-right-pane"), "适宽", "Right pane unchanged after left keyboard zoom");

    await page.getByTestId("pdf-pane-pdf-right-pane").hover();
    await page.keyboard.press("Control+=");
    await expectText(page.getByTestId("pdf-zoom-label-pdf-left-pane"), "145%", "Left pane remains stable after right hover keyboard zoom");
    await expectText(page.getByTestId("pdf-zoom-label-pdf-right-pane"), "145%", "Right pane keyboard zoom after hover");

    await page.getByTestId("scroll-right-to-page-6").click();
    await page.waitForTimeout(600);
    await waitForNumericTextAtLeast(page, "pdf-right-state-visible-page", 5, "Right pane visible page after scroll");
    await waitForNumericTextAtLeast(page, "pdf-right-state-anchor-page", 5, "Right pane anchor page after scroll");

    await page.getByTestId("toggle-right-file").click();
    await expectText(page.getByTestId("right-file-indicator"), "right-fixture-b.pdf", "Right pane switched to fixture B");
    await page.getByTestId("toggle-right-file").click();
    await expectText(page.getByTestId("right-file-indicator"), "right-fixture-a.pdf", "Right pane switched back to fixture A");
    await expectText(page.getByTestId("pdf-zoom-label-pdf-right-pane"), "145%", "Right pane restored manual zoom after file switch");
    await expectText(page.getByTestId("pdf-right-state-restore-ok"), "true", "Right pane manual zoom restore");
    await waitForNumericTextAtLeast(page, "pdf-right-state-anchor-page", 5, "Right pane anchor page restored after file switch");
    await waitForNumericTextAtMost(page, "pdf-right-state-restore-delta-top", 0.08, "Right pane anchor top delta after manual restore");

    await page.getByTestId("pdf-fit-width-pdf-right-pane").click();
    await expectText(page.getByTestId("pdf-zoom-label-pdf-right-pane"), "适宽", "Right pane fit-width label");
    await page.getByTestId("toggle-right-file").click();
    await page.getByTestId("toggle-right-file").click();
    await expectText(page.getByTestId("pdf-zoom-label-pdf-right-pane"), "适宽", "Right pane restored fit-width after file switch");
    await expectText(page.getByTestId("pdf-right-state-restore-ok"), "true", "Right pane fit-width restore");

    await page.getByTestId("toggle-pdf-compact-layout").click();
    await expectText(page.getByTestId("pdf-right-state-restore-ok"), "true", "Right pane restore after compact layout");
    await waitForNumericTextAtMost(page, "pdf-right-state-restore-delta-top", 0.08, "Right pane anchor top delta after compact layout");
  });
}

async function testImageAnnotation(page, baseUrl) {
  await page.goto(`${baseUrl}/diagnostics/image-annotation`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("image-annotation-ready").waitFor({ timeout: 120000 });
  await page.getByTestId("image-tldraw-toolbar").waitFor({ timeout: 120000 });
  await waitForExactText(page, "image-annotation-adapter-ready", "true", "Image annotation adapter ready");
  await page.getByTestId("create-image-sample-annotation").click();
  await waitForNumericTextAtLeast(page, "image-annotation-shape-count", 1, "Image annotation sample shape created");
  await page.waitForTimeout(2200);
  await page.getByTestId("read-image-annotation-sidecar").click();
  await waitForNumericTextAtLeast(page, "image-annotation-sidecar-count", 1, "Image annotation sidecar count");
  await expectText(page.getByTestId("image-annotation-sidecar-has-image"), "true", "Image annotation sidecar image target");

  const currentAnnotationId = (await page.getByTestId("image-annotation-current-id").textContent())?.trim() ?? "";
  if (!currentAnnotationId || currentAnnotationId === "无") {
    throw new Error("Image annotation diagnostics did not expose a persisted annotation id.");
  }

  await page.getByTestId("force-image-annotation-remount").click();
  await expectText(page.getByTestId("image-annotation-rerender-count"), "1", "Image annotation remount count after forced remount");
  await waitForExactText(page, "image-annotation-adapter-ready", "true", "Image annotation adapter ready after remount");
  await waitForNumericTextAtLeast(page, "image-annotation-shape-count", 1, "Image annotation restored shape count after remount");
  await expectText(page.getByTestId("image-annotation-current-id"), currentAnnotationId, "Image annotation id restored after remount");

  const pageText = await page.textContent("body");
  if ((pageText ?? "").includes("Drawing tools unavailable")) {
    throw new Error("Image annotation diagnostics fell back to error mode.");
  }
}

async function testSelectionAi(page, baseUrl) {
  await page.goto(`${baseUrl}/diagnostics/selection-ai`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("selection-ai-regression-ready").waitFor({ timeout: 120000 });

  await runSelectionAiFlow(page, {
    prompt: "Chat diagnostics prompt",
    submitButtonName: "发送到快速问答",
    assertions: [
      () => waitForExactText(page, "selection-ai-latest-origin", "chat", "Selection AI chat origin"),
      () => waitForExactText(page, "selection-ai-evidence-count", "2", "Selection AI chat evidence count"),
      () => waitForExactText(page, "selection-ai-provider", "Diagnostics Local Provider", "Selection AI provider override"),
      () => waitForExactText(page, "selection-ai-model", "selection-regression", "Selection AI model override"),
      () => waitForExactText(page, "selection-ai-preferred-mode", "chat", "Selection AI preferred chat mode"),
    ],
  });

  await page.getByTestId("reset-selection-ai-diagnostics").click();
  await runSelectionAiFlow(page, {
    modeButtonName: "Agent",
    prompt: "Agent diagnostics prompt",
    submitButtonName: "启动深度分析",
    assertions: [
      () => waitForExactText(page, "selection-ai-latest-origin", "agent", "Selection AI agent origin"),
      () => waitForExactText(page, "selection-ai-evidence-count", "2", "Selection AI agent evidence count"),
      () => waitForExactText(page, "selection-ai-preferred-mode", "agent", "Selection AI preferred agent mode"),
    ],
  });

  await page.getByTestId("reset-selection-ai-diagnostics").click();
  await runSelectionAiFlow(page, {
    modeButtonName: "Plan",
    prompt: "Plan diagnostics prompt",
    submitButtonName: "生成整理计划",
    assertions: [
      () => waitForExactText(page, "selection-ai-proposal-count", "1", "Selection AI plan proposal count"),
      () => waitForTruthyText(page, "selection-ai-highlighted-proposal", "Selection AI plan highlighted proposal"),
      () => waitForExactText(page, "selection-ai-preferred-mode", "plan", "Selection AI preferred plan mode"),
    ],
  });
}

async function main() {
  await ensureOutputDir();

  const port = await findAvailablePort(DEFAULT_PORT);
  const baseUrl = `http://${HOST}:${port}`;
  const server = startNextDevServer(port);
  let browser;

  try {
    await waitForServer(`${baseUrl}/diagnostics`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1720, height: 1080 } });

    try {
      await testPdfRegression(page, baseUrl);
      await testImageAnnotation(page, baseUrl);
      await testSelectionAi(page, baseUrl);
      console.log("Browser regression completed.");
    } catch (error) {
      await screenshotOnFailure(page, "browser-regression-failure");
      throw error;
    }
  } finally {
    if (browser) {
      await browser.close();
    }
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
