// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createProtocolServer, TEST_PASSWORD } from "./protocol-server";

const baseUrl = process.env.CLOUD_LIBRARY_BROWSER_BASE_URL;
if (!baseUrl) throw new Error("CLOUD_LIBRARY_BROWSER_BASE_URL is required; this scenario never contacts production.");

describe("cloud folders in the production workbench", () => {
  it("opens nested uploaded files with real readers and keeps the viewport and tab state usable", async () => {
    const server = await createProtocolServer({ allowedOrigins: [new URL(baseUrl).origin] });
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const evidence = resolve(".lattice-build/cloud-folder-evidence-20261012");
    await mkdir(evidence, { recursive: true });
    const errors: string[] = [];
    const apiFailures: Array<{ url: string; status: number; body: string }> = [];
    page.on("response", response => { if (response.url().startsWith(server.apiUrl) && !response.ok()) void response.text().then(body => apiFailures.push({ url: response.url(), status: response.status(), body })); });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text()); });
    const rendered: string[] = [];
    let downloadedBlobs = 0;
    page.on("response", response => { if (response.ok() && response.url().startsWith(server.apiUrl) && /\/blobs\/[^/]+\/content$/.test(response.url())) downloadedBlobs++; });
    try {
      await page.goto(new URL("/", baseUrl).href, { timeout: 120000 });
      await page.getByRole("button", { name: /^(跳过|Skip)$/ }).click({ timeout: 30000 });
      await page.getByRole("checkbox", { name: /^(Do not show this again|不再显示此提示)$/i }).check({ timeout: 30000 });
      await page.getByRole("button", { name: /^(Continue In Browser|继续使用网页版)$/i }).click();
      await page.getByRole("button", { name: /^(共享库|Shared library)$/ }).first().click();
      const cloud = page;
      const management = page.getByRole("dialog", { name: "共享库管理", exact: true });
      await cloud.getByRole("button", { name: "高级连接设置", exact: true }).click();
      await cloud.getByLabel("连接名称", { exact: true }).fill("Folder fixture");
      await cloud.getByLabel("Worker API URL", { exact: true }).fill(server.apiUrl);
      await cloud.getByLabel("Supabase 项目 URL", { exact: true }).fill(server.authUrl);
      await cloud.getByLabel("Supabase 公开 key", { exact: true }).fill("sb_publishable_fixture");
      await cloud.getByRole("button", { name: "保存连接", exact: true }).click();
      await cloud.getByLabel("云库邮箱", { exact: true }).fill("a@cloud.test");
      await cloud.getByLabel("云库密码", { exact: true }).fill(TEST_PASSWORD);
      await cloud.getByRole("button", { name: "登录云库", exact: true }).click();
      await management.getByRole("button", { name: "新建库", exact: true }).click();
      await cloud.getByLabel("新建名称", { exact: true }).fill("真实目录与查看器");
      await cloud.getByRole("button", { name: "创建", exact: true }).click();
      await management.getByRole("button", { name: "关闭共享库管理" }).click();
      const row = (name: string) => page.locator("[data-source-node-id]").filter({ has: page.locator("span").getByText(name, { exact: true }) });
      const createFolder = async (name: string) => {
        await page.getByTitle(/^(New folder|新建文件夹)$/i, { exact: true }).click();
        const folder = row("New Folder"); await folder.click(); await folder.press("F2");
        const input = page.locator("[data-explorer-rename-input]"); await input.fill(name); await input.press("Enter");
        await row(name).waitFor();
      };
      await createFolder("实验");
      await createFolder("测量");
      expect(await row("实验").getAttribute("aria-expanded")).toBe("true");
      const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
      pdf.addPage([612, 792]).drawText("CloudFolderPdfProof", { x: 40, y: 650, size: 16, font });
      const docx = new JSZip();
      docx.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
      docx.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
      docx.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>CloudFolderWordProof</w:t></w:r></w:p></w:body></w:document>');
      const fixtures = [
        { name: "notes.md", mimeType: "", buffer: Buffer.from("# CloudFolderMarkdownProof\nNested note\n\n![Cloud relative figure](./image.png)\n") },
        { name: "script.jl", mimeType: "", buffer: Buffer.from('println("CloudFolderJuliaProof")') },
        { name: "preview.html", mimeType: "application/octet-stream", buffer: Buffer.from('<!doctype html><html><body><h1>CloudFolderHtmlProof</h1><img src="./image.png" alt="HTML relative figure"></body></html>') },
        { name: "paper.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) },
        { name: "report.docx", mimeType: "application/octet-stream", buffer: await docx.generateAsync({ type: "nodebuffer" }) },
        { name: "image.png", mimeType: "", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64") },
        { name: "notebook.ipynb", mimeType: "", buffer: Buffer.from(JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ id: "proof", cell_type: "markdown", metadata: {}, source: ["# CloudFolderNotebookProof"] }] })) },
        { name: "raw.custom", mimeType: "application/octet-stream", buffer: Buffer.from([0, 255, 17, 33]) },
      ];
      await cloud.getByLabel("上传文件选择", { exact: true }).setInputFiles(fixtures);
      await row("raw.custom").waitFor({ timeout: 30000 });
      await page.waitForFunction(() => document.querySelector('[data-testid="cloud-sync-status"]')?.textContent?.includes("已同步"));
      // Drop only this isolated profile's cached blob bytes, so every reader
      // below proves real HTTP downloads rather than the uploader's local data.
      await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open("lattice-cloud-library-v1", 1); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction("records", "readwrite"); const store = transaction.objectStore("records");
          const cursor = store.openCursor(); cursor.onsuccess = () => { const value = cursor.result; if (!value) return; if (String(value.key).includes("content:cache:")) value.delete(); value.continue(); };
          transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
        }); db.close();
      });
      await page.reload();
      await row("实验").click();
      await row("测量").click();
      const viewer = page.locator('[data-testid^="pane-wrapper-"]').first();
      const tab = (name: string) => page.locator("[data-tab-id]").filter({ has: page.getByText(name, { exact: true }) });
      const open = async (name: string) => { await row(name).click(); await tab(name).waitFor(); };
      await open("notes.md"); await viewer.locator(".cm-content").filter({ hasText: "CloudFolderMarkdownProof" }).waitFor({ timeout: 120000 }); rendered.push("markdown");
      await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('[data-testid^="pane-wrapper-"] img')].some(img => img.complete && img.naturalWidth > 0 && img.src.startsWith('blob:')));
      await open("script.jl"); await viewer.locator(".cm-content").filter({ hasText: "CloudFolderJuliaProof" }).waitFor({ timeout: 120000 }); rendered.push("code");
      await open("preview.html"); await page.locator('iframe[title="preview.html"].opacity-100').contentFrame().getByText("CloudFolderHtmlProof").waitFor({ timeout: 120000 }); rendered.push("html");
      await page.locator('iframe[title="preview.html"].opacity-100').contentFrame().getByRole('img', { name: 'HTML relative figure' }).evaluate((img: HTMLImageElement) => new Promise<void>((resolve, reject) => { if (img.complete) { if (img.naturalWidth) resolve(); else reject(new Error('cloud asset not loaded')); } else { img.onload = () => resolve(); img.onerror = () => reject(new Error('cloud asset failed')); } }));
      await open("report.docx"); await viewer.getByText("CloudFolderWordProof", { exact: true }).first().waitFor({ timeout: 120000 }); rendered.push("word");
      await open("image.png"); await viewer.getByRole("img", { name: "image.png", exact: true }).waitFor({ timeout: 120000 }); rendered.push("image");
      await open("notebook.ipynb"); await viewer.getByText("CloudFolderNotebookProof", { exact: true }).first().waitFor({ timeout: 120000 }); rendered.push("notebook");
      await open("paper.pdf"); await viewer.locator(".textLayer span").filter({ hasText: "CloudFolderPdfProof" }).first().waitFor({ timeout: 120000 }); rendered.push("pdf");
      const bounds = await viewer.boundingBox(); expect(bounds?.height).toBeGreaterThan(300); expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(1001);
      await page.screenshot({ path: resolve(evidence, "production-pdf-tree.png") });
      await tab("notes.md").click();
      const editor = viewer.locator('.cm-content[contenteditable="true"]').filter({ hasText: "CloudFolderMarkdownProof" });
      await editor.click(); await editor.press("Control+End"); await editor.press("Enter"); await editor.pressSequentially("UnsavedCloudDraftProof");
      expect(await editor.innerText()).toContain("UnsavedCloudDraftProof");
      await page.screenshot({ path: resolve(evidence, "draft-before-switch.png") });
      await tab("paper.pdf").click();
      await viewer.locator(".textLayer span").filter({ hasText: "CloudFolderPdfProof" }).first().waitFor();
      await tab("notes.md").click(); expect(await editor.innerText()).toContain("UnsavedCloudDraftProof");
      await open("raw.custom"); const downloadPromise = page.waitForEvent("download"); await viewer.getByRole("button", { name: "下载原文件", exact: true }).click();
      const download = await downloadPromise; await download.saveAs(resolve(evidence, "raw.custom")); expect(await readFile(resolve(evidence, "raw.custom"))).toEqual(fixtures.at(-1)!.buffer);
      await row("实验").click(); expect(await row("paper.pdf").count()).toBe(0);
      await row("实验").click(); await row("paper.pdf").waitFor();
      await tab("paper.pdf").click();
      await viewer.locator(".textLayer span").filter({ hasText: "CloudFolderPdfProof" }).first().waitFor();
      await page.setViewportSize({ width: 900, height: 800 }); await viewer.locator(".textLayer span").filter({ hasText: "CloudFolderPdfProof" }).first().waitFor();
      await tab("notes.md").click();
      expect(await viewer.locator('.cm-content[contenteditable="true"]').filter({ hasText: "CloudFolderMarkdownProof" }).innerText()).toContain("UnsavedCloudDraftProof");
      await page.keyboard.press("Control+s");
      await page.waitForFunction(() => ![...document.querySelectorAll('[data-tab-id]')].find(node => node.textContent?.includes('notes.md'))?.querySelector('[title="Unsaved changes"], [title="未保存的更改"]'));
      await page.waitForFunction(() => document.querySelector('[data-testid="cloud-sync-status"]')?.textContent?.includes("已同步"));
      await tab("paper.pdf").click();
      await viewer.locator(".textLayer span").filter({ hasText: "CloudFolderPdfProof" }).first().waitFor();
      await page.screenshot({ path: resolve(evidence, "production-narrow.png") });
      await page.reload();
      await tab("notes.md").waitFor({ timeout: 30000 }); await tab("notes.md").click();
      await viewer.locator('.cm-content').filter({ hasText: "UnsavedCloudDraftProof" }).waitFor({ timeout: 30000 });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await viewer.getByTitle(/^(Split Right|Split right|向右分栏)$/).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid^="pane-wrapper-"]').length === 2);
      await row("实验").click(); await row("测量").click(); await row("paper.pdf").click();
      await page.locator('[data-testid^="pane-wrapper-"]').nth(1).locator('.textLayer span').filter({ hasText: "CloudFolderPdfProof" }).first().waitFor({ timeout: 30000 });
      expect(await viewer.locator('.cm-content').filter({ hasText: "UnsavedCloudDraftProof" }).count()).toBeGreaterThan(0);
      await page.screenshot({ path: resolve(evidence, "production-split.png") });
      expect(await page.locator("nextjs-portal").innerText().catch(() => "")).not.toContain("Runtime Error");
      expect(errors).toEqual([]);
      expect(downloadedBlobs).toBeGreaterThanOrEqual(8);
      expect(await page.getByTestId("cloud-library-workspace").count()).toBe(0);
      expect(await page.locator("[data-explorer-source]").count()).toBe(1);
      expect(await page.locator("[data-tab-id]").count()).toBe(9);
      await writeFile(resolve(evidence, "report.json"), JSON.stringify({ entry: page.url(), title: await page.title(), rendered, downloadedBlobs, nestedTree: true, draftRetained: true, savedAndRestored: true, sharedPaneSplitting: true, downloadBytes: true, viewport: bounds, errors }, null, 2));
    } catch (error) {
      await page.screenshot({ path: resolve(evidence, "failure.png") });
      await writeFile(resolve(evidence, "failure.json"), JSON.stringify({ error: String(error), rendered, errors, apiFailures, body: await page.locator("body").innerText(), diagnostics: server.diagnostics }, null, 2));
      throw error;
    } finally { await context.close(); await browser.close(); await server.close(); }
  }, 300000);
});
