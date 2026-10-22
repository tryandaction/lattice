"use client";

import { AiChatPanel } from "@/components/ai/ai-chat-panel";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import { buildCitationContracts } from "@/lib/ai/citation-contract";
import type { EvidenceRef } from "@/lib/ai/types";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { UniversalFileViewer } from "@/components/main-area/universal-file-viewer";
import { PaneWrapper } from "@/components/main-area/pane-wrapper";
import { DndContext } from "@dnd-kit/core";
import { AgentAnnotationDiagnosticsBridge } from "./agent-annotation-diagnostics-bridge";
import { PDFHighlighterAdapter } from "@/components/renderers/pdf-highlighter-adapter";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { resolveAppRoute } from "@/lib/app-route";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { createEmptyPane, findPane } from "@/lib/layout-utils";
import {
  createSamplePdfBuffer,
  ensureSubdirectory,
  getDiagnosticsWorkspaceHandle,
  writeArrayBufferFile,
} from "./browser-regression-utils";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { buildPersistedFileViewStateKey, deletePersistedFileViewState } from "@/lib/file-view-state";
import { createUniversalAnnotationFile, generateFileId, saveAnnotationsToDisk } from "@/lib/universal-annotation-storage";
import { loadPdfJsDocument } from "@/lib/pdf-js-document-loader";
import { getPdfPageTextModel, type PdfPageTextModel } from "@/lib/pdf-page-text-cache";
import { buildCanonicalPdfTextMarkupTargetFromExact } from "@/lib/pdf-annotation-text-repair";
import { readDesktopFileBytesRaw } from "@/lib/desktop-preview";
import { createDesktopFileHandle } from "@/lib/desktop-file-system";
import { isTauriHost } from "@/lib/storage-adapter";

interface PdfFixture {
  fileId: string;
  fileName: string;
  filePath: string;
  content: ArrayBuffer;
  fileHandle: FileSystemFileHandle;
}

interface DiagnosticsWorkspace {
  rootHandle: FileSystemDirectoryHandle;
  left: PdfFixture;
  rightA: PdfFixture;
  rightB: PdfFixture;
  evidenceNote?: { filePath: string; content: string; quote: string };
}

function createTextQuote(exact: string) {
  return {
    exact,
    prefix: "",
    suffix: "",
    source: "pdfjs-text-model" as const,
    confidence: "exact" as const,
  };
}

function assertDiagnosticsPdfBuffer(buffer: ArrayBuffer, label: string): ArrayBuffer {
  const bytes = new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength));
  const header = String.fromCharCode(...bytes);
  if (header !== "%PDF-") {
    throw new Error(`Diagnostics PDF source did not return PDF bytes: ${label}`);
  }
  return buffer;
}

async function loadDiagnosticsPdfBuffer(input: { url: string; desktopPath?: string | null }): Promise<ArrayBuffer> {
  if (input.desktopPath && isTauriHost()) {
    const bytes = await readDesktopFileBytesRaw(input.desktopPath);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return assertDiagnosticsPdfBuffer(buffer, input.desktopPath);
  }

  const url = input.url;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load diagnostics PDF: ${url} (${response.status})`);
  }
  return assertDiagnosticsPdfBuffer(await response.arrayBuffer(), url);
}

function sanitizeDiagnosticsPdfName(name: string): string {
  const leafName = name.split(/[\\/]/).filter(Boolean).pop()?.trim() || "diagnostics-real.pdf";
  const sanitized = leafName.replace(/[^\w.()[\] -]+/g, "_");
  return sanitized.toLowerCase().endsWith(".pdf") ? sanitized : `${sanitized}.pdf`;
}

async function seedPdfAnnotation(
  rootHandle: FileSystemDirectoryHandle,
  fileId: string,
  page: number,
  options?: { interactionSet?: boolean; textModel?: PdfPageTextModel },
) {
  const annotationFile = createUniversalAnnotationFile(fileId, "pdf");
  const createdAt = Date.now();
  annotationFile.annotations = [
    {
      id: `ann-${fileId}`,
      target: {
        type: "pdf",
        page,
        rects: [
          { x1: 0.12, y1: 0.18, x2: 0.46, y2: 0.22 },
        ],
      },
      style: {
        color: "#FFEB3B",
        type: "highlight",
      },
      content: `Diagnostic highlight on page ${page}`,
      comment: "Regression seed",
      author: "diagnostics",
      createdAt,
    },
  ];

  if (options?.interactionSet) {
    const targetQuote = createTextQuote("Fig. 5, that tend to cause shifts in opposite directions");
    annotationFile.annotations.push(
      {
        id: "ann-real-highlight",
        target: {
          type: "pdf",
          page,
          rects: [
            { x1: 0.081, y1: 0.292, x2: 0.482, y2: 0.315 },
            { x1: 0.081, y1: 0.318, x2: 0.310, y2: 0.340 },
          ],
          textQuote: targetQuote,
        },
        style: { color: "#FFEB3B", type: "highlight" },
        content: targetQuote.exact,
        author: "diagnostics",
        createdAt: createdAt + 1,
      },
      {
        id: "ann-real-underline",
        target: {
          type: "pdf",
          page,
          rects: [{ x1: 0.081, y1: 0.333, x2: 0.280, y2: 0.338 }],
          textQuote: createTextQuote("Stark shifts below 1 MHz"),
        },
        style: { color: "#2196F3", type: "underline", underlineStyle: "solid" },
        content: "Stark shifts below 1 MHz",
        author: "diagnostics",
        createdAt: createdAt + 2,
      },
      {
        id: "ann-real-area",
        target: {
          type: "pdf",
          page,
          rects: [{ x1: 0.56, y1: 0.18, x2: 0.76, y2: 0.28 }],
        },
        style: { color: "#4CAF50", type: "area" },
        content: "Diagnostic area",
        author: "diagnostics",
        createdAt: createdAt + 3,
      },
      {
        id: "ann-real-text",
        target: {
          type: "pdf",
          page,
          rects: [{ x1: 0.56, y1: 0.33, x2: 0.72, y2: 0.37 }],
        },
        style: {
          color: "#FFFFFF",
          type: "text",
          textStyle: { textColor: "#111111", fontSize: 14 },
        },
        content: "Real PDF text note",
        author: "diagnostics",
        createdAt: createdAt + 4,
      },
      {
        id: "ann-real-pin",
        target: {
          type: "pdf",
          page,
          rects: [{ x1: 0.79, y1: 0.18, x2: 0.81, y2: 0.20 }],
        },
        style: { color: "#FFC107", type: "area" },
        comment: "Real PDF pin",
        author: "diagnostics",
        createdAt: createdAt + 5,
      },
      {
        id: "ann-real-ink",
        target: {
          type: "pdf",
          page,
          rects: [{ x1: 0.56, y1: 0.44, x2: 0.78, y2: 0.53 }],
        },
        style: { color: "#FF5252", type: "ink" },
        content: JSON.stringify({
          paths: [[
            { x: 0.56, y: 0.44 },
            { x: 0.66, y: 0.49 },
            { x: 0.78, y: 0.53 },
          ]],
          width: 5,
        }),
        author: "diagnostics",
        createdAt: createdAt + 6,
      },
    );
  }

  if (options?.textModel) {
    const model = options.textModel;
    annotationFile.annotations = annotationFile.annotations.map((annotation) => {
      if (annotation.style.type !== "highlight" && annotation.style.type !== "underline") return annotation;
      const exact = annotation.id === `ann-${fileId}`
        ? "For small dc electric fields"
        : annotation.content ?? "";
      const target = buildCanonicalPdfTextMarkupTargetFromExact({ model, exact, page });
      if (!target) throw new Error(`Diagnostic quote not found on page ${page}: ${exact}`);
      return { ...annotation, target, content: target.textQuote?.exact ?? exact };
    });
  }

  await saveAnnotationsToDisk(annotationFile, rootHandle);
}

function findPdfDiagnosticsScrollContainer(shell: ParentNode | null | undefined, paneId: string): HTMLElement | null {
  if (!shell) {
    return null;
  }

  const preferred = document.querySelector<HTMLElement>(`[data-testid="pdf-viewer-container-${paneId}"]`)
    ?? shell.querySelector<HTMLElement>(`[data-testid="pdf-scroll-container-${paneId}"]`);
  if (preferred) {
    return preferred;
  }

  const candidates = Array.from(shell.querySelectorAll<HTMLElement>("*"));
  candidates.sort((left, right) => {
    const leftOverflow = (left.scrollHeight - left.clientHeight) + (left.scrollWidth - left.clientWidth);
    const rightOverflow = (right.scrollHeight - right.clientHeight) + (right.scrollWidth - right.clientWidth);
    return rightOverflow - leftOverflow;
  });
  return candidates[0] ?? null;
}

export function PdfRegressionDiagnostics() {
  const imageHandleHref = resolveAppRoute("/diagnostics/image-annotation");
  const selectionHref = resolveAppRoute("/diagnostics/selection-ai");
  const singlePaneMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("singlePane");
  const directHighlighterMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("directHighlighter");
  const stableStateMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("stableState");
  const resetViewStateMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("resetViewState");
  const realPdfMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("realPdf");
  const interactionSetMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("interactionSet");
  const realPdfUrl = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("realPdfUrl") || "/__lattice-diagnostics/saffman-real.pdf"
    : "/__lattice-diagnostics/saffman-real.pdf";
  const realPdfDesktopPath = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("realPdfPath")
    : null;
  const realPdfFileName = sanitizeDiagnosticsPdfName(typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("realPdfName") || "saffman-real.pdf"
    : "saffman-real.pdf");
  const realPdfSeedPage = Math.max(1, Number(typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("realPdfPage") || "7"
    : "7"));
  const [workspace, setWorkspace] = useState<DiagnosticsWorkspace | null>(null);
  const agentAnnotationMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("agentAnnotation") === "1";
  const agentDocumentPages = typeof window !== 'undefined' ? Math.max(1, Math.min(60, Number(new URLSearchParams(window.location.search).get('documentPages')) || 3)) : 3;
  const agentWorkspaceName = typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("agentWorkspace") ?? "lattice-agent-annotation-regression").replace(/[^a-z0-9-]/gi, "").slice(0, 80)
    : "lattice-agent-annotation-regression";
  const aiEvidenceMode = agentAnnotationMode || (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("aiEvidence"));
  const inlineEvidenceMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("inlineEvidence") === "1";
  const targetedEvidenceMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("targetedEvidence") === "1";
  const crossFileEvidenceMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("crossFileEvidence") === "1";
  const [targetedEvidence, setTargetedEvidence] = useState<{ contextPages: number; passages: { page?: number; quote: string; filePath: string }[] } | null>(null);
  const targetedActivePath = useWorkspaceStore((state) => {
    const pane = findPane(state.layout.root, "pdf-left-pane");
    return pane?.tabs[pane.activeTabIndex]?.filePath ?? "";
  });
  const targetedNavigationDebug = useLinkNavigationStore((state) => JSON.stringify({ pending: state.pendingByPane["pdf-left-pane"], outcomes: state.outcomesByRequestId }));
  const [error, setError] = useState<string | null>(null);
  const [setupStage, setSetupStage] = useState("initializing");
  const [rightVariant, setRightVariant] = useState<"a" | "b">("a");
  const [compactLayout, setCompactLayout] = useState(false);
  const [preloadedLeftDocument, setPreloadedLeftDocument] = useState<PDFDocumentProxy | null>(null);
  const [preloadedRightDocument, setPreloadedRightDocument] = useState<PDFDocumentProxy | null>(null);

  const rightFixture = useMemo(() => {
    if (!workspace) {
      return null;
    }
    return rightVariant === "a" ? workspace.rightA : workspace.rightB;
  }, [rightVariant, workspace]);

  useEffect(() => {
    if (!aiEvidenceMode || !workspace || agentAnnotationMode) return;
    if (targetedEvidenceMode) {
      let disposed = false;
      const seedTargetedAnswer = async () => {
        const document = await loadPdfJsDocument({ data: workspace.left.content.slice(0), label: "Targeted citation evidence", timeoutMs: 45000 });
        try {
          const pageCount = Math.min(9, document.numPages);
          if (pageCount < 3) throw new Error("Targeted citation diagnostics require at least three PDF pages");
          const models = await Promise.all(Array.from({ length: pageCount }, (_, index) => getPdfPageTextModel(document, index + 1)));
          // Context deliberately supplies only a page and its extracted text. The
          // answer must bind its own short quote; pre-filled snippets mask failures.
          const evidenceRefs: EvidenceRef[] = models.map((model) => ({
            kind: "pdf_page", label: workspace.left.fileName,
            locator: `${workspace.left.filePath}#page=${model.pageNumber}`,
            anchor: { page: model.pageNumber }, preview: model.normalizedText,
          }));
          const passageInputs: { page?: number; quote: string; filePath: string; evidenceIndex: number }[] = [1, pageCount - 2].map((index, passageIndex) => {
            const model = models[index];
            const preferred = passageIndex === 0
              ? "Rydberg states are extremely sensitive to small low-frequency fields."
              : "The right column explains the readout calibration sequence and preserves order.";
            const quote = model.normalizedText.includes(preferred) ? preferred
              : model.segments.find((segment) => segment.normalizedText.length >= 45)?.normalizedText.slice(0, 120).trim()
                ?? model.normalizedText.slice(0, 100).trim();
            if (!quote || !model.normalizedText.includes(quote)) throw new Error(`Missing real quote on PDF page ${model.pageNumber}`);
            return { page: model.pageNumber, quote, filePath: workspace.left.filePath, evidenceIndex: index };
          });
          if (crossFileEvidenceMode && workspace.evidenceNote) {
            const rightDocument = await loadPdfJsDocument({ data: workspace.rightA.content.slice(0), label: "Second targeted evidence PDF", timeoutMs: 45000 });
            try {
              for (let page = 1; page <= rightDocument.numPages; page += 1) {
                const model = await getPdfPageTextModel(rightDocument, page);
                evidenceRefs.push({ kind: "pdf_page", label: workspace.rightA.fileName, locator: `${workspace.rightA.filePath}#page=${page}`, anchor: { page }, preview: model.normalizedText });
                if (page === 2) {
                  const quote = "Possible interactions in the absence of applied fields are compared below.";
                  if (!model.normalizedText.includes(quote)) throw new Error("Missing second PDF quote");
                  passageInputs.push({ page, quote, filePath: workspace.rightA.filePath, evidenceIndex: evidenceRefs.length - 1 });
                }
              }
            } finally { await rightDocument.destroy(); }
            evidenceRefs.push({ kind: "file", label: "evidence-note.md", locator: workspace.evidenceNote.filePath, preview: workspace.evidenceNote.content });
            passageInputs.push({ quote: workspace.evidenceNote.quote, filePath: workspace.evidenceNote.filePath, evidenceIndex: evidenceRefs.length - 1 });
          }
          const citations = buildCitationContracts(evidenceRefs);
          const passages = passageInputs.map((passage) => ({ ...passage, citation: citations[passage.evidenceIndex] }));
          if (disposed) return;
          useAiChatStore.setState({
            isOpen: true, composerMode: "chat", activeConversationId: "pdf-targeted-evidence-regression",
            conversations: [{ id: "pdf-targeted-evidence-regression", title: "Targeted PDF evidence", createdAt: 1, messages: [{
              id: "pdf-targeted-evidence-answer", role: "assistant", timestamp: 1,
              content: passages.map(({ quote, citation }, index) => `${["Field sensitivity", "Readout calibration", "Applied field comparison", "Research note"][index]}: ${quote} [Source ${index + 1}](citation:${citation.stableId}?quote=${encodeURIComponent(quote)})`).join("\n\n"),
              evidenceRefs,
            }] }],
          });
          setTargetedEvidence({ contextPages: evidenceRefs.length, passages: passages.map(({ page, quote, filePath }) => ({ page, quote, filePath })) });
        } finally {
          await document.destroy();
        }
      };
      void seedTargetedAnswer().catch((err) => { if (!disposed) setError(err instanceof Error ? err.message : String(err)); });
      return () => { disposed = true; };
    }
    const passages = [
      { page: 1, snippet: "Rydberg states are extremely sensitive", label: "Field sensitivity" },
      { page: 1, snippet: "The right column explains the readout calibration sequence", label: "Readout calibration" },
      { page: 2, snippet: "Left regression fixture - Page 2", label: "Second page" },
      { page: 3, snippet: "Left regression fixture - Page 3", label: "Third page" },
    ];
    const evidenceRefs: EvidenceRef[] = inlineEvidenceMode ? passages.map(({ page, snippet }) => ({
      kind: "pdf_page", label: workspace.left.fileName,
      locator: `${workspace.left.filePath}#page=${page}`, anchor: { page, snippet },
    })) : [{ kind: "pdf_page", label: workspace.left.fileName, locator: workspace.left.filePath, anchor: { page: 1, snippet: "Rydberg states are extremely sensitive" } }];
    const citations = buildCitationContracts(evidenceRefs);
    useAiChatStore.setState({
      isOpen: true, composerMode: "chat", activeConversationId: "pdf-evidence-regression",
      conversations: [{ id: "pdf-evidence-regression", title: "PDF source navigation", createdAt: 1, messages: [{
        id: "pdf-evidence-answer", role: "assistant", timestamp: 1,
        content: inlineEvidenceMode
          ? passages.map((passage, index) => `${passage.label}: ${passage.snippet}. [Source ${index + 1}](citation:${citations[index].stableId})`).join("\n\n")
          : "Rydberg states are extremely sensitive. Open the source below to inspect the exact passage.",
        evidenceRefs,
      }] }],
    });
  }, [agentAnnotationMode, aiEvidenceMode, crossFileEvidenceMode, inlineEvidenceMode, targetedEvidenceMode, workspace]);

  useEffect(() => {
    let disposed = false;

    const setup = async () => {
      try {
        setSetupStage("opening workspace");
        const rootHandle = await getDiagnosticsWorkspaceHandle(agentAnnotationMode ? agentWorkspaceName : undefined);
        const pdfDirectory = await ensureSubdirectory(rootHandle, "pdf");
        const sessionId = stableStateMode ? "pdf-regression-stable" : `pdf-regression-${Date.now()}`;
        const workspaceRootPath = `${rootHandle.name}/${sessionId}`;
        const leftFilePath = realPdfMode ? `pdf/${realPdfFileName}` : "pdf/left-fixture.pdf";
        const rightAFilePath = "pdf/right-fixture-a.pdf";
        const rightBFilePath = "pdf/right-fixture-b.pdf";
        const leftFileId = generateFileId(leftFilePath);
        const rightAFileId = generateFileId(rightAFilePath);
        const rightBFileId = generateFileId(rightBFilePath);

        setSetupStage("creating PDF files");
        const createLeft = async () => {
          if (agentAnnotationMode && stableStateMode) {
            try {
              const saved = await (await (await pdfDirectory.getFileHandle(realPdfMode ? realPdfFileName : 'left-fixture.pdf')).getFile()).arrayBuffer();
              // Strict-mode setup can observe a just-created file before its first write closes.
              if (saved.byteLength > 0) return saved;
            }
            catch (error) { if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error; }
          }
          return realPdfMode
            ? loadDiagnosticsPdfBuffer({ url: realPdfUrl, desktopPath: realPdfDesktopPath })
            : createSamplePdfBuffer("Left regression fixture", agentAnnotationMode ? agentDocumentPages : targetedEvidenceMode ? 9 : inlineEvidenceMode ? 3 : 1);
        };
        const [leftBuffer, rightABuffer, rightBBuffer] = await Promise.all([
          createLeft(),
          createSamplePdfBuffer("Right regression fixture A", 2),
          createSamplePdfBuffer("Right regression fixture B", 2),
        ]);

        setSetupStage("writing PDF files");
        if (disposed) return;
        const [leftHandle, rightAHandle, rightBHandle] = await Promise.all([
          writeArrayBufferFile(pdfDirectory, realPdfMode ? realPdfFileName : "left-fixture.pdf", leftBuffer.slice(0)),
          writeArrayBufferFile(pdfDirectory, "right-fixture-a.pdf", rightABuffer.slice(0)),
          writeArrayBufferFile(pdfDirectory, "right-fixture-b.pdf", rightBBuffer.slice(0)),
        ]);
        const nativeLeftHandle = realPdfMode && realPdfDesktopPath && isTauriHost()
          ? createDesktopFileHandle(realPdfDesktopPath)
          : leftHandle;
        const evidenceNote = (targetedEvidenceMode || agentAnnotationMode) && crossFileEvidenceMode ? {
          filePath: "pdf/evidence-note.md",
          quote: "The measured field stability is 10 mV/cm after calibration.",
          content: "# Independent research note\n\n## Background\n\nThis paragraph gives background only.\n\n## Measured result\n\nThe measured field stability is 10 mV/cm after calibration.\n\n## Limitations\n\nFurther measurements are required for long term drift.\n",
        } : undefined;
        if (evidenceNote) await writeArrayBufferFile(pdfDirectory, "evidence-note.md", new TextEncoder().encode(evidenceNote.content).buffer);

        // Real-paper diagnostics must not paint hard-coded fixture rectangles
        // over unrelated text. Seed text markup using the same exact-quote
        // geometry as normal creation; synthetic fixtures keep their test layout.
        setSetupStage("seeding annotations");
        const seedDocument = realPdfMode && !targetedEvidenceMode && !agentAnnotationMode
          ? await loadPdfJsDocument({ data: leftBuffer.slice(0), label: "Real PDF diagnostic annotation anchors", timeoutMs: 45000 })
          : null;
        try {
          const textModel = seedDocument ? await getPdfPageTextModel(seedDocument, realPdfSeedPage) : undefined;
          if (!targetedEvidenceMode && !agentAnnotationMode) await Promise.all([
            seedPdfAnnotation(rootHandle, leftFileId, realPdfMode ? realPdfSeedPage : 1, {
              interactionSet: realPdfMode || interactionSetMode,
              textModel,
            }),
            seedPdfAnnotation(rootHandle, rightAFileId, 1),
            seedPdfAnnotation(rootHandle, rightBFileId, 2),
          ]);
        } finally {
          await seedDocument?.destroy();
        }

        if (disposed) {
          return;
        }

        const persistedKeys = [
          buildPersistedFileViewStateKey({
            kind: "pdf",
            workspaceRootPath,
            filePath: leftFilePath,
            fallbackName: realPdfMode ? realPdfFileName : "left-fixture.pdf",
          }),
          buildPersistedFileViewStateKey({
            kind: "pdf",
            workspaceRootPath,
            filePath: rightAFilePath,
            fallbackName: "right-fixture-a.pdf",
          }),
          buildPersistedFileViewStateKey({
            kind: "pdf",
            workspaceRootPath,
            filePath: rightBFilePath,
            fallbackName: "right-fixture-b.pdf",
          }),
        ];

        setSetupStage("resetting saved view");
        if (!stableStateMode || resetViewStateMode) {
          await Promise.all(persistedKeys.map((key) => deletePersistedFileViewState(key)));
        }
        useContentCacheStore.getState().clearCache();

        useWorkspaceStore.setState({
          rootHandle,
          ...(targetedEvidenceMode || agentAnnotationMode ? { workspaceRootHandle: rootHandle } : {}),
          workspaceRootPath,
          layout: {
            root: createEmptyPane("pdf-left-pane"),
            activePaneId: "pdf-left-pane",
          },
        });
        if (targetedEvidenceMode || agentAnnotationMode) useWorkspaceStore.getState().openFileInPane("pdf-left-pane", nativeLeftHandle, leftFilePath);

        setWorkspace({
          rootHandle,
          evidenceNote,
          left: {
            fileId: leftFileId,
            fileName: realPdfMode ? realPdfFileName : "left-fixture.pdf",
            filePath: leftFilePath,
            content: leftBuffer,
            fileHandle: nativeLeftHandle,
          },
          rightA: {
            fileId: rightAFileId,
            fileName: "right-fixture-a.pdf",
            filePath: rightAFilePath,
            content: rightABuffer,
            fileHandle: rightAHandle,
          },
          rightB: {
            fileId: rightBFileId,
            fileName: "right-fixture-b.pdf",
            filePath: rightBFilePath,
            content: rightBBuffer,
            fileHandle: rightBHandle,
          },
        });
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    void setup();

    return () => {
      disposed = true;
    };
  }, [agentAnnotationMode, agentDocumentPages, agentWorkspaceName, crossFileEvidenceMode, inlineEvidenceMode, interactionSetMode, realPdfDesktopPath, realPdfFileName, realPdfMode, realPdfSeedPage, realPdfUrl, resetViewStateMode, stableStateMode, targetedEvidenceMode]);

  useEffect(() => {
    if (!directHighlighterMode || !workspace || !rightFixture) {
      setPreloadedLeftDocument(null);
      setPreloadedRightDocument(null);
      return;
    }

    let disposed = false;
    setPreloadedLeftDocument(null);
    setPreloadedRightDocument(null);
    void Promise.all([
      loadPdfJsDocument({
        data: workspace.left.content,
        label: "PDF regression direct highlighter left",
        timeoutMs: realPdfMode ? 45000 : 20000,
      }),
      loadPdfJsDocument({
        data: rightFixture.content,
        label: "PDF regression direct highlighter right",
        timeoutMs: 20000,
      }),
    ]).then(([leftDocument, rightDocument]) => {
      if (disposed) {
        void leftDocument.destroy();
        void rightDocument.destroy();
        return;
      }
      setPreloadedLeftDocument(leftDocument);
      setPreloadedRightDocument(rightDocument);
    }).catch((err) => {
      if (!disposed) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });

    return () => {
      disposed = true;
    };
  }, [directHighlighterMode, rightFixture, workspace]);

  const scrollPaneToPage = (shellTestId: string, paneId: string, pageNumber: number) => {
    let attemptsLeft = 120;

    const attemptScroll = () => {
      const diagnosticsWindow = window as Window & {
        __latticePdfDiagnostics?: Record<string, {
          scrollToPage?: (pageNumber: number) => boolean;
        }>;
      };
      if (diagnosticsWindow.__latticePdfDiagnostics?.[paneId]?.scrollToPage?.(pageNumber)) {
        return;
      }

      const shell = document.querySelector<HTMLElement>(`[data-testid="${shellTestId}"]`);
      const scrollContainer = findPdfDiagnosticsScrollContainer(shell, paneId);
      const page = shell?.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`);
      if (page) {
        page.scrollIntoView({ behavior: "auto", block: "center" });
        return;
      }

      const firstPage = shell?.querySelector<HTMLElement>('[data-page-number="1"]');
      if (scrollContainer && firstPage) {
        const estimatedPageHeight = firstPage.getBoundingClientRect().height + 24;
        scrollContainer.scrollTo({
          top: Math.max(0, estimatedPageHeight * (pageNumber - 1)),
          behavior: "auto",
        });
      }

      attemptsLeft -= 1;
      if (attemptsLeft > 0) {
        window.requestAnimationFrame(attemptScroll);
      }
    };

    void window.requestAnimationFrame(attemptScroll);
  };

  if (error) {
    return <div className="p-6 text-sm text-destructive">{error}</div>;
  }

  if (!workspace || !rightFixture) {
    return <div className="p-6 text-sm text-muted-foreground">Preparing PDF regression fixtures: {setupStage}...</div>;
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground" data-testid="pdf-regression-ready">
      {targetedEvidence && <output hidden data-testid="pdf-targeted-evidence-fixture">{JSON.stringify(targetedEvidence)}</output>}
      {targetedEvidenceMode && <output hidden data-testid="pdf-targeted-active-file">{targetedActivePath}</output>}
      {targetedEvidenceMode && <output hidden data-testid="pdf-targeted-navigation">{targetedNavigationDebug}</output>}
      {agentAnnotationMode && <AgentAnnotationDiagnosticsBridge />}
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-medium">PDF Split Regression</h1>
          <p className="text-xs text-muted-foreground">
            Lightweight PDF diagnostics focused on split panes, scoped zoom, file switching, and annotation stability.
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs">
          {agentAnnotationMode && <>
            <button data-testid="agent-annotation-open-other-file" onClick={() => useWorkspaceStore.getState().openFileInPane("pdf-left-pane", workspace.rightA.fileHandle, workspace.rightA.filePath)}>Open other PDF</button>
            <button data-testid="agent-annotation-open-source-file" onClick={() => useWorkspaceStore.getState().openFileInPane("pdf-left-pane", workspace.left.fileHandle, workspace.left.filePath)}>Reopen source PDF</button>
          </>}
          <button
            type="button"
            data-testid="activate-left-pane"
            onClick={() => useWorkspaceStore.setState((state) => ({
              layout: {
                ...state.layout,
                activePaneId: "pdf-left-pane",
              },
            }))}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            Activate left
          </button>
          <button
            type="button"
            data-testid="activate-right-pane"
            onClick={() => useWorkspaceStore.setState((state) => ({
              layout: {
                ...state.layout,
                activePaneId: "pdf-right-pane",
              },
            }))}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            Activate right
          </button>
          <button
            type="button"
            data-testid="toggle-right-file"
            onClick={() => setRightVariant((value) => value === "a" ? "b" : "a")}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            Toggle right file
          </button>
          <button
            type="button"
            data-testid="scroll-right-to-page-2"
            onClick={() => scrollPaneToPage("pdf-right-shell", "pdf-right-pane", 2)}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            Scroll right to page 2
          </button>
          <button
            type="button"
            data-testid="toggle-pdf-compact-layout"
            onClick={() => setCompactLayout((value) => !value)}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            Toggle compact layout
          </button>
          <Link href={imageHandleHref} className="rounded border border-border px-3 py-1 hover:bg-muted">
            Image diagnostics
          </Link>
          <Link href={selectionHref} className="rounded border border-border px-3 py-1 hover:bg-muted">
            Selection AI
          </Link>
        </div>
      </header>

      <main className={`grid min-h-0 flex-1 gap-3 overflow-hidden p-3 ${aiEvidenceMode ? "grid-cols-[minmax(0,1fr)_minmax(320px,400px)]" : singlePaneMode ? "grid-cols-1" : compactLayout ? "grid-cols-[1fr_0.9fr]" : "grid-cols-[1fr_1fr]"}`}>
        <section className="min-h-0 overflow-hidden rounded-xl border border-border" data-testid="pdf-left-shell">
          {targetedEvidenceMode || agentAnnotationMode ? (
            <DndContext>
              <PaneWrapper paneId="pdf-left-pane" isActive onActivate={() => {}} onSplitRight={() => {}} onSplitDown={() => {}} onClose={() => {}} />
            </DndContext>
          ) : directHighlighterMode && !preloadedLeftDocument ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Preparing direct PDF highlighter...
            </div>
          ) : directHighlighterMode ? (
            <PDFHighlighterAdapter
              key={workspace.left.fileId}
              paneId="pdf-left-pane"
              fileHandle={workspace.left.fileHandle}
              rootHandle={workspace.rootHandle}
              source={{ kind: "buffer", data: workspace.left.content }}
              fileName={workspace.left.fileName}
              fileId={workspace.left.fileId}
              filePath={workspace.left.filePath}
              preloadedPdfDocument={preloadedLeftDocument}
            />
          ) : (
            <UniversalFileViewer
              key={workspace.left.fileId}
              paneId="pdf-left-pane"
              handle={workspace.left.fileHandle}
              rootHandle={workspace.rootHandle}
              content={{ kind: "buffer", data: workspace.left.content }}
              isLoading={false}
              error={null}
              fileId={workspace.left.fileId}
              filePath={workspace.left.filePath}
            />
          )}
        </section>

        {aiEvidenceMode ? <AiChatPanel loadPersistedState={false} /> : !singlePaneMode ? (
          <section className="min-h-0 overflow-hidden rounded-xl border border-border" data-testid="pdf-right-shell">
            {directHighlighterMode && !preloadedRightDocument ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Preparing direct PDF highlighter...
              </div>
            ) : directHighlighterMode ? (
              <PDFHighlighterAdapter
                key={rightFixture.fileId}
                paneId="pdf-right-pane"
                fileHandle={rightFixture.fileHandle}
                rootHandle={workspace.rootHandle}
                source={{ kind: "buffer", data: rightFixture.content }}
                fileName={rightFixture.fileName}
                fileId={rightFixture.fileId}
                filePath={rightFixture.filePath}
                preloadedPdfDocument={preloadedRightDocument}
              />
            ) : (
              <UniversalFileViewer
                key={rightFixture.fileId}
                paneId="pdf-right-pane"
                handle={rightFixture.fileHandle}
                rootHandle={workspace.rootHandle}
                content={{ kind: "buffer", data: rightFixture.content }}
                isLoading={false}
                error={null}
                fileId={rightFixture.fileId}
                filePath={rightFixture.filePath}
              />
            )}
          </section>
        ) : null}
      </main>

      <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        Right file: <span data-testid="right-file-indicator">{rightFixture.fileName}</span>
      </div>
    </div>
  );
}
