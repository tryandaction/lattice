import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const DEFAULT_PORT = Number(process.env.LATTICE_BROWSER_REGRESSION_PORT ?? 3217);
const HOST = "127.0.0.1";
const OUTPUT_DIR = path.resolve(process.cwd(), "output", "playwright");
const REGRESSION_DIST_DIR = process.env.LATTICE_BROWSER_REGRESSION_DIST_DIR?.trim() || "web-dist-browser-regression";

async function ensureOutputDir() {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

async function prepareRegressionDistDir() {
  await rm(path.resolve(process.cwd(), REGRESSION_DIST_DIR), { recursive: true, force: true });
}

function startNextDevServer(port) {
  const nextBin = path.resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", "-H", HOST, "-p", String(port)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "development",
      NEXT_DIST_DIR: REGRESSION_DIST_DIR,
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
      const response = await new Promise((resolve, reject) => {
        const request = http.get(url, (res) => {
          res.resume();
          resolve(res);
        });
        request.on("error", reject);
      });
      if (
        (typeof response.statusCode === "number" && response.statusCode >= 200 && response.statusCode < 300) ||
        response.statusCode === 307 ||
        response.statusCode === 308
      ) {
        return;
      }
      lastError = new Error(`Unexpected status: ${response.statusCode}`);
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

async function waitForNumericTextChange(page, testId, minimum, message) {
  await page.waitForFunction(({ id, threshold }) => {
    const value = Number(document.querySelector(`[data-testid="${id}"]`)?.textContent ?? "0");
    return value >= threshold;
  }, { id: testId, threshold: minimum }, { timeout: 120000 });

  const received = Number((await page.getByTestId(testId).textContent())?.trim() ?? "0");
  if (received < minimum) {
    throw new Error(`${message}: expected >= ${minimum} but received ${received}`);
  }
}

async function waitForTruthyText(page, testId, message) {
  await page.waitForFunction((id) => {
    const value = document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim();
    return value && value !== "0" && value !== "false";
  }, testId, { timeout: 120000 });

  const received = (await page.getByTestId(testId).textContent())?.trim() ?? "";
  if (!received || received === "0" || received === "false") {
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

async function waitForRestoreReady(page, panePrefix, message) {
  const okTestId = `${panePrefix}-restore-ok`;
  const statusTestId = `${panePrefix}-restore-status`;
  await page.waitForFunction(({ okId, statusId }) => {
    const ok = document.querySelector(`[data-testid="${okId}"]`)?.textContent?.trim();
    const status = document.querySelector(`[data-testid="${statusId}"]`)?.textContent?.trim();
    return ok === "true" && (status === "restored" || status === "fallback");
  }, { okId: okTestId, statusId: statusTestId }, { timeout: 120000 });

  await expectText(page.getByTestId(okTestId), "true", `${message} restore ok`);
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

  await page.getByTestId("selection-ai-submit").waitFor({ timeout: 30000 });
}

async function resetSelectionAiDiagnostics(page) {
  const reopenButton = page.getByTestId("reopen-selection-ai-hub");
  if (!(await reopenButton.isVisible().catch(() => false))) {
    await page.keyboard.press("Escape");
    await reopenButton.waitFor({ timeout: 30000 });
  }

  await page.getByTestId("reset-selection-ai-diagnostics").click();
  await page.waitForTimeout(1000);
}

async function runSelectionAiFlow(page, options) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await ensureSelectionAiHubOpen(page);

      if (options.modeButtonName) {
        const modeTestId = `selection-ai-mode-${options.modeButtonName.toLowerCase()}`;
        await page.getByTestId(modeTestId).click();
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

      await page.getByTestId("selection-ai-submit").click();
      for (const assertion of options.assertions) {
        await assertion();
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await resetSelectionAiDiagnostics(page);
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

async function resolvePdfScrollableSelector(page, paneId) {
  return page.evaluate((targetPaneId) => {
    const shell = document.querySelector(`[data-testid="${targetPaneId === "pdf-left-pane" ? "pdf-left-shell" : "pdf-right-shell"}"]`);
    if (!(shell instanceof HTMLElement)) {
      return null;
    }

    const preferred = document.querySelector(`[data-testid="pdf-viewer-container-${targetPaneId}"]`)
      ?? shell.querySelector(`[data-testid="pdf-scroll-container-${targetPaneId}"]`);
    if (preferred instanceof HTMLElement) {
      if (!preferred.id) {
        preferred.id = `pdf-scroll-target-${targetPaneId}`;
      }
      return `#${preferred.id}`;
    }

    const candidates = Array.from(shell.querySelectorAll("*"))
      .filter((element) => element instanceof HTMLElement)
      .map((element) => ({
        element,
        overflow: (element.scrollHeight - element.clientHeight) + (element.scrollWidth - element.clientWidth),
      }))
      .sort((left, right) => right.overflow - left.overflow);

    const target = candidates[0]?.element;
    if (!(target instanceof HTMLElement)) {
      return null;
    }

    if (!target.id) {
      target.id = `pdf-scroll-target-${targetPaneId}`;
    }

    return `#${target.id}`;
  }, paneId);
}

async function waitForPdfScrollableReady(page, paneId, minimumOverflow = 500) {
  await page.waitForFunction(({ targetPaneId, threshold }) => {
    const shell = document.querySelector(`[data-testid="${targetPaneId === "pdf-left-pane" ? "pdf-left-shell" : "pdf-right-shell"}"]`);
    if (!(shell instanceof HTMLElement)) {
      return false;
    }

    const preferred = document.querySelector(`[data-testid="pdf-viewer-container-${targetPaneId}"]`)
      ?? shell.querySelector(`[data-testid="pdf-scroll-container-${targetPaneId}"]`);
    if (preferred instanceof HTMLElement) {
      return ((preferred.scrollHeight - preferred.clientHeight) + (preferred.scrollWidth - preferred.clientWidth)) > threshold;
    }

    const candidates = Array.from(shell.querySelectorAll("*"))
      .filter((element) => element instanceof HTMLElement)
      .map((element) => (element.scrollHeight - element.clientHeight) + (element.scrollWidth - element.clientWidth));

    return candidates.some((overflow) => overflow > threshold);
  }, { targetPaneId: paneId, threshold: minimumOverflow }, { timeout: 120000 });
}

async function scrollPdfPaneDeep(page, paneId, topRatio = 0.82) {
  await waitForPdfScrollableReady(page, paneId);
  const selector = await resolvePdfScrollableSelector(page, paneId);
  if (!selector) {
    throw new Error(`Unable to resolve PDF scroll container for ${paneId}.`);
  }

  await page.evaluate(({ resolvedSelector, ratio }) => {
    const container = document.querySelector(resolvedSelector);
    if (!(container instanceof HTMLElement)) {
      throw new Error(`Unable to locate PDF scroll container: ${resolvedSelector}`);
    }

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTo({
      top: maxScrollTop * ratio,
      behavior: "auto",
    });
  }, { resolvedSelector: selector, ratio: topRatio });
}

async function testPdfRegression(page, baseUrl) {
  await runWithRetries("pdf-regression", 3, async () => {
    console.log("[pdf-regression] open page");
    await page.goto(`${baseUrl}/diagnostics/pdf-regression`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("pdf-regression-ready").waitFor({ timeout: 120000 });
    console.log("[pdf-regression] wait panes visible");
    await ensurePdfPaneVisiblePage(page, "pdf-left-shell", "pdf-left-state-visible-page", "activate-left-pane", 1);
    await ensurePdfPaneVisiblePage(page, "pdf-right-shell", "pdf-right-state-visible-page", "activate-right-pane", 1);
    await page.getByTestId("activate-left-pane").click();
    await expectText(page.getByTestId("pdf-right-state-visible-page"), "1", "Right pane initial visible page");

    const rightShell = await page.getByTestId("pdf-right-shell").boundingBox();
    const viewport = page.viewportSize();
    if (!rightShell || !viewport || rightShell.x + rightShell.width > viewport.width + 1) {
      throw new Error("Right PDF pane overflowed the viewport.");
    }

    console.log("[pdf-regression] verify default viewer route");
    await page.getByTestId("pdf-viewer-pdf-plain-pane").waitFor({ timeout: 120000 });
    await page.getByTestId("pdf-annotate-trigger-pdf-plain-pane").click();
    await page.getByTestId("pdf-pane-pdf-plain-pane").waitFor({ timeout: 120000 });
    await page.getByTestId("pdf-pane-pdf-left-pane").hover();
    await page.getByTestId("activate-left-pane").click();

    const initialLeftZoom = (await page.getByTestId("pdf-zoom-label-pdf-left-pane").textContent())?.trim() ?? "";
    const initialRightZoom = (await page.getByTestId("pdf-zoom-label-pdf-right-pane").textContent())?.trim() ?? "";
    if (!initialLeftZoom || initialLeftZoom !== initialRightZoom) {
      throw new Error(`Expected both panes to start with the same zoom label, got left="${initialLeftZoom}" right="${initialRightZoom}"`);
    }

    console.log("[pdf-regression] keyboard zoom left");
    await page.keyboard.press("Control+=");
    await expectText(page.getByTestId("pdf-zoom-label-pdf-left-pane"), "145%", "Left pane keyboard zoom");
    await expectText(page.getByTestId("pdf-zoom-label-pdf-right-pane"), initialRightZoom, "Right pane unchanged after left keyboard zoom");

    console.log("[pdf-regression] keyboard zoom right");
    await page.getByTestId("pdf-pane-pdf-right-pane").hover();
    await page.keyboard.press("Control+=");
    await expectText(page.getByTestId("pdf-zoom-label-pdf-left-pane"), "145%", "Left pane remains stable after right hover keyboard zoom");
    await expectText(page.getByTestId("pdf-zoom-label-pdf-right-pane"), "145%", "Right pane keyboard zoom after hover");

    console.log("[pdf-regression] scroll right deep");
    await page.getByTestId("scroll-right-to-page-6").click();
    await page.waitForTimeout(800);
    await waitForNumericTextAtLeast(page, "pdf-right-state-anchor-page", 5, "Right pane anchor page after scroll");

    console.log("[pdf-regression] switch file and restore manual zoom");
    await page.getByTestId("toggle-right-file").click();
    await expectText(page.getByTestId("right-file-indicator"), "right-fixture-b.pdf", "Right pane switched to fixture B");
    await ensurePdfPaneVisiblePage(page, "pdf-right-shell", "pdf-right-state-visible-page", "activate-right-pane", 1);
    await page.waitForTimeout(2500);
    await page.getByTestId("toggle-right-file").click();
    await expectText(page.getByTestId("right-file-indicator"), "right-fixture-a.pdf", "Right pane switched back to fixture A");
    await waitForRestoreReady(page, "pdf-right-state", "Right pane restore after file switch");
    await expectText(page.getByTestId("pdf-zoom-label-pdf-right-pane"), "145%", "Right pane restored manual zoom after file switch");
    await waitForNumericTextAtLeast(page, "pdf-right-state-anchor-page", 5, "Right pane anchor page restored after file switch");
    await waitForNumericTextAtMost(page, "pdf-right-state-restore-delta-top", 0.08, "Right pane anchor top delta after manual restore");

    // Keep fit-width / compact-layout recovery for manual diagnostics. The current
    // browser regression gate is intentionally scoped to the stable core chain:
    // split layout + pane-scoped zoom + deep-page progress + file-switch restore.
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
  if (!currentAnnotationId) {
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
    submitButtonName: "unused",
    assertions: [
      () => waitForExactText(page, "selection-ai-latest-origin", "chat", "Selection AI chat origin"),
      () => waitForExactText(page, "selection-ai-evidence-count", "2", "Selection AI chat evidence count"),
      () => waitForExactText(page, "selection-ai-provider", "Diagnostics Local Provider", "Selection AI provider override"),
      () => waitForExactText(page, "selection-ai-model", "selection-regression", "Selection AI model override"),
      () => waitForExactText(page, "selection-ai-preferred-mode", "chat", "Selection AI preferred chat mode"),
    ],
  });

  await resetSelectionAiDiagnostics(page);
  await runSelectionAiFlow(page, {
    modeButtonName: "Agent",
    prompt: "Agent diagnostics prompt",
    submitButtonName: "unused",
    assertions: [
      () => waitForExactText(page, "selection-ai-latest-origin", "agent", "Selection AI agent origin"),
      () => waitForExactText(page, "selection-ai-evidence-count", "2", "Selection AI agent evidence count"),
      () => waitForExactText(page, "selection-ai-preferred-mode", "agent", "Selection AI preferred agent mode"),
    ],
  });

  await resetSelectionAiDiagnostics(page);
  await runSelectionAiFlow(page, {
    modeButtonName: "Plan",
    prompt: "Plan diagnostics prompt",
    submitButtonName: "unused",
    assertions: [
      () => waitForExactText(page, "selection-ai-proposal-count", "1", "Selection AI plan proposal count"),
      () => waitForTruthyText(page, "selection-ai-highlighted-proposal", "Selection AI plan highlighted proposal"),
      () => waitForExactText(page, "selection-ai-preferred-mode", "plan", "Selection AI preferred plan mode"),
    ],
  });
}

async function testPerformanceBaseline(page, baseUrl) {
  await runWithRetries("performance-baseline", 2, async () => {
    await page.goto(`${baseUrl}/performance-test`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("performance-test-ready").waitFor({ timeout: 120000 });
    const runButton = page.getByTestId("run-performance-baseline");
    await runButton.waitFor({ timeout: 120000 });

    let started = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await runButton.click({ force: true });
      try {
        await page.waitForFunction((id) => {
          const value = document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim();
          return value === "running" || value === "completed" || value === "failed";
        }, "performance-baseline-status", { timeout: 15000 });
        started = true;
        break;
      } catch {
        if (attempt === 2) {
          throw new Error("Performance baseline did not start after repeated click attempts.");
        }
      }
    }

    if (!started) {
      throw new Error("Performance baseline did not start.");
    }

    await page.waitForFunction((id) => {
      const value = document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim();
      return value === "completed" || value === "failed";
    }, "performance-baseline-status", { timeout: 180000 });

    await waitForExactText(page, "performance-baseline-status", "completed", "Performance baseline overall status");
    await expectText(page.getByTestId("performance-baseline-failures"), "0", "Performance baseline failure count");
    await expectText(page.getByTestId("performance-baseline-count"), "3", "Performance baseline result count");
    await expectText(page.getByTestId("performance-status-markdown-live-preview-10000"), "Pass", "Markdown performance baseline");
    await expectText(page.getByTestId("performance-status-code-editor-javascript-5000"), "Pass", "Code editor performance baseline");
    await expectText(page.getByTestId("performance-status-annotation-index-lookup-8000"), "Pass", "Annotation index performance baseline");
  });
}

async function main() {
  await ensureOutputDir();
  await prepareRegressionDistDir();

  const port = await findAvailablePort(DEFAULT_PORT);
  const baseUrl = `http://${HOST}:${port}`;
  const server = startNextDevServer(port);
  let browser;

  try {
    await waitForServer(`${baseUrl}`, 300000);
    browser = await chromium.launch({ headless: true });
    const createPage = () => browser.newPage({ viewport: { width: 1720, height: 1080 } });

    const runFlow = async (name, flow) => {
      const page = await createPage();
      try {
        await flow(page, baseUrl);
      } catch (error) {
        try {
          await screenshotOnFailure(page, `browser-regression-failure-${name}`);
        } catch (screenshotError) {
          console.error(`Failed to capture regression screenshot for ${name}:`, screenshotError instanceof Error ? screenshotError.message : screenshotError);
        }
        throw error;
      } finally {
        await page.close();
      }
    };

    await runFlow("pdf", testPdfRegression);
    await runFlow("image-annotation", testImageAnnotation);
    await runFlow("selection-ai", testSelectionAi);
    await runFlow("performance", testPerformanceBaseline);
    console.log("Browser regression completed.");
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
