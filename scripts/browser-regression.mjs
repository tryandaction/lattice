import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const DEFAULT_PORT = Number(process.env.LATTICE_BROWSER_REGRESSION_PORT ?? 3217);
const HOST = "127.0.0.1";
const OUTPUT_DIR = path.resolve(process.cwd(), "output", "playwright");
const REGRESSION_DIST_DIR = process.env.LATTICE_BROWSER_REGRESSION_DIST_DIR?.trim() || "web-dist-browser-regression";
const TSCONFIG_PATH = path.resolve(process.cwd(), "tsconfig.json");
const FLOW_FILTER = (process.env.LATTICE_BROWSER_REGRESSION_FLOW ?? "all").trim().toLowerCase();
const PDF_STEP_FILTER = (process.env.LATTICE_BROWSER_REGRESSION_PDF_STEP ?? "all").trim().toLowerCase();
const PDF_READY_TIMEOUT_MS = Number(process.env.LATTICE_BROWSER_REGRESSION_PDF_READY_TIMEOUT_MS ?? 45000);
const PDF_ASSERT_TIMEOUT_MS = Number(process.env.LATTICE_BROWSER_REGRESSION_PDF_ASSERT_TIMEOUT_MS ?? 30000);
const PDF_FLOW_TIMEOUT_MS = Number(process.env.LATTICE_BROWSER_REGRESSION_PDF_FLOW_TIMEOUT_MS ?? 180000);
const PDF_CLEANUP_TIMEOUT_MS = Number(process.env.LATTICE_BROWSER_REGRESSION_PDF_CLEANUP_TIMEOUT_MS ?? 15000);
const PDF_RENDER_READY_TIMEOUT_MS = Number(process.env.LATTICE_BROWSER_REGRESSION_PDF_RENDER_READY_TIMEOUT_MS ?? 40000);
const VERBOSE_PDF_STATE_LOGS = process.env.LATTICE_BROWSER_REGRESSION_VERBOSE_PDF_STATE === "1";
const REAL_PDF_ROUTE_PATH = "/__lattice-diagnostics/saffman-real.pdf";
const REAL_PDF_SOURCE_PATH = process.env.LATTICE_BROWSER_REGRESSION_REAL_PDF_PATH?.trim() || "";
const REAL_PDF_SOURCE_URL = process.env.LATTICE_BROWSER_REGRESSION_REAL_PDF_URL?.trim() || "";
const REAL_PDF_FILE_NAME =
  process.env.LATTICE_BROWSER_REGRESSION_REAL_PDF_NAME?.trim() ||
  (REAL_PDF_SOURCE_PATH ? path.basename(REAL_PDF_SOURCE_PATH) : "saffman-real.pdf");
const REAL_PDF_PAGE = Math.max(1, Number(process.env.LATTICE_BROWSER_REGRESSION_REAL_PDF_PAGE ?? 7) || 7);
const REAL_PDF_SELECTION_TARGET =
  process.env.LATTICE_BROWSER_REGRESSION_REAL_PDF_SELECTION_TARGET?.trim() ||
  "Fig. 5, that tend";
const REAL_PDF_SELECTION_MAX_X2 = Number(process.env.LATTICE_BROWSER_REGRESSION_REAL_PDF_SELECTION_MAX_X2 ?? 0.55);

async function ensureOutputDir() {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

async function prepareRegressionDistDir() {
  await rm(path.resolve(process.cwd(), REGRESSION_DIST_DIR), { recursive: true, force: true });
}

async function backupTsconfig() {
  return readFile(TSCONFIG_PATH, "utf8");
}

async function restoreTsconfig(originalContent) {
  await writeFile(TSCONFIG_PATH, originalContent, "utf8");
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

async function installRealPdfRoute(page) {
  const routePattern = `**${REAL_PDF_ROUTE_PATH}`;

  if (REAL_PDF_SOURCE_PATH) {
    const pdfPath = path.resolve(REAL_PDF_SOURCE_PATH);
    await access(pdfPath);
    await page.route(routePattern, (route) => route.fulfill({
      path: pdfPath,
      contentType: "application/pdf",
    }));
    console.log(`[pdf-regression] real PDF route ${REAL_PDF_ROUTE_PATH} -> ${pdfPath}`);
    return;
  }

  if (REAL_PDF_SOURCE_URL) {
    const response = await fetch(REAL_PDF_SOURCE_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch real PDF fixture ${REAL_PDF_SOURCE_URL}: ${response.status}`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    await page.route(routePattern, (route) => route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body,
    }));
    console.log(`[pdf-regression] real PDF route ${REAL_PDF_ROUTE_PATH} <- ${REAL_PDF_SOURCE_URL} (${body.length} bytes)`);
    return;
  }

  throw new Error(
    "PDF real-paper-interactions requires LATTICE_BROWSER_REGRESSION_REAL_PDF_PATH or LATTICE_BROWSER_REGRESSION_REAL_PDF_URL.",
  );
}

async function expectText(locator, expected, message) {
  const received = (await locator.textContent())?.trim() ?? "";
  if (received !== expected) {
    throw new Error(`${message}: expected "${expected}" but received "${received}"`);
  }
}

async function waitForNumericTextAtLeast(page, testId, minimum, message) {
  try {
    await page.waitForFunction(({ id, threshold }) => {
      const value = Number(document.querySelector(`[data-testid="${id}"]`)?.textContent ?? "0");
      return value >= threshold;
    }, { id: testId, threshold: minimum }, { timeout: 120000 });
  } catch (error) {
    const received = (await page.getByTestId(testId).textContent().catch(() => null))?.trim() ?? "<missing>";
    throw new Error(`${message}: timed out waiting for >= ${minimum} in ${testId}; last received "${received}". ${error instanceof Error ? error.message : String(error)}`);
  }

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
  try {
    await page.waitForFunction(({ id, value }) => {
      const received = document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim();
      return received === value;
    }, { id: testId, value: expected }, { timeout: 120000 });
  } catch (error) {
    const received = (await page.getByTestId(testId).textContent().catch(() => null))?.trim() ?? "<missing>";
    throw new Error(`${message}: timed out waiting for "${expected}" in ${testId}; last received "${received}". ${error instanceof Error ? error.message : String(error)}`);
  }

  await expectText(page.getByTestId(testId), expected, message);
}

async function waitForTextInSet(page, testId, expectedValues, message) {
  try {
    await page.waitForFunction(({ id, values }) => {
      const received = document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim();
      return values.includes(received);
    }, { id: testId, values: expectedValues }, { timeout: 120000 });
  } catch (error) {
    const received = (await page.getByTestId(testId).textContent().catch(() => null))?.trim() ?? "<missing>";
    throw new Error(`${message}: timed out waiting for one of "${expectedValues.join(", ")}" in ${testId}; last received "${received}". ${error instanceof Error ? error.message : String(error)}`);
  }

  const received = (await page.getByTestId(testId).textContent())?.trim() ?? "";
  if (!expectedValues.includes(received)) {
    throw new Error(`${message}: expected one of "${expectedValues.join(", ")}" but received "${received}"`);
  }
}

async function waitForTextContaining(page, testId, expected, message) {
  try {
    await page.waitForFunction(({ id, value }) => {
      const received = document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? "";
      return received.includes(value);
    }, { id: testId, value: expected }, { timeout: 120000 });
  } catch (error) {
    const received = (await page.getByTestId(testId).textContent().catch(() => null))?.trim() ?? "<missing>";
    throw new Error(`${message}: timed out waiting for text containing "${expected}" in ${testId}; last received "${received}". ${error instanceof Error ? error.message : String(error)}`);
  }

  const received = (await page.getByTestId(testId).textContent())?.trim() ?? "";
  if (!received.includes(expected)) {
    throw new Error(`${message}: expected text containing "${expected}" but received "${received}"`);
  }
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

async function collectPdfRegressionReadyState(page) {
  return page.evaluate(() => {
    const summarizeElement = (testId) => {
      const element = document.querySelector(`[data-testid="${testId}"]`);
      if (!(element instanceof HTMLElement)) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      const textLayers = Array.from(element.querySelectorAll(".textLayer"));
      return {
        tag: element.tagName,
        text: element.textContent?.trim().slice(0, 160) ?? "",
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        canvasCount: element.querySelectorAll("canvas").length,
        pageCount: element.querySelectorAll("[data-page-number]").length,
        textLayerCount: textLayers.length,
        textLayerReadyCount: textLayers.filter((layer) => layer.dataset.pdfTextLayerReady === "true").length,
        textLayerSources: textLayers.map((layer) => layer.dataset.pdfTextLayerSource ?? "").join(","),
        textLayerSpanCount: textLayers.reduce((sum, layer) => sum + layer.querySelectorAll("span").length, 0),
        textLayerTextLength: textLayers.map((layer) => layer.textContent ?? "").join("\n").replace(/\s+/g, " ").trim().length,
      };
    };

    return {
      ready: summarizeElement("pdf-regression-ready"),
      leftShell: summarizeElement("pdf-left-shell"),
      rightShell: summarizeElement("pdf-right-shell"),
      leftPane: summarizeElement("pdf-pane-pdf-left-pane"),
      rightPane: summarizeElement("pdf-pane-pdf-right-pane"),
      leftViewer: summarizeElement("pdf-viewer-container-pdf-left-pane"),
      rightViewer: summarizeElement("pdf-viewer-container-pdf-right-pane"),
      leftDiagnostics: {
        fileReady: document.querySelector('[data-testid="pdf-file-ready-pdf-left-pane"]')?.textContent?.trim() ?? null,
        fileSource: document.querySelector('[data-testid="pdf-file-source-pdf-left-pane"]')?.textContent?.trim() ?? null,
        fileInputKind: document.querySelector('[data-testid="pdf-file-input-kind-pdf-left-pane"]')?.textContent?.trim() ?? null,
        fileByteLength: document.querySelector('[data-testid="pdf-file-byte-length-pdf-left-pane"]')?.textContent?.trim() ?? null,
        workerSrc: document.querySelector('[data-testid="pdf-worker-src-pdf-left-pane"]')?.textContent?.trim() ?? null,
        workerRuntimeReady: document.querySelector('[data-testid="pdf-worker-runtime-ready-pdf-left-pane"]')?.textContent?.trim() ?? null,
        workerRuntimeError: document.querySelector('[data-testid="pdf-worker-runtime-error-pdf-left-pane"]')?.textContent?.trim() ?? null,
        blobSize: document.querySelector('[data-testid="pdf-blob-size-pdf-left-pane"]')?.textContent?.trim() ?? null,
        objectUrlReady: document.querySelector('[data-testid="pdf-object-url-ready-pdf-left-pane"]')?.textContent?.trim() ?? null,
        loadStage: document.querySelector('[data-testid="pdf-load-stage-pdf-left-pane"]')?.textContent?.trim() ?? null,
        loadRunState: document.querySelector('[data-testid="pdf-load-run-state-pdf-left-pane"]')?.textContent?.trim() ?? null,
        loadWorkerState: document.querySelector('[data-testid="pdf-load-worker-state-pdf-left-pane"]')?.textContent?.trim() ?? null,
        loadProgress: document.querySelector('[data-testid="pdf-load-progress-pdf-left-pane"]')?.textContent?.trim() ?? null,
        sourceError: document.querySelector('[data-testid="pdf-source-error-pdf-left-pane"]')?.textContent?.trim() ?? null,
        resetCount: document.querySelector('[data-testid="pdf-reset-count-pdf-left-pane"]')?.textContent?.trim() ?? null,
        directProbeStage: document.querySelector('[data-testid="pdf-direct-probe-stage-pdf-left-pane"]')?.textContent?.trim() ?? null,
        directProbePages: document.querySelector('[data-testid="pdf-direct-probe-pages-pdf-left-pane"]')?.textContent?.trim() ?? null,
        directProbeError: document.querySelector('[data-testid="pdf-direct-probe-error-pdf-left-pane"]')?.textContent?.trim() ?? null,
        directProbeAttempt: document.querySelector('[data-testid="pdf-direct-probe-attempt-pdf-left-pane"]')?.textContent?.trim() ?? null,
        directProbeRunState: document.querySelector('[data-testid="pdf-direct-probe-run-state-pdf-left-pane"]')?.textContent?.trim() ?? null,
        numPages: document.querySelector('[data-testid="pdf-num-pages-pdf-left-pane"]')?.textContent?.trim() ?? null,
        loadError: document.querySelector('[data-testid="pdf-load-error-pdf-left-pane"]')?.textContent?.trim() ?? null,
      },
      rightDiagnostics: {
        fileReady: document.querySelector('[data-testid="pdf-file-ready-pdf-right-pane"]')?.textContent?.trim() ?? null,
        fileSource: document.querySelector('[data-testid="pdf-file-source-pdf-right-pane"]')?.textContent?.trim() ?? null,
        fileInputKind: document.querySelector('[data-testid="pdf-file-input-kind-pdf-right-pane"]')?.textContent?.trim() ?? null,
        fileByteLength: document.querySelector('[data-testid="pdf-file-byte-length-pdf-right-pane"]')?.textContent?.trim() ?? null,
        workerSrc: document.querySelector('[data-testid="pdf-worker-src-pdf-right-pane"]')?.textContent?.trim() ?? null,
        workerRuntimeReady: document.querySelector('[data-testid="pdf-worker-runtime-ready-pdf-right-pane"]')?.textContent?.trim() ?? null,
        workerRuntimeError: document.querySelector('[data-testid="pdf-worker-runtime-error-pdf-right-pane"]')?.textContent?.trim() ?? null,
        blobSize: document.querySelector('[data-testid="pdf-blob-size-pdf-right-pane"]')?.textContent?.trim() ?? null,
        objectUrlReady: document.querySelector('[data-testid="pdf-object-url-ready-pdf-right-pane"]')?.textContent?.trim() ?? null,
        loadStage: document.querySelector('[data-testid="pdf-load-stage-pdf-right-pane"]')?.textContent?.trim() ?? null,
        loadRunState: document.querySelector('[data-testid="pdf-load-run-state-pdf-right-pane"]')?.textContent?.trim() ?? null,
        loadWorkerState: document.querySelector('[data-testid="pdf-load-worker-state-pdf-right-pane"]')?.textContent?.trim() ?? null,
        loadProgress: document.querySelector('[data-testid="pdf-load-progress-pdf-right-pane"]')?.textContent?.trim() ?? null,
        sourceError: document.querySelector('[data-testid="pdf-source-error-pdf-right-pane"]')?.textContent?.trim() ?? null,
        resetCount: document.querySelector('[data-testid="pdf-reset-count-pdf-right-pane"]')?.textContent?.trim() ?? null,
        directProbeStage: document.querySelector('[data-testid="pdf-direct-probe-stage-pdf-right-pane"]')?.textContent?.trim() ?? null,
        directProbePages: document.querySelector('[data-testid="pdf-direct-probe-pages-pdf-right-pane"]')?.textContent?.trim() ?? null,
        directProbeError: document.querySelector('[data-testid="pdf-direct-probe-error-pdf-right-pane"]')?.textContent?.trim() ?? null,
        directProbeAttempt: document.querySelector('[data-testid="pdf-direct-probe-attempt-pdf-right-pane"]')?.textContent?.trim() ?? null,
        directProbeRunState: document.querySelector('[data-testid="pdf-direct-probe-run-state-pdf-right-pane"]')?.textContent?.trim() ?? null,
        numPages: document.querySelector('[data-testid="pdf-num-pages-pdf-right-pane"]')?.textContent?.trim() ?? null,
        loadError: document.querySelector('[data-testid="pdf-load-error-pdf-right-pane"]')?.textContent?.trim() ?? null,
      },
      bodyText: document.body.innerText.slice(0, 1000),
    };
  });
}

async function logPdfRegressionReadyState(page, label) {
  try {
    const state = await collectPdfRegressionReadyState(page);
    console.log(`[pdf-regression] ${label} state: ${JSON.stringify(state)}`);
  } catch (error) {
    console.log(`[pdf-regression] ${label} state unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function logPdfRegressionReadyStateBestEffort(page, label) {
  if (!VERBOSE_PDF_STATE_LOGS) {
    return;
  }
  await bestEffortWithTimeout(
    `PDF regression ${label} state`,
    5000,
    () => logPdfRegressionReadyState(page, label),
  );
}

function attachPageDiagnostics(page, flowName) {
  page.on("close", () => {
    console.log(`[browser-regression:${flowName}] page closed`);
  });
  page.on("crash", () => {
    console.log(`[browser-regression:${flowName}] page crashed`);
  });
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("pdf.worker") || url.includes("pdfjs-dist")) {
      console.log(`[browser-regression:${flowName}] request: ${request.method()} ${url}`);
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("pdf.worker") || url.includes("pdfjs-dist")) {
      console.log(`[browser-regression:${flowName}] response: ${response.status()} ${response.headers()["content-type"] ?? "unknown"} ${url}`);
    }
  });
  page.on("console", (message) => {
    const type = message.type();
    if (type === "error" || type === "warning") {
      console.log(`[browser-regression:${flowName}] console.${type}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    console.log(`[browser-regression:${flowName}] pageerror: ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    console.log(`[browser-regression:${flowName}] requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`);
  });
}

async function withTimeout(label, timeoutMs, fn) {
  let timeoutId;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function bestEffortWithTimeout(label, timeoutMs, fn) {
  try {
    await withTimeout(label, timeoutMs, fn);
  } catch (error) {
    console.error(`${label} skipped: ${error instanceof Error ? error.message : error}`);
  }
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

async function ensurePdfPaneVisiblePage(page, shellTestId, activateTestId, minimum = 1) {
  let lastError = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      if (activateTestId) {
        await page.getByTestId(activateTestId).click();
      }
      await page.getByTestId(shellTestId).hover();
      await page.waitForFunction(({ shellId, threshold }) => {
        const shell = document.querySelector(`[data-testid="${shellId}"]`);
        if (!(shell instanceof HTMLElement)) {
          return false;
        }
        const pane = shell.querySelector('[data-testid^="pdf-pane-"]');
        const pageNodes = shell.querySelectorAll("[data-page-number]");
        const canvasNodes = shell.querySelectorAll("canvas");
        if (!(pane instanceof HTMLElement) || (pageNodes.length === 0 && canvasNodes.length === 0)) {
          return false;
        }
        const shellRect = shell.getBoundingClientRect();
        const visiblePage = Array.from(shell.querySelectorAll("[data-page-number]")).find((pageElement) => {
          if (!(pageElement instanceof HTMLElement)) {
            return false;
          }
          const rect = pageElement.getBoundingClientRect();
          return rect.bottom > shellRect.top + 48 && rect.top < shellRect.bottom - 48;
        });
        const pageNumber = Number((visiblePage instanceof HTMLElement ? visiblePage.dataset.pageNumber : "0") ?? "0");
        return Number.isFinite(pageNumber) && pageNumber >= threshold;
      }, { shellId: shellTestId, threshold: minimum }, { timeout: 30000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1500);
    }
  }

  throw lastError ?? new Error(`Timed out waiting for visible page in ${shellTestId} to reach ${minimum}.`);
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
  }, { targetPaneId: paneId, threshold: minimumOverflow }, { timeout: PDF_ASSERT_TIMEOUT_MS });
}

async function waitForPdfPaneRendered(page, paneId, timeoutMs = PDF_ASSERT_TIMEOUT_MS) {
  const shellTestId = paneId === "pdf-left-pane" ? "pdf-left-shell" : "pdf-right-shell";
  await page.waitForFunction(({ shellId }) => {
    const shell = document.querySelector(`[data-testid="${shellId}"]`);
    return (shell?.querySelectorAll("canvas").length ?? 0) > 0 ||
      (shell?.querySelectorAll("[data-page-number]").length ?? 0) > 0;
  }, { shellId: shellTestId }, { timeout: timeoutMs });
}

async function waitForPdfDiagnosticSelectionBridge(page, paneId, timeoutMs = PDF_ASSERT_TIMEOUT_MS) {
  await waitForPdfPaneRendered(page, paneId, timeoutMs);
  await page.waitForFunction(({ targetPaneId }) => (
    typeof window.__latticePdfDiagnostics?.[targetPaneId]?.runSelectionOnPage === "function"
  ), { targetPaneId: paneId }, { timeout: timeoutMs });
}

async function getPdfDiagnosticSelectionState(page, paneId) {
  return withTimeout(
    `PDF diagnostic selection state ${paneId}`,
    Math.min(PDF_ASSERT_TIMEOUT_MS, 5000),
    () => page.evaluate(({ targetPaneId }) => ({
      ok: document.querySelector(`[data-testid="pdf-diagnostic-selection-ok-${targetPaneId}"]`)?.textContent?.trim() ?? "",
      text: document.querySelector(`[data-testid="pdf-diagnostic-selection-text-${targetPaneId}"]`)?.textContent?.trim() ?? "",
      source: document.querySelector(`[data-testid="pdf-diagnostic-selection-source-${targetPaneId}"]`)?.textContent?.trim() ?? "",
      annotationCount: document.querySelector(`[data-testid="pdf-diagnostic-selection-annotation-count-${targetPaneId}"]`)?.textContent?.trim() ?? "",
      rectCount: document.querySelector(`[data-testid="pdf-diagnostic-selection-rect-count-${targetPaneId}"]`)?.textContent?.trim() ?? "",
      copyPayload: document.querySelector(`[data-testid="pdf-copy-payload-${targetPaneId}"]`)?.textContent?.trim() ?? "",
      selectionPhase: document.querySelector(`[data-testid="pdf-selection-phase-${targetPaneId}"]`)?.textContent?.trim() ?? "",
      selectionPreview: document.querySelector(`[data-testid="pdf-selection-preview-${targetPaneId}"]`)?.textContent?.trim() ?? "",
      selectionViewportRectCount: document.querySelector(`[data-testid="pdf-selection-viewport-rect-count-${targetPaneId}"]`)?.textContent?.trim() ?? "",
      selectionOverlayRectCount: document.querySelector(`[data-testid="pdf-selection-overlay-rect-count-${targetPaneId}"]`)?.textContent?.trim() ?? "",
      restoreOk: document.querySelector(`[data-testid="pdf-restore-ok-${targetPaneId}"]`)?.textContent?.trim() ?? "",
      restoreStatus: document.querySelector(`[data-testid="pdf-restore-status-${targetPaneId}"]`)?.textContent?.trim() ?? "",
      restoreExpectedPage: document.querySelector(`[data-testid="pdf-restore-expected-page-${targetPaneId}"]`)?.textContent?.trim() ?? "",
      restoreActualPage: document.querySelector(`[data-testid="pdf-restore-actual-page-${targetPaneId}"]`)?.textContent?.trim() ?? "",
      hasTransientOverlay: document.querySelector('[data-pdf-transient-selection-overlay="true"]') !== null,
      hasStoredHighlight: document.querySelector('[data-pdf-stored-annotation-segment="true"][data-pdf-stored-annotation-type="highlight"]') !== null,
      bridgeAvailable: typeof window.__latticePdfDiagnostics?.[targetPaneId]?.runSelectionOnPage === "function",
      hasTextLayer: document.querySelector(`[data-testid="pdf-pane-${targetPaneId}"] .textLayer[data-pdf-text-layer-ready="true"]`) !== null,
    }), { targetPaneId: paneId }),
  );
}

async function waitForPdfDiagnosticSelectionState(page, paneId, predicate, description, timeoutMs = PDF_ASSERT_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastState = null;
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastState = await getPdfDiagnosticSelectionState(page, paneId);
      if (predicate(lastState)) {
        return lastState;
      }
    } catch (error) {
      lastError = error;
    }
    await page.waitForTimeout(250);
  }

  throw new Error(`${description} timed out. State=${JSON.stringify(lastState ?? {
    error: lastError instanceof Error ? lastError.message : String(lastError),
  })}`);
}

async function runPdfDiagnosticSelection(page, paneId, pageNumber, mode) {
  return page.evaluate(async ({ targetPaneId, targetPageNumber, selectionMode }) => {
    const runner = window.__latticePdfDiagnostics?.[targetPaneId]?.runSelectionOnPage;
    if (typeof runner !== "function") {
      return false;
    }

    return await Promise.resolve(runner(targetPageNumber, selectionMode));
  }, { targetPaneId: paneId, targetPageNumber: pageNumber, selectionMode: mode });
}

async function clickByTestId(page, testId) {
  const clicked = await page.evaluate(({ targetTestId }) => {
    const element = document.querySelector(`[data-testid="${targetTestId}"]`);
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    element.scrollIntoView({ block: "center", inline: "center" });
    element.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
    return true;
  }, { targetTestId: testId });
  if (!clicked) {
    throw new Error(`Unable to click missing element [data-testid="${testId}"].`);
  }
}

async function activatePdfPane(page, paneId) {
  const activateTestId = paneId === "pdf-right-pane" ? "activate-right-pane" : "activate-left-pane";
  const paneTestId = `pdf-pane-${paneId}`;
  await page.evaluate(({ activateId, paneId: targetPaneTestId }) => {
    const dispatchPointer = (element) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
        }));
      }
    };
    dispatchPointer(document.querySelector(`[data-testid="${targetPaneTestId}"]`));
    dispatchPointer(document.querySelector(`[data-testid="${activateId}"]`));
  }, { activateId: activateTestId, paneId: paneTestId });
}

async function getPdfZoomLabel(page, paneId) {
  return (await page.getByTestId(`pdf-zoom-label-${paneId}`).textContent())?.trim() ?? "";
}

async function waitForPdfZoomChange(page, paneId, initialZoom) {
  await page.waitForFunction(({ targetPaneId, initial }) => {
    const zoom = document.querySelector(`[data-testid="pdf-zoom-label-${targetPaneId}"]`)?.textContent?.trim() ?? "";
    return zoom.endsWith("%") && zoom !== initial;
  }, { targetPaneId: paneId, initial: initialZoom }, { timeout: PDF_ASSERT_TIMEOUT_MS });
  return getPdfZoomLabel(page, paneId);
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

async function scrollPdfPaneToPage(page, paneId, pageNumber) {
  const bridgeReady = await page.waitForFunction(({ targetPaneId }) => (
    typeof window.__latticePdfDiagnostics?.[targetPaneId]?.scrollToPage === "function"
  ), { targetPaneId: paneId }, { timeout: 5000 }).then(() => true).catch(() => false);
  if (bridgeReady) {
    const bridged = await page.evaluate(({ targetPaneId, targetPageNumber }) => (
      window.__latticePdfDiagnostics?.[targetPaneId]?.scrollToPage?.(targetPageNumber) === true
    ), { targetPaneId: paneId, targetPageNumber: pageNumber });
    if (bridged) {
      return;
    }
  }

  await waitForPdfScrollableReady(page, paneId, 100);
  const selector = await resolvePdfScrollableSelector(page, paneId);
  if (!selector) {
    throw new Error(`Unable to resolve PDF scroll container for ${paneId}.`);
  }

  await page.evaluate(({ resolvedSelector, targetPaneId, targetPageNumber }) => {
    const container = document.querySelector(resolvedSelector);
    if (!(container instanceof HTMLElement)) {
      throw new Error(`Unable to locate PDF scroll container: ${resolvedSelector}`);
    }

    const shellId = targetPaneId === "pdf-left-pane" ? "pdf-left-shell" : "pdf-right-shell";
    const pageElement = document.querySelector(`[data-testid="${shellId}"] [data-page-number="${targetPageNumber}"]`);
    if (pageElement instanceof HTMLElement) {
      const containerRect = container.getBoundingClientRect();
      const pageRect = pageElement.getBoundingClientRect();
      const targetTop = container.scrollTop +
        (pageRect.top - containerRect.top) -
        Math.max(0, (container.clientHeight - pageRect.height) / 2);
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "auto",
      });
      return;
    }

    const firstPage = document.querySelector(`[data-testid="${shellId}"] [data-page-number="1"]`);
    const estimatedPageHeight = firstPage instanceof HTMLElement
      ? firstPage.getBoundingClientRect().height + 24
      : Math.max(1, container.clientHeight * 0.92);
    container.scrollTo({
      top: Math.max(0, estimatedPageHeight * (targetPageNumber - 1)),
      behavior: "auto",
    });
  }, { resolvedSelector: selector, targetPaneId: paneId, targetPageNumber: pageNumber });
}

async function waitForPdfPageText(page, paneId, pageNumber, expectedText, timeoutMs = PDF_ASSERT_TIMEOUT_MS) {
  try {
    await page.waitForFunction(({ targetPaneId, targetPageNumber, text }) => {
      const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
      const shellId = targetPaneId === "pdf-left-pane" ? "pdf-left-shell" : "pdf-right-shell";
      const pageElement = document.querySelector(`[data-testid="${shellId}"] [data-page-number="${targetPageNumber}"]`);
      if (!(pageElement instanceof HTMLElement)) {
        return false;
      }

      const layerText = Array.from(pageElement.querySelectorAll(".textLayer[data-pdf-text-layer-ready='true']"))
        .map((layer) => layer.textContent ?? "")
        .join(" ");
      return normalize(layerText).includes(normalize(text));
    }, { targetPaneId: paneId, targetPageNumber: pageNumber, text: expectedText }, { timeout: timeoutMs });
  } catch (error) {
    const state = await page.evaluate(({ targetPaneId, targetPageNumber }) => {
      const shellId = targetPaneId === "pdf-left-pane" ? "pdf-left-shell" : "pdf-right-shell";
      const shell = document.querySelector(`[data-testid="${shellId}"]`);
      const viewer = document.querySelector(`[data-testid="pdf-viewer-container-${targetPaneId}"]`);
      const pageElement = shell?.querySelector(`[data-page-number="${targetPageNumber}"]`);
      const textLayers = pageElement
        ? Array.from(pageElement.querySelectorAll(".textLayer")).map((layer) => ({
            ready: layer instanceof HTMLElement ? layer.dataset.pdfTextLayerReady ?? "" : "",
            source: layer instanceof HTMLElement ? layer.dataset.pdfTextLayerSource ?? "" : "",
            chars: layer instanceof HTMLElement ? layer.dataset.pdfTextLayerChars ?? "" : "",
            text: (layer.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
          }))
        : [];
      const pageRect = pageElement instanceof HTMLElement ? pageElement.getBoundingClientRect() : null;
      return {
        shellPageCount: shell?.querySelectorAll("[data-page-number]").length ?? 0,
        readyTextLayerCount: shell?.querySelectorAll(".textLayer[data-pdf-text-layer-ready='true']").length ?? 0,
        viewerScrollTop: viewer instanceof HTMLElement ? viewer.scrollTop : null,
        viewerScrollHeight: viewer instanceof HTMLElement ? viewer.scrollHeight : null,
        targetPageExists: pageElement instanceof HTMLElement,
        targetPageVisible: pageElement instanceof HTMLElement ? pageElement.dataset.pdfPageVisible ?? "" : "",
        targetPageMeasured: pageElement instanceof HTMLElement ? pageElement.dataset.pdfPageMeasured ?? "" : "",
        targetPageRect: pageRect ? { top: Math.round(pageRect.top), height: Math.round(pageRect.height) } : null,
        textLayers,
      };
    }, { targetPaneId: paneId, targetPageNumber: pageNumber }).catch((stateError) => ({
      error: stateError instanceof Error ? stateError.message : String(stateError),
    }));
    throw new Error(`Timed out waiting for PDF page ${pageNumber} text "${expectedText}". State=${JSON.stringify(state)}. ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function clickPdfPageRatio(page, paneId, pageNumber, xRatio, yRatio) {
  const point = await page.evaluate(({ targetPaneId, targetPageNumber, x, y }) => {
    const shellId = targetPaneId === "pdf-left-pane" ? "pdf-left-shell" : "pdf-right-shell";
    const pageElement = document.querySelector(`[data-testid="${shellId}"] [data-page-number="${targetPageNumber}"]`);
    if (!(pageElement instanceof HTMLElement)) {
      return null;
    }

    const rect = pageElement.getBoundingClientRect();
    return {
      x: rect.left + (rect.width * x),
      y: rect.top + (rect.height * y),
    };
  }, { targetPaneId: paneId, targetPageNumber: pageNumber, x: xRatio, y: yRatio });

  if (!point) {
    throw new Error(`Unable to find PDF page ${pageNumber} in ${paneId}.`);
  }

  await page.mouse.click(point.x, point.y);
}

async function waitForPdfRegressionReady(page, options = {}) {
  const singlePane = options.singlePane === true;
  const quiet = options.quiet === true;
  const waitForTextLayer = options.waitForTextLayer === true;
  const stableState = options.stableState === true;
  const resetViewState = options.resetViewState === true;
  console.log("[pdf-regression] open page");
  const query = new URLSearchParams();
  if (singlePane) {
    query.set("singlePane", "1");
  }
  if (stableState) {
    query.set("stableState", "1");
  }
  if (resetViewState) {
    query.set("resetViewState", "1");
  }
  query.set("directHighlighter", "1");
  await page.goto(`${page.baseUrl}/diagnostics/pdf-regression?${query.toString()}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("pdf-regression-ready").waitFor({ timeout: PDF_READY_TIMEOUT_MS });
  console.log("[pdf-regression] page ready");

  console.log("[pdf-regression] wait pane shells");
  await page.waitForFunction(({ expectRightPane }) => {
    const hasVisibleBox = (testId) => {
      const element = document.querySelector(`[data-testid="${testId}"]`);
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    return hasVisibleBox("pdf-left-shell") && (!expectRightPane || hasVisibleBox("pdf-right-shell"));
  }, { expectRightPane: !singlePane }, { timeout: PDF_READY_TIMEOUT_MS });
  if (!quiet) {
    await logPdfRegressionReadyStateBestEffort(page, "after-shells");
  }

  console.log("[pdf-regression] wait pdf panes mounted");
  try {
    await page.waitForFunction(({ expectRightPane }) => {
      const leftMounted = Boolean(document.querySelector('[data-testid="pdf-pane-pdf-left-pane"]'));
      const rightMounted = Boolean(document.querySelector('[data-testid="pdf-pane-pdf-right-pane"]'));
      return Boolean(
        leftMounted &&
        (!expectRightPane || rightMounted)
      );
    }, { expectRightPane: !singlePane }, { timeout: PDF_READY_TIMEOUT_MS });
  } catch (error) {
    await logPdfRegressionReadyStateBestEffort(page, "pane-mount-timeout");
    throw error;
  }
  if (!quiet) {
    await logPdfRegressionReadyStateBestEffort(page, "after-panes");
  }

  console.log("[pdf-regression] wait rendered pdf pages");
  const renderStateLog = quiet
    ? null
    : setInterval(() => {
        void logPdfRegressionReadyStateBestEffort(page, "rendered-pages-poll").catch(() => {});
      }, 10000);
  try {
    await page.waitForFunction(({ expectRightPane, requireTextLayer }) => {
      const leftShell = document.querySelector('[data-testid="pdf-left-shell"]');
      const rightShell = document.querySelector('[data-testid="pdf-right-shell"]');
      const leftReady = (leftShell?.querySelectorAll('canvas').length ?? 0) > 0 || (leftShell?.querySelectorAll('[data-page-number]').length ?? 0) > 0;
      const rightReady = (rightShell?.querySelectorAll('canvas').length ?? 0) > 0 || (rightShell?.querySelectorAll('[data-page-number]').length ?? 0) > 0;
      if (!leftReady || (expectRightPane && !rightReady)) {
        return false;
      }
      if (!requireTextLayer) {
        return true;
      }
      const textLayerTextLength = (shell) => Array.from(shell?.querySelectorAll(".textLayer") ?? [])
        .map((layer) => layer.textContent ?? "")
        .join("\n")
        .replace(/\s+/g, " ")
        .trim()
        .length;
      return textLayerTextLength(leftShell) > 1000 && (!expectRightPane || textLayerTextLength(rightShell) > 1000);
    }, { expectRightPane: !singlePane, requireTextLayer: waitForTextLayer }, { timeout: waitForTextLayer ? PDF_ASSERT_TIMEOUT_MS : PDF_RENDER_READY_TIMEOUT_MS });
  } catch (error) {
    await page.waitForTimeout(2000);
    await logPdfRegressionReadyStateBestEffort(page, "rendered-pages-timeout");
    throw error;
  } finally {
    if (renderStateLog) {
      clearInterval(renderStateLog);
    }
  }

  if (!quiet) {
    await logPdfRegressionReadyStateBestEffort(page, "after-rendered-pages");
  }
}

async function openPdfRegressionPage(page, options = {}) {
  const singlePane = options.singlePane === true;
  const query = new URLSearchParams();
  if (singlePane) {
    query.set("singlePane", "1");
  }
  if (options.stableState === true) {
    query.set("stableState", "1");
  }
  if (options.resetViewState === true) {
    query.set("resetViewState", "1");
  }
  if (options.realPdf === true) {
    query.set("realPdf", "1");
  }
  if (options.realPdfUrl) {
    query.set("realPdfUrl", options.realPdfUrl);
  }
  if (options.realPdfName) {
    query.set("realPdfName", options.realPdfName);
  }
  if (options.realPdfPage) {
    query.set("realPdfPage", String(options.realPdfPage));
  }
  if (options.diagnosticSelectionTarget) {
    query.set("diagnosticSelectionTarget", options.diagnosticSelectionTarget);
  }
  if (options.diagnosticSelectionPage) {
    query.set("diagnosticSelectionPage", String(options.diagnosticSelectionPage));
  }
  query.set("directHighlighter", "1");
  await page.goto(`${page.baseUrl}/diagnostics/pdf-regression?${query.toString()}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("pdf-regression-ready").waitFor({ timeout: PDF_READY_TIMEOUT_MS });
  await page.waitForFunction(({ expectRightPane }) => {
    const hasShell = (testId) => {
      const element = document.querySelector(`[data-testid="${testId}"]`);
      return element instanceof HTMLElement && element.getBoundingClientRect().width > 0;
    };
    return hasShell("pdf-left-shell") && (!expectRightPane || hasShell("pdf-right-shell"));
  }, { expectRightPane: !singlePane }, { timeout: PDF_READY_TIMEOUT_MS });
}

async function runPdfSmokeStep(page) {
  await waitForPdfRegressionReady(page, { singlePane: true });
}

async function runPdfTextLayerStep(page) {
  await waitForPdfRegressionReady(page, { quiet: true, waitForTextLayer: true });
  await page.evaluate(() => {
    document.querySelector('[data-testid="activate-left-pane"]')?.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
  });
  await page.waitForFunction(() => {
    const combinedText = [
      document.querySelector('[data-testid="pdf-left-shell"]')?.textContent ?? "",
      document.querySelector('[data-testid="pdf-right-shell"]')?.textContent ?? "",
    ].join("\n").replace(/\s+/g, " ");
    return (
      combinedText.includes("Rydberg states are extremely sensitive") &&
      combinedText.includes("right column explains the readout calibration")
    );
  }, undefined, { timeout: PDF_ASSERT_TIMEOUT_MS });
  const probes = [
    "Rydberg states are extremely sensitive",
    "right column explains the readout calibration",
    "Fast, high-fidelity excitation to the Rydberg state21",
    "Formula probe: T2* = 3.7(4) s; Omega = sqrt(Delta2 + g2); alpha/beta phase.",
    "Ligature probe: affinity and fluorescence",
    "Greek probe: omega, delta, alpha, and beta",
    "Greek glyph probe:",
    "Citation superscript probe: Rydberg excitation",
    "Cross-line probe starts here",
    "on the next line without jumping into the right column",
    "Reference probe [12, 17]",
    "Diagnostic paragraph 1",
  ];
  const textLayerProbeState = await page.evaluate(({ probes: expectedProbes }) => {
    const summarize = (testId) => {
      const shell = document.querySelector(`[data-testid="${testId}"]`);
      const layers = Array.from(shell?.querySelectorAll(".textLayer") ?? []);
      return {
        testId,
        layerCount: layers.length,
        readyCount: layers.filter((layer) => layer.dataset.pdfTextLayerReady === "true").length,
        source: layers.map((layer) => layer.dataset.pdfTextLayerSource ?? "").join(","),
        spanCount: layers.reduce((sum, layer) => sum + layer.querySelectorAll("span").length, 0),
        textLength: (shell?.textContent ?? "").replace(/\s+/g, " ").trim().length,
        sample: (shell?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 220),
      };
    };
    const combinedText = [
      document.querySelector('[data-testid="pdf-left-shell"]')?.textContent ?? "",
      document.querySelector('[data-testid="pdf-right-shell"]')?.textContent ?? "",
    ].join("\n").replace(/\s+/g, " ");
    const missing = expectedProbes.filter((probe) => !combinedText.includes(probe));
    return {
      textLayerState: [summarize("pdf-left-shell"), summarize("pdf-right-shell")],
      probeResult: { ok: missing.length === 0, missing, sample: combinedText.slice(0, 1600) },
    };
  }, { probes });
  console.log(`[pdf-regression] text-layer state ${JSON.stringify(textLayerProbeState.textLayerState)}`);
  console.log("[pdf-regression] verify paper fixture text layer probes");
  const probeResult = textLayerProbeState.probeResult;
  console.log(`[pdf-regression] text-layer probes ${JSON.stringify(probeResult)}`);
  if (!probeResult.ok) {
    throw new Error(`PDF text layer probes missing: ${probeResult.missing.join(" | ")}`);
  }
}

async function runPdfLayoutStep(page) {
  await waitForPdfRegressionReady(page);
  const layoutState = await page.evaluate(() => {
    const rightShell = document.querySelector('[data-testid="pdf-right-shell"]');
    const rect = rightShell instanceof HTMLElement ? rightShell.getBoundingClientRect() : null;
    return {
      rightShell: rect
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right }
        : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  if (
    !layoutState.rightShell ||
    layoutState.rightShell.width <= 0 ||
    layoutState.rightShell.height <= 0 ||
    layoutState.rightShell.right > layoutState.viewport.width + 1
  ) {
    throw new Error("Right PDF pane overflowed the viewport.");
  }

  console.log("[pdf-regression] verify split panes ready");
}

async function runPdfSelectionCopyStep(page) {
  await openPdfRegressionPage(page);
  await waitForPdfDiagnosticSelectionBridge(page, "pdf-left-pane");
  const scheduled = await runPdfDiagnosticSelection(page, "pdf-left-pane", 1, "copy");
  if (scheduled === false) {
    throw new Error("PDF diagnostic page copy selection bridge was not available.");
  }
  await waitForPdfDiagnosticSelectionState(
    page,
    "pdf-left-pane",
    (state) => (
      state.ok === "true" &&
      state.text.includes("Rydberg states are extremely sensitive") &&
      state.copyPayload.includes("Rydberg states are extremely sensitive") &&
      Number(state.rectCount) > 0
    ),
    "PDF selection-copy diagnostic did not resolve",
  );
}

async function runPdfHighlightSaveRestoreStep(page) {
  console.log("[pdf-regression] highlight-save-restore open single pane");
  await openPdfRegressionPage(page, { singlePane: true });
  console.log("[pdf-regression] highlight-save-restore wait text kernel");
  await waitForPdfDiagnosticSelectionBridge(page, "pdf-left-pane");
  const restoreBefore = await page.evaluate(() => ({
    ok: document.querySelector('[data-testid="pdf-restore-ok-pdf-left-pane"]')?.textContent?.trim() ?? "",
    status: document.querySelector('[data-testid="pdf-restore-status-pdf-left-pane"]')?.textContent?.trim() ?? "",
    expectedPage: document.querySelector('[data-testid="pdf-restore-expected-page-pdf-left-pane"]')?.textContent?.trim() ?? "",
    actualPage: document.querySelector('[data-testid="pdf-restore-actual-page-pdf-left-pane"]')?.textContent?.trim() ?? "",
  }));
  console.log(`[pdf-regression] highlight-save-restore restore-before ${JSON.stringify(restoreBefore)}`);
  const beforeCount = await page.evaluate(() => Math.max(
    0,
    ...Array.from(document.querySelectorAll('[data-testid="pdf-diagnostic-selection-annotation-count-pdf-left-pane"]'))
      .map((element) => Number(element.textContent?.trim() ?? "0"))
      .filter(Number.isFinite)
  ));
  console.log(`[pdf-regression] highlight-save-restore before annotation count ${beforeCount}`);
  const scheduled = await runPdfDiagnosticSelection(page, "pdf-left-pane", 1, "highlight");
  if (scheduled === false) {
    throw new Error("PDF diagnostic page highlight save bridge was not available.");
  }
  console.log(`[pdf-regression] highlight-save-restore bridge result ${JSON.stringify(scheduled)}`);
  if (
    !scheduled.ok ||
    !scheduled.text.includes("Rydberg states are extremely sensitive") ||
    scheduled.source === "none" ||
    Number(scheduled.annotationCount) <= beforeCount ||
    Number(scheduled.rectCount) <= 0
  ) {
    throw new Error(`PDF highlight-save-restore bridge returned invalid result: ${JSON.stringify(scheduled)}`);
  }
  const bridgeState = await getPdfDiagnosticSelectionState(page, "pdf-left-pane");
  console.log(`[pdf-regression] highlight-save-restore bridge state ${JSON.stringify(bridgeState)}`);
  const bridgeShowsVisibleOverlay = (
    bridgeState.selectionPhase === "committed" &&
    Number(bridgeState.selectionOverlayRectCount) > 0 &&
    bridgeState.hasTransientOverlay
  );
  if (!bridgeShowsVisibleOverlay) {
    console.log("[pdf-regression] highlight-save-restore wait diagnostic save result");
    await waitForPdfDiagnosticSelectionState(
      page,
      "pdf-left-pane",
      (state) => (
        (
          state.selectionPhase === "committed" &&
          Number(state.selectionOverlayRectCount) > 0
        ) ||
        state.hasStoredHighlight ||
        state.hasTransientOverlay
      ),
      "PDF highlight-save-restore overlay did not become visible",
      Math.min(PDF_ASSERT_TIMEOUT_MS, 10000),
    );
  }
  const afterState = await getPdfDiagnosticSelectionState(page, "pdf-left-pane");
  console.log(`[pdf-regression] highlight-save-restore result ${JSON.stringify(afterState)}`);
}

async function runPdfRealPaperInteractionsStep(page) {
  console.log("[pdf-regression] real-paper install real PDF route");
  await installRealPdfRoute(page);

  console.log("[pdf-regression] real-paper open single pane");
  await openPdfRegressionPage(page, {
    singlePane: true,
    realPdf: true,
    realPdfUrl: REAL_PDF_ROUTE_PATH,
    realPdfName: REAL_PDF_FILE_NAME,
    realPdfPage: REAL_PDF_PAGE,
    diagnosticSelectionTarget: REAL_PDF_SELECTION_TARGET,
    diagnosticSelectionPage: REAL_PDF_PAGE,
  });
  await waitForPdfPaneRendered(page, "pdf-left-pane", 90000);
  await waitForPdfScrollableReady(page, "pdf-left-pane", 100);

  await page.waitForFunction(() => (
    typeof window.__latticePdfDiagnostics?.["pdf-left-pane"]?.runSelectionOnPage === "function"
  ), undefined, { timeout: PDF_ASSERT_TIMEOUT_MS });


  const beforeCount = await page.evaluate(() => Math.max(
    0,
    ...Array.from(document.querySelectorAll('[data-testid="pdf-diagnostic-selection-annotation-count-pdf-left-pane"]'))
      .map((element) => Number(element.textContent?.trim() ?? "0"))
      .filter(Number.isFinite),
  ));

  console.log("[pdf-regression] real-paper run diagnostic copy selection");
  const copyScheduled = await runPdfDiagnosticSelection(page, "pdf-left-pane", REAL_PDF_PAGE, "copy");
  if (copyScheduled === false) {
    throw new Error("Real PDF diagnostic page copy selection bridge was not available.");
  }
  await page.waitForFunction(({ target }) => (
    Array.from(document.querySelectorAll('[data-testid="pdf-diagnostic-selection-ok-pdf-left-pane"]'))
      .some((element) => element.textContent?.trim() === "true") &&
    Array.from(document.querySelectorAll('[data-testid="pdf-diagnostic-selection-text-pdf-left-pane"]'))
      .some((element) => (element.textContent ?? "").includes(target)) &&
    Array.from(document.querySelectorAll('[data-testid="pdf-copy-payload-pdf-left-pane"]'))
      .some((element) => (element.textContent ?? "").includes(target)) &&
    Array.from(document.querySelectorAll('[data-testid="pdf-diagnostic-selection-rect-count-pdf-left-pane"]'))
      .some((element) => Number(element.textContent ?? "0") > 0)
  ), { target: REAL_PDF_SELECTION_TARGET }, { timeout: PDF_ASSERT_TIMEOUT_MS });

  console.log("[pdf-regression] real-paper run diagnostic highlight selection");
  const highlightScheduled = await runPdfDiagnosticSelection(page, "pdf-left-pane", REAL_PDF_PAGE, "highlight");
  if (highlightScheduled === false) {
    throw new Error("Real PDF diagnostic page highlight selection bridge was not available.");
  }
  await page.waitForFunction(({ previousCount, target }) => (
    Array.from(document.querySelectorAll('[data-testid="pdf-diagnostic-selection-ok-pdf-left-pane"]'))
      .some((element) => element.textContent?.trim() === "true") &&
    Array.from(document.querySelectorAll('[data-testid="pdf-diagnostic-selection-text-pdf-left-pane"]'))
      .some((element) => (element.textContent ?? "").includes(target)) &&
    Array.from(document.querySelectorAll('[data-testid="pdf-diagnostic-selection-annotation-count-pdf-left-pane"]'))
      .some((element) => Number(element.textContent ?? "0") > previousCount) &&
    Array.from(document.querySelectorAll('[data-testid="pdf-diagnostic-selection-rect-count-pdf-left-pane"]'))
      .some((element) => Number(element.textContent ?? "0") > 0)
  ), { previousCount: beforeCount, target: REAL_PDF_SELECTION_TARGET }, { timeout: PDF_ASSERT_TIMEOUT_MS });

  const result = await page.evaluate(() => ({
    text: document.querySelector('[data-testid="pdf-diagnostic-selection-text-pdf-left-pane"]')?.textContent?.trim() ?? "",
    source: document.querySelector('[data-testid="pdf-diagnostic-selection-source-pdf-left-pane"]')?.textContent?.trim() ?? "",
    annotationCount: document.querySelector('[data-testid="pdf-diagnostic-selection-annotation-count-pdf-left-pane"]')?.textContent?.trim() ?? "",
    rectCount: document.querySelector('[data-testid="pdf-diagnostic-selection-rect-count-pdf-left-pane"]')?.textContent?.trim() ?? "",
    rectMinX1: document.querySelector('[data-testid="pdf-diagnostic-selection-rect-min-x1-pdf-left-pane"]')?.textContent?.trim() ?? "",
    rectMaxX2: document.querySelector('[data-testid="pdf-diagnostic-selection-rect-max-x2-pdf-left-pane"]')?.textContent?.trim() ?? "",
  }));
  console.log(`[pdf-regression] real-paper result ${JSON.stringify(result)}`);
  if (result.text.includes("two-atom states within")) {
    throw new Error(`Real PDF selection drifted into the opposite column: ${result.text}`);
  }
  const rectMaxX2 = Number(result.rectMaxX2);
  if (!Number.isFinite(rectMaxX2) || rectMaxX2 > REAL_PDF_SELECTION_MAX_X2) {
    throw new Error(`Real PDF selection saved right-column geometry: rectMaxX2=${result.rectMaxX2}, result=${JSON.stringify(result)}`);
  }
}

async function runPdfSidebarStep(page) {
  await waitForPdfRegressionReady(page);
  await activatePdfPane(page, "pdf-left-pane");
  console.log("[pdf-regression] open left annotation sidebar");
  await page.keyboard.press("Control+Shift+A");
  await page.waitForTimeout(800);
  await waitForPdfPaneRendered(page, "pdf-left-pane");
  const leftSidebarWidthCoverage = await page.evaluate(() => {
    const shell = document.querySelector('[data-testid="pdf-left-shell"]');
    const viewer = shell?.querySelector('[data-testid="pdf-viewer-container-pdf-left-pane"]');
    const firstPage = shell?.querySelector('[data-page-number="1"]');
    if (!(viewer instanceof HTMLElement) || !(firstPage instanceof HTMLElement)) {
      return 0;
    }
    const viewerWidth = viewer.getBoundingClientRect().width;
    const pageWidth = firstPage.getBoundingClientRect().width;
    return viewerWidth > 0 ? pageWidth / viewerWidth : 0;
  });
  if (leftSidebarWidthCoverage < 0.58) {
    throw new Error(`Left PDF page width coverage dropped too far after sidebar toggle: ${leftSidebarWidthCoverage.toFixed(3)}`);
  }
  await page.keyboard.press("Control+Shift+A");
  await page.waitForTimeout(500);
}

async function runPdfZoomLeftStep(page) {
  await waitForPdfRegressionReady(page);
  const initialLeftZoom = await getPdfZoomLabel(page, "pdf-left-pane");
  const initialRightZoom = await getPdfZoomLabel(page, "pdf-right-pane");
  if (!initialLeftZoom || initialLeftZoom !== initialRightZoom) {
    throw new Error(`Expected both panes to start with the same zoom label, got left="${initialLeftZoom}" right="${initialRightZoom}"`);
  }

  console.log("[pdf-regression] keyboard zoom left");
  await activatePdfPane(page, "pdf-left-pane");
  await page.keyboard.press("Control+=");
  const leftManualZoom = await waitForPdfZoomChange(page, "pdf-left-pane", initialLeftZoom);
  if (!leftManualZoom || leftManualZoom === initialLeftZoom || !leftManualZoom.endsWith("%")) {
    throw new Error(`Expected left pane keyboard zoom to enter manual percentage mode, got "${leftManualZoom}" from initial "${initialLeftZoom}"`);
  }
  await expectText(page.getByTestId("pdf-zoom-label-pdf-right-pane"), initialRightZoom, "Right pane unchanged after left keyboard zoom");
}

async function runPdfZoomRightStep(page) {
  await waitForPdfRegressionReady(page);
  const initialLeftZoom = await getPdfZoomLabel(page, "pdf-left-pane");
  const initialRightZoom = await getPdfZoomLabel(page, "pdf-right-pane");
  if (!initialLeftZoom || initialLeftZoom !== initialRightZoom) {
    throw new Error(`Expected both panes to start with the same zoom label, got left="${initialLeftZoom}" right="${initialRightZoom}"`);
  }

  console.log("[pdf-regression] keyboard zoom right");
  await activatePdfPane(page, "pdf-right-pane");
  await page.keyboard.press("Control+=");
  const rightManualZoom = await waitForPdfZoomChange(page, "pdf-right-pane", initialRightZoom);
  await expectText(page.getByTestId("pdf-zoom-label-pdf-left-pane"), initialLeftZoom, "Left pane unchanged after right keyboard zoom");
  if (!rightManualZoom || rightManualZoom === initialRightZoom || !rightManualZoom.endsWith("%")) {
    throw new Error(`Expected right pane keyboard zoom to enter manual percentage mode, got "${rightManualZoom}" from initial "${initialRightZoom}"`);
  }
}

async function runPdfScrollStep(page) {
  await waitForPdfRegressionReady(page);
  console.log("[pdf-regression] scroll right deep");
  await page.getByTestId("scroll-right-to-page-2").click();
  await page.waitForTimeout(1200);
  await page.waitForFunction(() => {
    const shell = document.querySelector('[data-testid="pdf-right-shell"]');
    if (!(shell instanceof HTMLElement)) {
      return false;
    }
    const shellRect = shell.getBoundingClientRect();
    const targetPage = shell.querySelector('[data-page-number="2"]');
    if (targetPage instanceof HTMLElement) {
      const rect = targetPage.getBoundingClientRect();
      if (rect.bottom > shellRect.top + 48 && rect.top < shellRect.bottom - 48) {
        return true;
      }
    }

    const anchorPage = Number(document.querySelector('[data-testid="pdf-anchor-page-pdf-right-pane"]')?.textContent?.trim() ?? "0");
    return anchorPage >= 2;
  }, undefined, { timeout: PDF_ASSERT_TIMEOUT_MS });
}

async function runPdfPositionRestoreStep(page) {
  console.log("[pdf-regression] position-restore open stable page with reset");
  await openPdfRegressionPage(page, { stableState: true, resetViewState: true });
  await waitForPdfPaneRendered(page, "pdf-right-pane");
  await waitForPdfScrollableReady(page, "pdf-right-pane");

  console.log("[pdf-regression] position-restore scroll right pane deep");
  await page.getByTestId("scroll-right-to-page-2").click();
  await page.waitForFunction(() => {
    const anchorPage = document.querySelector('[data-testid="pdf-anchor-page-pdf-right-pane"]')?.textContent?.trim() ?? "0";
    return Number(anchorPage) >= 2;
  }, undefined, { timeout: PDF_ASSERT_TIMEOUT_MS });
  await page.waitForTimeout(800);

  const before = await page.evaluate(() => {
    const container = document.querySelector('[data-testid="pdf-viewer-container-pdf-right-pane"]')
      ?? document.querySelector('[data-testid="pdf-scroll-container-pdf-right-pane"]');
    return {
      anchorPage: Number(document.querySelector('[data-testid="pdf-anchor-page-pdf-right-pane"]')?.textContent?.trim() ?? "0"),
      scrollTop: container instanceof HTMLElement ? container.scrollTop : 0,
    };
  });
  if (before.anchorPage < 2 || before.scrollTop <= 0) {
    throw new Error(`PDF position was not captured before reload: ${JSON.stringify(before)}`);
  }

  console.log("[pdf-regression] position-restore reload stable page");
  await openPdfRegressionPage(page, { stableState: true });
  await waitForPdfPaneRendered(page, "pdf-right-pane");
  await page.waitForFunction(() => {
    const anchorPage = document.querySelector('[data-testid="pdf-anchor-page-pdf-right-pane"]')?.textContent?.trim() ?? "0";
    const restoreStatus = document.querySelector('[data-testid="pdf-restore-status-pdf-right-pane"]')?.textContent?.trim() ?? "";
    const restoreOk = document.querySelector('[data-testid="pdf-restore-ok-pdf-right-pane"]')?.textContent?.trim() ?? "";
    return Number(anchorPage) >= 2 && restoreOk === "true" && (restoreStatus === "restored" || restoreStatus === "fallback");
  }, undefined, { timeout: PDF_ASSERT_TIMEOUT_MS });

  const after = await page.evaluate(() => ({
    anchorPage: Number(document.querySelector('[data-testid="pdf-anchor-page-pdf-right-pane"]')?.textContent?.trim() ?? "0"),
    restoreStatus: document.querySelector('[data-testid="pdf-restore-status-pdf-right-pane"]')?.textContent?.trim() ?? "",
    restoreOk: document.querySelector('[data-testid="pdf-restore-ok-pdf-right-pane"]')?.textContent?.trim() ?? "",
    expectedPage: document.querySelector('[data-testid="pdf-restore-expected-page-pdf-right-pane"]')?.textContent?.trim() ?? "",
    actualPage: document.querySelector('[data-testid="pdf-restore-actual-page-pdf-right-pane"]')?.textContent?.trim() ?? "",
  }));
  console.log(`[pdf-regression] position-restore result ${JSON.stringify({ before, after })}`);
}

async function runPdfFileSwitchStep(page) {
  await waitForPdfRegressionReady(page);
  console.log("[pdf-regression] switch right file");
  await page.getByTestId("toggle-right-file").click();
  await expectText(page.getByTestId("right-file-indicator"), "right-fixture-b.pdf", "Right pane switched to fixture B");
  await waitForPdfPaneRendered(page, "pdf-right-pane");
}

async function runPdfFileRestoreZoomStep(page) {
  await waitForPdfRegressionReady(page, { stableState: true, resetViewState: true });
  const initialRightZoom = await getPdfZoomLabel(page, "pdf-right-pane");
  await activatePdfPane(page, "pdf-right-pane");
  await page.keyboard.press("Control+=");
  const rightManualZoom = await waitForPdfZoomChange(page, "pdf-right-pane", initialRightZoom);

  console.log("[pdf-regression] switch right file and restore manual zoom");
  await page.getByTestId("toggle-right-file").click();
  await expectText(page.getByTestId("right-file-indicator"), "right-fixture-b.pdf", "Right pane switched to fixture B");
  await waitForPdfPaneRendered(page, "pdf-right-pane");
  await page.getByTestId("toggle-right-file").click();
  await expectText(page.getByTestId("right-file-indicator"), "right-fixture-a.pdf", "Right pane switched back to fixture A");
  await waitForPdfPaneRendered(page, "pdf-right-pane");
  await expectText(page.getByTestId("pdf-zoom-label-pdf-right-pane"), rightManualZoom, "Right pane restored manual zoom after file switch");
}

async function runPdfJsProbeStep(page) {
  console.log("[pdf-regression] open PDF.js probe");
  await page.goto(`${page.baseUrl}/diagnostics/pdf-js-probe`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("pdf-js-probe-ready").waitFor({ timeout: PDF_READY_TIMEOUT_MS });
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-testid="pdf-js-probe-status"]')?.textContent?.trim() ?? "";
    return status === "ready" || status === "error";
  }, undefined, { timeout: PDF_ASSERT_TIMEOUT_MS });
  await page.waitForFunction(() => {
    const values = [
      document.querySelector('[data-testid="pdf-js-probe-dual-left"]')?.textContent?.trim() ?? "",
      document.querySelector('[data-testid="pdf-js-probe-dual-right"]')?.textContent?.trim() ?? "",
      document.querySelector('[data-testid="pdf-js-probe-smoke-left"]')?.textContent?.trim() ?? "",
      document.querySelector('[data-testid="pdf-js-probe-smoke-right"]')?.textContent?.trim() ?? "",
    ];
    const isDone = (value) => value.startsWith("ready:") || value.startsWith("error:");
    return values.every(isDone);
  }, undefined, { timeout: PDF_ASSERT_TIMEOUT_MS });

  const status = (await page.getByTestId("pdf-js-probe-status").textContent())?.trim() ?? "";
  const pages = (await page.getByTestId("pdf-js-probe-pages").textContent())?.trim() ?? "";
  const error = (await page.getByTestId("pdf-js-probe-error").textContent())?.trim() ?? "";
  const dualLeft = (await page.getByTestId("pdf-js-probe-dual-left").textContent())?.trim() ?? "";
  const dualRight = (await page.getByTestId("pdf-js-probe-dual-right").textContent())?.trim() ?? "";
  const smokeLeft = (await page.getByTestId("pdf-js-probe-smoke-left").textContent())?.trim() ?? "";
  const smokeRight = (await page.getByTestId("pdf-js-probe-smoke-right").textContent())?.trim() ?? "";
  console.log(`[pdf-regression] PDF.js probe status=${status} pages=${pages} error=${error} dualLeft=${dualLeft} dualRight=${dualRight} smokeLeft=${smokeLeft} smokeRight=${smokeRight}`);

  if (status !== "ready" || Number(pages) < 1) {
    throw new Error(`PDF.js probe failed: status=${status} pages=${pages} error=${error}`);
  }
  if (!dualLeft.startsWith("ready:1:") || !dualRight.startsWith("ready:2:")) {
    throw new Error(`PDF.js dual probe failed: left=${dualLeft} right=${dualRight}`);
  }
  if (!smokeLeft.startsWith("ready:1:") || !smokeRight.startsWith("ready:2:")) {
    throw new Error(`PDF.js smoke fixture probe failed: left=${smokeLeft} right=${smokeRight}`);
  }
}

const PDF_REGRESSION_STEPS = [
  ["pdfjs-probe", runPdfJsProbeStep],
  ["smoke", runPdfSmokeStep],
  ["text-layer", runPdfTextLayerStep],
  ["layout", runPdfLayoutStep],
  ["selection-copy", runPdfSelectionCopyStep],
  ["highlight-save-restore", runPdfHighlightSaveRestoreStep],
  ["real-paper-interactions", runPdfRealPaperInteractionsStep],
  ["sidebar", runPdfSidebarStep],
  ["zoom-left", runPdfZoomLeftStep],
  ["zoom-right", runPdfZoomRightStep],
  ["scroll", runPdfScrollStep],
  ["position-restore", runPdfPositionRestoreStep],
  ["file-switch", runPdfFileSwitchStep],
  ["file-restore-zoom", runPdfFileRestoreZoomStep],
];

function getSelectedPdfRegressionSteps() {
  const requestedStepNames = PDF_STEP_FILTER === "all"
    ? null
    : new Set(PDF_STEP_FILTER.split(",").map((name) => name.trim()).filter(Boolean));
  const selectedSteps = PDF_REGRESSION_STEPS.filter(([name]) => !requestedStepNames || requestedStepNames.has(name));
  if (selectedSteps.length === 0) {
    throw new Error(`Unknown PDF regression step "${PDF_STEP_FILTER}". Expected one or more of: ${PDF_REGRESSION_STEPS.map(([name]) => name).join(", ")}, all.`);
  }
  if (requestedStepNames) {
    const knownStepNames = new Set(PDF_REGRESSION_STEPS.map(([name]) => name));
    const unknownStepNames = [...requestedStepNames].filter((name) => !knownStepNames.has(name));
    if (unknownStepNames.length > 0) {
      throw new Error(`Unknown PDF regression step "${unknownStepNames.join(", ")}". Expected one or more of: ${PDF_REGRESSION_STEPS.map(([name]) => name).join(", ")}, all.`);
    }
  }
  return selectedSteps;
}

function shouldRunPdfRegressionFlow() {
  return FLOW_FILTER === "all" || FLOW_FILTER === "pdf";
}

async function runPdfRegressionStep(page, baseUrl, name, step) {
  page.baseUrl = baseUrl;
  console.log(`[pdf-regression] start step: ${name}`);
  await step(page);
  console.log(`[pdf-regression] completed step: ${name}`);
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
      () => waitForTextContaining(page, "selection-ai-agent-session-id", "agent-session", "Selection AI agent session id"),
      () => waitForExactText(page, "selection-ai-agent-status", "completed", "Selection AI agent session completed"),
      () => waitForNumericTextAtLeast(page, "selection-ai-agent-trace-count", 4, "Selection AI agent trace count"),
      () => waitForExactText(page, "selection-ai-agent-plan-source", "custom", "Selection AI agent plan source"),
      () => waitForExactText(page, "selection-ai-agent-plan-warning-count", "0", "Selection AI agent plan warning count"),
      () => waitForTextContaining(page, "selection-ai-agent-planner-prompt-preview", "Agent diagnostics prompt", "Selection AI planner prompt preview"),
      () => waitForTextContaining(page, "selection-ai-agent-planner-raw-preview", "Collect diagnostics selection context", "Selection AI planner raw output preview"),
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

async function clickAiChatResearchAgentSubmit(page) {
  const submitTitles = [
    "Run a traced research agent with current context and evidence",
    "使用当前上下文和证据运行可审计研究 Agent",
  ];

  for (const title of submitTitles) {
    const button = page.getByTitle(title);
    if (await button.count() > 0) {
      await button.last().click();
      return;
    }
  }

  throw new Error(`AI Chat Research Agent submit button not found. Tried titles: ${submitTitles.join(", ")}`);
}

async function clickFirstVisibleButtonByNames(page, names, label) {
  for (const name of names) {
    const button = page.getByRole("button", { name });
    const count = await button.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = button.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.click();
        return;
      }
    }
  }

  throw new Error(`${label} button not found. Tried names: ${names.join(", ")}`);
}

async function clickFirstVisibleScopedButtonByNames(locator, names, label) {
  for (const name of names) {
    const button = locator.getByRole("button", { name });
    const count = await button.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = button.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.click();
        return;
      }
    }
  }

  throw new Error(`${label} button not found in scope. Tried names: ${names.join(", ")}`);
}

async function testAiChatResearchAgent(page, baseUrl) {
  await page.goto(`${baseUrl}/diagnostics/ai-chat-research-agent`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("ai-chat-research-agent-ready").waitFor({ timeout: 120000 });

  const scenarios = [
    {
      name: "reading-note",
      prompt: "Create a reading note from this diagnostics source",
      workflowLabel: "Reading Note",
      workbenchMode: "draft-ready",
      followUpKinds: "create_draft",
      saveDraftVisible: "true",
      proposalVisible: "false",
      draftTitleContains: "Reading Note",
      action: "save-draft",
    },
    {
      name: "knowledge-organization",
      prompt: "Organize and link this diagnostics note into the workspace knowledge structure",
      workflowLabel: "Knowledge Organization",
      workbenchMode: "proposal-ready",
      followUpKinds: "propose_task",
      saveDraftVisible: "false",
      proposalVisible: "true",
      draftTitleContains: "none",
      action: "generate-proposal",
    },
    {
      name: "teaching-explain",
      prompt: "Explain this diagnostics concept to students with examples",
      workflowLabel: "Teaching Explain",
      workbenchMode: "answer-only",
      followUpKinds: "none",
      saveDraftVisible: "false",
      proposalVisible: "false",
      draftTitleContains: "none",
      action: null,
    },
  ];

  for (const scenario of scenarios) {
    await page.getByTestId("reset-ai-chat-research-agent-diagnostics").click();
    await page.locator("textarea").first().fill(scenario.prompt);
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    await clickAiChatResearchAgentSubmit(page);

    await waitForTextContaining(page, "ai-chat-latest-user", `[Research Agent] ${scenario.prompt}`, `AI Chat Research Agent ${scenario.name} user message`);
    await waitForTextContaining(page, "ai-chat-latest-assistant", `Task: ${scenario.prompt}`, `AI Chat Research Agent ${scenario.name} assistant message`);
    await waitForNumericTextAtLeast(page, "ai-chat-evidence-count", 1, `AI Chat Research Agent ${scenario.name} evidence count`);
    await waitForNumericTextAtLeast(page, "ai-chat-prompt-context-node-count", 1, `AI Chat Research Agent ${scenario.name} prompt context node count`);
    await waitForExactText(page, "ai-chat-assistant-model", "ai-chat-research-regression", `AI Chat Research Agent ${scenario.name} planner model`);
    await waitForTextContaining(page, "ai-chat-agent-session-id", "agent-session", `AI Chat Research Agent ${scenario.name} session id`);
    await waitForTextInSet(page, "ai-chat-agent-status", ["completed", "waiting_approval"], `AI Chat Research Agent ${scenario.name} session finished or waiting approval`);
    await waitForNumericTextAtLeast(page, "ai-chat-agent-trace-count", 4, `AI Chat Research Agent ${scenario.name} trace count`);
    await waitForExactText(page, "ai-chat-agent-plan-source", "custom", `AI Chat Research Agent ${scenario.name} plan source`);
    await waitForExactText(page, "ai-chat-agent-plan-warning-count", "0", `AI Chat Research Agent ${scenario.name} plan warning count`);
    await waitForTextContaining(page, "ai-chat-agent-planner-prompt-preview", "Lattice Research Agent run", `AI Chat Research Agent ${scenario.name} planner prompt preview`);
    await waitForTextContaining(page, "ai-chat-agent-planner-raw-preview", "Collect AI Chat diagnostics context", `AI Chat Research Agent ${scenario.name} planner raw output preview`);
    await waitForExactText(page, "ai-chat-workflow-label", scenario.workflowLabel, `AI Chat Research Agent ${scenario.name} workflow label`);
    await waitForExactText(page, "ai-chat-workflow-inferred", "true", `AI Chat Research Agent ${scenario.name} workflow inferred`);
    await waitForExactText(page, "ai-chat-workbench-mode", scenario.workbenchMode, `AI Chat Research Agent ${scenario.name} workbench mode`);
    await waitForExactText(page, "ai-chat-follow-up-kinds", scenario.followUpKinds, `AI Chat Research Agent ${scenario.name} follow-up kinds`);
    await waitForExactText(page, "ai-chat-save-draft-visible", scenario.saveDraftVisible, `AI Chat Research Agent ${scenario.name} save draft visibility`);
    await waitForExactText(page, "ai-chat-proposal-visible", scenario.proposalVisible, `AI Chat Research Agent ${scenario.name} proposal visibility`);
    await waitForTextContaining(page, "ai-chat-draft-suggestion-title", scenario.draftTitleContains, `AI Chat Research Agent ${scenario.name} draft suggestion`);

    if (scenario.action === "save-draft") {
      await page.getByTestId("ai-chat-follow-up-save-draft").click();
      await waitForExactText(page, "ai-chat-workbench-draft-count", "1", `AI Chat Research Agent ${scenario.name} workbench draft count`);
      await waitForTextContaining(page, "ai-chat-workbench-latest-draft-title", scenario.draftTitleContains, `AI Chat Research Agent ${scenario.name} latest draft title`);
      await waitForExactText(page, "ai-chat-workbench-proposal-count", "0", `AI Chat Research Agent ${scenario.name} workbench proposal count`);
    } else if (scenario.action === "generate-proposal") {
      await page.getByTestId("ai-chat-follow-up-generate-proposal").click();
      await waitForExactText(page, "ai-chat-workbench-draft-count", "0", `AI Chat Research Agent ${scenario.name} workbench draft count`);
      await waitForExactText(page, "ai-chat-workbench-proposal-count", "1", `AI Chat Research Agent ${scenario.name} workbench proposal count`);
      await waitForTextContaining(page, "ai-chat-workbench-latest-proposal-title", scenario.prompt, `AI Chat Research Agent ${scenario.name} latest proposal title`);
    } else {
      await waitForExactText(page, "ai-chat-workbench-draft-count", "0", `AI Chat Research Agent ${scenario.name} workbench draft count`);
      await waitForExactText(page, "ai-chat-workbench-proposal-count", "0", `AI Chat Research Agent ${scenario.name} workbench proposal count`);
    }
  }

  await page.getByTestId("reset-ai-chat-research-agent-diagnostics").click();
  await page.getByTestId("create-ai-chat-agent-approval-fixture").click();
  await waitForExactText(page, "ai-chat-agent-status", "waiting_approval", "AI Chat Research Agent approval fixture waits for approval");
  await waitForExactText(page, "ai-chat-agent-pending-approval-count", "1", "AI Chat Research Agent approval fixture pending count");
  await waitForTextContaining(page, "ai-chat-agent-approval-tools", "runner.runCode:pending", "AI Chat Research Agent approval fixture pending tool");
  await clickFirstVisibleScopedButtonByNames(page.getByTestId("ai-chat-agent-approval-trace"), ["Approve and run", "批准并运行"], "AI Chat Research Agent approval fixture approve");
  await waitForExactText(page, "ai-chat-agent-pending-approval-count", "0", "AI Chat Research Agent approval fixture pending count after approval");
  await waitForExactText(page, "ai-chat-agent-completed-approval-count", "1", "AI Chat Research Agent approval fixture completed count");
  await waitForTextContaining(page, "ai-chat-agent-approval-tools", "runner.runCode:completed", "AI Chat Research Agent approval fixture completed tool");
  await waitForTextContaining(page, "ai-chat-agent-latest-approval-result", "diagnostics approval ok", "AI Chat Research Agent approval fixture result");
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
  const originalTsconfig = await backupTsconfig();

  const port = await findAvailablePort(DEFAULT_PORT);
  const baseUrl = `http://${HOST}:${port}`;
  const server = startNextDevServer(port);
  let browser;
  let ranPdfFlow = false;

  try {
    const healthPath = FLOW_FILTER === "pdf"
      ? PDF_STEP_FILTER === "pdfjs-probe"
        ? "/diagnostics/pdf-js-probe"
        : "/diagnostics/pdf-regression"
      : FLOW_FILTER === "image-annotation"
        ? "/diagnostics/image-annotation"
        : FLOW_FILTER === "selection-ai"
          ? "/diagnostics/selection-ai"
          : FLOW_FILTER === "ai-chat-research-agent"
            ? "/diagnostics/ai-chat-research-agent"
            : FLOW_FILTER === "performance"
              ? "/performance-test"
              : "";
    await waitForServer(`${baseUrl}${healthPath}`, 300000);
    browser = await chromium.launch({ headless: true });
    const createPage = () => browser.newPage({ viewport: { width: 1720, height: 1080 } });

    const runFlow = async (name, flow) => {
      console.log(`[browser-regression] start flow: ${name}`);
      const page = await createPage();
      const isPdfFlow = name.startsWith("pdf-");
      if (isPdfFlow) {
        ranPdfFlow = true;
      }
      attachPageDiagnostics(page, name);
      try {
        if (isPdfFlow) {
          await withTimeout(`Browser regression flow "${name}"`, PDF_FLOW_TIMEOUT_MS, () => flow(page, baseUrl));
        } else {
          await flow(page, baseUrl);
        }
        console.log(`[browser-regression] completed flow: ${name}`);
      } catch (error) {
        if (name.startsWith("pdf-")) {
          await bestEffortWithTimeout(
            `PDF regression failure state for "${name}"`,
            PDF_CLEANUP_TIMEOUT_MS,
            () => logPdfRegressionReadyState(page, `flow-failure-${name}`),
          );
        }
        if (isPdfFlow) {
          await bestEffortWithTimeout(
            `PDF regression screenshot for "${name}"`,
            PDF_CLEANUP_TIMEOUT_MS,
            () => screenshotOnFailure(page, `browser-regression-failure-${name}`),
          );
        } else {
          try {
            await screenshotOnFailure(page, `browser-regression-failure-${name}`);
          } catch (screenshotError) {
            console.error(`Failed to capture regression screenshot for ${name}:`, screenshotError instanceof Error ? screenshotError.message : screenshotError);
          }
        }
        throw error;
      } finally {
        if (isPdfFlow) {
          await bestEffortWithTimeout(
            `Close PDF regression page "${name}"`,
            PDF_CLEANUP_TIMEOUT_MS,
            () => page.close(),
          );
        } else {
          await page.close();
        }
      }
    };

    const pdfFlows = shouldRunPdfRegressionFlow() ? getSelectedPdfRegressionSteps().map(([stepName, step]) => [
      `pdf-${stepName}`,
      (page, flowBaseUrl) => runPdfRegressionStep(page, flowBaseUrl, stepName, step),
    ]) : [];

    const flows = [
      ...pdfFlows,
      ["image-annotation", testImageAnnotation],
      ["selection-ai", testSelectionAi],
      ["ai-chat-research-agent", testAiChatResearchAgent],
      ["performance", testPerformanceBaseline],
    ];
    for (const [name, flow] of flows) {
      const isPdfFlow = name.startsWith("pdf-");
      if (FLOW_FILTER === "pdf" && !isPdfFlow) {
        continue;
      }
      if (FLOW_FILTER !== "all" && FLOW_FILTER !== "pdf" && FLOW_FILTER !== name) {
        continue;
      }
      await runFlow(name, flow);
    }
    console.log("Browser regression completed.");
  } finally {
    if (browser) {
      if (ranPdfFlow) {
        await bestEffortWithTimeout(
          "Close browser after PDF regression",
          PDF_CLEANUP_TIMEOUT_MS,
          () => browser.close(),
        );
      } else {
        await browser.close();
      }
    }
    await stopServer(server);
    await restoreTsconfig(originalTsconfig);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
