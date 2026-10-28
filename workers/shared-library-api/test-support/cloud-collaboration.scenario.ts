// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createProtocolServer, PROFILE_A, PROFILE_B, TEST_PASSWORD } from "./protocol-server";
import { CloudLibraryWorkspaceController, type CloudWorkspaceSnapshot } from "@/lib/shared-library/cloud-workspace";
import { SupabaseAuthRepository } from "@/lib/shared-library/supabase-auth";
import { ApiTransport } from "@/lib/shared-library/api-transport";
import type { SharedLibraryItemContent } from "@/lib/shared-library/content-store";
import { fromLegacyAnnotation } from "@/lib/shared-library/annotation-adapter";

const baseUrl = process.env.CLOUD_LIBRARY_BROWSER_BASE_URL;
if (!baseUrl) throw new Error("CLOUD_LIBRARY_BROWSER_BASE_URL is required; this scenario uses isolated test services only.");

describe("cloud collaboration in the local workbench", () => {
  it("shows two authors, restores immutable history, filters PDF authors, shares members and prepares a scoped AI draft", async () => {
    const server = await createProtocolServer({ allowedOrigins: [new URL(baseUrl).origin] });
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await context.newPage();
    const evidence = process.env.LATTICE_CLOUD_COLLAB_EVIDENCE ?? resolve(tmpdir(), "lattice-cloud-collaboration-20261027");
    await mkdir(evidence, { recursive: true });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error" && !/favicon|act\(/.test(message.text()) && !message.location().url.includes('/ai/providers')) errors.push(message.text()); });
    const controllers: CloudLibraryWorkspaceController[] = [];
    const connection = { id: "collaboration-ui-fixture", name: "协作验收", apiUrl: server.apiUrl, supabaseUrl: server.authUrl, publicKey: "sb_publishable_fixture", maxFileBytes: 20 * 1024 * 1024 };
    async function profile(email: string) {
      const session = await new SupabaseAuthRepository(connection).signIn({ email, password: TEST_PASSWORD, deviceId: randomUUID() });
      let snapshot: CloudWorkspaceSnapshot | null = null; const contents = new Map<string, SharedLibraryItemContent>();
      const controller = new CloudLibraryWorkspaceController(connection, session.userId, {
        load: async () => structuredClone(snapshot), content: async key => structuredClone(contents.get(key) ?? null),
        commit: async (value, entries = []) => { snapshot = structuredClone(value); for (const entry of entries) if (entry.content) contents.set(entry.key, structuredClone(entry.content)); else contents.delete(entry.key); },
      }, new ApiTransport({ baseUrl: server.apiUrl, getAccessToken: async () => session.accessToken }));
      await controller.initialize(); controllers.push(controller); return { session, controller };
    }
    try {
      const a = await profile("a@cloud.test"); const b = await profile("b@cloud.test");
      const library = await a.controller.createLibrary("云端共创验收");
      await a.controller.setDisplayName(library.id, "林同学");
      const invitation = await a.controller.invite(library.id, "b@cloud.test", "editor");
      await b.controller.acceptInvite(invitation.token); await b.controller.refreshLibrary(library.id); await b.controller.setDisplayName(library.id, "周同学");
      const note = await a.controller.createItem({ libraryId: library.id, name: "共创笔记.md", kind: "markdown" }, { kind: "text", text: "# Shared note\nOriginal by Lin", mimeType: "text/markdown", updatedAt: new Date().toISOString() });
      const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
      pdf.addPage([612, 792]).drawText("Cloud collaboration reading proof", { x: 60, y: 680, size: 18, font });
      const paper = await a.controller.createItem({ libraryId: library.id, name: "协作阅读.pdf", kind: "pdf" }, { kind: "binary", data: (await pdf.save()).buffer as ArrayBuffer, mimeType: "application/pdf", updatedAt: new Date().toISOString() });
      await a.controller.sync(); await b.controller.refreshLibrary(library.id);
      await b.controller.save(library.id, note.id, { kind: "text", text: "# Shared note\nUpdated by Zhou", mimeType: "text/markdown", updatedAt: new Date().toISOString() }, note.currentVersionId);
      await b.controller.sync();
      const annotation = (author: string, id: string, y: number) => fromLegacyAnnotation({ id, author, createdAt: Date.now(), content: "Cloud collaboration reading proof", comment: author === PROFILE_A ? "Lin annotation" : "Zhou annotation", target: { type: "pdf", page: 1, rects: [{ x1: .1, y1: y, x2: .55, y2: y + .025 }] }, style: { type: "highlight", color: "#FFD400" } }, { itemId: paper.id, versionId: paper.currentVersionId! });
      const annotationA = randomUUID(); const annotationB = randomUUID();
      await a.controller.persistAnnotations(library.id, paper.id, [annotation(PROFILE_A, annotationA, .12)], []); await a.controller.sync();
      await b.controller.persistAnnotations(library.id, paper.id, [annotation(PROFILE_B, annotationB, .18)], []); await b.controller.sync();
      await context.addInitScript(({ connection, session, libraryId }) => {
        localStorage.setItem("lattice-download-dismissed", "true");
        localStorage.setItem("lattice-cloud-connections-v1", JSON.stringify([connection]));
        localStorage.setItem("lattice-cloud-active-connection-v1", connection.id);
        localStorage.setItem("lattice-cloud-device-v1", session.deviceId);
        localStorage.setItem(`cloud-session:${JSON.stringify([connection.id, connection.apiUrl, connection.supabaseUrl])}`, JSON.stringify(session));
        localStorage.setItem(`lattice-cloud-active-library-v1:${connection.id}:${session.userId}`, libraryId);
      }, { connection, session: b.session, libraryId: library.id });
      await page.goto(new URL(`/?source=cloud&library=${library.id}&item=${note.id}`, baseUrl).href, { timeout: 120000 });
      for (const name of [/^(跳过|Skip)$/, /^(Continue In Browser|继续使用网页版)$/i]) {
        const button = page.getByRole("button", { name });
        try { await button.waitFor({ state: "visible", timeout: 5000 }); await button.click(); } catch { /* The preference may already dismiss onboarding. */ }
      }
      const toolbar = page.getByTestId("cloud-collaboration-toolbar"); await toolbar.waitFor({ timeout: 120000 });
      await page.locator(".cm-content").filter({ hasText: "Updated by Zhou" }).first().waitFor();
      await toolbar.getByRole("button", { name: "版本历史", exact: true }).click();
      const history = page.getByTestId("cloud-version-history");
      await history.getByRole("button", { name: /v1.*林同学/ }).click();
      await history.getByText(/Original by Lin/).waitFor();
      expect(await history.getByRole("button", { name: /v2.*周同学/ }).count()).toBe(1);
      await history.getByRole("button", { name: "与当前版本比较", exact: true }).click();
      await history.getByTestId("cloud-history-diff").getByText(/Updated by Zhou/).waitFor();
      await page.screenshot({ path: resolve(evidence, "version-history.png"), fullPage: false });
      await history.getByRole("button", { name: "恢复此版本", exact: true }).click();
      await history.getByRole("button", { name: "恢复为新版本", exact: true }).click();
      await expect.poll(async () => (await b.controller.listVersions(library.id, note.id)).length).toBe(3);
      const restored = (await b.controller.listVersions(library.id, note.id))[0];
      expect(restored.createdBy).toBe(PROFILE_B); expect(restored.manifest.restoredFromVersionId).toBe(note.currentVersionId);
      await page.locator(".cm-content").filter({ hasText: "Original by Lin" }).first().waitFor();
      await history.waitFor({ state: "hidden" });
      await toolbar.getByRole("button", { name: "共享与成员", exact: true }).click();
      const management = page.getByRole("dialog", { name: "共享库管理" });
      await management.getByTestId("member-management").waitFor();
      expect(await management.getByText("林同学", { exact: true }).count()).toBeGreaterThan(0);
      await management.getByRole('button', { name: '团队 AI', exact: true }).click();
      await management.getByText(/管理员尚未配置团队 AI/).waitFor();
      expect(await management.getByRole('button', { name: '发送给团队 AI', exact: true }).isDisabled()).toBe(true);
      await management.getByRole('button', { name: 'GitHub 仓库', exact: true }).click();
      await management.getByText(/尚未配置 GitHub App/).waitFor();
      await management.getByRole('button', { name: '协作记录', exact: true }).click();
      await management.getByTestId('cloud-activity-event').first().waitFor();
      await management.getByTestId('cloud-activity-event').first().getByText('周同学', { exact: true }).waitFor();
      await page.screenshot({ path: resolve(evidence, 'cloud-activity.png'), fullPage: false });
      await management.getByRole('button', { name: '关闭活动记录' }).click();
      await management.getByRole("button", { name: "关闭共享库管理" }).click();
      await page.locator(`[data-source-node-id="${paper.id}"]`).click();
      await page.locator(".textLayer span").filter({ hasText: "Cloud collaboration reading proof" }).first().waitFor({ timeout: 120000 });
      const segment = (id: string) => page.locator(`[data-pdf-stored-annotation-id="${id}"][data-pdf-stored-annotation-segment="true"]`);
      await segment(annotationA).first().waitFor(); await segment(annotationB).first().waitFor();
      await page.locator("summary").filter({ hasText: "批注显示" }).click();
      const mode = page.getByLabel("批注范围", { exact: true });
      await mode.selectOption("mine");
      await expect.poll(() => segment(annotationA).count()).toBe(0); expect(await segment(annotationB).count()).toBeGreaterThan(0);
      await mode.selectOption("others");
      await expect.poll(() => segment(annotationB).count()).toBe(0); expect(await segment(annotationA).count()).toBeGreaterThan(0);
      await mode.selectOption("hidden");
      await expect.poll(() => page.locator('[data-pdf-stored-annotation-segment="true"]').count()).toBe(0);
      expect((await b.controller.annotations(library.id, paper.id)).length).toBe(2);
      await page.screenshot({ path: resolve(evidence, "pdf-annotations-hidden.png"), fullPage: false });
      await mode.selectOption("all"); await page.getByRole("checkbox", { name: "林同学", exact: true }).uncheck();
      await expect.poll(() => segment(annotationA).count()).toBe(0); expect(await segment(annotationB).count()).toBeGreaterThan(0);
      await page.getByRole("checkbox", { name: "林同学", exact: true }).check();
      await page.locator("summary").filter({ hasText: "批注显示" }).click();
      await page.screenshot({ path: resolve(evidence, "pdf-collaboration.png"), fullPage: false });
      await toolbar.getByRole("button", { name: "云端 AI", exact: true }).click();
      await page.getByTestId("ai-cloud-source-selection").getByText("协作阅读.pdf", { exact: true }).waitFor();
      const question = page.locator("textarea:visible").last();
      await expect.poll(() => question.inputValue()).toBe("");
      await question.fill("请总结这份云端 PDF 的要点。");
      expect(await question.inputValue()).toBe("请总结这份云端 PDF 的要点。");
      expect((await b.controller.annotations(library.id, paper.id)).length).toBe(2);
      await page.setViewportSize({ width: 900, height: 760 });
      await page.screenshot({ path: resolve(evidence, "cloud-ai-narrow.png"), fullPage: false });
      expect(errors).toEqual([]);
      await writeFile(resolve(evidence, "result.json"), JSON.stringify({ pageUrl: page.url(), pageTitle: await page.title(), twoAuthors: true, restoredVersion: restored.versionNumber, originalVersionsPreserved: true, annotationVisibility: ["mine", "others", "hidden", "member"], sharing: true, aiDraftOnly: true, teamAiFailsClosed: true, githubFailsClosed: true, immutableActivityVisible: true, viewports: [1440, 900], errors }, null, 2));
    } catch (error) {
      await page.screenshot({ path: resolve(evidence, "failure.png"), fullPage: false, timeout: 10000 }).catch(() => {});
      await writeFile(resolve(evidence, "failure.txt"), `${String(error)}\n${(await page.locator("body").innerText()).slice(0, 16000)}\n${errors.join("\n")}`);
      throw error;
    } finally { controllers.forEach(controller => controller.dispose()); await context.close(); await browser.close(); await server.close(); }
  }, 240000);
});
