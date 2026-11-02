import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObsidianMarkdownViewer } from "../obsidian-markdown-viewer";
import { setLocale } from "@/lib/i18n";

vi.mock("next/dynamic", () => ({
  default: () => function FixtureEditor({ content, onChange, onSave }: { content?: string; onChange?: (value: string) => void; onSave?: () => Promise<void> }) {
    return <div><textarea aria-label="Fixture Markdown editor" value={content ?? ""} onChange={event => onChange?.(event.target.value)} /><button onClick={() => void onSave?.()}>Save from editor</button></div>;
  },
}));
vi.mock("@/hooks/use-execution-runner", () => ({ useExecutionRunner: () => ({
  status: "idle", outputs: [], panelMeta: { diagnostics: [], context: null }, error: null,
  summary: { durationMs: null, exitCode: null }, run: vi.fn(), clearOutputs: vi.fn(), setPanelMeta: vi.fn(), isRunning: false, isLoading: false,
}) }));
vi.mock("@/components/editor/markdown-export-dialog", () => ({ MarkdownExportDialog: () => null }));
vi.mock("@/components/ai/selection-ai-hub", () => ({ SelectionAiHub: () => null }));
vi.mock("@/lib/file-view-state", () => ({
  buildPersistedFileViewStateKey: () => null, loadPersistedFileViewState: async () => null, savePersistedFileViewState: async () => {},
}));
const draft = "# Draft\n\nKeep this exact unsaved source.";
const view = (onSave: () => Promise<void>, fileId = "coedit-a", content = "# Original") => <ObsidianMarkdownViewer fileName={fileId + ".md"} filePath={fileId + ".md"} fileId={fileId} paneId="pane-fixture" content={content} onChange={vi.fn()} onSave={onSave} />;
beforeEach(() => setLocale("zh-CN"));
afterEach(() => vi.restoreAllMocks());

describe("Markdown save recovery", () => {
  it("shows a rejected save, retains the exact draft, copies it and clears the error only after successful retry", async () => {
    const onSave = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("private server detail")).mockResolvedValueOnce(undefined);
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(view(onSave));
    fireEvent.change(screen.getByLabelText("Fixture Markdown editor"), { target: { value: draft } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save from editor" })));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/保存未完成.*草稿/u);
    expect(alert.textContent).not.toContain("private server detail");
    expect(screen.getByLabelText("Fixture Markdown editor")).toHaveProperty("value", draft);
    fireEvent.click(screen.getByRole("button", { name: "复制草稿" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(draft));
    expect(screen.getByLabelText("Fixture Markdown editor")).toHaveProperty("value", draft);
    fireEvent.click(screen.getByRole("button", { name: "再次保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("does not carry a delayed rejection into a different document", async () => {
    let rejectSave!: (cause: Error) => void;
    const onSave = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
    const rendered = render(view(onSave));
    fireEvent.change(screen.getByLabelText("Fixture Markdown editor"), { target: { value: draft } });
    fireEvent.click(screen.getByRole("button", { name: "Save from editor" }));
    rendered.rerender(view(async () => {}, "coedit-b", "# Other document"));
    await act(async () => rejectSave(new Error("old file save failure")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Fixture Markdown editor")).toHaveProperty("value", "# Other document");
  });
});