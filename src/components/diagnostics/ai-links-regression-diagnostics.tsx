"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ObsidianMarkdownViewer } from "@/components/editor/obsidian-markdown-viewer";
import { CodeEditorViewer } from "@/components/renderers/code-editor-viewer";
import { NotebookEditor } from "@/components/notebook/notebook-editor";
import { LinkWidget } from "@/components/editor/codemirror/live-preview/widgets";
import { EvidencePanel } from "@/components/ai/evidence-panel";
import type { ChatMessage } from "@/stores/ai-chat-store";
import { navigateLinkDetailed } from "@/lib/link-router/navigate-link";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";

const MARKDOWN_PANE_ID = "ai-links-markdown-pane";
const CODE_PANE_ID = "ai-links-code-pane";
const NOTEBOOK_PANE_ID = "ai-links-notebook-pane";
const invalidEvidenceMessage: ChatMessage = {
  id: "ai-links-invalid-evidence",
  role: "assistant",
  content: "The source could not be opened.",
  timestamp: 1,
  evidenceRefs: [{
    kind: "file",
    label: "missing.md",
    locator: "missing.md#Missing",
    preview: "This file does not exist in the diagnostics workspace.",
  }],
};

const markdownContent = [
  "[External guide](https://example.com/guide)",
  "",
  "# Citation navigation fixture",
  "",
  ...Array.from({ length: 38 }, (_, index) => `Context line ${index + 1}.`),
  "## Target heading",
  "",
  "The target heading is used to verify real Markdown line navigation.",
  "",
  "[External guide](https://example.com/guide)",
].join("\n");

const codeContent = Array.from({ length: 60 }, (_, index) => `const value${index + 1} = ${index + 1};`).join("\n");

const notebookContent = JSON.stringify({
  cells: [
    { cell_type: "markdown", id: "intro", metadata: {}, source: ["# Notebook fixture"] },
    { cell_type: "code", id: "target-cell", execution_count: null, metadata: {}, outputs: [], source: ["value = 42"] },
  ],
  metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" }, language_info: { name: "python" } },
  nbformat: 4,
  nbformat_minor: 5,
}, null, 2);

export function AiLinksRegressionDiagnostics() {
  const [statusByKind, setStatusByKind] = useState<Record<string, string>>({
    markdown: "idle",
    code: "idle",
    notebook: "idle",
    invalid: "idle",
  });
  const [requestIdByKind, setRequestIdByKind] = useState<Record<string, string>>({});
  const outcomesByRequestId = useLinkNavigationStore((state) => state.outcomesByRequestId);
  const [markdownLinkClicks, setMarkdownLinkClicks] = useState(0);
  const [markdownLinkEdits, setMarkdownLinkEdits] = useState(0);
  const linkHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    useLinkNavigationStore.setState({ pendingByPane: {}, outcomesByRequestId: {} });
  }, []);

  useEffect(() => {
    const host = linkHostRef.current;
    if (!host) return;

    const view = {
      dom: host,
      posAtCoords: () => 0,
      dispatch: () => setMarkdownLinkEdits((count) => count + 1),
      focus: () => undefined,
    } as never;
    const link = new LinkWidget("Editable guide", "notes/guide.md", false, 0, 20, 0, 20).toDOM(view);
    const onNavigate = () => setMarkdownLinkClicks((count) => count + 1);
    host.addEventListener("workspace-link-click", onNavigate);
    host.replaceChildren(link);
    return () => {
      host.removeEventListener("workspace-link-click", onNavigate);
      host.replaceChildren();
    };
  }, []);

  const resolvedStatusByKind = Object.entries(requestIdByKind).reduce(
    (current, [kind, requestId]) => {
      const outcome = outcomesByRequestId[requestId];
      return outcome ? { ...current, [kind]: outcome.status } : current;
    },
    statusByKind,
  );

  const navigate = useCallback(async (kind: "markdown" | "code" | "notebook" | "invalid") => {
    const target = kind === "markdown"
      ? { locator: "notes/target.md#Target heading", paneId: MARKDOWN_PANE_ID, currentFilePath: "notes/target.md" }
      : kind === "code"
        ? { locator: "src/target.ts#line=40", paneId: CODE_PANE_ID, currentFilePath: "src/target.ts" }
        : kind === "notebook"
          ? { locator: "analysis.ipynb#cell=target-cell", paneId: NOTEBOOK_PANE_ID, currentFilePath: "analysis.ipynb" }
          : { locator: "missing.md#Missing", paneId: MARKDOWN_PANE_ID, currentFilePath: "notes/target.md" };

    const result = await navigateLinkDetailed(target.locator, {
      paneId: target.paneId,
      currentFilePath: target.currentFilePath,
      pathMode: "workspace",
    });
    if (result.status === "pending") {
      setStatusByKind((current) => ({ ...current, [kind]: "pending" }));
      setRequestIdByKind((current) => ({ ...current, [kind]: result.requestId }));
    } else {
      setStatusByKind((current) => ({ ...current, [kind]: result.status }));
    }
  }, []);

  return (
    <main className="min-h-screen bg-background p-4 text-foreground" data-testid="ai-links-regression-ready">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-sm font-medium">AI links regression</h1>
          <p className="text-xs text-muted-foreground">Real renderer navigation and target-frame diagnostics.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["markdown", "code", "notebook", "invalid"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              data-testid={`navigate-${kind}-reference`}
              onClick={() => void navigate(kind)}
              className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            >
              Navigate {kind}
            </button>
          ))}
        </div>
      </header>

      <div ref={linkHostRef} data-testid="ai-links-widget-host" className="mb-4 rounded border border-border px-3 py-2 text-xs" />
      <div className="sr-only">
        <span data-testid="markdown-link-navigation-count">{markdownLinkClicks}</span>
        <span data-testid="markdown-link-edit-count">{markdownLinkEdits}</span>
      </div>

      <div className="grid min-h-[70rem] gap-4 xl:grid-cols-3">
        <section data-testid="markdown-reference-surface" className="min-h-[34rem] overflow-hidden rounded border border-border">
          <div className="border-b border-border px-3 py-2 text-xs">Markdown: <span data-testid="navigation-markdown-status">{resolvedStatusByKind.markdown}</span></div>
          <div className="h-[30rem]">
            <ObsidianMarkdownViewer
              content={markdownContent}
              onChange={() => undefined}
              fileName="target.md"
              fileId="ai-links-markdown"
              filePath="notes/target.md"
              paneId={MARKDOWN_PANE_ID}
              initialMode="live"
              onNavigateToFile={() => setMarkdownLinkClicks((count) => count + 1)}
            />
          </div>
        </section>

        <section data-testid="code-reference-surface" className="min-h-[34rem] overflow-hidden rounded border border-border">
          <div className="border-b border-border px-3 py-2 text-xs">Code: <span data-testid="navigation-code-status">{resolvedStatusByKind.code}</span></div>
          <div className="h-[30rem]">
            <CodeEditorViewer
              content={codeContent}
              fileName="target.ts"
              onContentChange={() => undefined}
              onSave={async () => undefined}
              paneId={CODE_PANE_ID}
              tabId="ai-links-code"
              filePath="src/target.ts"
              executionScopeId="ai-links-code-scope"
            />
          </div>
        </section>

        <section data-testid="notebook-reference-surface" className="min-h-[34rem] overflow-hidden rounded border border-border">
          <div className="border-b border-border px-3 py-2 text-xs">Notebook: <span data-testid="navigation-notebook-status">{resolvedStatusByKind.notebook}</span></div>
          <div className="h-[30rem] overflow-auto">
            <NotebookEditor
              content={notebookContent}
              fileName="analysis.ipynb"
              onContentChange={() => undefined}
              onSave={async () => undefined}
              paneId={NOTEBOOK_PANE_ID}
              tabId="ai-links-notebook"
              filePath="analysis.ipynb"
              executionScopeId="ai-links-notebook-scope"
            />
          </div>
        </section>
      </div>

      <section data-testid="ai-links-invalid-evidence-panel" className="mt-4 min-h-[20rem] rounded border border-border">
        <EvidencePanel message={invalidEvidenceMessage} onClose={() => undefined} />
      </section>

      <span data-testid="navigation-invalid-status">{resolvedStatusByKind.invalid}</span>
    </main>
  );
}
