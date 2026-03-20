import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const PORT = Number(process.env.LATTICE_BROWSER_REGRESSION_PORT ?? 3217);
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const OUTPUT_DIR = path.resolve(process.cwd(), "output", "playwright");

async function ensureOutputDir() {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

function startNextDevServer() {
  const nextBin = path.resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", "-H", HOST, "-p", String(PORT)], {
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

async function testPdfRegression(page) {
  await page.goto(`${BASE_URL}/diagnostics/pdf-regression`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("pdf-regression-ready").waitFor({ timeout: 120000 });
  await page.waitForFunction(() => {
    const visiblePage = Number(document.querySelector('[data-testid="pdf-right-state-visible-page"]')?.textContent ?? "0");
    return visiblePage >= 1;
  }, undefined, { timeout: 120000 });
  await expectText(page.getByTestId("pdf-right-state-visible-page"), "1", "Right pane initial visible page");

  const rightShell = await page.getByTestId("pdf-right-shell").boundingBox();
  const viewport = page.viewportSize();
  if (!rightShell || !viewport || rightShell.x + rightShell.width > viewport.width + 1) {
    throw new Error("Right PDF pane overflowed the viewport.");
  }

  await expectText(page.getByTestId("pdf-zoom-label-pdf-left-pane"), "120%", "Left pane initial zoom");
  await expectText(page.getByTestId("pdf-zoom-label-pdf-right-pane"), "120%", "Right pane initial zoom");

  await page.keyboard.press("Control+=");
  await expectText(page.getByTestId("pdf-zoom-label-pdf-left-pane"), "145%", "Left pane keyboard zoom");
  await expectText(page.getByTestId("pdf-zoom-label-pdf-right-pane"), "120%", "Right pane unchanged after left keyboard zoom");

  await page.getByTestId("pdf-pane-pdf-right-pane").hover();
  await page.keyboard.press("Control+=");
  await expectText(page.getByTestId("pdf-zoom-label-pdf-left-pane"), "145%", "Left pane remains stable after right hover keyboard zoom");
  await expectText(page.getByTestId("pdf-zoom-label-pdf-right-pane"), "145%", "Right pane keyboard zoom after hover");

  await page.getByTestId("scroll-right-to-page-4").click();
  await page.waitForTimeout(500);
  await waitForNumericTextAtLeast(page, "pdf-right-state-visible-page", 3, "Right pane visible page after scroll");

  await page.getByTestId("toggle-right-file").click();
  await expectText(page.getByTestId("right-file-indicator"), "right-fixture-b.pdf", "Right pane switched to fixture B");
  await page.getByTestId("toggle-right-file").click();
  await expectText(page.getByTestId("right-file-indicator"), "right-fixture-a.pdf", "Right pane switched back to fixture A");
  await expectText(page.getByTestId("pdf-zoom-label-pdf-right-pane"), "145%", "Right pane restored manual zoom after file switch");

  await page.getByTestId("pdf-fit-width-pdf-right-pane").click();
  await expectText(page.getByTestId("pdf-zoom-label-pdf-right-pane"), "适宽", "Right pane fit-width label");
}

async function testImageAnnotation(page) {
  await page.goto(`${BASE_URL}/diagnostics/image-annotation`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("image-annotation-ready").waitFor({ timeout: 120000 });
  await page.getByTestId("image-tldraw-toolbar").waitFor({ timeout: 120000 });
  await expectText(page.getByTestId("image-annotation-rerender-count"), "0", "Image annotation rerender count");

  await page.getByTestId("force-image-annotation-rerender").click();
  await expectText(page.getByTestId("image-annotation-rerender-count"), "1", "Image annotation rerender count after force rerender");

  const pageText = await page.textContent("body");
  if ((pageText ?? "").includes("Drawing tools unavailable")) {
    throw new Error("Image annotation diagnostics fell back to error mode.");
  }
}

async function testSelectionAi(page) {
  await page.goto(`${BASE_URL}/diagnostics/selection-ai`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("selection-ai-regression-ready").waitFor({ timeout: 120000 });

  await page.getByRole("button", { name: "发送到快速问答" }).click();
  await expectText(page.getByTestId("selection-ai-latest-origin"), "chat", "Selection AI chat origin");
  await expectText(page.getByTestId("selection-ai-evidence-count"), "0", "Selection AI chat evidence count");

  await page.getByTestId("reset-selection-ai-diagnostics").click();
  await page.getByRole("button", { name: "Agent" }).click();
  await page.getByRole("button", { name: "启动深度分析" }).click();
  await expectText(page.getByTestId("selection-ai-latest-origin"), "agent", "Selection AI agent origin");
  await expectText(page.getByTestId("selection-ai-evidence-count"), "1", "Selection AI agent evidence count");

  await page.getByTestId("reset-selection-ai-diagnostics").click();
  await page.getByRole("button", { name: "Plan" }).click();
  await page.getByRole("button", { name: "生成整理计划" }).click();
  await expectText(page.getByTestId("selection-ai-proposal-count"), "1", "Selection AI plan proposal count");
  await expectText(page.getByTestId("selection-ai-highlighted-proposal"), "selection-regression-proposal", "Selection AI plan highlighted proposal");
}

async function main() {
  await ensureOutputDir();

  const server = startNextDevServer();
  let browser;

  try {
    await waitForServer(`${BASE_URL}/diagnostics`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1720, height: 1080 } });

    try {
      await testPdfRegression(page);
      await testImageAnnotation(page);
      await testSelectionAi(page);
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
