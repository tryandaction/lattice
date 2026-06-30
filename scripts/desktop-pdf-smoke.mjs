import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const ROOT_DIR = process.cwd();
const OUTPUT_DIR = path.join(ROOT_DIR, "output", "desktop-smoke");
const DEFAULT_EXE = path.join(ROOT_DIR, "src-tauri", "target", "release", "lattice.exe");
const DEFAULT_REAL_PDF = "C:/universe/MyStudy/atom/Categorized Papers/Reviews_Classics/Saffman 等 - 2010 - Quantum information with Rydberg atoms.pdf";
const REAL_PDF_ROUTE_PATH = "/__lattice-diagnostics/saffman-real.pdf";
const REAL_PDF_PAGE = Number(process.env.LATTICE_DESKTOP_SMOKE_REAL_PDF_PAGE ?? 7);
const REAL_PDF_SELECTION_TARGET = process.env.LATTICE_DESKTOP_SMOKE_REAL_PDF_SELECTION_TARGET ?? "Fig. 5, that tend";
const REAL_PDF_SELECTION_FULL = "Fig. 5, that tend to cause shifts in opposite directions";
const ASSERT_TIMEOUT_MS = Number(process.env.LATTICE_DESKTOP_SMOKE_TIMEOUT_MS ?? 120000);

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (!port) {
          reject(new Error("Unable to allocate a local CDP port."));
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForHttpOk(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const statusCode = await new Promise((resolve, reject) => {
        const request = http.get(url, (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        request.on("error", reject);
        request.setTimeout(3000, () => {
          request.destroy(new Error("HTTP probe timed out."));
        });
      });
      if (statusCode >= 200 && statusCode < 300) {
        return;
      }
      lastError = new Error(`Unexpected status ${statusCode}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function closeExistingLatticeProcesses() {
  if (process.env.LATTICE_DESKTOP_SMOKE_KEEP_EXISTING === "1") {
    return;
  }

  const command = [
    "$processes = Get-Process -Name lattice -ErrorAction SilentlyContinue;",
    "foreach ($process in $processes) {",
    "  try { $null = $process.CloseMainWindow() } catch {}",
    "}",
    "Start-Sleep -Milliseconds 1500;",
    "$processes = Get-Process -Name lattice -ErrorAction SilentlyContinue;",
    "foreach ($process in $processes) {",
    "  try { Stop-Process -Id $process.Id -Force -ErrorAction Stop } catch {}",
    "}",
  ].join(" ");

  await new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      console.warn(`[desktop-smoke] close existing Lattice processes returned ${code}: ${stderr.trim()}`);
      resolve();
    });
  });
}

async function waitForDesktopPage(browser, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const context of browser.contexts()) {
      const page = context.pages().find((candidate) => {
        const url = candidate.url();
        return url && url !== "about:blank" && !url.startsWith("devtools://");
      });
      if (page) {
        return page;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the Lattice desktop WebView page.");
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

async function clickAnnotationCenter(page, annotationId) {
  const point = await page.evaluate((id) => {
    const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(id)
      : id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    const selectors = [
      `.pdf-stored-annotation-overlay-${escapedId} [data-pdf-stored-annotation-segment="true"]`,
      `.text-overlay-${escapedId} [data-pdf-text-annotation-content="true"]`,
      `.ink-overlay-${escapedId} [data-pdf-ink-annotation-bounds-hit-area="true"]`,
      `.ink-overlay-${escapedId} [data-pdf-ink-annotation-segment="true"]`,
      `.ink-overlay-${escapedId} [data-pdf-ink-annotation-content="true"]`,
    ];
    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll(selector));
      const element = elements
        .filter((candidate) => candidate instanceof Element)
        .map((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return { candidate, rect };
        })
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        .sort((left, right) => (left.rect.width * left.rect.height) - (right.rect.width * right.rect.height))[0]?.candidate;
      if (!(element instanceof Element)) {
        continue;
      }
      element.scrollIntoView?.({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const visibleLeft = Math.max(rect.left, 4);
      const visibleTop = Math.max(rect.top, 4);
      const visibleRight = Math.min(rect.right, Math.max(4, viewportWidth - 4));
      const visibleBottom = Math.min(rect.bottom, Math.max(4, viewportHeight - 4));
      if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
        continue;
      }
      return {
        x: (visibleLeft + visibleRight) / 2,
        y: (visibleTop + visibleBottom) / 2,
        selector,
        tagName: element.tagName,
        dataset: { ...(element instanceof HTMLElement || element instanceof SVGElement ? element.dataset : {}) },
      };
    }
    return null;
  }, annotationId);

  if (!point) {
    return false;
  }
  await page.mouse.click(point.x, point.y);
  return point;
}

async function waitForAnnotationOverlay(page, annotationId) {
  await page.waitForFunction((id) => {
    const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(id)
      : id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    const selectors = [
      `.pdf-stored-annotation-overlay-${escapedId} [data-pdf-stored-annotation-segment="true"]`,
      `.text-overlay-${escapedId} [data-pdf-text-annotation-content="true"]`,
      `.ink-overlay-${escapedId} [data-pdf-ink-annotation-bounds-hit-area="true"]`,
      `.ink-overlay-${escapedId} [data-pdf-ink-annotation-segment="true"]`,
      `.ink-overlay-${escapedId} [data-pdf-ink-annotation-content="true"]`,
    ];
    return selectors.some((selector) => (
      Array.from(document.querySelectorAll(selector)).some((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
    ));
  }, annotationId, { timeout: ASSERT_TIMEOUT_MS });
}

async function inspectPoint(page, x, y) {
  return page.evaluate(({ clientX, clientY }) => {
    const element = document.elementFromPoint(clientX, clientY);
    if (!element) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      tagName: element.tagName,
      className: typeof element.className === "string" ? element.className : String(element.className?.baseVal ?? ""),
      dataset: { ...(element instanceof HTMLElement || element instanceof SVGElement ? element.dataset : {}) },
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      pointerEvents: style.pointerEvents,
      zIndex: style.zIndex,
    };
  }, { clientX: x, clientY: y });
}

async function collectAnnotationOverlayDiagnostics(page, annotationIds) {
  return page.evaluate((ids) => {
    return ids.map((id) => {
      const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(id)
        : id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      const selectors = [
        `.pdf-stored-annotation-overlay-${escapedId}`,
        `.pdf-stored-annotation-overlay-${escapedId} [data-pdf-stored-annotation-segment="true"]`,
        `.text-overlay-${escapedId}`,
        `.text-overlay-${escapedId} [data-pdf-text-annotation-content="true"]`,
        `.ink-overlay-${escapedId}`,
        `.ink-overlay-${escapedId} [data-pdf-ink-annotation-bounds-hit-area="true"]`,
        `.ink-overlay-${escapedId} [data-pdf-ink-annotation-segment="true"]`,
      ];
      return {
        id,
        elements: selectors.flatMap((selector) => (
          Array.from(document.querySelectorAll(selector)).map((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return {
              selector,
              rect: {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              },
              zIndex: style.zIndex,
              opacity: style.opacity,
              backgroundColor: style.backgroundColor,
              backgroundImage: style.backgroundImage,
              border: style.border,
              pointerEvents: style.pointerEvents,
            };
          })
        )),
      };
    });
  }, annotationIds);
}

async function scrollPdfPaneToPage(page, paneId, pageNumber) {
  const ok = await page.evaluate(({ targetPaneId, targetPageNumber }) => {
    const diagnostics = window.__latticePdfDiagnostics?.[targetPaneId];
    return diagnostics?.scrollToPage?.(targetPageNumber) === true;
  }, { targetPaneId: paneId, targetPageNumber: pageNumber });
  if (!ok) {
    throw new Error(`PDF diagnostics scroll bridge is unavailable for ${paneId}.`);
  }
}

async function waitForPdfPageText(page, paneId, pageNumber, expectedText, timeoutMs) {
  await page.waitForFunction(({ targetPaneId, targetPageNumber, text }) => {
    const shellId = targetPaneId === "pdf-left-pane" ? "pdf-left-shell" : "pdf-right-shell";
    const pageElement = document.querySelector(`[data-testid="${shellId}"] [data-page-number="${targetPageNumber}"]`);
    if (!pageElement) {
      return false;
    }
    const layerText = Array.from(pageElement.querySelectorAll(".textLayer"))
      .map((layer) => layer.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ");
    return layerText.includes(text);
  }, { targetPaneId: paneId, targetPageNumber: pageNumber, text: expectedText }, { timeout: timeoutMs });
}

async function closeStoredMenu(page, annotationId) {
  await clickPdfPageRatio(page, "pdf-left-pane", REAL_PDF_PAGE, 0.03, 0.08);
  await page.locator(`[data-pdf-annotation-menu="${annotationId}"]`).waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}

async function assertStoredMenu(page, annotationId, xRatio, yRatio, expectedText = "") {
  await waitForAnnotationOverlay(page, annotationId);
  const clickedOverlay = await clickAnnotationCenter(page, annotationId);
  const clickInspection = clickedOverlay
    ? await inspectPoint(page, clickedOverlay.x, clickedOverlay.y)
    : null;
  if (!clickedOverlay) {
    await clickPdfPageRatio(page, "pdf-left-pane", REAL_PDF_PAGE, xRatio, yRatio);
  }
  const menu = page.locator(`[data-pdf-annotation-menu="${annotationId}"]`);
  try {
    await menu.waitFor({ timeout: ASSERT_TIMEOUT_MS });
  } catch (error) {
    throw new Error(`Stored annotation menu ${annotationId} did not open. clickedOverlay=${JSON.stringify(clickedOverlay)} elementFromPoint=${JSON.stringify(clickInspection)} original=${error instanceof Error ? error.message : String(error)}`);
  }
  if (expectedText) {
    const menuText = await menu.textContent();
    if (!menuText?.includes(expectedText)) {
      throw new Error(`Stored annotation menu ${annotationId} did not include expected text "${expectedText}". Received: ${menuText}`);
    }
  }
  await closeStoredMenu(page, annotationId);
}

async function main() {
  const exePath = path.resolve(process.env.LATTICE_DESKTOP_EXE ?? DEFAULT_EXE);
  const realPdfPath = path.resolve(process.env.LATTICE_DESKTOP_SMOKE_REAL_PDF_PATH ?? DEFAULT_REAL_PDF);
  await access(exePath);
  await access(realPdfPath);
  await mkdir(OUTPUT_DIR, { recursive: true });
  await closeExistingLatticeProcesses();

  const cdpPort = Number(process.env.LATTICE_DESKTOP_CDP_PORT ?? await getAvailablePort());
  const webviewArgs = [
    `--remote-debugging-port=${cdpPort}`,
    "--remote-allow-origins=*",
  ].join(" ");

  console.log(`[desktop-smoke] launch ${exePath}`);
  const child = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: webviewArgs,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });

  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout?.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk).toString("utf8")));
  child.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk).toString("utf8")));

  let browser;
  let page;
  const diagnosticAnnotationIds = [
    "ann-real-highlight",
    "ann-real-underline",
    "ann-real-area",
    "ann-real-pin",
    "ann-real-text",
    "ann-real-ink",
  ];

  try {
    await waitForHttpOk(`http://127.0.0.1:${cdpPort}/json/version`, ASSERT_TIMEOUT_MS);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    page = await waitForDesktopPage(browser, ASSERT_TIMEOUT_MS);
    page.setDefaultTimeout(ASSERT_TIMEOUT_MS);

    const appUrl = new URL(page.url());
    const baseUrl = appUrl.origin;
    console.log(`[desktop-smoke] connected to desktop WebView ${page.url()}`);

    await page.route(`**${REAL_PDF_ROUTE_PATH}`, (route) => route.fulfill({
      path: realPdfPath,
      contentType: "application/pdf",
    }));

    const query = new URLSearchParams({
      singlePane: "1",
      directHighlighter: "1",
      realPdf: "1",
      realPdfUrl: REAL_PDF_ROUTE_PATH,
      realPdfPath,
      realPdfName: path.basename(realPdfPath),
      realPdfPage: String(REAL_PDF_PAGE),
      diagnosticSelectionTarget: REAL_PDF_SELECTION_TARGET,
      diagnosticSelectionPage: String(REAL_PDF_PAGE),
    });

    await page.goto(`${baseUrl}/diagnostics/pdf-regression?${query.toString()}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("pdf-regression-ready").waitFor();
    await page.waitForFunction(() => {
      const shell = document.querySelector('[data-testid="pdf-left-shell"]');
      return (
        Boolean(document.querySelector('[data-testid="pdf-pane-pdf-left-pane"]')) &&
        Boolean(shell?.querySelector("canvas")) &&
        Boolean(shell?.querySelector(".textLayer"))
      );
    });

    await page.waitForFunction(() => (
      window.__latticePdfDiagnostics?.["pdf-left-pane"]?.hasTextLayer?.() === true
    ));
    await page.waitForFunction(() => (
      typeof window.__latticePdfDiagnostics?.["pdf-left-pane"]?.runSelectionOnPage === "function"
    ));
    await page.waitForFunction(() => (
      typeof window.__latticePdfDiagnostics?.["pdf-left-pane"]?.createTextMarkupOnPage === "function"
    ));

    await scrollPdfPaneToPage(page, "pdf-left-pane", REAL_PDF_PAGE);
    await waitForPdfPageText(page, "pdf-left-pane", REAL_PDF_PAGE, REAL_PDF_SELECTION_TARGET, ASSERT_TIMEOUT_MS);

    await assertStoredMenu(page, "ann-real-highlight", 0.26, 0.304, REAL_PDF_SELECTION_FULL);
    await assertStoredMenu(page, "ann-real-underline", 0.18, 0.335, "Stark shifts below 1 MHz");
    await assertStoredMenu(page, "ann-real-area", 0.66, 0.23, "Diagnostic area");
    await assertStoredMenu(page, "ann-real-pin", 0.80, 0.19);
    await assertStoredMenu(page, "ann-real-ink", 0.66, 0.49);

    if (!await clickAnnotationCenter(page, "ann-real-text")) {
      await clickPdfPageRatio(page, "pdf-left-pane", REAL_PDF_PAGE, 0.64, 0.35);
    }
    await page.waitForFunction(() => (
      Array.from(document.querySelectorAll("textarea"))
        .some((element) => element instanceof HTMLTextAreaElement && element.value.includes("Real PDF text note"))
    ));
    await page.keyboard.press("Escape").catch(() => {});

    const beforeCount = await page.evaluate(() => Math.max(
      0,
      ...Array.from(document.querySelectorAll('[data-testid="pdf-diagnostic-selection-annotation-count-pdf-left-pane"]'))
        .map((element) => Number(element.textContent?.trim() ?? "0"))
        .filter(Number.isFinite),
    ));

    await scrollPdfPaneToPage(page, "pdf-left-pane", REAL_PDF_PAGE);
    await waitForPdfPageText(page, "pdf-left-pane", REAL_PDF_PAGE, REAL_PDF_SELECTION_TARGET, ASSERT_TIMEOUT_MS);
    await page.waitForFunction(() => (
      typeof window.__latticePdfDiagnostics?.["pdf-left-pane"]?.runSelectionOnPage === "function"
    ));
    const copyResult = await page.evaluate((targetPage) => (
      window.__latticePdfDiagnostics?.["pdf-left-pane"]?.runSelectionOnPage?.(targetPage, "copy") ?? false
    ), REAL_PDF_PAGE);
    if (!copyResult || copyResult.ok !== true) {
      throw new Error(`Desktop PDF diagnostic page copy selection bridge failed: ${JSON.stringify(copyResult)}`);
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
    ), { target: REAL_PDF_SELECTION_TARGET });
    const copyPayloadAfterCopy = await page.evaluate(() => (
      document.querySelector('[data-testid="pdf-copy-payload-pdf-left-pane"]')?.textContent?.trim() ?? ""
    ));

    const highlightResult = await page.evaluate((targetPage) => (
      window.__latticePdfDiagnostics?.["pdf-left-pane"]?.runSelectionOnPage?.(targetPage, "highlight") ?? false
    ), REAL_PDF_PAGE);
    if (!highlightResult || highlightResult.ok !== true) {
      throw new Error(`Desktop PDF diagnostic page highlight selection bridge failed: ${JSON.stringify(highlightResult)}`);
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
    ), { previousCount: beforeCount, target: REAL_PDF_SELECTION_TARGET });

    const result = await page.evaluate(() => ({
      text: document.querySelector('[data-testid="pdf-diagnostic-selection-text-pdf-left-pane"]')?.textContent?.trim() ?? "",
      source: document.querySelector('[data-testid="pdf-diagnostic-selection-source-pdf-left-pane"]')?.textContent?.trim() ?? "",
      annotationCount: document.querySelector('[data-testid="pdf-diagnostic-selection-annotation-count-pdf-left-pane"]')?.textContent?.trim() ?? "",
      rectCount: document.querySelector('[data-testid="pdf-diagnostic-selection-rect-count-pdf-left-pane"]')?.textContent?.trim() ?? "",
      rectMinX1: document.querySelector('[data-testid="pdf-diagnostic-selection-rect-min-x1-pdf-left-pane"]')?.textContent?.trim() ?? "",
      rectMaxX2: document.querySelector('[data-testid="pdf-diagnostic-selection-rect-max-x2-pdf-left-pane"]')?.textContent?.trim() ?? "",
      hasCanvas: Boolean(document.querySelector('[data-testid="pdf-left-shell"] canvas')),
      hasTextLayer: Boolean(document.querySelector('[data-testid="pdf-left-shell"] .textLayer[data-pdf-text-layer-ready="true"]')),
    }));
    result.copyPayload = copyPayloadAfterCopy;

    if (!result.text.includes(REAL_PDF_SELECTION_TARGET) || !result.copyPayload.includes(REAL_PDF_SELECTION_TARGET)) {
      throw new Error(`Desktop PDF selection/copy did not include target text: ${JSON.stringify(result)}`);
    }
    if (result.text.includes("two-atom states within") || result.text === "0") {
      throw new Error(`Desktop PDF selection drifted or returned zero: ${JSON.stringify(result)}`);
    }
    const rectMaxX2 = Number(result.rectMaxX2);
    if (!Number.isFinite(rectMaxX2) || rectMaxX2 > 0.55) {
      throw new Error(`Desktop PDF selection saved right-column geometry: ${JSON.stringify(result)}`);
    }

    const programmatic = await page.evaluate(({ targetPage, exact }) => (
      window.__latticePdfDiagnostics?.["pdf-left-pane"]?.createTextMarkupOnPage?.(
        targetPage,
        exact,
        "underline",
        "#2196F3",
      ) ?? false
    ), {
      targetPage: REAL_PDF_PAGE,
      exact: REAL_PDF_SELECTION_TARGET,
    });
    if (!programmatic || programmatic.ok !== true || !programmatic.annotationId) {
      throw new Error(`Desktop PDF programmatic text-markup creation failed: ${JSON.stringify(programmatic)}`);
    }
    diagnosticAnnotationIds.push(programmatic.annotationId);
    if (!programmatic.text.includes(REAL_PDF_SELECTION_TARGET) || programmatic.rectCount < 1) {
      throw new Error(`Desktop PDF programmatic text-markup drifted: ${JSON.stringify(programmatic)}`);
    }
    if (Number(programmatic.rectMaxX2) > 0.55) {
      throw new Error(`Desktop PDF programmatic text-markup saved right-column geometry: ${JSON.stringify(programmatic)}`);
    }
    await assertStoredMenu(page, programmatic.annotationId, 0.18, 0.335, REAL_PDF_SELECTION_TARGET);

    await writeFile(path.join(OUTPUT_DIR, "desktop-pdf-smoke.json"), `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      exePath,
      realPdfPath,
      cdpPort,
      result,
      programmatic,
    }, null, 2)}\n`, "utf8");
    console.log(`[desktop-smoke] passed ${JSON.stringify(result)}`);
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(OUTPUT_DIR, "desktop-pdf-smoke-failure.png"), fullPage: true }).catch(() => {});
      const overlayDiagnostics = await collectAnnotationOverlayDiagnostics(page, [
        ...new Set(diagnosticAnnotationIds),
      ]).catch((diagnosticError) => ({
        error: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
      }));
      await writeFile(
        path.join(OUTPUT_DIR, "desktop-pdf-smoke-overlays.json"),
        `${JSON.stringify(overlayDiagnostics, null, 2)}\n`,
        "utf8",
      ).catch(() => {});
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (!child.killed) {
      child.kill();
    }
    await writeFile(path.join(OUTPUT_DIR, "desktop-pdf-smoke-process.log"), [
      "STDOUT:",
      ...stdoutChunks,
      "",
      "STDERR:",
      ...stderrChunks,
    ].join("\n"), "utf8").catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
