# PDF toolbar and eraser closure

## Goals

- Keep PDF overflow predictable: zoom in, zoom out, export original PDF, and export PDF with annotations must always live in the more menu.
- Split export intent clearly. Original export copies source bytes; annotated export flattens current PDF annotations when present.
- Make the eraser behave like a PDF tool. Ink keeps drag-to-erase behavior, while non-ink annotations are removed on click.
- Preserve existing command-bar layout and avoid changing unrelated renderers.

## Implementation notes

- Reuse `exportFile` for both web and Tauri export paths.
- Register the two PDF export actions as explicit overflow actions, not secondary actions that may be hidden by viewport pressure.
- In eraser mode, intercept annotation clicks before edit/menu handling.
- Add focused regression coverage for command registration and non-ink deletion.
