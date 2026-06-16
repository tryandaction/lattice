"use client";

import { useEffect, useMemo, useState } from "react";
import { createSamplePdfBuffer } from "./browser-regression-utils";
import { loadPdfJsDocument, pdfJsWorkerUrl } from "@/lib/pdf-js-document-loader";

type ProbeStatus = "idle" | "generating" | "loading" | "ready" | "error";

interface ProbeResult {
  status: ProbeStatus;
  pages: number;
  error: string;
  bytes: number;
}

async function loadProbeDocument(title: string, pages: number): Promise<ProbeResult> {
  try {
    const buffer = await createSamplePdfBuffer(title, pages);
    const document = await loadPdfJsDocument({
      data: buffer,
      label: `PDF.js probe ${title}`,
      timeoutMs: 20000,
    });
    const result = {
      status: "ready" as const,
      pages: document.numPages,
      error: "",
      bytes: buffer.byteLength,
    };
    void document.destroy();
    return result;
  } catch (err) {
    return {
      status: "error",
      pages: 0,
      error: err instanceof Error ? err.message : String(err),
      bytes: 0,
    };
  }
}

export function PdfJsProbeDiagnostics() {
  const [status, setStatus] = useState<ProbeStatus>("idle");
  const [pages, setPages] = useState(0);
  const [error, setError] = useState("");
  const [bytes, setBytes] = useState(0);
  const [dualLeft, setDualLeft] = useState<ProbeResult>({ status: "idle", pages: 0, error: "", bytes: 0 });
  const [dualRight, setDualRight] = useState<ProbeResult>({ status: "idle", pages: 0, error: "", bytes: 0 });
  const [smokeLeft, setSmokeLeft] = useState<ProbeResult>({ status: "idle", pages: 0, error: "", bytes: 0 });
  const [smokeRight, setSmokeRight] = useState<ProbeResult>({ status: "idle", pages: 0, error: "", bytes: 0 });
  const [tick, setTick] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [workerSrc, setWorkerSrc] = useState(pdfJsWorkerUrl);
  const startedAt = useMemo(() => Date.now(), []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setTick((value) => value + 1);
      setElapsedMs(Date.now() - startedAt);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [startedAt]);

  useEffect(() => {
    let disposed = false;

    const run = async () => {
      try {
        setStatus("generating");
        setWorkerSrc(pdfJsWorkerUrl);
        const result = await loadProbeDocument("PDF.js probe fixture", 1);
        if (disposed) {
          return;
        }

        setBytes(result.bytes);
        setPages(result.pages);
        setStatus(result.status);
        setError(result.error);
        if (result.status !== "ready") {
          return;
        }

        setDualLeft((current) => ({ ...current, status: "loading" }));
        const leftResult = await loadProbeDocument("PDF.js dual left fixture", 1);
        if (disposed) {
          return;
        }
        setDualLeft(leftResult);
        setDualRight((current) => ({ ...current, status: "loading" }));
        const rightResult = await loadProbeDocument("PDF.js dual right fixture", 2);
        if (disposed) {
          return;
        }
        setDualRight(rightResult);
        setSmokeLeft((current) => ({ ...current, status: "loading" }));
        const smokeLeftResult = await loadProbeDocument("Left regression fixture", 1);
        if (disposed) {
          return;
        }
        setSmokeLeft(smokeLeftResult);
        setSmokeRight((current) => ({ ...current, status: "loading" }));
        const smokeRightResult = await loadProbeDocument("Right regression fixture A", 2);
        if (disposed) {
          return;
        }
        setSmokeRight(smokeRightResult);
      } catch (err) {
        if (!disposed) {
          setStatus("error");
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    void run();

    return () => {
      disposed = true;
    };
  }, []);

  return (
    <main className="flex min-h-screen flex-col gap-3 bg-background p-6 text-sm text-foreground" data-testid="pdf-js-probe-ready">
      <h1 className="text-base font-medium">PDF.js Probe</h1>
      <div className="grid max-w-2xl grid-cols-[10rem_1fr] gap-2">
        <span>Status</span>
        <span data-testid="pdf-js-probe-status">{status}</span>
        <span>Pages</span>
        <span data-testid="pdf-js-probe-pages">{pages}</span>
        <span>Error</span>
        <span data-testid="pdf-js-probe-error">{error}</span>
        <span>Bytes</span>
        <span data-testid="pdf-js-probe-bytes">{bytes}</span>
        <span>Dual left</span>
        <span data-testid="pdf-js-probe-dual-left">{`${dualLeft.status}:${dualLeft.pages}:${dualLeft.bytes}:${dualLeft.error}`}</span>
        <span>Dual right</span>
        <span data-testid="pdf-js-probe-dual-right">{`${dualRight.status}:${dualRight.pages}:${dualRight.bytes}:${dualRight.error}`}</span>
        <span>Smoke left</span>
        <span data-testid="pdf-js-probe-smoke-left">{`${smokeLeft.status}:${smokeLeft.pages}:${smokeLeft.bytes}:${smokeLeft.error}`}</span>
        <span>Smoke right</span>
        <span data-testid="pdf-js-probe-smoke-right">{`${smokeRight.status}:${smokeRight.pages}:${smokeRight.bytes}:${smokeRight.error}`}</span>
        <span>Worker</span>
        <span data-testid="pdf-js-probe-worker">{workerSrc}</span>
        <span>Tick</span>
        <span data-testid="pdf-js-probe-tick">{tick}</span>
        <span>Elapsed</span>
        <span data-testid="pdf-js-probe-elapsed">{elapsedMs}</span>
      </div>
    </main>
  );
}
