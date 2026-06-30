# Lattice Annotations Activity Panel Plan

## Goal

Upgrade the global Annotations activity panel into a clean workspace-level annotation browser:

- Reduce nested cards, borders, and visual vertical lines.
- Show annotation content with the same semantic cues as the PDF annotation sidebar: color, type, page or line, quote text, and comment.
- Add search over file name, path, annotation text, comment, tags, page, and line.
- Keep navigation behavior reliable: click an annotation opens the exact target; "Open file" opens the source file.
- Preserve current scope and sort settings.

## Current Problems

- The panel wraps the count, controls, file groups, and annotation list in several bordered containers, creating visual noise.
- Each file group shows only the first four annotations, so users cannot inspect all content.
- Annotation rows render as plain truncated text and do not expose style color, type, page, or comment.
- There is no annotation-content search.
- Empty/search states are too generic.

## Interaction Design

### Layout

- Use one flat panel surface:
  - Compact header with total count and loading state.
  - Search input directly below the header.
  - Scope and sort segmented controls in one compact toolbar row.
  - File groups as unboxed sections separated by subtle horizontal dividers.
- Avoid nested cards. Use a single left color rail per annotation for the strongest visual cue.

### Annotation Row

Each annotation row shows:

- A color rail matching `annotation.style.color`.
- A compact metadata line:
  - type label,
  - page number for PDF,
  - line number for code,
  - created time.
- Primary quote/content text with natural wrapping, not fixed truncation.
- Optional comment in a quieter bubble-like block.
- Optional tags inline.

Rows remain clickable and use hover/focus states only; no extra nested controls inside the row except the group-level "Open file" command.

### Search

- Search box placeholder: "Search annotation text, comments, tags, or files..."
- Filter is case-insensitive.
- Match fields:
  - file name,
  - file path,
  - canonical annotation text,
  - comment,
  - tag,
  - page/line string.
- Count reflects filtered annotations.

### Sorting and Scope

- Existing scope values remain: all/current.
- Existing sort values remain: latest/count/name.
- For `count`, count is based on filtered annotations.
- For `latest`, latest is based on filtered annotations.

## Implementation Steps

1. Add small local helpers to extract annotation text, location label, type label, search haystack, and style color.
2. Replace deeply nested card markup with a flat header, search field, compact controls, and grouped sections.
3. Filter annotations before sorting groups.
4. Render every matching annotation, not only the first four.
5. Add i18n keys for search placeholder, match count, type labels, comments, and no-search-results state.
6. Update tests for current-file filtering, navigation, content search, color rendering, and complete result rendering.

## Verification

- Run focused annotations activity panel tests.
- Run typecheck.
- Scan for newly introduced hardcoded UI strings.
