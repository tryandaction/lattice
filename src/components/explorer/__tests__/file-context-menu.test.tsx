/**
 * @vitest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UI_LAYER_CLASS } from "@/lib/ui-layers";
import { FileContextMenu } from "../file-context-menu";

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("FileContextMenu", () => {
  it("portals file menus above sidebar borders and resize handles", () => {
    const { container } = render(
      <div data-testid="sidebar-host">
        <FileContextMenu
          x={48}
          y={64}
          onRename={vi.fn()}
          onDelete={vi.fn()}
          onClose={vi.fn()}
        />
      </div>,
    );

    const menu = screen.getByRole("menu");
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
    expect(menu.className).toContain(UI_LAYER_CLASS.chromeMenu);
  });
});
