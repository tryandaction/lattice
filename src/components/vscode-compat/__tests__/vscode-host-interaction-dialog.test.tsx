/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VSCodeHostInteractionDialog } from "../vscode-host-interaction-dialog";
import { useVSCodeExtensionHostStore } from "@/stores/vscode-extension-host-store";

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("VSCodeHostInteractionDialog", () => {
  const resolveInteraction = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    useVSCodeExtensionHostStore.setState({
      pendingInteraction: null,
      resolveInteraction,
    } as never);
  });

  it("returns the selected QuickPick item to the extension host", async () => {
    useVSCodeExtensionHostStore.setState({
      pendingInteraction: {
        id: "interaction-1",
        type: "quickPick",
        title: "Choose a formatter",
        placeHolder: "Select one",
        canPickMany: false,
        items: [
          { id: "item-0", label: "Prettier", description: "Default formatter" },
          { id: "item-1", label: "Built-in" },
        ],
      },
    });

    render(<VSCodeHostInteractionDialog />);
    expect(screen.getByRole("dialog", { name: "Choose a formatter" })).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /Prettier/ }));
    });

    expect(resolveInteraction).toHaveBeenCalledWith({
      interactionId: "interaction-1",
      cancelled: false,
      selectedIds: ["item-0"],
    });
  });

  it("returns InputBox text and supports cancellation", async () => {
    useVSCodeExtensionHostStore.setState({
      pendingInteraction: {
        id: "interaction-2",
        type: "inputBox",
        title: "Create branch",
        prompt: "Branch name",
        value: "feature/",
      },
    });

    render(<VSCodeHostInteractionDialog />);
    const input = screen.getByRole("textbox", { name: "Branch name" });
    fireEvent.change(input, { target: { value: "feature/editor" } });

    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });

    expect(resolveInteraction).toHaveBeenCalledWith({
      interactionId: "interaction-2",
      cancelled: false,
      value: "feature/editor",
    });
  });
});
