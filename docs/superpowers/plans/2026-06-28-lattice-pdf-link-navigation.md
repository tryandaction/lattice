# Lattice PDF Link Navigation Plan

## Goal

Make PDF links behave like a professional paper reader:

- Citation and internal PDF links jump to the referenced page or named destination inside the current PDF viewer.
- Web links, DOI links, and mail links open reliably through Lattice's existing link router.
- Users can choose whether PDF web links open in a Lattice web tab or the system browser.
- Modifier-click keeps a fast escape hatch: Ctrl/Meta/Shift opens external links in the browser.
- Link clicks must not interfere with text selection, highlight creation, or annotation drag/resize.

## Current Findings

- The PDF viewer renders an annotation layer and already detects `.annotationLayer a`, `[role="link"]`, and `.linkAnnotation`.
- Normal link clicks are not routed; the click capture handler only suppresses accidental link activation after a drag.
- Lattice already has `navigateLink`, which opens external URLs internally by default or externally when requested.
- Lattice already has web tabs with an "Open in browser" command, so PDF links should reuse that pathway.

## Interaction Design

### Internal PDF links

Supported targets:

- `#page=12`
- `#annotation=ann-id`
- `#nameddest=...`
- hash-only named destinations such as `#section.1`
- PDF.js explicit destinations available through `data-dest` / `data-pdf-dest`

Behavior:

- Prevent browser hash navigation.
- Resolve destination to a 1-based page number.
- Warm/render the page, scroll it into view, and flash the destination page.
- If an annotation id matches a stored annotation, use the existing annotation navigation path.

### External links

Supported targets:

- `https://...`
- `http://...`
- `mailto:...`
- `doi:...`
- `www...`

Behavior:

- Default setting: open in Lattice web tab.
- Setting option: open in browser.
- Ctrl/Meta/Shift click: open in browser for the current click.
- Browser-unsafe or non-web protocols continue to use the system opener through `navigateLink`.

## Settings

Add:

```ts
pdfExternalLinkOpenMode: "internal" | "browser"
```

Settings UI:

- Location: Files tab.
- Label: PDF web links.
- Choices: Open in Lattice / Open in browser.
- Description should make it clear that web tabs still include an "Open in browser" command.

## Implementation Steps

1. Add a small PDF link navigation helper for DOM target extraction and link classification.
2. Extend app settings, defaults, normalization, and settings UI/i18n.
3. In `PDFHighlighterAdapter`, handle annotation link clicks before selection suppression logic.
4. Resolve internal PDF destinations via fragment parsing first, then `PDFDocumentProxy.getDestination/getPageIndex`.
5. Reuse `navigateLink` for external URLs with the selected open mode.
6. Add regression tests for:
   - external link opens in Lattice by default,
   - modifier-click opens in browser,
   - `#page=N` jumps inside the PDF,
   - helper parsing for DOI/web/named destinations.

## Verification

- Focused unit/component tests for PDF highlighter and link helper.
- `npm run typecheck`.
- Scan for hardcoded UI labels introduced by this change.
