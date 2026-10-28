// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import type { CloudPersistence } from "../cloud-persistence";

type Snapshot = { revision: number; outbox: string[] };
type PersistenceModule = { createCloudPersistence: (scope: string) => CloudPersistence<Snapshot> };

// Native IndexedDB transactions run in Chromium; only the page document is local fixture data.
describe("cloud persistence native IndexedDB cancellation", () => {
  let browser: Browser;
  let bundle: string;
  beforeAll(async () => {
    const result = await build({ entryPoints: ["src/lib/shared-library/cloud-persistence.ts"], bundle: true, write: false, format: "iife", globalName: "CloudPersistenceModule", platform: "browser", logLevel: "silent" });
    bundle = result.outputFiles[0].text;
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => { await browser?.close(); });
  async function page(): Promise<Page> {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route("http://cloud-persistence.test/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Local IndexedDB fixture</title>" }));
    await page.goto("http://cloud-persistence.test/");
    await page.addScriptTag({ content: bundle });
    return page;
  }

  it("rolls back snapshot and bytes together when aborted after the content write is queued", async () => {
    const tab = await page();
    try {
      const result = await tab.evaluate(async () => {
        const persistenceModule = (window as unknown as { CloudPersistenceModule: PersistenceModule }).CloudPersistenceModule;
        const persistence = persistenceModule.createCloudPersistence("cancel-active-transaction");
        const original = { kind: "text" as const, text: "original bytes", mimeType: "text/plain", updatedAt: "2026-10-27" };
        await persistence.commit({ revision: 1, outbox: [] }, [{ key: "original", content: original }], 0);
        const abort = new AbortController();
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, key) {
          const request = put.call(this, value, key);
          if (value && typeof value === "object" && "text" in value && value.text === "historical bytes") abort.abort();
          return request;
        };
        let error: string | undefined;
        try {
          await persistence.commit({ revision: 2, outbox: ["restore"] }, [{ key: "restored", content: { ...original, text: "historical bytes" } }], 1, abort.signal);
        } catch (cause) { error = (cause as Error).name; }
        finally { IDBObjectStore.prototype.put = put; }
        return { error, snapshot: await persistence.load(), original: await persistence.content("original"), restored: await persistence.content("restored") };
      });
      expect(result.error).toBe("AbortError");
      expect(result.snapshot).toEqual({ revision: 1, outbox: [] });
      expect(result.original).toMatchObject({ text: "original bytes" });
      expect(result.restored).toBeNull();
    } finally { await tab.context().close(); }
  });

  it("refuses an already cancelled commit without changing the persisted revision", async () => {
    const tab = await page();
    try {
      const result = await tab.evaluate(async () => {
        const persistence = (window as unknown as { CloudPersistenceModule: PersistenceModule }).CloudPersistenceModule.createCloudPersistence("cancel-before-transaction");
        await persistence.commit({ revision: 1, outbox: [] }, [], 0);
        const abort = new AbortController(); abort.abort();
        let error: string | undefined;
        try { await persistence.commit({ revision: 2, outbox: ["restore"] }, [], 1, abort.signal); }
        catch (cause) { error = (cause as Error).name; }
        return { error, snapshot: await persistence.load() };
      });
      expect(result).toEqual({ error: "AbortError", snapshot: { revision: 1, outbox: [] } });
    } finally { await tab.context().close(); }
  });

  it("retains a successful commit and permits later writes after its signal is cancelled", async () => {
    const tab = await page();
    try {
      const result = await tab.evaluate(async () => {
        const persistence = (window as unknown as { CloudPersistenceModule: PersistenceModule }).CloudPersistenceModule.createCloudPersistence("cancel-after-transaction");
        const abort = new AbortController();
        await persistence.commit({ revision: 1, outbox: ["restore"] }, [], 0, abort.signal);
        abort.abort();
        const committed = await persistence.load();
        await persistence.commit({ revision: 2, outbox: ["restore", "later-edit"] }, [], 1);
        return { committed, latest: await persistence.load() };
      });
      expect(result).toEqual({ committed: { revision: 1, outbox: ["restore"] }, latest: { revision: 2, outbox: ["restore", "later-edit"] } });
    } finally { await tab.context().close(); }
  });
});
