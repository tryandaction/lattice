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
const DEFAULT_WORKSPACE = "C:/universe/MyStudy/atom";
const DEFAULT_REAL_PDF =
  "C:/universe/MyStudy/atom/Categorized Papers/Reviews_Classics/Saffman 等 - 2010 - Quantum information with Rydberg atoms.pdf";
const DEFAULT_REAL_PDF_UNICODE =
  "C:/universe/MyStudy/atom/Categorized Papers/Reviews_Classics/Saffman \u7b49 - 2010 - Quantum information with Rydberg atoms.pdf";
const REAL_PDF_PAGE = Number(process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_REAL_PDF_PAGE ?? 7);
const LEFT_TARGET = process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_LEFT_TARGET ?? "Fig. 5, that tend";
const RIGHT_TARGET = process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_RIGHT_TARGET ?? "Rydberg atoms A and B";
const RIGHT_FALLBACK_TARGET = "dipole-dipole interaction";
const EXACT_TARGET = process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_EXACT_TARGET ?? "";
const EXACT_STYLE_TYPE = process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_EXACT_STYLE_TYPE ?? "highlight";
const EXACT_COLOR = process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_EXACT_COLOR ?? "#ffd400";
const POINTER_TARGET = process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_POINTER_TARGET ?? "";
const POINTER_ONLY = process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_POINTER_ONLY === "1";
const POINTER_NATIVE_DRAG = process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_POINTER_NATIVE_DRAG === "1";
const POINTER_SAVE_ONLY = process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_POINTER_SAVE_ONLY === "1";
const POINTER_SAVE_STYLE_TYPE = process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_POINTER_SAVE_STYLE_TYPE === "underline"
  ? "underline"
  : "highlight";
const POINTER_EXPECTED_SEGMENTS = Number(process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_POINTER_EXPECTED_SEGMENTS ?? 0);
const SIDECAR_ONLY = process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_SIDECAR_ONLY === "1";
const SIDECAR_PATH = process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_SIDECAR_PATH ?? "";
const ASSERT_TIMEOUT_MS = Number(process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_TIMEOUT_MS ?? 120000);

function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function createCssString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"");
}

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

function relativeWorkspacePath(workspacePath, filePath) {
  const root = normalizePath(workspacePath);
  const file = normalizePath(filePath);
  const rootName = root.split("/").filter(Boolean).at(-1);
  if (!rootName) {
    throw new Error(`Unable to derive workspace root name from ${workspacePath}`);
  }
  if (!file.startsWith(`${root}/`)) {
    throw new Error(`PDF path is not under workspace root: ${filePath}`);
  }
  return `${rootName}/${file.slice(root.length + 1)}`;
}

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
  if (process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_KEEP_EXISTING === "1") {
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
      if (code !== 0) {
        console.warn(`[desktop-product-smoke] close existing Lattice processes returned ${code}: ${stderr.trim()}`);
      }
      resolve();
    });
  });
}

async function waitForDesktopPage(browser, timeoutMs) {
  const startedAt = Date.now();
  let fallbackPage = null;
  while (Date.now() - startedAt < timeoutMs) {
    for (const context of browser.contexts()) {
      const pages = context.pages().filter((candidate) => {
        const url = candidate.url();
        return url && url !== "about:blank" && !url.startsWith("devtools://");
      });
      const tauriPage = pages.find((candidate) => candidate.url().startsWith("http://tauri.localhost"));
      if (tauriPage) {
        await tauriPage.waitForLoadState("domcontentloaded").catch(() => {});
        return tauriPage;
      }
      fallbackPage ??= pages[0] ?? null;
      if (fallbackPage && Date.now() - startedAt > Math.min(10000, timeoutMs / 3)) {
        await fallbackPage.waitForLoadState("domcontentloaded").catch(() => {});
        return fallbackPage;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the Lattice desktop WebView page.");
}

async function ensureProductWorkspace(page, workspacePath, pdfRelativePath) {
  const hasTauriBridge = await page.waitForFunction(() => (
    typeof window.__TAURI__?.core?.invoke === "function" ||
    typeof window.__TAURI_INTERNALS__?.invoke === "function"
  ), null, {
    timeout: Math.min(30000, ASSERT_TIMEOUT_MS),
  }).then(() => true).catch(() => false);

  if (!hasTauriBridge) {
    console.warn("[desktop-product-smoke] Tauri invoke bridge unavailable; continuing with restored product session.");
    if (!page.url().startsWith("http://tauri.localhost")) {
      await page.goto("http://tauri.localhost/", { waitUntil: "domcontentloaded" }).catch(() => {});
    }
    return false;
  }

  await page.getByTestId("desktop-commandbar-workspace").waitFor();
  await page.waitForTimeout(1000);
  await page.evaluate(async ({ rootPath, relativePdfPath }) => {
    const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") {
      throw new Error("Tauri invoke bridge unavailable.");
    }

    const settings = await invoke("get_setting", { key: "lattice-settings" }) ?? {};
    await invoke("set_last_workspace_path", { path: rootPath });
    const workspaceKey = `desktop:${rootPath}`;
    const nextSettings = {
      ...settings,
      onboardingCompleted: true,
      lastWorkspacePath: rootPath,
      lastOpenedFolder: rootPath,
      lastWorkspaceKey: workspaceKey,
      recentWorkspacePaths: [
        rootPath,
        ...((settings.recentWorkspacePaths ?? []).filter((item) => item !== rootPath)),
      ].slice(0, 12),
      recentWorkspaceKeys: [
        workspaceKey,
        ...((settings.recentWorkspaceKeys ?? []).filter((item) => item !== workspaceKey)),
      ].slice(0, 12),
      workspaceDisplayPaths: {
        ...(settings.workspaceDisplayPaths ?? {}),
        [workspaceKey]: rootPath,
      },
      activityView: "files",
      sidePanelCollapsed: false,
    };

    const sessionKey = `lattice-workbench-session:${workspaceKey}`;
    const session = {
      version: 1,
      activePaneId: "pane-initial",
      sidebarCollapsed: false,
      root: {
        type: "pane",
        id: "pane-initial",
        tabs: [
          {
            kind: "file",
            filePath: relativePdfPath,
            fileName: relativePdfPath.split("/").pop() ?? relativePdfPath,
          },
        ],
        activeTabIndex: 0,
      },
    };

    await invoke("set_setting", { key: "lattice-settings", value: nextSettings });
    await invoke("set_setting", { key: sessionKey, value: session });
    window.localStorage?.removeItem("lattice-desktop-window-sessions");
    window.sessionStorage?.removeItem("lattice-desktop-window-session-id");
  }, { rootPath: normalizePath(workspacePath), relativePdfPath: pdfRelativePath });

  await page.goto("http://tauri.localhost/", { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  return true;
}

async function waitForProductPdf(page, expectedFileName) {
  await page.waitForFunction((name) => {
    const bodyText = document.body?.innerText ?? "";
    const hasProductChrome = bodyText.includes("Lattice") && !bodyText.includes("PDF Split Regression");
    const hasPdfPane = Boolean(document.querySelector("[data-testid^='pdf-pane-']"));
    const hasExpectedFile = bodyText.includes(name) || bodyText.toLowerCase().includes(".pdf");
    return hasProductChrome && hasPdfPane && hasExpectedFile;
  }, expectedFileName, { timeout: ASSERT_TIMEOUT_MS });

  await page.waitForFunction(() => {
    const pane = document.querySelector("[data-testid^='pdf-pane-']");
    return Boolean(
      pane?.querySelector("canvas") &&
      pane?.querySelector(".textLayer[data-pdf-text-layer-ready='true']"),
    );
  }, null, { timeout: ASSERT_TIMEOUT_MS });
}

async function scrollProductPdfToPage(page, pageNumber) {
  await page.evaluate(async (targetPageNumber) => {
    const findVisiblePdfPageElement = (pageNo) => {
      const pages = Array.from(document.querySelectorAll(`[data-testid^='pdf-pane-'] [data-page-number="${pageNo}"]`))
        .filter((pageElement) => pageElement instanceof HTMLElement)
        .map((pageElement) => {
          const rect = pageElement.getBoundingClientRect();
          const ready = pageElement.querySelector(".textLayer")?.getAttribute("data-pdf-text-layer-ready") === "true";
          const visible = rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth;
          return { pageElement, ready, visible, area: Math.max(0, rect.width) * Math.max(0, rect.height) };
        })
        .filter((candidate) => candidate.ready && candidate.visible)
        .sort((left, right) => right.area - left.area);
      return pages[0]?.pageElement ?? null;
    };
    const target = findVisiblePdfPageElement(targetPageNumber) ??
      document.querySelector(`[data-testid^='pdf-pane-'] [data-page-number="${targetPageNumber}"]`);
    if (!(target instanceof HTMLElement)) {
      throw new Error(`PDF page ${targetPageNumber} not found.`);
    }
    target.scrollIntoView({ block: "center" });
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }, pageNumber);
}

async function waitForPageText(page, pageNumber, expectedText) {
  await page.waitForFunction(({ targetPageNumber, text }) => {
    const compact = (value) => String(value ?? "").replace(/\s+/g, "").toLowerCase();
    const findVisiblePdfPageElement = (pageNo, expected = "") => {
      const compactTarget = compact(expected);
      const pages = Array.from(document.querySelectorAll(`[data-testid^='pdf-pane-'] [data-page-number="${pageNo}"]`))
        .filter((pageElement) => pageElement instanceof HTMLElement)
        .map((pageElement) => {
          const rect = pageElement.getBoundingClientRect();
          const textLayer = pageElement.querySelector(".textLayer");
          const layerText = textLayer?.textContent ?? "";
          const ready = textLayer?.getAttribute("data-pdf-text-layer-ready") === "true";
          const visible = rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth;
          const containsTarget = !expected || layerText.includes(expected) || compact(layerText).includes(compactTarget);
          return { pageElement, ready, visible, containsTarget, area: Math.max(0, rect.width) * Math.max(0, rect.height) };
        })
        .filter((candidate) => candidate.ready && candidate.visible)
        .sort((left, right) => Number(right.containsTarget) - Number(left.containsTarget) || right.area - left.area);
      return pages[0]?.pageElement ?? null;
    };
    const pageElement = findVisiblePdfPageElement(targetPageNumber, text);
    const layerText = pageElement?.querySelector(".textLayer")?.textContent ?? "";
    return layerText.includes(text) || compact(layerText).includes(compact(text));
  }, { targetPageNumber: pageNumber, text: expectedText }, { timeout: ASSERT_TIMEOUT_MS });
}

async function getTextTargetBox(page, pageNumber, targetText) {
  return page.evaluate(({ targetPageNumber, text }) => {
    const compact = (value) => String(value ?? "").replace(/\s+/g, "").toLowerCase();
    const findVisiblePdfPageElement = (pageNo, expected = "") => {
      const compactTarget = compact(expected);
      const pages = Array.from(document.querySelectorAll(`[data-testid^='pdf-pane-'] [data-page-number="${pageNo}"]`))
        .filter((pageElement) => pageElement instanceof HTMLElement)
        .map((pageElement) => {
          const rect = pageElement.getBoundingClientRect();
          const textLayer = pageElement.querySelector(".textLayer");
          const layerText = textLayer?.textContent ?? "";
          const ready = textLayer?.getAttribute("data-pdf-text-layer-ready") === "true";
          const visible = rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth;
          const containsTarget = !expected || layerText.includes(expected) || compact(layerText).includes(compactTarget);
          return { pageElement, ready, visible, containsTarget, area: Math.max(0, rect.width) * Math.max(0, rect.height) };
        })
        .filter((candidate) => candidate.ready && candidate.visible)
        .sort((left, right) => Number(right.containsTarget) - Number(left.containsTarget) || right.area - left.area);
      return pages[0]?.pageElement ?? null;
    };
    const pageElement = findVisiblePdfPageElement(targetPageNumber, text);
    if (!(pageElement instanceof HTMLElement)) {
      return null;
    }

    const spans = Array.from(pageElement.querySelectorAll(".textLayer span"))
      .filter((span) => span instanceof HTMLElement);
    const normalizedTarget = text.replace(/\s+/g, " ").trim();
    const compactTarget = compact(normalizedTarget);
    const compactChars = [];
    let compactText = "";

    spans.forEach((span) => {
      const raw = span.textContent ?? "";
      const rect = span.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || !raw) {
        return;
      }
      Array.from(raw).forEach((char, charIndex) => {
        if (/\s/.test(char)) {
          return;
        }
        compactChars.push({
          span,
          rect,
          charIndex,
          charCount: Math.max(1, Array.from(raw).length),
        });
        compactText += char.toLowerCase();
      });
    });

    const compactIndex = compactText.indexOf(compactTarget);
    if (compactIndex >= 0 && compactChars.length > compactIndex) {
      const startChar = compactChars[compactIndex];
      const endChar = compactChars[Math.min(compactChars.length - 1, compactIndex + compactTarget.length - 1)];
      const matchedChars = compactChars.slice(compactIndex, compactIndex + compactTarget.length);
      const boxes = matchedChars.map((entry) => entry.rect);
      const left = Math.min(...boxes.map((box) => box.left));
      const top = Math.min(...boxes.map((box) => box.top));
      const right = Math.max(...boxes.map((box) => box.right));
      const bottom = Math.max(...boxes.map((box) => box.bottom));
      const startRatio = Math.max(0, Math.min(1, startChar.charIndex / startChar.charCount));
      const endRatio = Math.max(0, Math.min(1, (endChar.charIndex + 1) / endChar.charCount));
      const startX = startChar.rect.left + startChar.rect.width * startRatio;
      const endX = endChar.rect.left + endChar.rect.width * endRatio;
      const startY = startChar.rect.top + startChar.rect.height / 2;
      const endY = endChar.rect.top + endChar.rect.height / 2;
      return {
        text: text,
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
        startX,
        startY,
        endX,
        endY,
      };
    }

    return null;
  }, { targetPageNumber: pageNumber, text: targetText });
}

function isComfortablyVisibleBox(box, viewport) {
  if (!box) {
    return false;
  }

  return box.top >= 120 &&
    box.bottom <= Math.max(160, viewport.height - 96) &&
    box.left >= 0 &&
    box.right <= viewport.width;
}

async function scrollProductPdfTextIntoView(page, pageNumber, targetText) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.evaluate(({ targetPageNumber, text }) => {
      const compact = (value) => String(value ?? "").replace(/\s+/g, "").toLowerCase();
      const findScrollRoot = (element) => {
        let current = element.parentElement;
        while (current) {
          const style = window.getComputedStyle(current);
          const canScrollY = current.scrollHeight > current.clientHeight + 8 &&
            /(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`);
          if (canScrollY) {
            return current;
          }
          current = current.parentElement;
        }
        return document.scrollingElement ?? document.documentElement;
      };
      const getTargetBounds = (pageElement) => {
        const spans = Array.from(pageElement.querySelectorAll(".textLayer span"))
          .filter((span) => span instanceof HTMLElement);
        const compactTarget = compact(text);
        const compactChars = [];
        let pageCompact = "";

        spans.forEach((span) => {
          const raw = span.textContent ?? "";
          const rect = span.getBoundingClientRect();
          if (!raw || rect.width <= 0 || rect.height <= 0) {
            return;
          }
          const chars = Array.from(raw);
          chars.forEach((char, charIndex) => {
            if (/\s/.test(char)) {
              return;
            }
            compactChars.push({
              rect,
              charIndex,
              charCount: Math.max(1, chars.length),
            });
            pageCompact += char.toLowerCase();
          });
        });

        const compactIndex = pageCompact.indexOf(compactTarget);
        if (compactIndex < 0) {
          return null;
        }
        const matched = compactChars.slice(compactIndex, compactIndex + compactTarget.length);
        if (matched.length === 0) {
          return null;
        }

        return {
          left: Math.min(...matched.map((entry) => entry.rect.left)),
          top: Math.min(...matched.map((entry) => entry.rect.top)),
          right: Math.max(...matched.map((entry) => entry.rect.right)),
          bottom: Math.max(...matched.map((entry) => entry.rect.bottom)),
        };
      };

      const compactTarget = compact(text);
      const pages = Array.from(document.querySelectorAll(`[data-testid^='pdf-pane-'] [data-page-number="${targetPageNumber}"]`))
        .filter((pageElement) => pageElement instanceof HTMLElement)
        .map((pageElement) => {
          const textLayer = pageElement.querySelector(".textLayer");
          const layerText = textLayer?.textContent ?? "";
          const containsTarget = layerText.includes(text) || compact(layerText).includes(compactTarget);
          const ready = textLayer?.getAttribute("data-pdf-text-layer-ready") === "true";
          return { pageElement, containsTarget, ready };
        })
        .filter((candidate) => candidate.ready)
        .sort((left, right) => Number(right.containsTarget) - Number(left.containsTarget));

      const pageElement = pages[0]?.pageElement;
      if (!(pageElement instanceof HTMLElement)) {
        return;
      }

      const bounds = getTargetBounds(pageElement);
      if (!bounds) {
        pageElement.scrollIntoView({ block: "center" });
        return;
      }

      const scrollRoot = findScrollRoot(pageElement);
      const rootRect = scrollRoot === document.scrollingElement || scrollRoot === document.documentElement
        ? { top: 0, left: 0, height: window.innerHeight, width: window.innerWidth }
        : scrollRoot.getBoundingClientRect();
      const targetCenterY = (bounds.top + bounds.bottom) / 2;
      const targetCenterX = (bounds.left + bounds.right) / 2;
      const desiredCenterY = rootRect.top + rootRect.height * 0.45;
      const desiredCenterX = rootRect.left + rootRect.width * 0.5;
      scrollRoot.scrollTop += targetCenterY - desiredCenterY;
      scrollRoot.scrollLeft += targetCenterX - desiredCenterX;
    }, { targetPageNumber: pageNumber, text: targetText });

    await new Promise((resolve) => setTimeout(resolve, 450));
    const box = await getTextTargetBox(page, pageNumber, targetText);
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    if (isComfortablyVisibleBox(box, viewport)) {
      return box;
    }
  }

  return getTextTargetBox(page, pageNumber, targetText);
}

async function dragSelectTextTarget(page, box) {
  const startX = Number.isFinite(box.startX) ? box.startX : box.left + 2;
  const startY = Number.isFinite(box.startY) ? box.startY : box.top + box.height / 2;
  const endX = Number.isFinite(box.endX) ? box.endX : box.right - 2;
  const endY = Number.isFinite(box.endY) ? box.endY : box.top + box.height / 2;
  await page.mouse.move(startX - 4, startY);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX + 4, endY, { steps: 24 });
  await page.mouse.up();
}

async function dragSelectTextTargetReverse(page, box) {
  const startX = Number.isFinite(box.startX) ? box.startX : box.left + 2;
  const startY = Number.isFinite(box.startY) ? box.startY : box.top + box.height / 2;
  const endX = Number.isFinite(box.endX) ? box.endX : box.right - 2;
  const endY = Number.isFinite(box.endY) ? box.endY : box.top + box.height / 2;
  await page.mouse.move(endX + 4, endY);
  await page.mouse.down();
  await page.mouse.move(startX - 4, startY, { steps: 24 });
  await page.mouse.up();
}

async function selectProductPdfTextRange(page, pageNumber, targetText) {
  const selectionBox = await page.evaluate(({ targetPageNumber, text }) => {
    const compact = (value) => String(value ?? "").replace(/\s+/g, "").toLowerCase();
    const compactTarget = compact(text);
    const pageElements = Array.from(document.querySelectorAll(`[data-testid^='pdf-pane-'] [data-page-number="${targetPageNumber}"]`))
      .filter((element) => element instanceof HTMLElement);
    const pageElement = pageElements.find((element) => {
      const rect = element.getBoundingClientRect();
      const textLayer = element.querySelector(".textLayer");
      const layerText = textLayer?.textContent ?? "";
      return rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        textLayer?.getAttribute("data-pdf-text-layer-ready") === "true" &&
        (layerText.includes(text) || compact(layerText).includes(compactTarget));
    });
    const textLayer = pageElement?.querySelector(".textLayer");
    if (!(pageElement instanceof HTMLElement) || !(textLayer instanceof HTMLElement)) {
      return null;
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
    const directStart = fullText.indexOf(text);
    let start = directStart;
    let end = directStart >= 0 ? directStart + text.length : -1;
    if (start < 0 && compactTarget) {
      const offsets = [];
      let compactTextValue = "";
      for (let index = 0; index < fullText.length; index += 1) {
        const character = fullText[index] ?? "";
        if (/\s/.test(character)) {
          continue;
        }
        offsets.push(index);
        compactTextValue += character.toLowerCase();
      }
      const compactStart = compactTextValue.indexOf(compactTarget);
      if (compactStart >= 0) {
        start = offsets[compactStart] ?? -1;
        const compactEnd = compactStart + compactTarget.length - 1;
        end = typeof offsets[compactEnd] === "number" ? offsets[compactEnd] + 1 : -1;
      }
    }
    if (start < 0 || end <= start) {
      return null;
    }

    const startEntry = textNodes.find((entry) => entry.start <= start && entry.end >= start);
    const endEntry = textNodes.find((entry) => entry.start < end && entry.end >= end);
    if (!startEntry || !endEntry) {
      return null;
    }

    const range = document.createRange();
    range.setStart(startEntry.node, Math.max(0, start - startEntry.start));
    range.setEnd(endEntry.node, Math.max(0, end - endEntry.start));
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (rects.length === 0) {
      return null;
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    const first = rects[0];
    const last = rects[rects.length - 1];
    const serializeRect = (rect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
    const debugEntries = textNodes
      .filter((entry) => entry.end > start && entry.start < end)
      .map((entry) => {
        const parentElement = entry.node.parentElement;
        const parentRect = parentElement?.getBoundingClientRect();
        const parentStyle = parentElement ? getComputedStyle(parentElement) : null;
        const nodeRange = document.createRange();
        nodeRange.selectNodeContents(entry.node);
        const nodeRect = nodeRange.getBoundingClientRect();
        const nodeClientRects = Array.from(nodeRange.getClientRects()).map(serializeRect);
        const localStart = Math.max(0, start - entry.start);
        const localEnd = Math.min(entry.node.textContent?.length ?? 0, end - entry.start);
        const sampleStart = Math.max(0, localStart - 3);
        const sampleEnd = Math.min(entry.node.textContent?.length ?? 0, localEnd + 3);
        const chars = [];
        for (let index = sampleStart; index < sampleEnd; index += 1) {
          const charRange = document.createRange();
          charRange.setStart(entry.node, index);
          charRange.setEnd(entry.node, index + 1);
          chars.push({
            index,
            text: entry.node.textContent?.slice(index, index + 1) ?? "",
            rect: serializeRect(charRange.getBoundingClientRect()),
          });
        }
        return {
          text: entry.node.textContent ?? "",
          parentRect: parentRect ? serializeRect(parentRect) : null,
          parentInlineStyle: parentElement?.getAttribute("style") ?? "",
          parentTransform: parentStyle?.transform ?? "",
          parentTransformOrigin: parentStyle?.transformOrigin ?? "",
          parentPosition: parentStyle?.position ?? "",
          parentFontSize: parentStyle?.fontSize ?? "",
          parentFontFamily: parentStyle?.fontFamily ?? "",
          parentFontStretch: parentStyle?.fontStretch ?? "",
          parentFontWeight: parentStyle?.fontWeight ?? "",
          parentLineHeight: parentStyle?.lineHeight ?? "",
          parentLetterSpacing: parentStyle?.letterSpacing ?? "",
          parentWordSpacing: parentStyle?.wordSpacing ?? "",
          parentTextSizeAdjust: parentStyle?.textSizeAdjust ?? "",
          parentGlyphScaleX: parentElement?.dataset.pdfTextGlyphScaleX ?? "",
          parentGlyphScaleY: parentElement?.dataset.pdfTextGlyphScaleY ?? "",
          parentZoom: parentStyle?.zoom ?? "",
          devicePixelRatio: window.devicePixelRatio,
          visualViewportScale: window.visualViewport?.scale ?? null,
          nodeRect: serializeRect(nodeRect),
          nodeClientRects,
          localStart,
          localEnd,
          chars,
        };
      });
    return {
      startX: first.left + 1,
      startY: first.top + first.height / 2,
      endX: last.right - 1,
      endY: last.top + last.height / 2,
      left: Math.min(...rects.map((rect) => rect.left)),
      top: Math.min(...rects.map((rect) => rect.top)),
      right: Math.max(...rects.map((rect) => rect.right)),
      bottom: Math.max(...rects.map((rect) => rect.bottom)),
      width: Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left)),
      height: Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top)),
      selectedText: selection?.toString() ?? range.toString(),
      debugEntries,
    };
  }, { targetPageNumber: pageNumber, text: targetText });

  if (!selectionBox) {
    return null;
  }

  await page.mouse.move(selectionBox.startX, selectionBox.startY);
  await page.mouse.down();
  await page.evaluate(({ endX, endY }) => {
    document.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: endX,
      clientY: endY,
      pointerId: 1,
      pointerType: "mouse",
    }));
  }, selectionBox);
  await page.mouse.move(selectionBox.endX, selectionBox.endY, { steps: 4 });
  await page.mouse.up();
  await page.evaluate(() => document.dispatchEvent(new Event("selectionchange", { bubbles: true })));
  return selectionBox;
}

async function dragProductPdfTextBox(page, selectionBox, reverse = false) {
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  });
  const start = reverse
    ? { x: selectionBox.endX, y: selectionBox.endY }
    : { x: selectionBox.startX, y: selectionBox.startY };
  const end = reverse
    ? { x: selectionBox.startX, y: selectionBox.startY }
    : { x: selectionBox.endX, y: selectionBox.endY };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 18 });
  await page.mouse.up();
}

async function dispatchProductPdfPointerEvent(page, type, point, buttons) {
  await page.evaluate(({ eventType, clientX, clientY, pointerButtons }) => {
    const target = document.elementFromPoint(clientX, clientY);
    target?.dispatchEvent(new PointerEvent(eventType, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: pointerButtons,
      clientX,
      clientY,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    }));
  }, {
    eventType: type,
    clientX: point.x,
    clientY: point.y,
    pointerButtons: buttons,
  });
}

async function waitForSelectionMenuText(page, primary, fallback, timeoutMs = 6000) {
  return page.waitForFunction(({ primary: primaryText, fallback: fallbackText }) => {
    const compact = (value) => String(value ?? "").replace(/\s+/g, "").toLowerCase();
    const menus = Array.from(document.querySelectorAll(".pdf-selection-color-picker, [data-pdf-annotation-menu]"));
    return menus.some((menu) => {
      const menuText = menu.textContent ?? "";
      return menuText.includes(primaryText) ||
        menuText.includes(fallbackText) ||
        compact(menuText).includes(compact(primaryText)) ||
        compact(menuText).includes(compact(fallbackText));
    });
  }, { primary, fallback }, { timeout: timeoutMs }).then(() => true).catch(() => false);
}

async function collectSelectionDiagnostics(page, pageNumber, targetText) {
  return page.evaluate(({ targetPageNumber, text }) => {
    const compact = (value) => String(value ?? "").replace(/\s+/g, "").toLowerCase();
    const findVisiblePdfPageElement = (pageNo, expected = "") => {
      const compactTarget = compact(expected);
      const pages = Array.from(document.querySelectorAll(`[data-testid^='pdf-pane-'] [data-page-number="${pageNo}"]`))
        .filter((pageElement) => pageElement instanceof HTMLElement)
        .map((pageElement) => {
          const rect = pageElement.getBoundingClientRect();
          const textLayer = pageElement.querySelector(".textLayer");
          const layerText = textLayer?.textContent ?? "";
          const ready = textLayer?.getAttribute("data-pdf-text-layer-ready") === "true";
          const visible = rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth;
          const containsTarget = !expected || layerText.includes(expected) || compact(layerText).includes(compactTarget);
          return { pageElement, ready, visible, containsTarget, area: Math.max(0, rect.width) * Math.max(0, rect.height) };
        })
        .filter((candidate) => candidate.ready && candidate.visible)
        .sort((left, right) => Number(right.containsTarget) - Number(left.containsTarget) || right.area - left.area);
      return pages[0]?.pageElement ?? null;
    };
    const pageElement = findVisiblePdfPageElement(targetPageNumber, text);
    const textLayer = pageElement?.querySelector(".textLayer");
    const selection = window.getSelection();
    const spanSamples = Array.from(textLayer?.querySelectorAll("span") ?? [])
      .filter((span) => span instanceof HTMLElement && (span.textContent ?? "").trim())
      .slice(0, 20)
      .map((span) => {
        const rect = span.getBoundingClientRect();
        return {
          text: span.textContent,
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        };
      });
    return {
      target: text,
      selectionText: selection?.toString() ?? "",
      selectionRangeCount: selection?.rangeCount ?? 0,
      menuText: document.querySelector(".pdf-selection-color-picker, [data-pdf-annotation-menu]")?.textContent ?? "",
      layerReady: textLayer?.getAttribute("data-pdf-text-layer-ready"),
      layerTextSample: (textLayer?.textContent ?? "").slice(0, 400),
      targetInLayer: (textLayer?.textContent ?? "").includes(text),
      spanSamples,
    };
  }, { targetPageNumber: pageNumber, text: targetText });
}

async function waitForSelectionMenu(page, expectedText) {
  await page.waitForFunction((text) => {
    const compact = (value) => String(value ?? "").replace(/\s+/g, "").toLowerCase();
    const menus = Array.from(document.querySelectorAll(".pdf-selection-color-picker, [data-pdf-annotation-menu]"));
    return menus.some((menu) => {
      const menuText = menu.textContent ?? "";
      return menuText.includes(text) || compact(menuText).includes(compact(text));
    });
  }, expectedText, { timeout: ASSERT_TIMEOUT_MS });
}

async function waitForAnnotationMenuText(page, expectedText) {
  await page.waitForFunction((text) => {
    const compact = (value) => String(value ?? "").replace(/\s+/g, "").toLowerCase();
    const menus = Array.from(document.querySelectorAll("[data-pdf-annotation-menu], .pdf-selection-color-picker"));
    return menus.some((menu) => {
      const menuText = menu.textContent ?? "";
      return menuText.includes(text) || compact(menuText).includes(compact(text));
    });
  }, expectedText, { timeout: ASSERT_TIMEOUT_MS });
}

async function clearPdfMenusAndSelection(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 2, clientY: 2 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 2, clientY: 2 }));
  }).catch(() => {});
}

async function saveSelectionAsHighlight(page) {
  const clicked = await page.evaluate(() => {
    const picker = document.querySelector(".pdf-selection-color-picker");
    if (!(picker instanceof HTMLElement)) {
      return false;
    }
    const buttons = Array.from(picker.querySelectorAll("button"));
    const colorButton = buttons.find((button) => {
      const text = button.textContent ?? "";
      return text.includes("黄色") || text.toLowerCase().includes("yellow");
    }) ?? buttons[0];
    if (!(colorButton instanceof HTMLButtonElement)) {
      return false;
    }
    colorButton.click();
    return true;
  });
  if (!clicked) {
    throw new Error("Selection color picker was not available for saving highlight.");
  }
}

async function saveSelectionAsUnderline(page, selectionBox) {
  const directAction = page.locator('[data-testid="pdf-selection-draft-action-underline"]');
  if (await directAction.isVisible().catch(() => false)) {
    await directAction.click();
    return;
  }
  await page.mouse.click(selectionBox.endX, selectionBox.endY, { button: "right" });
  const underlineAction = page.locator('[data-testid="pdf-context-menu-action-underline-selection"]');
  await underlineAction.waitFor({ state: "visible", timeout: ASSERT_TIMEOUT_MS });
  await underlineAction.click();
}

async function getSelectionState(page) {
  return page.evaluate(() => {
    const pane = document.querySelector("[data-testid^='pdf-pane-']");
    const preview = pane?.getAttribute("data-transient-selection-active") ?? "false";
    const menu = document.querySelector(".pdf-selection-color-picker, [data-pdf-annotation-menu]");
    const menuText = menu?.textContent ?? "";
    const nativeText = window.getSelection()?.toString() ?? "";
    return {
      preview,
      menuText,
      nativeText,
      storedSegments: document.querySelectorAll("[data-pdf-stored-annotation-segment='true']").length,
      highlightSegments: document.querySelectorAll("[data-pdf-stored-annotation-type='highlight']").length,
      underlineSegments: document.querySelectorAll("[data-pdf-stored-annotation-type='underline']").length,
      areaSegments: document.querySelectorAll("[data-pdf-stored-annotation-type='area']").length,
      pinSegments: document.querySelectorAll("[data-pdf-stored-annotation-type='pin']").length,
      textAnnotations: document.querySelectorAll("[data-pdf-text-annotation-content='true']").length,
      inkSegments: document.querySelectorAll("[data-pdf-ink-annotation-segment='true'],[data-pdf-ink-annotation-content='true']").length,
    };
  });
}

async function getStoredSegmentQuality(page) {
  return page.evaluate(() => {
    const pane = document.querySelector("[data-testid^='pdf-pane-']");
    const pageElement = pane?.querySelector(`[data-page-number="${7}"]`);
    const pageRect = pageElement instanceof HTMLElement ? pageElement.getBoundingClientRect() : null;
    const segments = Array.from(document.querySelectorAll("[data-pdf-stored-annotation-segment='true']"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const type = element.getAttribute("data-pdf-stored-annotation-type") ?? "";
        return {
          type,
          width: rect.width,
          height: rect.height,
          area: rect.width * rect.height,
          relativeHeight: pageRect && pageRect.height > 0 ? rect.height / pageRect.height : null,
          relativeArea: pageRect && pageRect.width > 0 && pageRect.height > 0
            ? (rect.width * rect.height) / (pageRect.width * pageRect.height)
            : null,
          text: (element.textContent ?? "").slice(0, 80),
        };
      })
      .filter((segment) => segment.width > 0 && segment.height > 0);
    const textMarkup = segments.filter((segment) => segment.type === "highlight" || segment.type === "underline");
    const suspiciousTextMarkup = textMarkup.filter((segment) => (
      (segment.relativeHeight ?? 0) > 0.12 ||
      (segment.relativeArea ?? 0) > 0.18
    ));
    return {
      total: segments.length,
      textMarkup: textMarkup.length,
      suspiciousTextMarkup,
    };
  });
}

async function getAnnotationSegmentQuality(page, annotationId) {
  return page.evaluate((id) => {
    const safeId = String(id).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    const segments = Array.from(document.querySelectorAll(`[data-pdf-stored-annotation-id="${safeId}"][data-pdf-stored-annotation-segment="true"]`))
      .map((element) => {
        const pageElement = element.closest("[data-page-number]");
        const pageRect = pageElement instanceof HTMLElement ? pageElement.getBoundingClientRect() : null;
        const rect = element.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          relativeHeight: pageRect && pageRect.height > 0 ? rect.height / pageRect.height : null,
          relativeArea: pageRect && pageRect.width > 0 && pageRect.height > 0
            ? (rect.width * rect.height) / (pageRect.width * pageRect.height)
            : null,
        };
      })
      .filter((segment) => segment.width > 0 && segment.height > 0);
    return {
      count: segments.length,
      suspicious: segments.filter((segment) => (
        (segment.relativeHeight ?? 0) > 0.12 ||
        (segment.relativeArea ?? 0) > 0.18
      )),
    };
  }, annotationId);
}

async function clickFirstStoredAnnotationType(page, type) {
  const point = await page.evaluate(async (annotationType) => {
    const elements = Array.from(document.querySelectorAll(`[data-pdf-stored-annotation-type="${annotationType}"]`));
    const isVisible = (rect) => (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth
    );
    let candidateElement = elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { element, rect };
      })
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((left, right) => (left.rect.top - right.rect.top) || (left.rect.left - right.rect.left))[0]?.element;
    if (!candidateElement) {
      return null;
    }
    if (!isVisible(candidateElement.getBoundingClientRect())) {
      candidateElement.scrollIntoView({ block: "center", inline: "center" });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    const visible = elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { rect };
      })
      .filter(({ rect }) => isVisible(rect))
      .sort((left, right) => (left.rect.top - right.rect.top) || (left.rect.left - right.rect.left))[0];
    if (!visible) {
      return null;
    }
    return {
      x: visible.rect.left + visible.rect.width / 2,
      y: visible.rect.top + visible.rect.height / 2,
    };
  }, type);

  if (!point) {
    return false;
  }
  await page.mouse.click(point.x, point.y);
  return true;
}

async function getTransientSelectionQuality(page, rightColumnLeft) {
  return page.evaluate(({ columnLeft }) => {
    const segments = Array.from(document.querySelectorAll("[data-pdf-transient-selection-segment='true']"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((segment) => segment.width > 0 && segment.height > 0);
    const heights = segments.map((segment) => segment.height);
    const minHeight = heights.length > 0 ? Math.min(...heights) : 0;
    const maxHeight = heights.length > 0 ? Math.max(...heights) : 0;
    return {
      segmentCount: segments.length,
      segments,
      minHeight,
      maxHeight,
      heightRatio: minHeight > 0 ? maxHeight / minHeight : null,
      crossesRightColumn: Number.isFinite(columnLeft)
        ? segments.some((segment) => segment.right >= columnLeft - 2)
        : false,
      hasDegenerateSegment: segments.some((segment) => segment.width < 2 || segment.height < 2),
    };
  }, { columnLeft: rightColumnLeft });
}

async function clickFirstVisibleSelector(page, selector) {
  const point = await page.evaluate((cssSelector) => {
    const elements = Array.from(document.querySelectorAll(cssSelector));
    const visible = elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { rect };
      })
      .filter(({ rect }) => (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom >= 0 &&
        rect.right >= 0 &&
        rect.top <= window.innerHeight &&
        rect.left <= window.innerWidth
      ))
      .sort((left, right) => (left.rect.top - right.rect.top) || (left.rect.left - right.rect.left))[0];
    if (!visible) {
      return null;
    }
    return {
      x: visible.rect.left + visible.rect.width / 2,
      y: visible.rect.top + visible.rect.height / 2,
    };
  }, selector);

  if (!point) {
    return false;
  }
  await page.mouse.click(point.x, point.y);
  return true;
}

async function waitForAnnotationInteractionSurface(page, timeoutMs = 6000) {
  return page.waitForFunction(() => {
    if (document.querySelector("[data-pdf-annotation-menu], .pdf-selection-color-picker")) {
      return true;
    }
    if (document.querySelector("textarea, input, [contenteditable='true']")) {
      return true;
    }
    return false;
  }, null, { timeout: timeoutMs }).then(() => true).catch(() => false);
}

async function runProductSmokeBridgeSelection(page, pageNumber, mode, targetText) {
  await page.waitForFunction(() => (
    Object.values(window.__latticePdfDiagnostics ?? {})
      .some((bridge) => typeof bridge?.runSelectionOnPage === "function")
  ), null, { timeout: ASSERT_TIMEOUT_MS });
  return page.evaluate(async ({ targetPageNumber, selectionMode, expectedText }) => {
    const bridges = Object.values(window.__latticePdfDiagnostics ?? {})
      .filter((bridge) => typeof bridge?.runSelectionOnPage === "function");
    let lastResult = false;
    for (const bridge of bridges) {
      const result = await bridge.runSelectionOnPage(targetPageNumber, selectionMode, expectedText);
      lastResult = result;
      const compact = (value) => String(value ?? "").replace(/\s+/g, "").toLowerCase();
      if (
        result &&
        result.ok &&
        compact(result.text).includes(compact(expectedText)) &&
        Number(result.rectCount) > 0
      ) {
        return result;
      }
    }
    return lastResult;
  }, { targetPageNumber: pageNumber, selectionMode: mode, expectedText: targetText });
}

async function runProductSmokeBridgeTextMarkup(page, pageNumber, exactText, styleType = "highlight", color = "#ffd400") {
  await page.waitForFunction(() => (
    Object.values(window.__latticePdfDiagnostics ?? {})
      .some((bridge) => typeof bridge?.createTextMarkupOnPage === "function")
  ), null, { timeout: ASSERT_TIMEOUT_MS });
  return page.evaluate(async ({ targetPageNumber, exact, requestedStyleType, requestedColor }) => {
    const bridges = Object.values(window.__latticePdfDiagnostics ?? {})
      .filter((bridge) => typeof bridge?.createTextMarkupOnPage === "function");
    let lastResult = false;
    for (const bridge of bridges) {
      const result = await bridge.createTextMarkupOnPage(targetPageNumber, exact, requestedStyleType, requestedColor);
      lastResult = result;
      if (result && result.ok && Number(result.rectCount) > 0) {
        return result;
      }
    }
    return lastResult;
  }, {
    targetPageNumber: pageNumber,
    exact: exactText,
    requestedStyleType: styleType,
    requestedColor: color,
  });
}

async function verifyOptionalAnnotationClick(page, label, count, clicker) {
  if (count <= 0) {
    return { status: "absent" };
  }

  await clearPdfMenusAndSelection(page);
  const clicked = await clicker();
  if (!clicked) {
    throw new Error(`Stored ${label} annotation was counted but no visible clickable target was found.`);
  }
  const opened = await waitForAnnotationInteractionSurface(page);
  if (!opened) {
    throw new Error(`Stored ${label} annotation did not open a menu or editor when clicked.`);
  }
  const state = await getSelectionState(page);
  return {
    status: "opened",
    menuText: state.menuText.slice(0, 240),
    nativeText: state.nativeText.slice(0, 120),
  };
}

async function clickStoredAnnotationNearBox(page, type, box) {
  const point = await page.evaluate(({ annotationType, targetBox }) => {
    const elements = Array.from(document.querySelectorAll(`[data-pdf-stored-annotation-type="${annotationType}"]`));
    const targetCenter = {
      x: (targetBox.left + targetBox.right) / 2,
      y: (targetBox.top + targetBox.bottom) / 2,
    };
    const candidates = elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const overlapX = Math.max(0, Math.min(rect.right, targetBox.right) - Math.max(rect.left, targetBox.left));
        const overlapY = Math.max(0, Math.min(rect.bottom, targetBox.bottom) - Math.max(rect.top, targetBox.top));
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.hypot(centerX - targetCenter.x, centerY - targetCenter.y);
        return { rect, score: overlapX * overlapY, distance };
      })
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((left, right) => (right.score - left.score) || (left.distance - right.distance));
    const best = candidates[0];
    if (!best) {
      return null;
    }
    return {
      x: best.rect.left + Math.min(Math.max(best.rect.width / 2, 4), Math.max(4, best.rect.width - 4)),
      y: best.rect.top + Math.min(Math.max(best.rect.height / 2, 4), Math.max(4, best.rect.height - 4)),
      score: best.score,
      distance: best.distance,
    };
  }, { annotationType: type, targetBox: box });

  if (!point) {
    return false;
  }
  await page.mouse.click(point.x, point.y);
  return true;
}

async function clickStoredAnnotationById(page, annotationId) {
  if (!annotationId) {
    return false;
  }

  const point = await page.evaluate((id) => {
    const elements = Array.from(document.querySelectorAll(`[data-pdf-stored-annotation-id="${CSS.escape(id)}"]`));
    const candidates = elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { rect };
      })
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((left, right) => (left.rect.top - right.rect.top) || (left.rect.left - right.rect.left));
    const best = candidates[0];
    if (!best) {
      return null;
    }
    return {
      x: best.rect.left + Math.min(Math.max(best.rect.width / 2, 4), Math.max(4, best.rect.width - 4)),
      y: best.rect.top + Math.min(Math.max(best.rect.height / 2, 4), Math.max(4, best.rect.height - 4)),
    };
  }, annotationId);

  if (!point) {
    return false;
  }
  await page.mouse.click(point.x, point.y);
  return true;
}

async function main() {
  const exePath = path.resolve(process.env.LATTICE_DESKTOP_EXE ?? DEFAULT_EXE);
  const workspacePath = path.resolve(process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_WORKSPACE ?? DEFAULT_WORKSPACE);
  const realPdfPath = path.resolve(process.env.LATTICE_DESKTOP_PRODUCT_SMOKE_REAL_PDF_PATH ?? DEFAULT_REAL_PDF_UNICODE);
  const pdfRelativePath = relativeWorkspacePath(workspacePath, realPdfPath);
  const realPdfName = path.basename(realPdfPath);
  const sidecarPath = SIDECAR_PATH ? path.resolve(SIDECAR_PATH) : "";
  const sidecarRelativePath = sidecarPath ? relativeWorkspacePath(workspacePath, sidecarPath) : "";

  await access(exePath);
  await access(workspacePath);
  await access(realPdfPath);
  if (SIDECAR_ONLY) {
    await access(sidecarPath);
  }
  await mkdir(OUTPUT_DIR, { recursive: true });
  await closeExistingLatticeProcesses();

  const cdpPort = Number(process.env.LATTICE_DESKTOP_CDP_PORT ?? await getAvailablePort());
  const webviewArgs = [
    `--remote-debugging-port=${cdpPort}`,
    "--remote-allow-origins=*",
  ].join(" ");

  console.log(`[desktop-product-smoke] launch ${exePath}`);
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
  try {
    await waitForHttpOk(`http://127.0.0.1:${cdpPort}/json/version`, ASSERT_TIMEOUT_MS);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    page = await waitForDesktopPage(browser, ASSERT_TIMEOUT_MS);
    page.setDefaultTimeout(ASSERT_TIMEOUT_MS);
    await page.evaluate(() => {
      window.localStorage?.setItem("lattice-pdf-product-smoke-bridge", "1");
    }).catch(() => undefined);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    page = await waitForDesktopPage(browser, ASSERT_TIMEOUT_MS);
    page.setDefaultTimeout(ASSERT_TIMEOUT_MS);

    const productSessionWasSeeded = await ensureProductWorkspace(
      page,
      workspacePath,
      SIDECAR_ONLY ? sidecarRelativePath : pdfRelativePath,
    );
    if (SIDECAR_ONLY) {
      await page.waitForSelector(".lattice-pdf-annotation-preview", { state: "visible", timeout: ASSERT_TIMEOUT_MS });
      await page.waitForFunction(() => {
        const images = Array.from(document.querySelectorAll(".lattice-pdf-annotation-preview"));
        return images.length > 0 && images.every((image) => (
          image instanceof HTMLImageElement &&
          image.src.startsWith("blob:")
        ));
      }, null, { timeout: ASSERT_TIMEOUT_MS });
      const previewImages = page.locator(".lattice-pdf-annotation-preview");
      const previewImageCount = await previewImages.count();
      for (let index = 0; index < previewImageCount; index += 1) {
        await previewImages.nth(index).scrollIntoViewIfNeeded();
        await page.waitForFunction((imageIndex) => {
          const image = document.querySelectorAll(".lattice-pdf-annotation-preview")[imageIndex];
          return image instanceof HTMLImageElement &&
            image.src.startsWith("blob:") &&
            image.complete &&
            image.naturalWidth > 0 &&
            image.naturalHeight > 0;
        }, index, { timeout: ASSERT_TIMEOUT_MS });
      }
      const sidecarState = await page.evaluate(() => {
        const readColoredElement = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return {
            color: element.getAttribute("data-color"),
            annotationColor: element.style.getPropertyValue("--annotation-color"),
            borderColor: style.borderLeftColor || style.borderColor,
            backgroundColor: style.backgroundColor,
            width: rect.width,
            height: rect.height,
          };
        };
        return {
          images: Array.from(document.querySelectorAll(".lattice-pdf-annotation-preview")).map((element) => ({
            ...readColoredElement(element),
            src: element instanceof HTMLImageElement ? element.src : "",
            complete: element instanceof HTMLImageElement ? element.complete : false,
            naturalWidth: element instanceof HTMLImageElement ? element.naturalWidth : 0,
            naturalHeight: element instanceof HTMLImageElement ? element.naturalHeight : 0,
          })),
          quotes: Array.from(document.querySelectorAll(".lattice-pdf-annotation-quote")).map(readColoredElement),
          chips: Array.from(document.querySelectorAll(".lattice-pdf-annotation-chip")).map(readColoredElement),
        };
      });
      if (sidecarState.images.length === 0 || sidecarState.quotes.length === 0 || sidecarState.chips.length === 0) {
        throw new Error(`PDF annotation sidecar is missing visible content: ${JSON.stringify(sidecarState)}`);
      }
      const invalidColoredElement = [...sidecarState.images, ...sidecarState.quotes, ...sidecarState.chips]
        .find((element) => !element.color || element.annotationColor.toLowerCase() !== element.color.toLowerCase());
      if (invalidColoredElement) {
        throw new Error(`PDF annotation sidecar lost its annotation color: ${JSON.stringify(invalidColoredElement)}`);
      }
      await page.screenshot({ path: path.join(OUTPUT_DIR, "desktop-pdf-annotation-sidecar.png"), fullPage: true });
      await writeFile(
        path.join(OUTPUT_DIR, "desktop-pdf-annotation-sidecar.json"),
        `${JSON.stringify({
          generatedAt: new Date().toISOString(),
          exePath,
          workspacePath,
          sidecarPath,
          sidecarRelativePath,
          productSessionWasSeeded,
          activeUrl: page.url(),
          ...sidecarState,
        }, null, 2)}\n`,
        "utf8",
      );
      console.log(`[desktop-product-smoke] sidecar passed ${JSON.stringify({
        images: sidecarState.images.length,
        quotes: sidecarState.quotes.length,
        chips: sidecarState.chips.length,
      })}`);
      return;
    }
    await waitForProductPdf(page, realPdfName);
    await scrollProductPdfToPage(page, REAL_PDF_PAGE);
    await waitForPageText(page, REAL_PDF_PAGE, LEFT_TARGET);
    await waitForPageText(page, REAL_PDF_PAGE, RIGHT_TARGET);

    let pointerSelectionResult = null;
    if (POINTER_TARGET.trim()) {
      const beforePointerCreate = await getSelectionState(page);
      await clearPdfMenusAndSelection(page);
      const pointerTargetBox = await scrollProductPdfTextIntoView(page, REAL_PDF_PAGE, POINTER_TARGET);
      if (!pointerTargetBox) {
        throw new Error(`Unable to locate native pointer target box for "${POINTER_TARGET}".`);
      }
      const pointerSelectionBox = await selectProductPdfTextRange(page, REAL_PDF_PAGE, POINTER_TARGET);
      if (!pointerSelectionBox) {
        throw new Error(`Unable to create a real pointer selection for "${POINTER_TARGET}".`);
      }
      if (POINTER_NATIVE_DRAG) {
        await dragProductPdfTextBox(page, pointerSelectionBox);
      } else {
        await page.evaluate(() => window.getSelection()?.removeAllRanges());
        await dispatchProductPdfPointerEvent(
          page,
          "pointerdown",
          { x: pointerSelectionBox.startX, y: pointerSelectionBox.startY },
          1,
        );
        await selectProductPdfTextRange(page, REAL_PDF_PAGE, POINTER_TARGET);
        await dispatchProductPdfPointerEvent(
          page,
          "pointerup",
          { x: pointerSelectionBox.endX, y: pointerSelectionBox.endY },
          0,
        );
      }
      const pointerMenuOpened = await waitForSelectionMenuText(
        page,
        POINTER_TARGET,
        POINTER_TARGET,
        Math.min(15000, ASSERT_TIMEOUT_MS),
      );
      if (!pointerMenuOpened) {
        const pointerFailureState = await page.evaluate(() => {
          const readDiagnosticText = (fragment) => (
            Array.from(document.querySelectorAll(`[data-testid*='${fragment}']`))
              .map((element) => element.textContent?.trim() ?? "")
              .find(Boolean) ?? ""
          );
          return {
            nativeText: window.getSelection()?.toString() ?? "",
            previewText: readDiagnosticText("pdf-selection-preview-"),
            source: readDiagnosticText("pdf-selection-source-"),
            rectCount: readDiagnosticText("pdf-selection-overlay-rect-count-"),
            menuText: Array.from(document.querySelectorAll(".pdf-selection-color-picker, [data-pdf-annotation-menu]"))
              .map((element) => element.textContent?.trim() ?? "")
              .filter(Boolean),
          };
        });
        throw new Error(`Native pointer selection menu did not match "${POINTER_TARGET}": ${JSON.stringify({
          pointerSelectionBox,
          pointerFailureState,
        })}`);
      }

      pointerSelectionResult = await page.evaluate(() => {
        const readDiagnosticText = (fragment) => (
          Array.from(document.querySelectorAll(`[data-testid*='${fragment}']`))
            .map((element) => element.textContent?.trim() ?? "")
            .find(Boolean) ?? ""
        );
        return {
          text: readDiagnosticText("pdf-selection-preview-"),
          source: readDiagnosticText("pdf-selection-source-"),
          rectCount: Number(readDiagnosticText("pdf-selection-overlay-rect-count-")),
          nativeText: window.getSelection()?.toString() ?? "",
          menuText: document.querySelector(".pdf-selection-color-picker")?.textContent?.trim() ?? "",
        };
      });
      const previewRightColumnBox = await scrollProductPdfTextIntoView(page, REAL_PDF_PAGE, RIGHT_TARGET);
      if (!previewRightColumnBox) {
        throw new Error(`Unable to locate right-column boundary target "${RIGHT_TARGET}" while validating transient selection.`);
      }
      const transientSelectionState = await getTransientSelectionQuality(page, previewRightColumnBox.left);
      if (
        transientSelectionState.segmentCount < 1 ||
        (POINTER_EXPECTED_SEGMENTS > 0 && transientSelectionState.segmentCount !== POINTER_EXPECTED_SEGMENTS) ||
        transientSelectionState.crossesRightColumn ||
        transientSelectionState.hasDegenerateSegment ||
        (transientSelectionState.heightRatio !== null && transientSelectionState.heightRatio > 1.2)
      ) {
        throw new Error(`Native pointer transient selection failed visual geometry checks: ${JSON.stringify(transientSelectionState)}`);
      }
      const compactPointerMenu = compactText(pointerSelectionResult.menuText);
      const pointerMenuMatches = compactPointerMenu.includes(compactText(POINTER_TARGET));
      if (POINTER_SAVE_ONLY && pointerMenuMatches) {
        const pointerStyleType = POINTER_SAVE_STYLE_TYPE;
        const previousSegmentCount = pointerStyleType === "underline"
          ? beforePointerCreate.underlineSegments
          : beforePointerCreate.highlightSegments;
        if (pointerStyleType === "underline") {
          await saveSelectionAsUnderline(page, pointerSelectionBox);
        } else {
          await saveSelectionAsHighlight(page);
        }
        await page.waitForFunction(({ previousCount, styleType }) => (
          document.querySelectorAll(`[data-pdf-stored-annotation-type='${styleType}']`).length > previousCount
        ), {
          previousCount: previousSegmentCount,
          styleType: pointerStyleType,
        }, { timeout: ASSERT_TIMEOUT_MS });
        const rightColumnBox = await scrollProductPdfTextIntoView(page, REAL_PDF_PAGE, RIGHT_TARGET);
        if (!rightColumnBox) {
          throw new Error(`Unable to locate right-column boundary target "${RIGHT_TARGET}" after pointer save.`);
        }
        const savedPointerState = await page.evaluate(({ previousCount, rightColumnLeft, targetPage, styleType }) => {
          const pageElement = document.querySelector(`[data-page-number="${targetPage}"]`);
          const pageRect = pageElement instanceof HTMLElement ? pageElement.getBoundingClientRect() : null;
          const segments = Array.from(document.querySelectorAll(`[data-pdf-stored-annotation-type='${styleType}']`))
            .slice(previousCount)
            .map((element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return {
                annotationId: element.getAttribute("data-pdf-stored-annotation-id") ?? "",
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                normalizedLeft: pageRect && pageRect.width > 0 ? (rect.left - pageRect.left) / pageRect.width : null,
                normalizedRight: pageRect && pageRect.width > 0 ? (rect.right - pageRect.left) / pageRect.width : null,
                backgroundColor: style.backgroundColor,
                backgroundImage: style.backgroundImage,
                backgroundPosition: style.backgroundPosition,
                backgroundSize: style.backgroundSize,
                opacity: style.opacity,
              };
            });
          const heights = segments.map((segment) => segment.bottom - segment.top);
          const minHeight = heights.length > 0 ? Math.min(...heights) : 0;
          const maxHeight = heights.length > 0 ? Math.max(...heights) : 0;
          return {
            styleType,
            segmentCount: segments.length,
            segments,
            rightColumnLeft,
            minHeight,
            maxHeight,
            heightRatio: minHeight > 0 ? maxHeight / minHeight : null,
            crossesRightColumn: segments.some((segment) => (
              segment.right >= rightColumnLeft - 2
            )),
            hasDegenerateSegment: segments.some((segment) => (
              segment.right - segment.left < 2 || segment.bottom - segment.top < 2
            )),
            hasBrokenDecoration: styleType === "underline"
              ? segments.some((segment) => segment.backgroundImage === "none" || !segment.backgroundPosition.includes("100%"))
              : segments.some((segment) => segment.backgroundColor === "rgba(0, 0, 0, 0)"),
          };
        }, {
          previousCount: previousSegmentCount,
          rightColumnLeft: rightColumnBox.left,
          targetPage: REAL_PDF_PAGE,
          styleType: pointerStyleType,
        });
        if (
          savedPointerState.segmentCount < 1 ||
          savedPointerState.crossesRightColumn ||
          savedPointerState.hasDegenerateSegment ||
          savedPointerState.hasBrokenDecoration ||
          (savedPointerState.heightRatio !== null && savedPointerState.heightRatio > 1.2)
        ) {
          throw new Error(`Saved native pointer ${pointerStyleType} failed visual geometry checks: ${JSON.stringify(savedPointerState)}`);
        }
        const result = {
          generatedAt: new Date().toISOString(),
          exePath,
          workspacePath,
          realPdfPath,
          pdfRelativePath,
          cdpPort,
          pointerTargetBox,
          pointerSelectionBox,
          pointerSelectionResult,
          transientSelectionState,
          savedPointerState,
          productSessionWasSeeded,
          activeUrl: page.url(),
        };
        await page.screenshot({
          path: path.join(OUTPUT_DIR, `desktop-pdf-product-pointer-${pointerStyleType}-save.png`),
          fullPage: false,
        });
        await writeFile(
          path.join(OUTPUT_DIR, `desktop-pdf-product-pointer-${pointerStyleType}-save-smoke.json`),
          `${JSON.stringify(result, null, 2)}\n`,
          "utf8",
        );
        console.log(`[desktop-product-smoke] pointer save passed ${JSON.stringify(savedPointerState)}`);
        return;
      }
      const acceptedPointerSources = new Set(["pdfjs-text-model", "pdfium-native"]);
      if (!acceptedPointerSources.has(pointerSelectionResult.source)) {
        throw new Error(`Real pointer selection did not use a validated PDF text source: ${JSON.stringify(pointerSelectionResult)}`);
      }
      if (!compactText(pointerSelectionResult.text).includes(compactText(POINTER_TARGET))) {
        throw new Error(`Real pointer selection returned an incomplete quote: ${JSON.stringify(pointerSelectionResult)}`);
      }
      if (!Number.isFinite(pointerSelectionResult.rectCount) || pointerSelectionResult.rectCount < 1) {
        throw new Error(`Real pointer selection returned no visible text rects: ${JSON.stringify(pointerSelectionResult)}`);
      }

      if (POINTER_ONLY) {
        const result = {
          generatedAt: new Date().toISOString(),
          exePath,
          workspacePath,
          realPdfPath,
          pdfRelativePath,
          cdpPort,
          pointerTargetBox,
          pointerSelectionBox,
          pointerSelectionResult,
          transientSelectionState,
          productSessionWasSeeded,
          activeUrl: page.url(),
        };
        await writeFile(
          path.join(OUTPUT_DIR, "desktop-pdf-product-pointer-smoke.json"),
          `${JSON.stringify(result, null, 2)}\n`,
          "utf8",
        );
        console.log(`[desktop-product-smoke] pointer passed ${JSON.stringify(pointerSelectionResult)}`);
        return;
      }

      await clearPdfMenusAndSelection(page);
    }

    const leftBox = await scrollProductPdfTextIntoView(page, REAL_PDF_PAGE, LEFT_TARGET);
    if (!leftBox) {
      throw new Error(`Unable to locate left target box for "${LEFT_TARGET}".`);
    }
    const leftViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    if (!isComfortablyVisibleBox(leftBox, leftViewport)) {
      throw new Error(`Left target box is not comfortably visible before click: ${JSON.stringify(leftBox)}`);
    }
    const beforeLeftCreate = await getSelectionState(page);
    await clearPdfMenusAndSelection(page);
    const leftCopyResult = await runProductSmokeBridgeSelection(page, REAL_PDF_PAGE, "copy", LEFT_TARGET);
    if (!leftCopyResult || !leftCopyResult.ok) {
      throw new Error(`Product smoke bridge failed to copy left target: ${JSON.stringify(leftCopyResult)}`);
    }
    const leftHighlightResult = await runProductSmokeBridgeSelection(page, REAL_PDF_PAGE, "highlight", LEFT_TARGET);
    if (!leftHighlightResult || !leftHighlightResult.ok) {
      throw new Error(`Product smoke bridge failed to highlight left target: ${JSON.stringify(leftHighlightResult)}`);
    }
    const leftSelectionState = await getSelectionState(page);
    if (leftCopyResult.text === "0") {
      throw new Error(`Product left selection returned a zero-like quote: ${JSON.stringify({ leftCopyResult, leftSelectionState })}`);
    }
    await page.waitForFunction((previousCount) => (
      document.querySelectorAll("[data-pdf-stored-annotation-type='highlight']").length > previousCount
    ), beforeLeftCreate.highlightSegments, { timeout: ASSERT_TIMEOUT_MS });
    const createdHighlightState = await getSelectionState(page);
    if (createdHighlightState.highlightSegments <= beforeLeftCreate.highlightSegments) {
      throw new Error(`Highlight was not persisted after saving left target: ${JSON.stringify(createdHighlightState)}`);
    }
    await clearPdfMenusAndSelection(page);
    if (!await clickStoredAnnotationById(page, leftHighlightResult.annotationId)) {
      throw new Error("No clickable saved highlight segment found near the target text after saving.");
    }
    await page.waitForFunction(() => Boolean(document.querySelector("[data-pdf-annotation-menu]")), null, { timeout: ASSERT_TIMEOUT_MS });
    const clickedCreatedHighlightState = await getSelectionState(page);
    if (
      clickedCreatedHighlightState.menuText.includes('"0"') ||
      clickedCreatedHighlightState.nativeText === "0" ||
      !compactText(clickedCreatedHighlightState.menuText).includes(compactText(LEFT_TARGET))
    ) {
      throw new Error(`Saved product highlight opened with an incorrect quote: ${JSON.stringify(clickedCreatedHighlightState)}`);
    }

    await clearPdfMenusAndSelection(page);
    await scrollProductPdfToPage(page, REAL_PDF_PAGE);
    const rightBox = await scrollProductPdfTextIntoView(page, REAL_PDF_PAGE, RIGHT_TARGET);
    if (!rightBox) {
      throw new Error(`Unable to locate right target box for "${RIGHT_TARGET}".`);
    }
    const rightViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    if (!isComfortablyVisibleBox(rightBox, rightViewport)) {
      throw new Error(`Right target box is not comfortably visible before drag: ${JSON.stringify(rightBox)}`);
    }
    await clearPdfMenusAndSelection(page);
    const rightCopyResult = await runProductSmokeBridgeSelection(page, REAL_PDF_PAGE, "copy", RIGHT_TARGET);
    if (!rightCopyResult || !rightCopyResult.ok) {
      const diagnostics = await collectSelectionDiagnostics(page, REAL_PDF_PAGE, RIGHT_TARGET);
      throw new Error(`Product smoke bridge failed to copy right target: ${JSON.stringify({ result: rightCopyResult, diagnostics })}`);
    }
    const rightSelectionState = await getSelectionState(page);
    const rightMenuMatches = Boolean(
      compactText(rightCopyResult.text).includes(compactText(RIGHT_TARGET)) ||
      compactText(rightCopyResult.text).includes(compactText(RIGHT_FALLBACK_TARGET))
    );
    if (!rightMenuMatches) {
      throw new Error(`Product right-column copy result did not include target text: ${JSON.stringify({ rightCopyResult, rightSelectionState })}`);
    }
    if (rightSelectionState.menuText.includes('"0"') || rightSelectionState.nativeText === "0" || rightCopyResult.text === "0") {
      throw new Error(`Product right-column selection returned zero: ${JSON.stringify(rightSelectionState)}`);
    }

    let exactMarkupResult = null;
    let exactMarkupState = null;
    if (EXACT_TARGET.trim()) {
      await clearPdfMenusAndSelection(page);
      exactMarkupResult = await runProductSmokeBridgeTextMarkup(page, REAL_PDF_PAGE, EXACT_TARGET, EXACT_STYLE_TYPE, EXACT_COLOR);
      if (!exactMarkupResult || !exactMarkupResult.ok) {
        throw new Error(`Product exact quote text markup failed: ${JSON.stringify(exactMarkupResult)}`);
      }
      const compactExactResult = compactText(exactMarkupResult.text);
      if (
        !compactExactResult.includes(compactText("Fig. 5")) ||
        !compactExactResult.includes(compactText("opposite directions. Even so")) ||
        !compactExactResult.includes(compactText("V/cm")) ||
        compactExactResult.includes(compactText("with equal and opposite")) ||
        compactExactResult.includes(compactText("In higher electric fields"))
      ) {
        throw new Error(`Exact product markup returned an expanded or incorrect quote: ${JSON.stringify(exactMarkupResult)}`);
      }
      const exactState = await getSelectionState(page);
      exactMarkupState = exactState;
      const compactMenu = compactText(exactState.menuText);
      if (compactMenu && (
        compactMenu.includes(compactText("with equal and opposite")) ||
        compactMenu.includes(compactText("In higher electric fields"))
      )) {
        throw new Error(`Exact product markup opened with an expanded or incorrect quote: ${JSON.stringify({ exactMarkupResult, exactState })}`);
      }
      if (Number(exactMarkupResult.rectCount) < 4) {
        throw new Error(`Exact product markup produced too few rects: ${JSON.stringify(exactMarkupResult)}`);
      }
      const exactQuality = await getAnnotationSegmentQuality(page, exactMarkupResult.annotationId);
      if (exactQuality.suspicious.length > 0) {
        throw new Error(`Exact product markup contains oversized segments: ${JSON.stringify(exactQuality)}`);
      }
      await clearPdfMenusAndSelection(page);
      if (!await clickStoredAnnotationById(page, exactMarkupResult.annotationId)) {
        throw new Error("No clickable saved exact-quote annotation target found.");
      }
      await page.waitForFunction(() => Boolean(document.querySelector("[data-pdf-annotation-menu]")), null, { timeout: ASSERT_TIMEOUT_MS });
      const clickedExactMarkupState = await getSelectionState(page);
      const clickedExactMenu = compactText(clickedExactMarkupState.menuText);
      if (
        !clickedExactMenu.includes(compactText("Fig. 5")) ||
        clickedExactMenu.includes(compactText("with equal and opposite")) ||
        clickedExactMenu.includes(compactText("In higher electric fields"))
      ) {
        throw new Error(`Clicked exact product markup opened with an incorrect quote: ${JSON.stringify(clickedExactMarkupState)}`);
      }
    }

    await clearPdfMenusAndSelection(page);
    const storedBeforeClick = await getSelectionState(page);
    if (storedBeforeClick.highlightSegments <= beforeLeftCreate.highlightSegments) {
      throw new Error(`Expected the newly saved highlight to stay visible in product UI: ${JSON.stringify(storedBeforeClick)}`);
    }
    const storedQuality = await getStoredSegmentQuality(page);
    if (storedQuality.suspiciousTextMarkup.length > 0) {
      throw new Error(`Stored text markup contains oversized segments: ${JSON.stringify(storedQuality)}`);
    }

    const optionalAnnotationClicks = {
      highlight: await verifyOptionalAnnotationClick(
        page,
        "highlight",
        storedBeforeClick.highlightSegments,
        () => clickStoredAnnotationNearBox(page, "highlight", leftBox),
      ),
      underline: await verifyOptionalAnnotationClick(
        page,
        "underline",
        storedBeforeClick.underlineSegments,
        () => clickFirstStoredAnnotationType(page, "underline"),
      ),
      area: await verifyOptionalAnnotationClick(
        page,
        "area",
        storedBeforeClick.areaSegments,
        () => clickFirstStoredAnnotationType(page, "area"),
      ),
      pin: await verifyOptionalAnnotationClick(
        page,
        "pin",
        storedBeforeClick.pinSegments,
        () => clickFirstStoredAnnotationType(page, "pin"),
      ),
      text: await verifyOptionalAnnotationClick(
        page,
        "text",
        storedBeforeClick.textAnnotations,
        () => clickFirstVisibleSelector(page, "[data-pdf-text-annotation-content='true']"),
      ),
      ink: await verifyOptionalAnnotationClick(
        page,
        "ink",
        storedBeforeClick.inkSegments,
        () => clickFirstVisibleSelector(page, "[data-pdf-ink-annotation-segment='true'],[data-pdf-ink-annotation-content='true']"),
      ),
    };

    const result = {
      generatedAt: new Date().toISOString(),
      exePath,
      workspacePath,
      realPdfPath,
      pdfRelativePath,
      cdpPort,
      rightBox,
      leftSelectionState,
      leftCopyResult,
      leftHighlightResult,
      createdHighlightState,
      clickedCreatedHighlightState,
      rightCopyResult,
      rightSelectionState,
      exactMarkupResult,
      exactMarkupState,
      pointerSelectionResult,
      storedBeforeClick,
      storedQuality,
      optionalAnnotationClicks,
      productSessionWasSeeded,
      activeUrl: page.url(),
    };

    await writeFile(path.join(OUTPUT_DIR, "desktop-pdf-product-smoke.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(`[desktop-product-smoke] passed ${JSON.stringify({
      created: clickedCreatedHighlightState.menuText.slice(0, 120),
      right: rightSelectionState.menuText.slice(0, 120),
      storedSegments: storedBeforeClick.storedSegments,
      highlightSegments: storedBeforeClick.highlightSegments,
      underlineSegments: storedBeforeClick.underlineSegments,
      areaSegments: storedBeforeClick.areaSegments,
      optionalAnnotationClicks,
      suspiciousTextMarkup: storedQuality.suspiciousTextMarkup.length,
      activeUrl: page.url(),
    })}`);
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(OUTPUT_DIR, "desktop-pdf-product-smoke-failure.png"), fullPage: true }).catch(() => {});
      const diagnostics = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        text: (document.body?.innerText ?? "").slice(0, 4000),
        pdfPanes: Array.from(document.querySelectorAll("[data-testid^='pdf-pane-']")).map((element) => element.getAttribute("data-testid")),
        pages: Array.from(document.querySelectorAll("[data-page-number]")).slice(0, 20).map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            page: element.getAttribute("data-page-number"),
            ready: element.querySelector(".textLayer")?.getAttribute("data-pdf-text-layer-ready"),
            text: (element.querySelector(".textLayer")?.textContent ?? "").slice(0, 200),
            rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          };
        }),
      })).catch((diagnosticError) => ({ error: String(diagnosticError) }));
      await writeFile(path.join(OUTPUT_DIR, "desktop-pdf-product-smoke-diagnostics.json"), `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8").catch(() => {});
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (!child.killed) {
      child.kill();
    }
    await writeFile(path.join(OUTPUT_DIR, "desktop-pdf-product-smoke-process.log"), [
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
