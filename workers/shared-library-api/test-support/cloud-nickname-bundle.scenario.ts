// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createProtocolServer, PROFILE_A, PROFILE_B, TEST_PASSWORD } from "./protocol-server";
import { SourceTestDirectory, SourceTestFile } from "@/lib/ai/__tests__/fixtures/source-workspace";
import { uploadLocalWorkspaceEntries } from "@/lib/shared-library/local-workspace-upload";
import { buildFileFingerprint } from "@/lib/file-identity";
import { getDefaultPdfItemFolderPath } from "@/lib/pdf-item";
import { CloudLibraryWorkspaceController, type CloudWorkspaceSnapshot } from "@/lib/shared-library/cloud-workspace";
import { ApiTransport } from "@/lib/shared-library/api-transport";
import { SupabaseAuthRepository } from "@/lib/shared-library/supabase-auth";
import type { SharedLibraryItemContent } from "@/lib/shared-library/content-store";
import type { CloudLibraryConnection } from "@/lib/shared-library/connection";

const baseUrl = process.env.CLOUD_LIBRARY_BROWSER_BASE_URL;
if (!baseUrl) throw new Error("CLOUD_LIBRARY_BROWSER_BASE_URL is required");

describe("PDF bundle and nickname across real cloud collaborators", () => {
  it("imports an isolated local PDF package, renders it in the shared production viewer, and saves a collaborator nickname", async () => {
    const server = await createProtocolServer({ allowedOrigins: [new URL(baseUrl).origin] });
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await context.newPage(); const errors: string[] = []; const failedResponses: string[] = [];
    page.on("response", response => { if (response.url().startsWith(server.apiUrl) && !response.ok()) void response.text().then(body => failedResponses.push(`${response.status()} ${response.url()}: ${body}`)); });
    page.on("requestfailed", request => { if (request.url().startsWith(server.apiUrl)) failedResponses.push(`FAILED ${request.method()} ${request.url()}: ${request.failure()?.errorText}`); });
    const evidence = resolve(".lattice-build/cloud-nickname-bundle-evidence-20261012"); await mkdir(evidence, { recursive: true });
    page.on("pageerror", error => errors.push(error.message));
    const connection: CloudLibraryConnection = { id: "bundle-fixture", name: "PDF bundle fixture", apiUrl: server.apiUrl, supabaseUrl: server.authUrl, publicKey: "sb_publishable_fixture", maxFileBytes: 20 * 1024 * 1024 };
    let uploader: CloudLibraryWorkspaceController | undefined;
    try {
      const auth = new SupabaseAuthRepository(connection);
      const sessionA = await auth.signIn({ email: "a@cloud.test", password: TEST_PASSWORD, deviceId: "bundle-uploader" });
      const sessionB = await auth.signIn({ email: "b@cloud.test", password: TEST_PASSWORD, deviceId: "bundle-reader" });
      let snapshot: CloudWorkspaceSnapshot | null = null; const content = new Map<string, SharedLibraryItemContent>();
      uploader = new CloudLibraryWorkspaceController(connection, PROFILE_A, { load: async () => snapshot, content: async key => content.get(key) ?? null, commit: async (value, entries = []) => { snapshot = structuredClone(value); for (const entry of entries) if (entry.content) content.set(entry.key, structuredClone(entry.content)); } }, new ApiTransport({ baseUrl: server.apiUrl, getAccessToken: async () => sessionA.accessToken }));
      await uploader.initialize(); const library = await uploader.createLibrary("PDF 协作 fixture"); await uploader.setDisplayName(library.id, "上传者甲");
      const invite = await uploader.invite(library.id, "b@cloud.test", "editor");
      const accepted = await fetch(`${server.apiUrl}/v1/invitations/accept`, { method: "POST", headers: { authorization: `Bearer ${sessionB.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ token: invite.token }) }); expect(accepted.ok).toBe(true);
      const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); pdf.addPage([612, 792]).drawText("ImportedBundleProof", { x: 60, y: 680, size: 18, font });
      const bytes = await pdf.save(); const file = new File([bytes as Uint8Array<ArrayBuffer>], "paper.pdf", { type: "application/pdf", lastModified: 12345 });
      const root = new SourceTestDirectory("fixture-workspace"); const papers = root.add(new SourceTestDirectory("papers"));
      const handle = papers.add(new SourceTestFile("paper.pdf", "")); handle.getFile = async () => file;
      const fingerprint = await buildFileFingerprint(handle as unknown as FileSystemFileHandle);
      const folderPath = getDefaultPdfItemFolderPath("papers/paper.pdf"); let children = root;
      for (const part of folderPath.split("/")) children = await children.getDirectoryHandle(part, { create: true });
      children.add(new SourceTestFile("manifest.json", JSON.stringify({ version: 4, itemId: "bundle-document", pdfPath: "papers/paper.pdf", itemFolderPath: folderPath, annotationIndexPath: null, fileFingerprint: fingerprint.fingerprint, versionFingerprint: fingerprint.versionFingerprint, knownPdfPaths: ["papers/paper.pdf"], createdAt: 1, updatedAt: 1 })));
      children.add(new SourceTestFile("summary.md", "# ImportedResearchChildProof\nThe PDF research notes travel with their parent."));
      const annotations = await (await root.getDirectoryHandle(".lattice")).getDirectoryHandle("annotations", { create: true });
      annotations.add(new SourceTestFile("bundle-document.json", JSON.stringify({ version: 3, documentId: "bundle-document", fileId: "bundle-document", fileType: "pdf", lastModified: 12345, annotations: [{ id: "local-highlight", author: "原本地作者", createdAt: 12345, target: { type: "pdf", page: 1, rects: [{ x1: 0.098, y1: 0.118, x2: 0.42, y2: 0.146 }] }, style: { type: "highlight", color: "#FFD400" }, content: "ImportedBundleProof", comment: "ImportedAnnotationCommentProof" }] })));
      const result = await uploadLocalWorkspaceEntries({ rootHandle: root.handle(), entries: [{ path: "papers/paper.pdf", kind: "file", handle: handle as unknown as FileSystemFileHandle }], controller: uploader, libraryId: library.id });
      expect(result.warnings).toEqual([]); expect(result.annotationsImported).toBe(1); await uploader.sync(); expect(uploader.getStatus().pending).toBe(0);
      const uploadedPdf = result.items.find(item => item.kind === "pdf")!;
      const remote = (await uploader.annotations(library.id, uploadedPdf.id))[0];
      expect(remote).toMatchObject({ versionId: uploadedPdf.currentVersionId, authorId: PROFILE_A, body: { authorDisplayName: "上传者甲", importedFromLocal: { author: "原本地作者" } } });
      await context.addInitScript(({ connection, session, libraryId }) => {
        localStorage.setItem("lattice-cloud-connections-v1", JSON.stringify([connection]));
        localStorage.setItem("lattice-cloud-active-connection-v1", connection.id);
        localStorage.setItem("lattice-cloud-device-v1", session.deviceId);
        localStorage.setItem(`cloud-session:${JSON.stringify([connection.id, connection.apiUrl, connection.supabaseUrl])}`, JSON.stringify(session));
        localStorage.setItem(`lattice-cloud-active-library-v1:${connection.id}:${session.userId}`, libraryId);
      }, { connection, session: sessionB, libraryId: library.id });
      await page.goto(new URL("/?source=cloud", baseUrl).href, { timeout: 120000 });
      await page.getByRole("button", { name: /^(跳过|Skip)$/ }).click();
      await page.getByRole("checkbox", { name: /^(Do not show this again|不再显示此提示)$/i }).check();
      await page.getByRole("button", { name: /^(Continue In Browser|继续使用网页版)$/i }).click();
      await page.getByRole("button", { name: "共享库管理", exact: true }).click();
      const management = page.getByRole("dialog", { name: "共享库管理" });
      await management.getByLabel("我的云库昵称").fill("协作者乙"); await management.getByRole("button", { name: "保存昵称", exact: true }).click();
      await expect.poll(async () => (await uploader!.members(library.id)).find(member => member.userId === PROFILE_B)?.displayName).toBe("协作者乙");
      await management.getByRole("button", { name: "关闭共享库管理" }).click();
      const pdfRow = page.locator(`[data-source-node-id="${uploadedPdf.id}"]`); await pdfRow.click();
      await page.locator(".textLayer span").filter({ hasText: "ImportedBundleProof" }).first().waitFor({ timeout: 120000 });
      await page.locator('[data-pdf-stored-annotation-segment="true"]').first().waitFor();
      await page.keyboard.press("Control+Shift+A");
      await page.locator("[data-annotation-author]").filter({ hasText: "上传者甲" }).first().waitFor();
      await page.getByText("ImportedAnnotationCommentProof", { exact: true }).first().waitFor();
      await page.getByText("1 related files", { exact: true }).first().waitFor();
      await page.getByRole("button", { name: /PDF Item.*paper\.pdf/i }).first().click();
      await page.getByRole("button", { name: "summary.md", exact: true }).waitFor();
      await page.screenshot({ path: resolve(evidence, "bundle-pdf-nickname.png") });
      await page.getByRole("button", { name: /^(Expand item children|展开条目子项)$/ }).first().click();
      const child = result.items.find(item => item.canonicalName === "summary.md")!; await page.locator(`[data-source-node-id="${child.id}"]`).click();
      await page.locator(".cm-content").filter({ hasText: "ImportedResearchChildProof" }).first().waitFor();
      await pdfRow.click();
      await page.getByRole("button", { name: /^(New note|新建笔记)$/i }).first().click();
      await page.locator(".cm-content").filter({ hasText: "# Untitled" }).first().waitFor();
      await expect.poll(async () => (await server.db.query<{ id: string }>("select id from public.items where library_id=$1 and canonical_name='Untitled.md' and metadata->>'parentItemId'=$2", [library.id, uploadedPdf.id])).rows.length, { timeout: 15000 }).toBe(1);
      await page.screenshot({ path: resolve(evidence, "bundle-research-child.png") });
      // A synthetic user-authorized FSA picker; all menu, target dialog and
      // upload code remains the actual production path, with no private files.
      await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const fixture = await root.getDirectoryHandle("right-click-fixture", { create: true });
        const handle = await fixture.getFileHandle("selected-note.md", { create: true });
        const writer = await handle.createWritable(); await writer.write("# RightClickUploadProof\nOnly this selected file should be uploaded."); await writer.close();
        const sibling = await fixture.getFileHandle("not-selected.md", { create: true }); const siblingWriter = await sibling.createWritable(); await siblingWriter.write("MUST NOT UPLOAD"); await siblingWriter.close();
        Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => fixture });
      });
      await page.getByTestId("desktop-commandbar-workspace").click();
      await page.getByTestId("desktop-commandbar-workspace-open-folder").click();
      await page.getByText("selected-note.md", { exact: true }).first().waitFor();
      await page.getByText("selected-note.md", { exact: true }).first().click({ button: "right" });
      await page.getByRole("button", { name: "上传到云端库…", exact: true }).click();
      const uploadDialog = page.getByRole("dialog", { name: "上传到云端库", exact: true }); await uploadDialog.waitFor();
      expect((await server.db.query("select id from public.items where library_id=$1 and canonical_name='selected-note.md'", [library.id])).rows.length).toBe(0);
      await uploadDialog.getByLabel("上传目标库").selectOption(library.id); await uploadDialog.getByLabel("上传目标文件夹").selectOption("");
      await uploadDialog.getByRole("button", { name: "上传", exact: true }).click();
      await uploadDialog.waitFor({ state: "detached" });
      await expect.poll(async () => (await server.db.query("select id from public.items where library_id=$1 and canonical_name='selected-note.md'", [library.id])).rows.length, { timeout: 15000 }).toBe(1);
      expect((await server.db.query("select id from public.items where library_id=$1 and canonical_name='not-selected.md'", [library.id])).rows).toEqual([]);
      await page.getByTestId("explorer-source-controls").getByRole("button", { name: "共享库", exact: true }).click();
      const uploadedNote = (await server.db.query<{ id: string }>("select id from public.items where library_id=$1 and canonical_name='selected-note.md'", [library.id])).rows[0];
      await page.locator(`[data-source-node-id="${uploadedNote.id}"]`).click();
      await page.locator(".cm-content").filter({ hasText: "RightClickUploadProof" }).first().waitFor();
      await page.screenshot({ path: resolve(evidence, "right-click-upload-read.png") });
      expect(await page.locator('[data-testid="cloud-library-workspace"]').count()).toBe(0);
      expect(errors).toEqual([]);
      await writeFile(resolve(evidence, "report.json"), JSON.stringify({ entry: page.url(), nicknameSaved: "协作者乙", annotationAuthor: remote.authorId, annotationNickname: remote.body.authorDisplayName, originalLocalAuthor: (remote.body.importedFromLocal as { author: string }).author, annotationVersion: remote.versionId, uploadedPdfVersion: uploadedPdf.currentVersionId, pdfRendered: true, highlightRendered: true, nestedResearchChildRendered: true, pdfItemPanelListsChildren: true, pdfItemPanelCreatesCloudNote: true, uiPath: "production main workbench", uploadPath: "synthetic local handle -> actual uploadLocalWorkspaceEntries -> real HTTP/PostgreSQL/RLS", rightClickUploadE2E: true, uploadDestinationConfirmed: true, unselectedSiblingNotUploaded: true, errors }, null, 2));
    } catch (error) { await page.getByRole("button", { name: "共享库管理", exact: true }).click({ timeout: 1000 }).catch(() => {}); await page.screenshot({ path: resolve(evidence, "failure.png") }); await writeFile(resolve(evidence, "failure.json"), JSON.stringify({ error: String(error), errors, failedResponses, body: await page.locator("body").innerText(), diagnostics: server.diagnostics }, null, 2)); throw error; }
    finally { uploader?.dispose(); await context.close(); await browser.close(); await server.close(); }
  }, 240000);
});
