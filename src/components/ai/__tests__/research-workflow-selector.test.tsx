import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn(), clear: vi.fn() };
vi.mock("@/lib/storage-adapter", () => ({ getStorageAdapter: () => storage }));
vi.mock("@/hooks/use-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import { ResearchWorkflowSelector } from "../research-workflow-selector";
import { useAiChatStore } from "@/stores/ai-chat-store";

describe("ResearchWorkflowSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAiChatStore.setState({ selectedResearchWorkflowId: null, noteConfigOverrides: {} });
  });
  it('starts with automatic routing and keeps manual delivery choices inside a closed advanced disclosure', () => {
    render(<ResearchWorkflowSelector />);
    const advanced = screen.getByTestId('research-workflow-advanced') as HTMLDetailsElement;
    expect(advanced.open).toBe(false);
    expect(screen.getByLabelText('chat.workflow.deliveryLabel').closest('details')).toBe(advanced);
    fireEvent.click(screen.getByText('chat.workflow.advanced'));
    expect(advanced.open).toBe(true);
    expect(screen.getByRole('combobox', { name: 'chat.workflow.deliveryLabel' }).id).toBe('research-workflow-select');
    expect(screen.getByText('chat.workflow.strategyHint')).toBeTruthy();
  });

  it('shows an explicit manual override and lets the user restore automatic routing', () => {
    useAiChatStore.setState({ selectedResearchWorkflowId: 'code-change-plan' });
    render(<ResearchWorkflowSelector />);
    expect(screen.getByText('chat.workflow.manualOverride')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'chat.workflow.resetAuto' }));
    expect(useAiChatStore.getState().selectedResearchWorkflowId).toBeNull();
  });

  it('shows PDF-only annotation settings only while a PDF source is available', () => {
    const { rerender } = render(<ResearchWorkflowSelector />);
    expect(screen.queryByLabelText('chat.workflow.annotationLimit')).toBeNull();
    rerender(<ResearchWorkflowSelector includePdfScoped />);
    expect(screen.getByLabelText('chat.workflow.annotationLimit')).toBeTruthy();
  });

  it('offers only concrete manual deliveries and gates new PDF annotation choices on PDF context', () => {
    const { rerender } = render(<ResearchWorkflowSelector />);
    const select = document.getElementById('research-workflow-select') as HTMLSelectElement;
    expect(Array.from(select.options, option => option.value)).toEqual(['', 'reading-note']);
    rerender(<ResearchWorkflowSelector includePdfScoped />);
    expect(Array.from(select.options, option => option.value)).toEqual(['', 'reading-note', 'pdf-annotation']);
    fireEvent.change(select, { target: { value: 'pdf-annotation' } });
    expect(useAiChatStore.getState().selectedResearchWorkflowId).toBe('pdf-annotation');
    rerender(<ResearchWorkflowSelector includePdfScoped={false} />);
    expect(select.value).toBe('pdf-annotation');
    expect(select.selectedOptions[0].disabled).toBe(true);
    fireEvent.change(select, { target: { value: '' } });
    expect(Array.from(select.options, option => option.value)).toEqual(['', 'reading-note']);
  });

  it('temporarily preserves a legacy selection without offering it as a new delivery', () => {
    useAiChatStore.setState({ selectedResearchWorkflowId: 'notebook-from-paper' });
    render(<ResearchWorkflowSelector includePdfScoped />);
    const select = document.getElementById('research-workflow-select') as HTMLSelectElement;
    expect(select.value).toBe('notebook-from-paper');
    expect(select.selectedOptions[0].disabled).toBe(true);
    expect(Array.from(select.options, option => option.value)).toEqual(['', 'reading-note', 'pdf-annotation', 'notebook-from-paper']);
    fireEvent.click(screen.getByRole('button', { name: 'chat.workflow.resetAuto' }));
    expect(useAiChatStore.getState().selectedResearchWorkflowId).toBeNull();
    expect(Array.from(select.options, option => option.value)).toEqual(['', 'reading-note', 'pdf-annotation']);
  });

  it("changes the workflow and all configurable note fields", async () => {
    render(<ResearchWorkflowSelector />);
    fireEvent.change(screen.getByLabelText("chat.workflow.deliveryLabel"), { target: { value: "reading-note" } });
    fireEvent.change(screen.getByLabelText("chat.workflow.language"), { target: { value: "en-US" } });
    fireEvent.change(screen.getByLabelText("chat.workflow.noteStyle"), { target: { value: "cornell" } });
    fireEvent.change(screen.getByLabelText("chat.workflow.sections"), { target: { value: "Summary, Evidence" } });
    fireEvent.blur(screen.getByLabelText("chat.workflow.sections"));
    fireEvent.change(screen.getByLabelText("chat.workflow.quotePolicy"), { target: { value: "evidence-table" } });
    fireEvent.change(screen.getByLabelText("chat.workflow.template"), { target: { value: "# {{title}}" } });
    fireEvent.blur(screen.getByLabelText("chat.workflow.template"));

    expect(useAiChatStore.getState()).toMatchObject({
      selectedResearchWorkflowId: "reading-note",
      noteConfigOverrides: { language: "en-US", noteStyle: "cornell", sections: ["Summary", "Evidence"], quotePolicy: "evidence-table", template: "# {{title}}" },
    });
    await waitFor(() => expect(storage.set).toHaveBeenCalledWith("lattice-ai-workflow-config-v1", expect.objectContaining({ version: 1 })));
  });

  it("preserves section input while typing and restores defaults when cleared", () => {
    useAiChatStore.setState({ noteConfigOverrides: { language: "en-US", noteStyle: "cornell", quotePolicy: "evidence-table", sections: ["Summary"], template: "# Note" } });
    render(<ResearchWorkflowSelector />);
    const sections = screen.getByLabelText("chat.workflow.sections") as HTMLInputElement;
    fireEvent.change(sections, { target: { value: "Summary," } });
    expect(sections.value).toBe("Summary,");
    expect(useAiChatStore.getState().noteConfigOverrides.sections).toEqual(["Summary"]);
    fireEvent.change(sections, { target: { value: "Summary, Evidence" } });
    fireEvent.blur(sections);
    expect(useAiChatStore.getState().noteConfigOverrides.sections).toEqual(["Summary", "Evidence"]);
    fireEvent.change(screen.getByLabelText("chat.workflow.language"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("chat.workflow.noteStyle"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("chat.workflow.quotePolicy"), { target: { value: "" } });
    fireEvent.change(sections, { target: { value: "" } });
    fireEvent.blur(sections);
    const template = screen.getByLabelText("chat.workflow.template");
    fireEvent.change(template, { target: { value: "" } });
    fireEvent.blur(template);
    expect(useAiChatStore.getState().noteConfigOverrides).toEqual({});
  });

  it("keeps a selected PDF workflow visible when PDF context disappears", () => {
    useAiChatStore.setState({ selectedResearchWorkflowId: "paper-reading" });
    const { rerender } = render(<ResearchWorkflowSelector includePdfScoped />);
    rerender(<ResearchWorkflowSelector includePdfScoped={false} />);
    expect((screen.getByLabelText("chat.workflow.deliveryLabel") as HTMLSelectElement).value).toBe("paper-reading");
    expect(screen.getByRole("status").textContent).toBe("chat.workflow.pdfContextRequired");
    expect(useAiChatStore.getState().selectedResearchWorkflowId).toBe("paper-reading");
  });

  it("keeps uncommitted text when stored settings arrive during editing", async () => {
    render(<ResearchWorkflowSelector />);
    const sections = screen.getByLabelText("chat.workflow.sections") as HTMLInputElement;
    const template = screen.getByLabelText("chat.workflow.template") as HTMLTextAreaElement;
    fireEvent.change(sections, { target: { value: "My section," } });
    fireEvent.change(template, { target: { value: "# My draft" } });
    storage.get.mockResolvedValue({ version: 1, overrides: { sections: ["Saved"], template: "# Saved" } });
    await act(async () => { await useAiChatStore.getState().loadWorkflowConfig(); });
    expect(sections.value).toBe("My section,");
    expect(template.value).toBe("# My draft");
    fireEvent.blur(sections);
    fireEvent.blur(template);
    expect(useAiChatStore.getState().noteConfigOverrides).toMatchObject({ sections: ["My section"], template: "# My draft" });
  });
});
