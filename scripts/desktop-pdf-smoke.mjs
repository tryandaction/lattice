import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const ROOT_DIR = process.cwd();
const OUTPUT_DIR = path.resolve(process.env.LATTICE_DESKTOP_SMOKE_OUTPUT_DIR ?? path.join(ROOT_DIR, "output", "desktop-smoke"));
const DEFAULT_EXE = path.join(ROOT_DIR, "src-tauri", "target", "release", "lattice.exe");
const DEFAULT_REAL_PDF = "C:/universe/MyStudy/atom/Categorized Papers/Reviews_Classics/Saffman 等 - 2010 - Quantum information with Rydberg atoms.pdf";
const REAL_PDF_ROUTE_PATH = "/__lattice-diagnostics/saffman-real.pdf";
const REAL_PDF_PAGE = Number(process.env.LATTICE_DESKTOP_SMOKE_REAL_PDF_PAGE ?? 7);
const REAL_PDF_SELECTION_TARGET = process.env.LATTICE_DESKTOP_SMOKE_REAL_PDF_SELECTION_TARGET ?? "Fig. 5, that tend";
const REAL_PDF_SELECTION_FULL = "Fig. 5, that tend to cause shifts in opposite directions";
const POINTER_TARGET = process.env.LATTICE_DESKTOP_SMOKE_POINTER_TARGET ?? "";
const POINTER_ONLY = process.env.LATTICE_DESKTOP_SMOKE_POINTER_ONLY === "1";
const POINTER_MIN_RECTS = Number(process.env.LATTICE_DESKTOP_SMOKE_POINTER_MIN_RECTS ?? 1);
const OCR_ONLY = process.env.LATTICE_DESKTOP_SMOKE_OCR_ONLY === "1";
const OCR_POINTER = process.env.LATTICE_DESKTOP_SMOKE_OCR_POINTER === "1";
const OCR_POINTER_EXACT = process.env.LATTICE_DESKTOP_SMOKE_OCR_POINTER_EXACT === "1";
const OCR_TARGET = process.env.LATTICE_DESKTOP_SMOKE_OCR_TARGET ?? "";
const AREA_ADJUST_ONLY = process.env.LATTICE_DESKTOP_SMOKE_AREA_ADJUST_ONLY === "1";
const OCR_LANGUAGE = process.env.LATTICE_DESKTOP_SMOKE_OCR_LANGUAGE ?? "eng";
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

async function waitForPdfPageVisible(page, pageNumber) {
  await page.waitForFunction((targetPageNumber) => {
    const viewer = document.querySelector('[data-testid="pdf-viewer-container-pdf-left-pane"]');
    const pageElement = document.querySelector(
      `[data-testid="pdf-left-shell"] [data-page-number="${targetPageNumber}"]`,
    );
    if (!(viewer instanceof HTMLElement) || !(pageElement instanceof HTMLElement)) {
      return false;
    }

    const viewerRect = viewer.getBoundingClientRect();
    const pageRect = pageElement.getBoundingClientRect();
    const visible = pageRect.bottom > viewerRect.top + 8 && pageRect.top < viewerRect.bottom - 8;
    if (!visible) {
      pageElement.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    }
    return visible;
  }, pageNumber, { timeout: ASSERT_TIMEOUT_MS });
}

async function assertSearchMarkerPersistence(page, target, pageNumber) {
  await waitForPdfPageVisible(page, pageNumber);
  const pagePoint = await page.evaluate((targetPageNumber) => {
    const viewer = document.querySelector('[data-testid="pdf-viewer-container-pdf-left-pane"]');
    const pageElement = document.querySelector(
      `[data-testid="pdf-left-shell"] [data-page-number="${targetPageNumber}"]`,
    );
    if (!(viewer instanceof HTMLElement) || !(pageElement instanceof HTMLElement)) {
      return null;
    }
    const viewerRect = viewer.getBoundingClientRect();
    const rect = pageElement.getBoundingClientRect();
    const visibleTop = Math.max(rect.top, viewerRect.top + 8);
    const visibleBottom = Math.min(rect.bottom, viewerRect.bottom - 8);
    if (visibleBottom <= visibleTop) {
      return null;
    }
    return {
      x: rect.left + (rect.width * 0.5),
      y: visibleTop + ((visibleBottom - visibleTop) * 0.35),
    };
  }, pageNumber);
  if (!pagePoint) {
    throw new Error(`Unable to open PDF search because page ${pageNumber} is not rendered.`);
  }
  await page.mouse.click(pagePoint.x, pagePoint.y, { button: "right" });
  const openSearchAction = page.getByTestId("pdf-context-menu-action-open-search");
  const openedFromMouse = await openSearchAction.waitFor({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!openedFromMouse) {
    // CDP right-click delivery is unreliable when the native PDF canvas owns
    // the pointer target. Dispatch the same bubbling browser event so the
    // real desktop renderer and menu handler remain covered.
    await page.getByTestId("pdf-scroll-container-pdf-left-pane").dispatchEvent("contextmenu", {
      clientX: pagePoint.x,
      clientY: pagePoint.y,
      bubbles: true,
      cancelable: true,
    });
  }
  await openSearchAction.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
  });
  const overlay = page.getByTestId("pdf-search-overlay");
  await overlay.waitFor();
  await overlay.locator("input").fill(target);

  const firstResult = overlay.locator('[data-pdf-search-result-index="0"]');
  await firstResult.waitFor();
  await firstResult.click();
  await page.waitForFunction(() => (
    Array.from(document.querySelectorAll(".pdf-search-sketched-ring--active"))
      .some((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
  ));

  const initialActiveRingCount = await page.locator(".pdf-search-sketched-ring--active").count();
  await page.waitForTimeout(2_000);
  const retainedState = await page.evaluate(() => ({
    overlayOpen: Boolean(document.querySelector('[data-testid="pdf-search-overlay"]')),
    activeRingCount: Array.from(document.querySelectorAll(".pdf-search-sketched-ring--active"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).length,
  }));
  if (!retainedState.overlayOpen || retainedState.activeRingCount < 1) {
    throw new Error(`Desktop PDF search marker disappeared while search stayed open: ${JSON.stringify({ initialActiveRingCount, retainedState })}`);
  }

  await overlay.locator('button[title*="Close"], button[title*="关闭"]').click();
  await page.waitForFunction(() => (
    !document.querySelector('[data-testid="pdf-search-overlay"]') &&
    !document.querySelector(".pdf-search-sketched-ring--active")
  ));

  return {
    target,
    initialActiveRingCount,
    retainedActiveRingCount: retainedState.activeRingCount,
  };
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
    const compact = (value) => String(value ?? "").replace(/\s+/g, "").toLowerCase();
    const shellId = targetPaneId === "pdf-left-pane" ? "pdf-left-shell" : "pdf-right-shell";
    const pageElement = document.querySelector(`[data-testid="${shellId}"] [data-page-number="${targetPageNumber}"]`);
    if (!pageElement) {
      return false;
    }
    const layerText = Array.from(pageElement.querySelectorAll(".textLayer"))
      .map((layer) => layer.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ");
    return layerText.includes(text) || compact(layerText).includes(compact(text));
  }, { targetPaneId: paneId, targetPageNumber: pageNumber, text: expectedText }, { timeout: timeoutMs });
}

async function selectPdfTextRangeWithPointer(page, paneId, pageNumber, targetText) {
  // Fixtures can rerender while the pointer moves, so use a scoped stylesheet
  // that also covers replacement hit targets instead of mutating old elements.
  const fixtureStyle = await page.addStyleTag({
    content: `[data-testid="pdf-left-shell"] [data-pdf-stored-annotation-segment],
      [data-testid="pdf-left-shell"] [data-pdf-text-annotation-content],
      [data-testid="pdf-left-shell"] [data-pdf-ink-annotation-bounds-hit-area] {
        pointer-events: none !important;
      }`,
  });

  await page.evaluate((targetPaneId) => {
    const shell = document.querySelector(`[data-testid="pdf-scroll-container-${targetPaneId}"]`);
    window.__latticePointerSmokeTrace = [];
    for (const type of ["pointerdown", "pointermove", "pointerup"]) {
      shell?.addEventListener(type, (event) => {
        if (window.__latticePointerSmokeTrace.length >= 64) {
          return;
        }
        const target = event.target instanceof Element ? event.target : null;
        window.__latticePointerSmokeTrace.push({
          type,
          isTrusted: event.isTrusted,
          target: target?.className || target?.tagName || "unknown",
          attributes: target ? Object.fromEntries(Array.from(target.attributes).filter((attribute) => attribute.name.startsWith("data-pdf") || attribute.name === "data-testid").map((attribute) => [attribute.name, attribute.value])) : {},
          x: event.clientX,
          y: event.clientY,
        });
      }, true);
    }
  }, paneId);

  await page.evaluate(() => document.fonts.ready);
  let selectionBox = null;
  let previousBox = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    selectionBox = await page.evaluate(({ targetPaneId, targetPageNumber, text }) => {
    const compactTarget = String(text ?? "").replace(/[\s\u00ad-]+/g, "").toLowerCase();
    const shellId = targetPaneId === "pdf-left-pane" ? "pdf-left-shell" : "pdf-right-shell";
    const pageElement = document.querySelector(`[data-testid="${shellId}"] [data-page-number="${targetPageNumber}"]`);
    const textLayer = pageElement?.querySelector(".textLayer");
    if (!(textLayer instanceof HTMLElement) || !compactTarget) {
      return { error: "text-layer-not-ready" };
    }

    const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let fullText = "";
    let node;
    while ((node = walker.nextNode())) {
      const value = node.textContent ?? "";
      textNodes.push({ node, start: fullText.length, end: fullText.length + value.length });
      fullText += value;
    }

    const compactOffsets = [];
    let compactText = "";
    for (let index = 0; index < fullText.length; index += 1) {
      const character = fullText[index] ?? "";
      if (/[\s\u00ad-]/.test(character)) {
        continue;
      }
      compactOffsets.push(index);
      compactText += character.toLowerCase();
    }
    const compactStart = compactText.indexOf(compactTarget);
    if (compactStart < 0) {
      return {
        error: "target-not-found",
        compactTarget,
        compactTextSample: compactText.slice(0, 1200),
      };
    }
    const start = compactOffsets[compactStart] ?? -1;
    const compactEnd = compactStart + compactTarget.length - 1;
    const end = typeof compactOffsets[compactEnd] === "number" ? compactOffsets[compactEnd] + 1 : -1;
    if (start < 0 || end <= start) {
      return { error: "invalid-compact-offsets", start, end };
    }

    const startEntry = textNodes.find((entry) => entry.start <= start && entry.end > start);
    const endEntry = textNodes.find((entry) => entry.start < end && entry.end >= end);
    if (!startEntry || !endEntry) {
      return { error: "text-node-boundary-not-found", start, end };
    }

    const range = document.createRange();
    range.setStart(startEntry.node, start - startEntry.start);
    range.setEnd(endEntry.node, end - endEntry.start);
    endEntry.node.parentElement?.scrollIntoView({ block: "center", inline: "nearest" });
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (rects.length === 0) {
      return { error: "range-has-no-rects" };
    }

    const selection = window.getSelection();
    selection?.removeAllRanges();
    // Measure the target without creating a selection. Preselecting it starts the
    // application's selection session before the real pointer gesture.
    const startOffset = start - startEntry.start;
    const endOffset = end - endEntry.start;
    const startPointRange = document.createRange();
    startPointRange.setStart(startEntry.node, startOffset);
    startPointRange.setEnd(startEntry.node, Math.min(startOffset + 1, startEntry.node.length));
    const endPointRange = document.createRange();
    endPointRange.setStart(endEntry.node, Math.max(0, endOffset - 1));
    endPointRange.setEnd(endEntry.node, endOffset);
    const first = Array.from(startPointRange.getClientRects()).find((rect) => rect.height > 0) ?? rects[0];
    const last = Array.from(endPointRange.getClientRects()).find((rect) => rect.height > 0) ?? rects[rects.length - 1];
    return {
      startX: first.left + 1,
      startY: first.top + (first.height / 2),
      endX: last.right - 1,
      endY: last.top + (last.height / 2),
      pageBounds: pageElement instanceof HTMLElement ? (() => {
        const bounds = pageElement.getBoundingClientRect();
        return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
      })() : null,
      rangeRectCount: rects.length,
      domText: range.toString(),
      targetRects: rects.map((rect) => {
        const bounds = pageElement.getBoundingClientRect();
        return {
          x1: (rect.left - bounds.left) / bounds.width,
          y1: (rect.top - bounds.top) / bounds.height,
          x2: (rect.right - bounds.left) / bounds.width,
          y2: (rect.bottom - bounds.top) / bounds.height,
        };
      }),
    };
    }, { targetPaneId: paneId, targetPageNumber: pageNumber, text: targetText });
    if (!selectionBox?.error && previousBox &&
      ["startX", "startY", "endX", "endY"].every((coordinate) => Math.abs(selectionBox[coordinate] - previousBox[coordinate]) < 0.1)) {
      break;
    }
    previousBox = selectionBox?.error ? null : selectionBox;
    await page.waitForTimeout(100);
  }

  if (!selectionBox || selectionBox.error) {
    throw new Error(`Unable to resolve desktop pointer selection coordinates: ${JSON.stringify(selectionBox)}`);
  }

  await page.mouse.move(selectionBox.startX, selectionBox.startY);
  await page.mouse.down();
  await page.mouse.move(selectionBox.endX, selectionBox.endY, { steps: 4 });
  await page.mouse.up();

  const physicalPointerHandled = await page.waitForFunction((targetPaneId) => (
    ["pdfium-native", "pdfjs-text-model"].includes(
      document.querySelector(`[data-testid="pdf-selection-source-${targetPaneId}"]`)?.textContent?.trim() ?? "",
    )
  ), paneId, { timeout: Math.min(15000, ASSERT_TIMEOUT_MS) }).then(() => true).catch(() => false);

  selectionBox.physicalPointerHandled = physicalPointerHandled;
  selectionBox.pointerTrace = await page.evaluate(() => window.__latticePointerSmokeTrace ?? []);
  await fixtureStyle.evaluate((element) => element.remove());
  return selectionBox;
}

async function waitForPointerSelection(page, paneId, targetText, minRects) {
  await page.waitForFunction(({ targetPaneId, text, requiredRects }) => {
    const compact = (value) => String(value ?? "").normalize("NFKC").replace(/[\s-]+/g, "").toLowerCase();
    const preview = document.querySelector(`[data-testid="pdf-selection-preview-${targetPaneId}"]`)?.textContent?.trim() ?? "";
    const source = document.querySelector(`[data-testid="pdf-selection-source-${targetPaneId}"]`)?.textContent?.trim() ?? "";
    const rectCount = Number(document.querySelector(`[data-testid="pdf-selection-overlay-rect-count-${targetPaneId}"]`)?.textContent ?? "0");
    return ["pdfium-native", "pdfjs-text-model"].includes(source) && compact(preview).includes(compact(text)) && rectCount >= requiredRects;
  }, { targetPaneId: paneId, text: targetText, requiredRects: minRects }, {
    timeout: Math.min(15000, ASSERT_TIMEOUT_MS),
  }).catch(() => {});

  return page.evaluate((targetPaneId) => ({
    text: document.querySelector(`[data-testid="pdf-selection-preview-${targetPaneId}"]`)?.textContent?.trim() ?? "",
    source: document.querySelector(`[data-testid="pdf-selection-source-${targetPaneId}"]`)?.textContent?.trim() ?? "",
    rectCount: Number(document.querySelector(`[data-testid="pdf-selection-overlay-rect-count-${targetPaneId}"]`)?.textContent ?? "0"),
    copyPayload: document.querySelector(`[data-testid="pdf-copy-payload-${targetPaneId}"]`)?.textContent?.trim() ?? "",
    nativeText: window.getSelection()?.toString() ?? "",
  }), paneId);
}

async function assertPointerCopyAndPersistence(page, selectionBox, selectionResult) {
  await page.evaluate(() => {
    window.__latticePointerCopyEvent = null;
    window.__latticePointerCopyKey = null;
    const observeKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        window.__latticePointerCopyKey = { isTrusted: event.isTrusted };
        window.removeEventListener("keydown", observeKey, true);
      }
    };
    window.addEventListener("keydown", observeKey, true);
    const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async (text) => {
      await originalWriteText(text);
      window.__latticePointerCopyEvent = { text, ...window.__latticePointerCopyKey };
      navigator.clipboard.writeText = originalWriteText;
    };
  });
  await page.keyboard.press("Control+c");
  await page.waitForFunction(() => window.__latticePointerCopyEvent !== null, undefined, { timeout: 10000 });
  const copyEvent = await page.evaluate(() => window.__latticePointerCopyEvent);
  if (!copyEvent.isTrusted || copyEvent.text !== selectionResult.text) {
    throw new Error(`Real desktop PDF copy event diverged from the visible selection: ${JSON.stringify({ copyEvent, selectionResult })}`);
  }

  const readStoredAnnotations = async () => page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const workspace = await root.getDirectoryHandle("lattice-browser-regression");
    const lattice = await workspace.getDirectoryHandle(".lattice");
    const directory = await lattice.getDirectoryHandle("annotations");
    const annotations = [];
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".json")) continue;
      const file = JSON.parse(await (await handle.getFile()).text());
      annotations.push(...(file.annotations ?? []));
    }
    return annotations;
  });
  const previousIds = new Set((await readStoredAnnotations()).map((annotation) => annotation.id));
  // Diagnostic viewers use a five-minute save debounce to isolate fixture
  // interactions. Advance that timer after the real menu click.
  await page.clock.install();
  const previousCount = await page.getByTestId("pdf-diagnostic-selection-annotation-count-pdf-left-pane").textContent();
  await page.locator(".pdf-selection-color-picker button").first().click();
  await page.waitForFunction((before) => Number(document.querySelector('[data-testid="pdf-diagnostic-selection-annotation-count-pdf-left-pane"]')?.textContent ?? 0) > Number(before), previousCount);
  await page.clock.fastForward(300100);
  const deadline = Date.now() + Math.min(15000, ASSERT_TIMEOUT_MS);
  let stored = null;
  while (Date.now() < deadline && !stored) {
    stored = (await readStoredAnnotations()).find((annotation) => !previousIds.has(annotation.id)) ?? null;
    if (!stored) await page.waitForTimeout(100);
  }
  if (!stored || stored.target?.type !== "pdf" || stored.target.page !== REAL_PDF_PAGE) {
    throw new Error(`Real desktop PDF pointer annotation was not persisted on the selected page: ${JSON.stringify(stored)}`);
  }
  if (stored.target.textQuote?.exact !== selectionResult.text || stored.content !== selectionResult.text) {
    throw new Error(`Real desktop PDF persisted annotation text diverged: ${JSON.stringify({ stored, selectionResult })}`);
  }
  const targetRects = selectionBox.targetRects;
  const bounds = {
    x1: Math.min(...targetRects.map((rect) => rect.x1)),
    y1: Math.min(...targetRects.map((rect) => rect.y1)),
    x2: Math.max(...targetRects.map((rect) => rect.x2)),
    y2: Math.max(...targetRects.map((rect) => rect.y2)),
  };
  const rects = stored.target.rects ?? [];
  const tolerance = 0.015;
  if (rects.length < POINTER_MIN_RECTS || rects.length > selectionBox.rangeRectCount + 2 || rects.some((rect) => (
    ![rect.x1, rect.y1, rect.x2, rect.y2].every(Number.isFinite) ||
    rect.x2 <= rect.x1 || rect.y2 <= rect.y1 ||
    rect.x1 < bounds.x1 - tolerance || rect.x2 > bounds.x2 + tolerance ||
    rect.y1 < bounds.y1 - tolerance || rect.y2 > bounds.y2 + tolerance
  ))) {
    throw new Error(`Real desktop PDF persisted pointer annotation expanded outside the target: ${JSON.stringify({ stored, bounds })}`);
  }
  // The diagnostics route reseeds its annotations on every mount. Leave that
  // route and reopen the OPFS sidecar independently to verify disk persistence.
  await page.goto(new URL("/", page.url()).href, { waitUntil: "domcontentloaded" });
  const restored = (await readStoredAnnotations()).find((annotation) => annotation.id === stored.id);
  if (JSON.stringify(restored) !== JSON.stringify(stored)) {
    throw new Error(`Real desktop PDF annotation changed after leaving the viewer: ${JSON.stringify({ stored, restored })}`);
  }
  return { copyEvent, annotation: stored, targetBounds: bounds, survivesViewerUnmount: true };
}

async function closeStoredMenu(page, annotationId) {
  await clickPdfPageRatio(page, "pdf-left-pane", REAL_PDF_PAGE, 0.03, 0.08);
  await page.locator(`[data-pdf-annotation-menu="${annotationId}"]`).waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}

async function selectPdfAnnotationTool(page) {
  const activated = await page.evaluate(() => (
    window.__latticePdfDiagnostics?.["pdf-left-pane"]?.activateSelectTool?.() === true
  ));
  if (!activated) {
    throw new Error("PDF diagnostics could not activate the select annotation tool.");
  }
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

async function assertStoredAreaAdjustment(page, annotationId) {
  await waitForAnnotationOverlay(page, annotationId);
  if (!await clickAnnotationCenter(page, annotationId)) {
    throw new Error(`Unable to select stored area annotation ${annotationId}.`);
  }

  const readState = () => page.evaluate((id) => {
    const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(id)
      : id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    const segment = document.querySelector(`.pdf-stored-annotation-overlay-${escapedId} [data-pdf-stored-annotation-segment="true"]`);
    if (!(segment instanceof HTMLElement)) {
      return null;
    }
    return {
      left: Number.parseFloat(segment.style.left),
      top: Number.parseFloat(segment.style.top),
      width: Number.parseFloat(segment.style.width),
      height: Number.parseFloat(segment.style.height),
      annotationCount: Number(document.querySelector('[data-testid="pdf-diagnostic-selection-annotation-count-pdf-left-pane"]')?.textContent ?? "0"),
    };
  }, annotationId);

  const before = await readState();
  if (!before || ![before.left, before.top, before.width, before.height].every(Number.isFinite)) {
    throw new Error(`Stored area ${annotationId} has no measurable geometry: ${JSON.stringify(before)}`);
  }

  await page.keyboard.press("a");
  const resizeHandle = page.locator(`[data-pdf-stored-annotation-id="${annotationId}"][data-pdf-annotation-area-handle="se"]`);
  await resizeHandle.waitFor({ state: "visible", timeout: ASSERT_TIMEOUT_MS });
  const resizeBox = await resizeHandle.boundingBox();
  if (!resizeBox) {
    throw new Error(`Stored area ${annotationId} resize handle has no bounding box.`);
  }
  await page.mouse.move(resizeBox.x + (resizeBox.width / 2), resizeBox.y + (resizeBox.height / 2));
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + (resizeBox.width / 2) + 42, resizeBox.y + (resizeBox.height / 2) + 34, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(({ id, previousWidth, previousHeight }) => {
    const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(id)
      : id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    const segment = document.querySelector(`.pdf-stored-annotation-overlay-${escapedId} [data-pdf-stored-annotation-segment="true"]`);
    return segment instanceof HTMLElement &&
      Number.parseFloat(segment.style.width) > previousWidth + 0.5 &&
      Number.parseFloat(segment.style.height) > previousHeight + 0.5;
  }, { id: annotationId, previousWidth: before.width, previousHeight: before.height });

  const resized = await readState();
  if (!resized || resized.annotationCount !== before.annotationCount) {
    throw new Error(`Resizing ${annotationId} created another area: ${JSON.stringify({ before, resized })}`);
  }

  const moveHandle = page.locator(`[data-pdf-stored-annotation-id="${annotationId}"][data-pdf-annotation-area-handle="move"]`).last();
  await moveHandle.waitFor({ state: "visible", timeout: ASSERT_TIMEOUT_MS });
  const moveBox = await moveHandle.boundingBox();
  if (!moveBox) {
    throw new Error(`Stored area ${annotationId} move handle has no bounding box.`);
  }
  await page.mouse.move(moveBox.x + (moveBox.width / 2), moveBox.y + (moveBox.height / 2));
  await page.mouse.down();
  await page.mouse.move(moveBox.x + (moveBox.width / 2) + 36, moveBox.y + (moveBox.height / 2) + 26, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(({ id, previousLeft, previousTop }) => {
    const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(id)
      : id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    const segment = document.querySelector(`.pdf-stored-annotation-overlay-${escapedId} [data-pdf-stored-annotation-segment="true"]`);
    return segment instanceof HTMLElement &&
      Number.parseFloat(segment.style.left) > previousLeft + 0.5 &&
      Number.parseFloat(segment.style.top) > previousTop + 0.5;
  }, { id: annotationId, previousLeft: resized.left, previousTop: resized.top });

  const moved = await readState();
  if (!moved || moved.annotationCount !== before.annotationCount) {
    throw new Error(`Moving ${annotationId} created another area: ${JSON.stringify({ before, resized, moved })}`);
  }
  if (Math.abs(moved.width - resized.width) > 0.05 || Math.abs(moved.height - resized.height) > 0.05) {
    throw new Error(`Moving ${annotationId} changed its size: ${JSON.stringify({ resized, moved })}`);
  }

  return { before, resized, moved };
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
  let searchPersistence = null;
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
    if (process.env.LATTICE_DESKTOP_SMOKE_MINIMIZE === "1") {
      await page.setViewportSize({ width: 1600, height: 1000 });
      const desktopCdp = await page.context().newCDPSession(page);
      await desktopCdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
      await page.evaluate(async () => {
        const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
        await invoke("desktop_window_minimize");
      });
    }

    if (!OCR_ONLY && !POINTER_ONLY && !AREA_ADJUST_ONLY) {
      // PDF tools are scoped to the active pane. Make the diagnostic interaction
      // explicit before dispatching the right-click used to open search.
      await page.getByTestId("activate-left-pane").click();
      await page.waitForFunction(() => (
        typeof window.__latticePdfDiagnostics?.["pdf-left-pane"]?.scrollToPage === "function"
      ));
      await scrollPdfPaneToPage(page, "pdf-left-pane", REAL_PDF_PAGE);
      await waitForPdfPageText(page, "pdf-left-pane", REAL_PDF_PAGE, REAL_PDF_SELECTION_TARGET, ASSERT_TIMEOUT_MS);
      searchPersistence = await assertSearchMarkerPersistence(page, REAL_PDF_SELECTION_TARGET, REAL_PDF_PAGE);
    }

    if (OCR_ONLY) {
      if (OCR_POINTER) {
        await page.waitForFunction(() => (
          typeof window.__latticePdfDiagnostics?.["pdf-left-pane"]?.scrollToPage === "function"
        ));
        await scrollPdfPaneToPage(page, "pdf-left-pane", REAL_PDF_PAGE);
        await page.waitForFunction((targetPageNumber) => {
          const viewer = document.querySelector('[data-testid="pdf-viewer-container-pdf-left-pane"]');
          const pageElement = viewer?.querySelector(`[data-page-number="${targetPageNumber}"]`);
          return pageElement instanceof HTMLElement && Boolean(pageElement.querySelector("canvas"));
        }, REAL_PDF_PAGE);
      }
      const ocrLayout = await page.evaluate(async ({ path, pageNumber, language, useDiagnosticCache }) => {
        if (useDiagnosticCache) {
          const getOcrLayout = window.__latticePdfDiagnostics?.["pdf-left-pane"]?.getOcrLayout;
          if (typeof getOcrLayout !== "function") {
            throw new Error("PDF diagnostics OCR bridge is unavailable.");
          }
          return getOcrLayout(pageNumber);
        }
        const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
        if (typeof invoke !== "function") {
          throw new Error("Tauri invoke bridge is unavailable.");
        }
        return invoke("desktop_ocr_pdf_page_text_layout", {
          path,
          pageNumber,
          options: { dpi: 220, language, psm: 6 },
        });
      }, {
        path: realPdfPath,
        pageNumber: REAL_PDF_PAGE,
        language: OCR_LANGUAGE,
        useDiagnosticCache: OCR_POINTER,
      });

      if (ocrLayout?.source !== "ocr" || !ocrLayout.text?.trim() || !Array.isArray(ocrLayout.words) || ocrLayout.words.length < 1) {
        throw new Error(`Desktop PDF OCR returned no usable text layout: ${JSON.stringify(ocrLayout)}`);
      }
      if (!(ocrLayout.width > 0) || !(ocrLayout.height > 0)) {
        throw new Error(`Desktop PDF OCR returned invalid page dimensions: ${JSON.stringify(ocrLayout)}`);
      }

      const invalidWords = ocrLayout.words.filter((word) => (
        !word.text?.trim() ||
        !Number.isFinite(word.left) ||
        !Number.isFinite(word.top) ||
        !Number.isFinite(word.width) ||
        !Number.isFinite(word.height) ||
        word.left < 0 ||
        word.top < 0 ||
        word.width <= 0 ||
        word.height <= 0 ||
        word.left + word.width > ocrLayout.width + 1 ||
        word.top + word.height > ocrLayout.height + 1
      ));
      if (invalidWords.length > 0) {
        throw new Error(`Desktop PDF OCR returned invalid word geometry: ${JSON.stringify(invalidWords.slice(0, 10))}`);
      }

      const compactText = ocrLayout.text.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
      const compactTarget = OCR_TARGET.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
      if (compactTarget && !compactText.includes(compactTarget)) {
        throw new Error(`Desktop PDF OCR did not include target text "${OCR_TARGET}".`);
      }

      const result = {
        source: ocrLayout.source,
        pageNumber: ocrLayout.pageNumber,
        width: ocrLayout.width,
        height: ocrLayout.height,
        textLength: ocrLayout.text.length,
        wordCount: ocrLayout.words.length,
        confidence: ocrLayout.confidence,
        sample: ocrLayout.text.slice(0, 500),
      };

      if (OCR_POINTER) {
        const wordsByLine = new Map();
        for (const word of ocrLayout.words) {
          const lineIndex = Number.isInteger(word.lineIndex) ? word.lineIndex : -1;
          const words = wordsByLine.get(lineIndex) ?? [];
          words.push(word);
          wordsByLine.set(lineIndex, words);
        }
        const selectedWords = Array.from(wordsByLine.values())
          .map((words) => words.slice().sort((left, right) => left.left - right.left))
          .filter((words) => words.length >= 2)
          .sort((left, right) => {
            const leftLength = left.reduce((sum, word) => sum + word.text.length, 0);
            const rightLength = right.reduce((sum, word) => sum + word.text.length, 0);
            return rightLength - leftLength;
          })[0]?.slice(0, 5);
        if (!selectedWords || selectedWords.length < 2) {
          throw new Error("Desktop PDF OCR did not return a selectable multi-word line.");
        }

        const expectedSelection = selectedWords.map((word) => word.text).join(" ");
        const pointerBox = await page.evaluate(async ({ targetPageNumber, layout, words }) => {
          const eventShell = document.querySelector('[data-testid="pdf-scroll-container-pdf-left-pane"]');
          const scrollRoot = document.querySelector('[data-testid="pdf-viewer-container-pdf-left-pane"]');
          if (!(eventShell instanceof HTMLElement) || !(scrollRoot instanceof HTMLElement)) {
            return null;
          }
          const pageElement = scrollRoot.querySelector(`[data-page-number="${targetPageNumber}"]`);
          if (!(pageElement instanceof HTMLElement)) {
            return null;
          }
          const first = words[0];
          const last = words[words.length - 1];
          const shellBounds = scrollRoot.getBoundingClientRect();
          const modelCenterY = ((first.top + (first.height / 2)) + (last.top + (last.height / 2))) / 2;
          const desiredClientY = shellBounds.top + Math.min(shellBounds.height * 0.45, Math.max(120, shellBounds.height - 120));
          scrollRoot.style.scrollBehavior = "auto";
          pageElement.scrollIntoView({ block: "start", inline: "nearest" });
          await new Promise((resolve) => setTimeout(resolve, 50));
          for (let attempt = 0; attempt < 12; attempt += 1) {
            const livePageBounds = pageElement.getBoundingClientRect();
            const currentClientY = livePageBounds.top + ((modelCenterY / layout.height) * livePageBounds.height);
            if (currentClientY >= shellBounds.top + 24 && currentClientY <= shellBounds.bottom - 24) {
              break;
            }
            scrollRoot.scrollTo({
              top: scrollRoot.scrollTop + currentClientY - desiredClientY,
              behavior: "instant",
            });
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          const pageBounds = pageElement.getBoundingClientRect();
          const startX = pageBounds.left + (((first.left + 1) / layout.width) * pageBounds.width);
          const startY = pageBounds.top + (((first.top + (first.height / 2)) / layout.height) * pageBounds.height);
          const endX = pageBounds.left + (((last.left + last.width - 1) / layout.width) * pageBounds.width);
          const endY = pageBounds.top + (((last.top + (last.height / 2)) / layout.height) * pageBounds.height);
          const dispatch = (target, type, x, y, buttons) => {
            target.dispatchEvent(new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: 73,
              pointerType: "mouse",
              isPrimary: true,
              button: 0,
              buttons,
              clientX: x,
              clientY: y,
            }));
          };
          window.getSelection()?.removeAllRanges();
          const startTarget = document.elementFromPoint(startX, startY) ?? pageElement;
          const endTarget = document.elementFromPoint(endX, endY) ?? pageElement;
          dispatch(startTarget, "pointerdown", startX, startY, 1);
          dispatch(endTarget, "pointermove", endX, endY, 1);
          dispatch(endTarget, "pointerup", endX, endY, 0);
          return {
            startX,
            startY,
            endX,
            endY,
            pageBounds: {
              left: pageBounds.left,
              top: pageBounds.top,
              width: pageBounds.width,
              height: pageBounds.height,
            },
            shellBounds: {
              left: shellBounds.left,
              top: shellBounds.top,
              right: shellBounds.right,
              bottom: shellBounds.bottom,
            },
            shellScrollTop: scrollRoot.scrollTop,
            shellScrollHeight: scrollRoot.scrollHeight,
            shellClientHeight: scrollRoot.clientHeight,
          };
        }, { targetPageNumber: REAL_PDF_PAGE, layout: ocrLayout, words: selectedWords });
        if (!pointerBox) {
          throw new Error("Desktop PDF OCR pointer coordinates could not be dispatched.");
        }

        const ocrSelectionReady = await page.waitForFunction(() => {
          const source = document.querySelector('[data-testid="pdf-selection-source-pdf-left-pane"]')?.textContent?.trim() ?? "";
          const preview = document.querySelector('[data-testid="pdf-selection-preview-pdf-left-pane"]')?.textContent?.trim() ?? "";
          const rectCount = Number(document.querySelector('[data-testid="pdf-selection-overlay-rect-count-pdf-left-pane"]')?.textContent ?? "0");
          return source === "ocr-text-model" && preview.length > 0 && rectCount > 0;
        }, undefined, { timeout: 30000 }).then(() => true).catch(() => false);
        if (!ocrSelectionReady) {
          const selectionDiagnostics = await page.evaluate(({ box }) => {
            const describePoint = (x, y) => {
              const element = document.elementFromPoint(x, y);
              return element instanceof Element ? {
                tagName: element.tagName,
                className: String(element.className ?? ""),
                testId: element.getAttribute("data-testid"),
                pageNumber: element.closest("[data-page-number]")?.getAttribute("data-page-number") ?? null,
              } : null;
            };
            const pageElement = document.elementFromPoint(box.startX, box.startY)?.closest("[data-page-number]");
            const textLayer = pageElement?.querySelector(".textLayer");
            return {
              phase: document.querySelector('[data-testid="pdf-selection-phase-pdf-left-pane"]')?.textContent?.trim() ?? "",
              source: document.querySelector('[data-testid="pdf-selection-source-pdf-left-pane"]')?.textContent?.trim() ?? "",
              preview: document.querySelector('[data-testid="pdf-selection-preview-pdf-left-pane"]')?.textContent?.trim() ?? "",
              rectCount: Number(document.querySelector('[data-testid="pdf-selection-overlay-rect-count-pdf-left-pane"]')?.textContent ?? "0"),
              startElement: describePoint(box.startX, box.startY),
              endElement: describePoint(box.endX, box.endY),
              pageTextLayerSource: pageElement instanceof HTMLElement ? pageElement.dataset.pdfTextLayerSource ?? null : null,
              textLayerSource: textLayer instanceof HTMLElement ? textLayer.dataset.pdfTextLayerSource ?? null : null,
              textLayerLength: textLayer?.textContent?.trim().length ?? 0,
            };
          }, { box: pointerBox });
          throw new Error(`Desktop PDF OCR pointer selection did not resolve: ${JSON.stringify({ pointerBox, expectedSelection, selectionDiagnostics })}`);
        }
        const selectionResult = await page.evaluate(() => ({
          text: document.querySelector('[data-testid="pdf-selection-preview-pdf-left-pane"]')?.textContent?.trim() ?? "",
          source: document.querySelector('[data-testid="pdf-selection-source-pdf-left-pane"]')?.textContent?.trim() ?? "",
          rectCount: Number(document.querySelector('[data-testid="pdf-selection-overlay-rect-count-pdf-left-pane"]')?.textContent ?? "0"),
          annotationCount: Number(document.querySelector('[data-testid="pdf-diagnostic-selection-annotation-count-pdf-left-pane"]')?.textContent ?? "0"),
        }));
        if (OCR_POINTER_EXACT) {
          const compact = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
          if (compact(selectionResult.text) !== compact(expectedSelection)) {
            throw new Error(`Desktop PDF OCR pointer text drifted: ${JSON.stringify({ expectedSelection, selectionResult })}`);
          }
        }
        await page.locator(".pdf-selection-color-picker button").first().click();
        await page.waitForFunction((previousCount) => (
          Number(document.querySelector('[data-testid="pdf-diagnostic-selection-annotation-count-pdf-left-pane"]')?.textContent ?? "0") > previousCount
        ), selectionResult.annotationCount);
        const annotationCountAfter = await page.evaluate(() => (
          Number(document.querySelector('[data-testid="pdf-diagnostic-selection-annotation-count-pdf-left-pane"]')?.textContent ?? "0")
        ));
        result.pointer = {
          expectedSelection,
          pointerBox,
          selectionResult,
          annotationCountAfter,
        };
      }

      await writeFile(path.join(OUTPUT_DIR, "desktop-pdf-ocr-smoke.json"), `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        exePath,
        realPdfPath,
        cdpPort,
        result,
      }, null, 2)}\n`, "utf8");
      console.log(`[desktop-smoke] OCR passed ${JSON.stringify(result)}`);
      return;
    }

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

    if (POINTER_TARGET.trim()) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      const pointerSelectionBox = await selectPdfTextRangeWithPointer(
        page,
        "pdf-left-pane",
        REAL_PDF_PAGE,
        POINTER_TARGET,
      );
      if (!pointerSelectionBox) {
        throw new Error(`Unable to create real desktop PDF pointer selection for "${POINTER_TARGET}".`);
      }
      const pointerSelectionResult = await waitForPointerSelection(
        page,
        "pdf-left-pane",
        POINTER_TARGET,
        POINTER_MIN_RECTS,
      );
      pointerSelectionBox.nativeEndpointProbe = await page.evaluate(async ({ path, pageNumber, box }) => {
        const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
        if (typeof invoke !== "function" || !box.pageBounds) {
          return null;
        }
        const layout = await invoke("desktop_extract_pdf_page_text_layout", { path, pageNumber });
        const nativeX = ((box.endX - box.pageBounds.left) / box.pageBounds.width) * layout.width;
        const nativeY = ((box.endY - box.pageBounds.top) / box.pageBounds.height) * layout.height;
        const closest = layout.chars
          .map((character) => ({
            text: character.text,
            charIndex: character.charIndex,
            x1: character.x1,
            y1: character.y1,
            x2: character.x2,
            y2: character.y2,
            distance: Math.hypot(
              ((character.x1 + character.x2) / 2) - nativeX,
              ((character.y1 + character.y2) / 2) - nativeY,
            ),
          }))
          .sort((left, right) => left.distance - right.distance)
          .slice(0, 12);
        return { nativeX, nativeY, source: layout.source, charCount: layout.chars.length, layoutWidth: layout.width, layoutHeight: layout.height, closest };
      }, { path: realPdfPath, pageNumber: REAL_PDF_PAGE, box: pointerSelectionBox }).catch((error) => ({ error: String(error) }));
      // The reconciler deliberately prefers DOM geometry when it matches the
      // rendered range more closely. Check native availability separately from
      // the winning selection source, then enforce text/copy/persisted geometry.
      if (!pointerSelectionBox.physicalPointerHandled ||
        !["pdfium-native", "pdfjs-text-model"].includes(pointerSelectionResult.source) ||
        pointerSelectionBox.nativeEndpointProbe?.source !== "pdfium" ||
        !(pointerSelectionBox.nativeEndpointProbe?.charCount > 0) ||
        !["pointerdown", "pointerup"].every((type) => pointerSelectionBox.pointerTrace.some((event) => event.type === type && event.isTrusted))) {
        throw new Error(`Real desktop PDF pointer/native text validation failed: ${JSON.stringify({ pointerSelectionResult, pointerSelectionBox })}`);
      }
      const compactPointerText = pointerSelectionResult.text.normalize("NFKC").replace(/[\s-]+/g, "").toLowerCase();
      const compactPointerTarget = POINTER_TARGET.normalize("NFKC").replace(/[\s-]+/g, "").toLowerCase();
      const maximumPointerLength = compactPointerTarget.length + Math.max(24, Math.ceil(compactPointerTarget.length * 0.15));
      const maximumPointerRects = Math.max(POINTER_MIN_RECTS, pointerSelectionBox.rangeRectCount + 2);
      if (!compactPointerText.startsWith(compactPointerTarget) || compactPointerText.length > maximumPointerLength) {
        throw new Error(`Real desktop PDF pointer selection expanded beyond its target: ${JSON.stringify({ pointerSelectionBox, pointerSelectionResult })}`);
      }
      if (pointerSelectionResult.rectCount < POINTER_MIN_RECTS || pointerSelectionResult.rectCount > maximumPointerRects) {
        throw new Error(`Real desktop PDF pointer selection geometry was imprecise: ${JSON.stringify({ pointerSelectionBox, pointerSelectionResult })}`);
      }
      const compactCopyPayload = pointerSelectionResult.copyPayload.normalize("NFKC").replace(/[\s-]+/g, "").toLowerCase();
      if (compactCopyPayload !== compactPointerText) {
        throw new Error(`Real desktop PDF copy payload diverged from the visible selection: ${JSON.stringify(pointerSelectionResult)}`);
      }

      if (POINTER_ONLY) {
        const persistence = await assertPointerCopyAndPersistence(page, pointerSelectionBox, pointerSelectionResult);
        await writeFile(path.join(OUTPUT_DIR, "desktop-pdf-pointer-smoke.json"), `${JSON.stringify({
          generatedAt: new Date().toISOString(),
          exePath,
          realPdfPath,
          cdpPort,
          pointerSelectionBox,
          pointerSelectionResult,
          persistence,
        }, null, 2)}\n`, "utf8");
        console.log(`[desktop-smoke] pointer passed ${JSON.stringify(pointerSelectionResult)}`);
        return;
      }
    }

    await assertStoredMenu(page, "ann-real-highlight", 0.26, 0.304, REAL_PDF_SELECTION_FULL);
    await assertStoredMenu(page, "ann-real-underline", 0.18, 0.335, "Stark shifts below 1 MHz");
    await assertStoredMenu(page, "ann-real-area", 0.66, 0.23, "Diagnostic area");
    const areaAdjustment = await assertStoredAreaAdjustment(page, "ann-real-area");
    if (AREA_ADJUST_ONLY) {
      await writeFile(path.join(OUTPUT_DIR, "desktop-pdf-area-adjust-smoke.json"), `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        exePath,
        realPdfPath,
        cdpPort,
        areaAdjustment,
      }, null, 2)}\n`, "utf8");
      console.log(`[desktop-smoke] area adjustment passed ${JSON.stringify(areaAdjustment)}`);
      return;
    }
    await selectPdfAnnotationTool(page);
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
      searchPersistence,
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
