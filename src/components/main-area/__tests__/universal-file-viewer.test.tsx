/**
 * @vitest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UniversalFileViewer } from "../universal-file-viewer";

const isTauriHostMock = vi.hoisted(() => vi.fn(() => false));
const resolveFileIdentityMock = vi.hoisted(() => vi.fn(async (_input?: unknown) => ({
  primaryFileId: "paper-id",
  fileIdCandidates: ["paper-id"],
  canonicalPath: "workspace:docs/paper.pdf",
  relativePathFromRoot: "docs/paper.pdf",
  fileName: "paper.pdf",
  fileFingerprint: null,
  versionFingerprint: null,
  size: null,
  lastModified: null,
})));
const loadAnnotationsForFileIdentityMock = vi.hoisted(() => vi.fn(async (_input?: unknown) => ({
  annotationFile: {
    version: 2 as const,
    fileId: "paper-id",
    fileType: "pdf" as const,
    annotations: [],
    lastModified: Date.now(),
  },
  source: null,
} as any)));

vi.mock("next/dynamic", async () => {
  const ReactModule = await import("react");

  return {
    default: (loader: () => Promise<unknown>) => {
      const Lazy = ReactModule.lazy(async () => {
        const loaded = await loader();
        const resolved = loaded as { default?: React.ComponentType<unknown> };
        const component: React.ComponentType<Record<string, unknown>> = typeof loaded === "function"
          ? loaded as React.ComponentType<Record<string, unknown>>
          : resolved.default ?? (() => null);
        return {
          default: component,
        };
      });

      return function DynamicComponent(props: Record<string, unknown>) {
        return (
          <ReactModule.Suspense fallback={null}>
            <Lazy {...props} />
          </ReactModule.Suspense>
        );
      };
    },
  };
});

vi.mock("@/lib/storage-adapter", () => ({
  isTauriHost: () => isTauriHostMock(),
}));

vi.mock("@/lib/file-identity", () => ({
  resolveFileIdentity: (input: unknown) => resolveFileIdentityMock(input),
}));

vi.mock("@/lib/universal-annotation-storage", () => ({
  loadAnnotationsForFileIdentity: (input: unknown) => loadAnnotationsForFileIdentityMock(input),
}));

vi.mock("@/lib/i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("@/lib/link-router/navigate-link", () => ({
  navigateLink: vi.fn(async () => true),
}));

vi.mock("@/lib/runner/execution-scope", () => ({
  buildExecutionScopeId: () => "scope:test",
}));

vi.mock("@/stores/workspace-store", async () => {
  const actual = await vi.importActual("@/stores/workspace-store");
  return {
    ...actual,
    useWorkspaceStore: (selector: (state: { workspaceIdentity: { workspaceKey: string } | null }) => unknown) => selector({
      workspaceIdentity: { workspaceKey: "workspace:test" },
    }),
  };
});

vi.mock("@/components/renderers/pdf-viewer", () => ({
  PDFViewer: ({
    paneId,
    canAnnotate,
    hasPersistedAnnotations,
    onRequestAnnotationMode,
  }: {
    paneId?: string;
    canAnnotate?: boolean;
    hasPersistedAnnotations?: boolean;
    onRequestAnnotationMode?: () => void;
  }) => (
    <div data-testid={`mock-pdf-viewer-${paneId ?? "default"}`}>
      <span data-testid={`mock-pdf-viewer-can-annotate-${paneId ?? "default"}`}>{String(Boolean(canAnnotate))}</span>
      <span data-testid={`mock-pdf-viewer-has-persisted-${paneId ?? "default"}`}>{String(Boolean(hasPersistedAnnotations))}</span>
      <button type="button" onClick={onRequestAnnotationMode} data-testid={`mock-pdf-viewer-annotate-${paneId ?? "default"}`}>
        annotate
      </button>
    </div>
  ),
}));

vi.mock("@/components/renderers/pdf-highlighter-adapter", () => ({
  PDFHighlighterAdapter: ({ paneId, fileId }: { paneId: string; fileId: string }) => (
    <div data-testid={`mock-pdf-highlighter-${paneId}`}>{fileId}</div>
  ),
}));

function createPdfHandle(name = "paper.pdf") {
  return { name } as FileSystemFileHandle;
}

function renderPdfViewer() {
  return render(
    <UniversalFileViewer
      paneId="pane-left"
      handle={createPdfHandle()}
      rootHandle={{ name: "workspace" } as FileSystemDirectoryHandle}
      content={new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer}
      isLoading={false}
      error={null}
      fileId="paper-id"
      filePath="docs/paper.pdf"
    />,
  );
}

describe("UniversalFileViewer PDF routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriHostMock.mockReturnValue(false);
    loadAnnotationsForFileIdentityMock.mockResolvedValue({
      annotationFile: {
        version: 2 as const,
        fileId: "paper-id",
        fileType: "pdf" as const,
        annotations: [],
        lastModified: Date.now(),
      },
      source: null,
    } as any);
  });

  it("defaults to the lightweight PDF viewer when no persisted annotations exist", async () => {
    renderPdfViewer();

    expect(await screen.findByTestId("mock-pdf-viewer-pane-left")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("mock-pdf-viewer-can-annotate-pane-left").textContent).toBe("true");
      expect(screen.getByTestId("mock-pdf-viewer-has-persisted-pane-left").textContent).toBe("false");
      expect(screen.queryByTestId("mock-pdf-highlighter-pane-left")).toBeNull();
    });
  });

  it("auto-upgrades to the highlighter path when persisted annotations are detected", async () => {
    loadAnnotationsForFileIdentityMock.mockResolvedValue({
      annotationFile: {
        version: 2 as const,
        fileId: "paper-id",
        fileType: "pdf" as const,
        annotations: [
          {
            id: "ann-1",
            target: { type: "pdf" as const, page: 1, rects: [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2 }] },
            style: { color: "#FFEB3B", type: "highlight" as const },
            content: undefined,
            comment: undefined,
            author: "user",
            createdAt: Date.now(),
          },
        ],
        lastModified: Date.now(),
      },
      source: { sourceKind: "nested-lattice" } as unknown,
    } as any);

    renderPdfViewer();

    expect(await screen.findByTestId("mock-pdf-viewer-pane-left")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("mock-pdf-highlighter-pane-left")).toBeTruthy();
    });
  });

  it("enters annotation mode on explicit user request", async () => {
    renderPdfViewer();

    fireEvent.click(await screen.findByTestId("mock-pdf-viewer-annotate-pane-left"));

    await waitFor(() => {
      expect(screen.getByTestId("mock-pdf-highlighter-pane-left")).toBeTruthy();
    });
  });

  it("keeps desktop PDFs on the lightweight viewer until annotation mode is explicitly requested", async () => {
    isTauriHostMock.mockReturnValue(true);
    loadAnnotationsForFileIdentityMock.mockResolvedValue({
      annotationFile: {
        version: 2 as const,
        fileId: "paper-id",
        fileType: "pdf" as const,
        annotations: [
          {
            id: "ann-1",
            target: { type: "pdf" as const, page: 1, rects: [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2 }] },
            style: { color: "#FFEB3B", type: "highlight" as const },
            content: undefined,
            comment: undefined,
            author: "user",
            createdAt: Date.now(),
          },
        ],
        lastModified: Date.now(),
      },
      source: { sourceKind: "nested-lattice" } as unknown,
    } as any);

    renderPdfViewer();

    expect(await screen.findByTestId("mock-pdf-viewer-pane-left")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("mock-pdf-viewer-has-persisted-pane-left").textContent).toBe("true");
      expect(screen.queryByTestId("mock-pdf-highlighter-pane-left")).toBeNull();
    });
  });
});
