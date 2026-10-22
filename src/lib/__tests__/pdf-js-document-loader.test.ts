import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPdfJsDocument } from "@/lib/pdf-js-document-loader";

const pdfJsMock = vi.hoisted(() => {
  const workers: Array<{ destroyed: boolean; destroy: ReturnType<typeof vi.fn> }> = [];
  const state = {
    nextDocumentResult: "resolve" as "resolve" | "reject",
    loadingTaskDestroy: vi.fn(async (): Promise<void> => undefined),
  };

  return {
    workers,
    state,
    GlobalWorkerOptions: { workerSrc: "" },
    PDFWorker: {
      create: vi.fn(() => {
        const worker = {
          destroyed: false,
          destroy: vi.fn(() => {
            worker.destroyed = true;
          }),
        };
        workers.push(worker);
        return worker;
      }),
    },
    getDocument: vi.fn(() => {
      const document = {
        destroy: vi.fn(async () => state.loadingTaskDestroy()),
      };
      const promise = state.nextDocumentResult === "resolve"
        ? Promise.resolve(document)
        : Promise.reject(new Error("synthetic PDF parse failure"));
      return {
        promise,
        destroy: state.loadingTaskDestroy,
        onProgress: undefined,
      };
    }),
  };
});

vi.mock("pdfjs-dist/build/pdf.mjs", () => pdfJsMock);

describe("pdf-js-document-loader worker ownership", () => {
  beforeEach(() => {
    pdfJsMock.state.nextDocumentResult = "resolve";
    pdfJsMock.state.loadingTaskDestroy.mockReset().mockResolvedValue(undefined);
    pdfJsMock.workers.length = 0;
  });

  it("destroys an explicitly-created worker with the document and is idempotent", async () => {
    const document = await loadPdfJsDocument({
      data: new ArrayBuffer(8),
      label: "worker-ownership-success",
    });
    const worker = pdfJsMock.workers[0];

    expect(worker.destroyed).toBe(false);
    expect(pdfJsMock.PDFWorker.create).toHaveBeenLastCalledWith({ name: "worker-ownership-success" });
    const firstDestroy = document.destroy();
    const secondDestroy = document.destroy();
    expect(firstDestroy).toBe(secondDestroy);
    await Promise.all([firstDestroy, secondDestroy]);

    expect(pdfJsMock.state.loadingTaskDestroy).toHaveBeenCalledTimes(1);
    expect(worker.destroy).toHaveBeenCalledTimes(1);
    expect(worker.destroyed).toBe(true);
  });

  it("cleans up the worker when document loading fails", async () => {
    pdfJsMock.state.nextDocumentResult = "reject";

    await expect(loadPdfJsDocument({
      data: new ArrayBuffer(8),
      label: "worker-ownership-failure",
    })).rejects.toThrow("synthetic PDF parse failure");

    const worker = pdfJsMock.workers[0];
    expect(pdfJsMock.state.loadingTaskDestroy).toHaveBeenCalledTimes(1);
    expect(worker.destroy).toHaveBeenCalledTimes(1);
    expect(worker.destroyed).toBe(true);
  });

  it("waits for document transport teardown before terminating its worker", async () => {
    let finishDestroy!: () => void;
    pdfJsMock.state.loadingTaskDestroy.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishDestroy = resolve;
    }));
    const document = await loadPdfJsDocument({ data: new ArrayBuffer(8), label: "worker-ownership-order" });
    const worker = pdfJsMock.workers[0];

    const destroyed = document.destroy();
    expect(worker.destroyed).toBe(false);
    finishDestroy();
    await destroyed;

    expect(worker.destroyed).toBe(true);
  });

  it("terminates the worker even if document transport teardown fails", async () => {
    const failure = new Error("synthetic document teardown failure");
    pdfJsMock.state.loadingTaskDestroy.mockRejectedValueOnce(failure);
    const document = await loadPdfJsDocument({ data: new ArrayBuffer(8), label: "worker-ownership-teardown-error" });

    await expect(document.destroy()).rejects.toBe(failure);
    expect(pdfJsMock.workers[0].destroyed).toBe(true);
    await expect(document.destroy()).rejects.toBe(failure);
    expect(pdfJsMock.state.loadingTaskDestroy).toHaveBeenCalledTimes(1);
  });

  it("preserves the load error when loading task cleanup also fails", async () => {
    pdfJsMock.state.nextDocumentResult = "reject";
    pdfJsMock.state.loadingTaskDestroy.mockRejectedValueOnce(new Error("synthetic cleanup failure"));

    await expect(loadPdfJsDocument({ data: new ArrayBuffer(8), label: "worker-ownership-double-error" }))
      .rejects.toThrow("synthetic PDF parse failure");
    expect(pdfJsMock.workers[0].destroyed).toBe(true);
  });

  it("keeps a timed-out task's worker destroyed even if its promise later resolves", async () => {
    const lateDocument = { destroy: vi.fn(async () => undefined) };
    let finishLoading!: (document: typeof lateDocument) => void;
    const lateResult = new Promise<typeof lateDocument>((resolve) => { finishLoading = resolve; });
    pdfJsMock.getDocument.mockImplementationOnce(() => ({
      promise: lateResult,
      destroy: pdfJsMock.state.loadingTaskDestroy,
      onProgress: undefined,
    }));

    await expect(loadPdfJsDocument({
      data: new ArrayBuffer(8), label: "worker-ownership-timeout", timeoutMs: 10,
    })).rejects.toThrow("timed out after 10ms");

    expect(pdfJsMock.state.loadingTaskDestroy).toHaveBeenCalledTimes(1);
    expect(pdfJsMock.workers[0].destroyed).toBe(true);
    finishLoading(lateDocument);
    await lateResult;
    expect(pdfJsMock.workers[0].destroyed).toBe(true);
    expect(pdfJsMock.workers[0].destroy).toHaveBeenCalledTimes(1);
  });
});
