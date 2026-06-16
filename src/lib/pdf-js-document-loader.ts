"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { withTimeout } from "@/lib/async-task-guard";

type PdfJsModule = typeof import("pdfjs-dist/build/pdf.mjs");

export const pdfJsWorkerUrl = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export interface LoadPdfJsDocumentInput {
  data?: ArrayBuffer | null;
  url?: string | null;
  label: string;
  timeoutMs?: number;
  onProgress?: (progress: { loaded?: number; total?: number }) => void;
}

export async function loadPdfJsDocument(input: LoadPdfJsDocumentInput): Promise<PDFDocumentProxy> {
  const pdfjsModule = await import("pdfjs-dist/build/pdf.mjs");
  pdfjsModule.GlobalWorkerOptions.workerSrc = pdfJsWorkerUrl;
  const worker = pdfjsModule.PDFWorker.create({ name: input.label });
  let loadingTask: ReturnType<PdfJsModule["getDocument"]> | null = null;

  try {
    if (input.data) {
      loadingTask = pdfjsModule.getDocument({
        data: new Uint8Array(input.data.slice(0)),
        length: input.data.byteLength,
        worker,
      });
    } else if (input.url) {
      loadingTask = pdfjsModule.getDocument({ url: input.url, worker });
    } else {
      throw new Error("PDF document loader requires either data or url.");
    }

    if (input.onProgress) {
      loadingTask.onProgress = input.onProgress;
    }

    return await withTimeout(
      loadingTask.promise,
      input.timeoutMs ?? 20000,
      input.label,
    );
  } catch (error) {
    void loadingTask?.destroy();
    worker.destroy();
    throw error;
  }
}
