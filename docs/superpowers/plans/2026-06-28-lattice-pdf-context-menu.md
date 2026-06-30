# Lattice PDF Context Menu Upgrade

## Goal

Upgrade the PDF right-click menu from a single search command into a compact, reliable, localized PDF tool menu that matches Lattice workflows: reading, selection, annotation, AI, and precise page references.

## Problems Found

- The current menu is implemented inside `src/components/renderers/pdf-highlighter-adapter.tsx` as `PdfViewerContextMenu`.
- Visible labels are hard-coded Chinese/English and do not follow the global language setting.
- The menu only exposes copy/search actions. On an empty page click it often appears as a single "search PDF text" item, which feels broken and offers no PDF-specific value.
- Search action opens the existing search overlay, but the UI gives no context, no page actions, and no selection-aware AI/annotation actions.
- The menu uses semantic tokens, but needs stronger structure and consistent i18n keys.

## Design

### Menu Header

- Localized title: PDF Tools / PDF 工具.
- Context metadata:
  - Page number if available.
  - Selection snippet when text is selected.

### Selection Actions

Shown only when selected text exists:

- Copy selected text.
- Search selected text.
- Highlight selection.
- Underline selection.
- Ask AI about selection.

All actions must close the menu after execution and use existing Lattice PDF selection/annotation/Selection AI mechanisms.

### Page Actions

Always shown when the PDF pane is active:

- Open PDF search.
- Copy page link/reference.
- Toggle annotation panel.

These actions are intentionally limited: no duplicate zoom/export controls in the context menu.

## Implementation Notes

- Reuse `copyToClipboard`, `setSearchOpen`, existing `pendingSelectionDraft`, and existing `SelectionAiHub` state.
- Keep the menu in a portal with `UI_LAYER_CLASS.pdfFloating`.
- Do not introduce raw light/dark colors; use `bg-popover`, `text-popover-foreground`, `border-border`, `bg-muted`, `hover:bg-accent`.
- Use i18n keys under `pdf.context.*`.

## Acceptance Criteria

- Right-click on PDF shows a localized, theme-adaptive Lattice PDF menu.
- Empty page menu has useful page actions, not a single dead-looking command.
- Selected text menu exposes copy/search/annotation/AI actions.
- "Open PDF search" reliably opens the existing search overlay.
- "Search selected text" opens search overlay with the selected text as query.
- Context menu tests cover localized menu title, page actions, and selection actions.
- Typecheck and focused PDF context menu tests pass.
