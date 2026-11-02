import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

const repo = process.env.LATTICE_ACCEPTANCE_REPO || process.cwd();
const require = createRequire(path.join(repo, "package.json"));
const { chromium } = require("playwright");
const baseURL = new URL(process.env.LATTICE_ACCEPTANCE_URL || "http://127.0.0.1:3217").origin;
assert.ok(["http://127.0.0.1:3217", "http://localhost:3217"].includes(baseURL), "Only the existing loopback static server is permitted.");
const output = process.env.LATTICE_COEDIT_OUTPUT || path.join(os.tmpdir(), "lattice-cloud-coedit-acceptance");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: process.env.LATTICE_ACCEPTANCE_HEADLESS !== "0" });
const now = () => new Date().toISOString();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const libraryId = "a1111111-1111-4111-8111-111111111111";
const itemId = "b2222222-2222-4222-8222-222222222222";
const accounts = [
  { id: "c3333333-3333-4333-8333-333333333333", email: "owner@coedit.fixture.test", role: "owner", name: "Coedit owner" },
  { id: "d4444444-4444-4444-8444-444444444444", email: "editor@coedit.fixture.test", role: "editor", name: "Coedit editor" },
];
const initialText = "# Shared coedit fixture\n\nInitial content from the shared fixture.\n";
const textA = "# Shared coedit fixture\n\nOwner A committed revision two through the real editor.\n";
const textB = "# Shared coedit fixture\n\nEditor B committed revision three through the real editor.\n";
const ownerRaceText = "# Shared coedit fixture\n\nOwner A committed a newer revision while B has a draft.\n";
const editorDraft = "# Shared coedit fixture\n\nEditor B unsaved parallel content must never disappear.\n";
const library = { id: libraryId, name: "共同编辑验收库", slug: "coedit-fixture", ownerId: accounts[0].id, visibility: "private", createdAt: now(), updatedAt: now() };
const initialBlob = Buffer.from(initialText);
const versions = [{ id: "e5555555-5555-4555-8555-555555555555", itemId, versionNumber: 1, blobId: "coedit-initial-blob", contentHash: sha(initialBlob), manifest: { mimeType: "text/markdown", sizeBytes: initialBlob.length }, createdBy: accounts[0].id, createdAt: now() }];
const items = new Map([[itemId, { id: itemId, libraryId, title: "coedit.md", canonicalName: "coedit.md", kind: "markdown", metadata: {}, currentVersionId: versions[0].id, contentHash: versions[0].contentHash, status: "active", createdBy: accounts[0].id, createdAt: now(), updatedAt: now() }]]);
const blobs = new Map([["coedit-initial-blob", initialBlob]]);
const uploads = new Map();
let sequence = 1;
const changes = [{ sequence: "1", type: "item", value: structuredClone(items.get(itemId)) }];
const requests = [], unexpected = [], checks = [], errors = [], screenshots = [], pageErrors = [];
const actors = [];
function changed(item) { changes.push({ sequence: String(++sequence), type: "item", value: structuredClone(item) }); }
function check(label, value) { assert.ok(value, label); checks.push(label); console.log("PASS " + checks.length + ": " + label); }
async function poll(test, message, ms = 30000) { const until = Date.now() + ms; while (Date.now() < until) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(message); }
async function visible(locator) { return locator.isVisible().catch(() => false); }

async function actor(account) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", serviceWorkers: "block" });
  await context.routeWebSocket("**/*", socket => { unexpected.push({ actor: account.role, method: "WEBSOCKET", path: new URL(socket.url()).pathname }); socket.close(); });
  await context.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === baseURL) return route.continue();
    const apiPath = url.pathname.replace(/^\/functions\/v1\/shared-library-api(?=\/v1\/)/, "");
    requests.push({ actor: account.role, method: req.method(), path: apiPath });
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(data) });
    const data = value => json({ data: value });
    if (apiPath === "/auth/v1/token" && req.method() === "POST") {
      const credentials = req.postDataJSON();
      assert.equal(credentials.email, account.email);
      return json({ access_token: "fixture-access-" + account.role, refresh_token: "fixture-refresh-" + account.role, expires_in: 3600, user: { id: account.id } });
    }
    if (apiPath === "/auth/v1/logout") return json({});
    if (apiPath === "/v1/libraries") return data([library]);
    if (apiPath.endsWith("/members/me")) return data({ libraryId, userId: account.id, role: account.role, status: "active", displayName: account.name, joinedAt: now() });
    if (apiPath.endsWith("/members")) return data(accounts.map(value => ({ libraryId, userId: value.id, role: value.role, status: "active", displayName: value.name, joinedAt: now() })));
    if (apiPath.endsWith("/invitations")) return data([]);
    if (apiPath.endsWith("/changes")) return data({ changes: changes.filter(value => BigInt(value.sequence) > BigInt(url.searchParams.get("cursor") || "0")), cursor: String(sequence), hasMore: false });
    if (apiPath.endsWith("/annotations")) return data([]);
    if (apiPath.endsWith("/activity")) return data({ events: [], nextCursor: null, hasMore: false });
    if (apiPath.endsWith("/usage")) return data({ usedBytes: 0, reservedBytes: 0, maxStorageBytes: 1_000_000_000, maxFileBytes: 20_971_520 });
    if (apiPath.endsWith("/items") && req.method() === "POST") { const item = req.postDataJSON(); items.set(item.id, item); changed(item); return data(item); }
    const itemPath = /^\/v1\/items\/([^/]+)$/.exec(apiPath);
    if (itemPath && req.method() === "GET") return data(items.get(itemPath[1]));
    if (apiPath.endsWith("/versions")) {
      const target = apiPath.split("/items/")[1].split("/")[0];
      if (req.method() === "GET") return data(versions.filter(value => value.itemId === target));
      const input = req.postDataJSON(), item = items.get(target);
      if (input.baseVersionId !== (item.currentVersionId ?? null)) return json({ error: { code: "SYNC_CONFLICT", message: "合成远端版本已更新，请先处理冲突。", retryable: false } }, 409);
      const bytes = blobs.get(input.blobId);
      assert.ok(bytes, "Version must refer to uploaded bytes");
      assert.equal(input.contentHash, sha(bytes), "Version SHA256 must match bytes");
      const version = { ...input, itemId: target, versionNumber: versions.filter(value => value.itemId === target).length + 1, createdBy: account.id, createdAt: now() };
      versions.push(version);
      items.set(target, { ...item, currentVersionId: version.id, contentHash: version.contentHash, updatedAt: now() });
      changed(items.get(target));
      return json({ data: version }, 201);
    }
    if (apiPath.endsWith("/index-text")) return data({});
    if (apiPath.endsWith("/blobs/find")) {
      const match = [...blobs].find(([, bytes]) => sha(bytes) === url.searchParams.get("hash"));
      return data(match ? { blobId: match[0] } : {});
    }
    if (apiPath.endsWith("/uploads") && req.method() === "POST") { const uploadId = randomUUID(); uploads.set(uploadId, { parts: new Map(), input: req.postDataJSON() }); return data({ uploadId, libraryId, partSize: 5 * 1024 * 1024, expiresAt: new Date(Date.now() + 3600000).toISOString() }); }
    const part = /\/uploads\/([^/]+)\/parts\/(\d+)$/.exec(apiPath);
    if (part && req.method() === "PUT") { assert.ok(uploads.has(part[1])); uploads.get(part[1]).parts.set(Number(part[2]), req.postDataBuffer()); return data({ etag: "fixture-etag-" + part[2] }); }
    const complete = /\/uploads\/([^/]+)\/complete$/.exec(apiPath);
    if (complete) { const input = req.postDataJSON(), upload = uploads.get(complete[1]); assert.ok(upload); const bytes = Buffer.concat([...upload.parts].sort(([a], [b]) => a - b).map(([, bytes]) => bytes)); assert.equal(input.sha256, sha(bytes)); const blobId = "coedit-upload-" + complete[1]; blobs.set(blobId, bytes); return data({ blobId }); }
    const content = /\/blobs\/([^/]+)\/content$/.exec(apiPath);
    if (content) { const bytes = blobs.get(content[1]); assert.ok(bytes, "Requested blob must exist"); return route.fulfill({ status: 200, contentType: "text/markdown", headers: { "access-control-allow-origin": "*" }, body: bytes }); }
    unexpected.push({ actor: account.role, method: req.method(), path: apiPath });
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push({ actor: account.role, message: error.message }));
  const dialog = page.getByRole("dialog", { name: "共享库管理" });
  const value = { account, context, page, dialog, editor: null }; actors.push(value);
  await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 180000 });
  const skip = page.getByRole("button", { name: "跳过", exact: true });
  await skip.waitFor({ timeout: 3000 }).catch(() => {});
  if (await visible(skip)) await skip.click();
  await page.getByRole("button", { name: "共享库", exact: true }).first().click();
  await dialog.waitFor();
  await dialog.getByLabel("云库邮箱", { exact: true }).fill(account.email);
  await dialog.getByLabel("云库密码", { exact: true }).fill("Synthetic-Coedit-Password!");
  await dialog.getByRole("button", { name: "登录云库", exact: true }).click();
  await dialog.getByRole("button", { name: "成员与共享", exact: true }).waitFor({ timeout: 45000 });
  await dialog.getByRole("button", { name: "关闭共享库管理", exact: true }).click();
  const continueWeb = page.getByRole("button", { name: "继续使用网页版", exact: true });
  await continueWeb.waitFor({ timeout: 2000 }).catch(() => {});
  if (await visible(continueWeb)) { await page.getByRole("checkbox", { name: "不再显示此提示", exact: true }).check(); await continueWeb.click(); }
  await page.locator('[data-source-node-id="' + itemId + '"]').waitFor({ timeout: 45000 });
  await page.locator('[data-source-node-id="' + itemId + '"]').click();
  const editor = page.locator(".cm-content[contenteditable=true]").first();
  await editor.waitFor({ timeout: 90000 });
  await poll(async () => (await editor.innerText()).includes("Initial content from the shared fixture."), "Initial Markdown did not load for " + account.role);
  value.editor = editor;
  return value;
}
async function edit(value, text) {
  await value.editor.click();
  await value.editor.press("ControlOrMeta+A");
  await value.page.keyboard.insertText(text);
  await poll(async () => (await value.editor.innerText()).includes(text.split("\n")[2]), "Typed source not visible");
}
async function save(value, text) {
  const expected = sha(Buffer.from(text));
  await value.page.getByRole("button", { name: "保存", exact: true }).click();
  await poll(() => items.get(itemId).contentHash === expected, "Real save did not commit expected cloud version", 45000);
  await poll(async () => await visible(value.page.getByTestId("cloud-collaboration-toolbar").getByText("已同步", { exact: true })), "Saved version did not settle to synced");
}
async function screenshot(value, label) { const file = value.account.role + "-" + label + ".png"; await value.page.screenshot({ path: path.join(output, file) }); screenshots.push(file); }

let outcome;
try {
  const a = await actor(accounts[0]);
  const b = await actor(accounts[1]);
  check("两个真实UI会话分别登录owner与editor并打开同一Markdown文件", requests.some(value => value.actor === "owner" && value.path === "/auth/v1/token") && requests.some(value => value.actor === "editor" && value.path === "/auth/v1/token"));
  await edit(a, textA); await save(a, textA);
  check("owner通过真实编辑器保存并上传字节生成v2版本", versions.length === 2 && versions[1].createdBy === accounts[0].id && blobs.get(versions[1].blobId).toString() === textA);
  await b.page.reload({ waitUntil: "domcontentloaded" });
  const bEditor = b.page.locator(".cm-content[contenteditable=true]").first();
  await bEditor.waitFor({ timeout: 90000 });
  b.editor = bEditor;
  await poll(async () => (await b.editor.innerText()).includes("Owner A committed revision two"), "Editor B did not see owner update after real reload");
  check("editor刷新真实应用后读取owner提交的新内容", true); await screenshot(b, "owner-update-visible");
  await edit(b, textB); await save(b, textB);
  check("editor通过真实编辑器保存v3并保留作者信息", versions.length === 3 && versions[2].createdBy === accounts[1].id && blobs.get(versions[2].blobId).toString() === textB);
  await a.page.reload({ waitUntil: "domcontentloaded" });
  a.editor = a.page.locator(".cm-content[contenteditable=true]").first();
  await a.editor.waitFor({ timeout: 90000 });
  await poll(async () => (await a.editor.innerText()).includes("Editor B committed revision three"), "Owner A did not see editor update");
  check("owner刷新后读取editor的新版本", true);
  await a.page.getByRole("button", { name: "版本历史", exact: true }).click();
  const history = a.page.getByTestId("cloud-version-history");
  await history.getByRole("button", { name: /^v1 / }).click();
  await poll(async () => (await history.innerText()).includes("Initial content from the shared fixture."), "Historical v1 bytes not readable");
  check("真实版本历史读取v1原文并保留v2和v3作者版本", (await history.getByRole("list", { name: "版本历史" }).getByRole("button").count()) === 3);
  await screenshot(a, "immutable-history"); await history.getByRole("button", { name: "关闭历史", exact: true }).click();
  await edit(b, editorDraft);
  await edit(a, ownerRaceText); await save(a, ownerRaceText);
  await poll(async () => await visible(b.page.getByRole("button", { name: "加载最新版本", exact: true })), "Remote revision indicator missing while editor has a draft", 45000);
  check("存在并行草稿时远端更新按钮禁用并保留编辑内容", await b.page.getByRole("button", { name: "加载最新版本", exact: true }).isDisabled() && (await b.editor.innerText()).includes("Editor B unsaved parallel"));
  const versionCountBeforeStaleSave = versions.length;
  await b.page.getByRole("button", { name: "保存", exact: true }).click();
  await poll(async () => await visible(b.page.getByText(/当前文件版本已变化|远端.*变化|未能保存|保存失败|保存未完成|合成远端版本已更新/).first()) || await visible(b.page.getByTestId("cloud-collaboration-toolbar").getByText("同步有冲突", { exact: true })), "Stale save was rejected but no actionable product error or conflict state was displayed", 15000);
  if (!(await visible(b.page.getByTestId("cloud-collaboration-toolbar").getByText("同步有冲突", { exact: true })))) {
    check("旧基线保存明确提示失败且保留草稿与远端新内容", versions.length === versionCountBeforeStaleSave && items.get(itemId).contentHash === sha(Buffer.from(ownerRaceText)) && (await b.editor.innerText()).includes("Editor B unsaved parallel"));
    await screenshot(b, "parallel-stale-save-rejected");
    await b.context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await b.page.getByRole("button", { name: "复制草稿", exact: true }).click();
    await b.page.getByText("草稿已复制，编辑内容仍保留。", { exact: true }).waitFor();
    const copiedRawDraft = await b.page.evaluate(() => navigator.clipboard.readText());
    const copiedDraft = copiedRawDraft.replace(/\r\n/g, "\n");
    assert.equal(copiedDraft, editorDraft, "Copied synthetic source must match exactly after Windows clipboard line-ending normalization");
    check("保存拒绝后真实复制草稿按钮保留完整源码且不改远端", copiedDraft === editorDraft && items.get(itemId).contentHash === sha(Buffer.from(ownerRaceText)));
    await b.page.getByRole("button", { name: "再次保存", exact: true }).click();
    await poll(async () => !(await b.page.getByRole("button", { name: "再次保存", exact: true }).isDisabled()), "Retry did not settle");
    check("旧基线重试仍明确失败而不覆盖他人新版本", await visible(b.page.getByRole("alert").filter({ hasText: "保存未完成" })) && versions.length === versionCountBeforeStaleSave);
    await b.page.locator("[data-tab-id]").filter({ hasText: "coedit.md" }).getByRole("button", { name: "关闭", exact: true }).click();
    await b.page.getByRole("dialog", { name: "保存更改？", exact: true }).getByRole("button", { name: "不保存", exact: true }).click();
    await b.page.locator('[data-source-node-id="' + itemId + '"]').click();
    b.editor = b.page.locator(".cm-content[contenteditable=true]").first();
    await b.editor.waitFor();
    await poll(async () => (await b.editor.innerText()).includes("Owner A committed a newer revision"), "Reopened latest source unavailable");
    const merged = ownerRaceText + "\n" + copiedDraft;
    await edit(b, merged); await save(b, merged);
    check("复制后真实关闭不保存并重开合并生成新版本保留双方内容", blobs.get(versions.at(-1).blobId).toString() === merged && versions.at(-1).createdBy === accounts[1].id && !(await visible(b.page.getByRole("alert").filter({ hasText: "保存未完成" }))));
    await screenshot(b, "manual-merge-recovered");
  } else {
  check("旧基线保存进入冲突且没有覆盖远端内容", items.get(itemId).contentHash === sha(Buffer.from(ownerRaceText)) && (await b.editor.innerText()).includes("Editor B unsaved parallel"));
  await b.page.getByTestId("cloud-collaboration-toolbar").getByRole("button", { name: "同步有冲突", exact: true }).click();
  await b.dialog.waitFor();
  await b.dialog.locator("summary").filter({ hasText: "同步任务" }).click();
  check("冲突处理由真实UI提供保留远端与另存副本", await visible(b.dialog.getByRole("button", { name: "另存副本", exact: true })) && await visible(b.dialog.getByRole("button", { name: "采用远端", exact: true })));
  await screenshot(b, "parallel-draft-conflict-protected");
  }
  check("所有外部HTTP与WS均拦截且没有未知请求", unexpected.length === 0);
  check("没有浏览器运行时异常或框架overlay", pageErrors.length === 0 && !(await a.page.locator("nextjs-portal").count()) && !(await b.page.locator("nextjs-portal").count()));
  outcome = { ok: true };
} catch (error) {
  errors.push(error.stack || String(error));
  for (const value of actors) {
    await screenshot(value, "failure").catch(() => {});
    await writeFile(path.join(output, value.account.role + "-failure-dom.txt"), await value.page.locator("body").innerText()).catch(() => {});
  }
  outcome = { ok: false };
} finally {
  const report = { ...outcome, baseURL, viewport: { width: 1440, height: 900 }, browserPlugin: "Browser plugin not available; user-requested Playwright", realExternalCalls: 0, realOtpEmailSent: false, checks, errors, pageErrors, unexpected, versions: versions.map(({ id, versionNumber, contentHash, createdBy }) => ({ id, versionNumber, contentHash, createdBy })), requests, screenshots };
  await writeFile(path.join(output, "coedit-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, checks: checks.length, errors, unexpected, output }, null, 2));
  await browser.close();
  process.exitCode = report.ok ? 0 : 1;
}