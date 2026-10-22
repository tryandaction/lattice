"use client";

import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { applyWorkspaceHandleToStores } from "@/hooks/use-file-system";
import { getDiagnosticsWorkspaceHandle, writeArrayBufferFile } from "./browser-regression-utils";

const WORKSPACE_NAME = "lattice-skins-plugins-acceptance-v1";
let setupPromise: Promise<void> | null = null;

async function initializeAcceptanceWorkspace(): Promise<void> {
  const settings = useSettingsStore.getState();
  if (!settings.isInitialized) await settings.loadSettings();
  await useSettingsStore.getState().updateSetting("onboardingCompleted", true);
  const root = await getDiagnosticsWorkspaceHandle(WORKSPACE_NAME);
  const response = await fetch("/__lattice-diagnostics/plugin-formulas.pdf", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load the synthetic formula acceptance PDF.");
  const pdfBytes = await response.arrayBuffer();
  if (new TextDecoder().decode(pdfBytes.slice(0, 5)) !== "%PDF-") throw new Error("The acceptance PDF is invalid.");

  const pdf = await writeArrayBufferFile(root, "plugin-formulas.pdf", pdfBytes);
  const notes = [
    "# Skin and plugin acceptance",
    "",
    "This synthetic note verifies reading, formula rendering, and plugin export.",
    "",
    "Inline expression: $E = mc^2$.",
    "",
    "$$",
    "\\frac{H}{h} = \\begin{pmatrix}0 & \\Omega/2 \\\\ \\Omega/2 & -\\Delta\\end{pmatrix}",
    "$$",
    "",
    "| Material | Result |",
    "| --- | --- |",
    "| Synthetic PDF | Three expected formulas |",
    "| Markdown | Two explicit formulas |",
    "",
    "> This note contains no personal research data.",
    "",
    "\`\`\`python",
    "def energy(m, c):",
    "    return m * c ** 2",
    "\`\`\`",
    "",
  ].join("\n");
  const texts = [
    { name: "acceptance-note.md", text: notes, extension: "md" },
    { name: "acceptance-code.py", text: "def energy(m: float, c: float) -> float:\n    return m * c ** 2\n", extension: "py" },
    { name: "acceptance-notebook.ipynb", text: JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
      { cell_type: "markdown", metadata: {}, source: ["# Synthetic Notebook\n", "$E=mc^2$"] },
      { cell_type: "code", metadata: {}, source: ["def energy(m, c):\n", "    return m * c ** 2"], execution_count: null, outputs: [] },
    ] }, null, 2), extension: "ipynb" },
  ];
  for (const entry of texts) {
    try { await root.getFileHandle(entry.name); }
    catch (cause) {
      if (!(cause instanceof DOMException) || cause.name !== "NotFoundError") throw cause;
      await writeArrayBufferFile(root, entry.name, new TextEncoder().encode(entry.text).buffer);
    }
  }
  await applyWorkspaceHandleToStores(root, WORKSPACE_NAME);
  const workspace = useWorkspaceStore.getState();
  workspace.openFileInActivePane(pdf, `${root.name}/${pdf.name}`);
}

export function SkinsPluginsDiagnostics() {
  const rootName = useWorkspaceStore((state) => state.rootHandle?.name ?? null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    setupPromise ??= initializeAcceptanceWorkspace().catch((cause) => { setupPromise = null; throw cause; });
    void setupPromise.then(() => { if (!disposed) setReady(true); })
      .catch((cause) => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { disposed = true; };
  }, []);
  const reloadMaterials = () => {
    setError(null);
    setReady(false);
    setupPromise = null;
    void initializeAcceptanceWorkspace().then(() => setReady(true))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  if (error) return <main className="p-6 text-destructive" role="alert">{error}</main>;
  if (!ready) return <main className="p-6 text-muted-foreground" role="status">Preparing synthetic skin and plugin workspace…</main>;
  return <>
    <AppLayout />
    {!rootName && <button type="button" onClick={reloadMaterials} className="fixed bottom-4 right-4 z-[200] rounded border border-border bg-background px-3 py-2 text-sm">Reload synthetic acceptance materials</button>}
  </>;
}
