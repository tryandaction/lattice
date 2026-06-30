/**
 * @vitest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkbenchContextMenu } from "../workbench-context-menu";

describe("WorkbenchContextMenu", () => {
  it("keeps long menus inside the viewport and preserves action execution", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 360 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 420 });

    const onSelect = vi.fn();
    const onClose = vi.fn();
    const actions = Array.from({ length: 24 }, (_, index) => ({
      id: `item-${index}`,
      label: `Item ${index}`,
      onSelect: index === 20 ? onSelect : vi.fn(),
    }));

    render(
      <WorkbenchContextMenu
        x={380}
        y={320}
        actions={actions}
        onClose={onClose}
      />,
    );

    const menu = screen.getByRole("menu");
    expect(menu.style.maxHeight).toBeTruthy();
    expect(menu.className).toContain("overflow-y-auto");

    fireEvent.click(screen.getByRole("menuitem", { name: "Item 20" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens child actions as a submenu beside the parent item", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });

    const childSelect = vi.fn();
    const parentSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <WorkbenchContextMenu
        x={120}
        y={120}
        actions={[
          {
            id: "more-tools",
            label: "More Tools",
            onSelect: parentSelect,
            children: [
              { id: "insert-table", label: "Insert table", onSelect: childSelect },
            ],
          },
        ]}
        onClose={onClose}
      />,
    );

    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: /More Tools/ }));

    const child = await screen.findByRole("menuitem", { name: "Insert table" });
    fireEvent.click(child);

    await waitFor(() => {
      expect(childSelect).toHaveBeenCalledTimes(1);
    });
    expect(parentSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens nested tool groups without flattening the menu", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 720 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 960 });

    const insertSymbol = vi.fn();
    const onClose = vi.fn();

    render(
      <WorkbenchContextMenu
        x={80}
        y={80}
        actions={[
          {
            id: "more-tools",
            label: "More Tools",
            onSelect: vi.fn(),
            children: [
              {
                id: "symbols",
                label: "Symbols",
                onSelect: vi.fn(),
                children: [
                  { id: "math-infinity", label: "∞", onSelect: insertSymbol },
                ],
              },
            ],
          },
        ]}
        onClose={onClose}
      />,
    );

    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: /More Tools/ }));
    const symbols = await screen.findByRole("menuitem", { name: /Symbols/ });
    fireEvent.pointerEnter(symbols);

    const infinity = await screen.findByRole("menuitem", { name: "∞" });
    fireEvent.click(infinity);

    await waitFor(() => {
      expect(insertSymbol).toHaveBeenCalledTimes(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
