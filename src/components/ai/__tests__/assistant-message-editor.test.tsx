import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AssistantMessageEditor } from "../assistant-message-editor";

const { saveMessage, liveProps } = vi.hoisted(() => ({
  saveMessage: vi.fn(),
  liveProps: vi.fn(),
}));

vi.mock("@/stores/ai-chat-store", () => ({
  useAiChatStore: (selector: (state: unknown) => unknown) => selector({ updateAssistantMessage: saveMessage }),
}));
vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({ t: (key: string, params?: { reason?: string }) => params?.reason ? `${key}: ${params.reason}` : key }),
}));
vi.mock("@/components/editor/codemirror/live-preview/live-preview-editor", () => ({
  LivePreviewEditor: (props: { content: string; onChange: (text: string) => void; readOnly?: boolean; mode?: string }) => {
    liveProps(props);
    return <textarea data-testid="existing-live-editor" value={props.content} readOnly={props.readOnly}
      onChange={(event) => props.onChange(event.target.value)} />;
  },
}));

describe("assistant message editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveMessage.mockResolvedValue(undefined);
  });

  it("reuses the lazy LivePreviewEditor with the full Markdown and saves its local draft", async () => {
    const onClose = vi.fn();
    const source = "# Full answer\n\n$x^2$\n\n---\n\n| A | B |\n|---|---|\n| 1 | 2 |";
    render(<AssistantMessageEditor messageId="m1" content={source} onClose={onClose} />);
    const editor = await screen.findByTestId("existing-live-editor");
    expect((editor as HTMLTextAreaElement).value).toBe(source);
    expect(liveProps).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "live", fileId: "ai-response-m1", autoHeight: false }));
    fireEvent.change(editor, { target: { value: `${source}\n\nEdited.` } });
    expect(saveMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("ai-assistant-edit-save"));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(saveMessage).toHaveBeenCalledWith("m1", `${source}\n\nEdited.`, source);
  });

  it("cancels without writing the draft", async () => {
    const onClose = vi.fn();
    render(<AssistantMessageEditor messageId="m2" content="Original" onClose={onClose} />);
    fireEvent.change(await screen.findByTestId("existing-live-editor"), { target: { value: "Draft" } });
    fireEvent.click(screen.getByTestId("ai-assistant-edit-cancel"));
    expect(onClose).toHaveBeenCalledOnce();
    expect(saveMessage).not.toHaveBeenCalled();
  });

  it("keeps the draft and shows a persistence failure until retry succeeds", async () => {
    saveMessage.mockRejectedValueOnce(new Error("disk full"));
    const onClose = vi.fn();
    render(<AssistantMessageEditor messageId="m3" content="Original" onClose={onClose} />);
    const editor = await screen.findByTestId("existing-live-editor");
    fireEvent.change(editor, { target: { value: "Unsaved draft" } });
    fireEvent.click(screen.getByTestId("ai-assistant-edit-save"));
    expect((await screen.findByRole("alert")).textContent).toContain("disk full");
    expect((editor as HTMLTextAreaElement).value).toBe("Unsaved draft");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("ai-assistant-edit-save"));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("handles save/cancel shortcuts without intercepting IME composition", async () => {
    const onClose = vi.fn();
    render(<AssistantMessageEditor messageId="m4" content="Original" onClose={onClose} />);
    const editor = await screen.findByTestId("existing-live-editor");
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true, isComposing: true });
    fireEvent.keyDown(editor, { key: "Escape", isComposing: true });
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true, keyCode: 229 });
    expect(saveMessage).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
    await waitFor(() => expect(saveMessage).toHaveBeenCalledOnce());
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("cancels on Escape and does not write empty Markdown", async () => {
    const onClose = vi.fn();
    render(<AssistantMessageEditor messageId="m5" content="Original" onClose={onClose} />);
    const editor = await screen.findByTestId("existing-live-editor");
    fireEvent.change(editor, { target: { value: "  " } });
    fireEvent.click(screen.getByTestId("ai-assistant-edit-save"));
    expect(screen.getByRole("alert").textContent).toContain("chat.edit.empty");
    expect(saveMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("prevents duplicate saves and cancellation while the write is pending", async () => {
    let completeSave!: () => void;
    saveMessage.mockReturnValue(new Promise<void>((resolve) => { completeSave = resolve; }));
    const onClose = vi.fn();
    render(<AssistantMessageEditor messageId="m6" content="Original" onClose={onClose} />);
    const editor = await screen.findByTestId("existing-live-editor");
    fireEvent.click(screen.getByTestId("ai-assistant-edit-save"));
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(editor, { key: "Escape" });
    expect((screen.getByTestId("ai-assistant-edit-save") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("ai-assistant-edit-cancel") as HTMLButtonElement).disabled).toBe(true);
    expect(saveMessage).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { completeSave(); });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
