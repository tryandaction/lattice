/**
 * @vitest-environment jsdom
 */

import React from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DndProvider } from "../dnd-provider";

const reorderTabs = vi.fn();
const moveTabToPane = vi.fn();
const moveTabToNewSplit = vi.fn();
let capturedOnDragEnd: ((event: unknown) => void) | null = null;

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: (selector: (state: {
    reorderTabs: typeof reorderTabs;
    moveTabToPane: typeof moveTabToPane;
    moveTabToNewSplit: typeof moveTabToNewSplit;
  }) => unknown) => selector({
    reorderTabs,
    moveTabToPane,
    moveTabToNewSplit,
  }),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd?: (event: unknown) => void;
  }) => {
    capturedOnDragEnd = onDragEnd ?? null;
    return <div>{children}</div>;
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
  useSensor: () => ({}),
  useSensors: () => [],
  PointerSensor: function PointerSensor() { return null; },
  KeyboardSensor: function KeyboardSensor() { return null; },
}));

vi.mock("@dnd-kit/sortable", () => ({
  sortableKeyboardCoordinates: vi.fn(),
}));

vi.mock("@/components/main-area/tab", () => ({
  Tab: () => <div>mock-tab</div>,
}));

describe("DndProvider", () => {
  beforeEach(() => {
    reorderTabs.mockReset();
    moveTabToPane.mockReset();
    moveTabToNewSplit.mockReset();
    capturedOnDragEnd = null;
  });

  it("reorders tabs when dropping on another tab in the same pane", () => {
    render(
      <DndProvider>
        <div>content</div>
      </DndProvider>,
    );

    capturedOnDragEnd?.({
      active: {
        data: {
          current: {
            type: "tab",
            paneId: "pane-a",
            tabIndex: 0,
            tab: {
              id: "tab-1",
              fileName: "a.md",
              filePath: "a.md",
              fileHandle: {} as FileSystemFileHandle,
              isDirty: false,
              scrollPosition: 0,
            },
          },
        },
      },
      over: {
        data: {
          current: {
            type: "tab",
            paneId: "pane-a",
            tabIndex: 2,
          },
        },
      },
    });

    expect(reorderTabs).toHaveBeenCalledWith("pane-a", 0, 2);
    expect(moveTabToPane).not.toHaveBeenCalled();
  });
});
