# Lattice Zotero-Grade PDF Reading Design

**Date:** 2026-07-26

**Status:** Approved for implementation

## Goal

Make the existing Lattice PDF reading path reliably resolve readable text, one-drag selections, persistent text annotations, native and inferred links, and citation previews with Zotero-class precision while keeping interaction smooth on large academic PDFs.

## Non-Negotiable Compatibility

- Keep `src/components/renderers/pdf-highlighter-adapter.tsx` as the primary annotated PDF workflow.
- Preserve the existing PDF item workspace, PDF child-file routing, bibliography, annotation sidecar, markdown draft, and sidebar behavior.
- Preserve the existing `PdfTarget` storage contract: page, normalized rects, quote context, character indexes, quads, source, and confidence.
- Read legacy geometry-only annotations without rewriting them merely because the document was opened.
- Do not replace the renderer with Zotero Reader or copy Zotero implementation code.
- Do not create a branch, commit, push, deploy, or refresh `releases/` in this work.

## Research Conclusions

Zotero Reader owns a page character model and resolves pointer positions against character geometry. Its PDF text selection is not primarily a browser DOM-selection repair pipeline. Annotation positions are stored in PDF page coordinates and projected through the current PDF.js viewport when displayed.

PDF.js deliberately separates responsibilities:

- `getTextContent()` provides text items and transforms.
- `TextLayer` lays those items out for selection and accessibility using a page viewport.
- `AnnotationLayer` binds native PDF annotations, including URL, named action, and destination links.
- `PDFLinkService` resolves named or explicit destinations and delegates scrolling to the viewer.
- `PageViewport` is the boundary for PDF-space and viewport-space conversion.

Lattice already has most required primitives, but their responsibilities overlap. `pdf-page-text-cache`, `pdf-text-kernel`, `pdf-canonical-text-anchoring`, and the native selection portions of `pdf-selection-reconciler` each build related text or geometry representations. The adapter then arbitrates multiple snapshots and can transform the same selection more than once before persistence.

## Architecture

### 1. Canonical Page Text Kernel

`PdfTextKernelPage` becomes the shared, source-aware page representation. A page kernel contains:

- normalized and readable page text;
- character start/end offsets using JavaScript UTF-16 indexing;
- page-local viewport rectangles and normalized 0-1 rectangles;
- line, block, column, and layout classification;
- source provenance (`pdfium`, `pdfjs`, or `ocr`) and confidence;
- optional DOM node mappings that are valid only for the current rendered text layer.

Desktop source order is PDFium geometry first, PDF.js semantic text second, rendered DOM as a transient boundary hint, and OCR only for low-text pages. Web source order is PDF.js text content first and rendered DOM as a transient boundary hint.

Source arbitration must never splice unrelated offsets from two sources. A candidate is accepted only when compact text, pointer geometry, and page identity agree. Otherwise the resolver uses one complete source candidate or returns a deterministic failure.

### 2. Coordinate Contract

All persistent and reusable overlays use normalized page-local coordinates:

```text
PDF/PDFium coordinates
        -> source page-local viewport coordinates
        -> normalized page rects (0..1)
        -> current rendered page viewport coordinates
        -> client coordinates only at the DOM event boundary
```

Client and `DOMRect` values are transient. They must not enter annotation storage. Search rings, transient selection overlays, stored annotations, inferred link hotspots, citation hotspots, and target flashes all project from normalized page coordinates.

### 3. One-Drag Selection State Machine

Use one tokenized interaction state:

```text
idle -> native_dragging -> frozen -> committed
                          \-> cancelled
```

`pointerdown` records page-local start intent. Movement of at least three CSS pixels promotes the gesture to a drag and suppresses the following link click. `pointermove` updates only pointer geometry. `pointerup` freezes one immutable snapshot and schedules one resolution. Late `selectionchange` events may improve the DOM hint during a bounded settle window but cannot replace a geometry-trusted frozen snapshot with unrelated text.

Resolution order:

1. Resolve pointer endpoints or covered geometry against the canonical character model.
2. Use DOM Range offsets only when they map into the same page model.
3. Use native selection text only to validate or trim the canonical candidate.
4. Produce one `PdfCanonicalSelection` and normalize its page rects once.
5. Persist or show the transient action menu from that immutable selection.

Same-page multi-line and same-column paragraph selection are required. Cross-column selection is accepted only when pointer endpoints demonstrate a gutter crossing. Non-adjacent and currently unsupported cross-page selections fail without saving a wrong annotation. Multi-page persistence is deferred until the storage schema can represent per-page quotes and rects without weakening existing data.

### 4. Readable Text

Readable output is derived from canonical characters, not raw browser `Selection.toString()` alone. It must:

- collapse artificial fragment whitespace without joining real words;
- dehyphenate wrapped words when geometry and line continuation agree;
- preserve paragraph separation where column or block boundaries require it;
- retain superscript citation content without allowing it to reorder surrounding prose;
- avoid duplicate characters introduced by overlapping PDF.js text items;
- preserve UTF-16 indexes for ligatures and non-BMP text.

### 5. Persistent Annotation Recovery

Persisted text markup continues to store `textQuote`, `startCharIndex`, `endCharIndex`, normalized `rects`, `quads`, kernel version, source, and confidence.

Recovery order is fixed:

1. exact normalized quote with prefix/suffix disambiguation;
2. stored indexes validated against the quote;
3. context-aware fuzzy quote matching;
4. geometry-to-character recovery;
5. stored geometry display as a final fallback.

Recovery may improve in-memory display geometry but must not silently rewrite a precise stored annotation. Zoom, pane resize, virtualization, text-layer rebuild, and reopen only reproject normalized page geometry.

### 6. Links And Citations

Native PDF annotation links remain authoritative. Inferred text links are generated from canonical model offsets and use exact character rectangles. URL, `www`, DOI, arXiv, email, page, annotation, named destination, explicit destination, and named action routing continue through `pdf-link-navigation` and the existing Lattice `navigateLink` path.

A link click is eligible only when the pointer gesture stayed below the drag threshold and no canonical text selection was frozen. Dragging across a link suppresses its click and dragstart without disabling text selection.

Citation parsing continues through `pdf-reference-preview`, but hotspots are projected from canonical offsets. Hover uses a bounded delay; moving into the popup preserves it; clicking an entry warms and navigates to the target page, then flashes exact target rectangles.

### 7. Performance

- Never extract every page merely because search or the reader opened.
- Prefetch PDFium/PDF.js models only for visible, adjacent, anchor, and explicitly targeted pages.
- Reuse page model promises and resolved values.
- Keep pointermove free of async extraction and React state churn.
- Build link and citation indexes per ready page, then merge incrementally.
- Cache by document identity, page number, source, scale-independent model version, and rendered text-layer signature where DOM mapping is required.
- Cancel stale selection, navigation, and preview work with interaction tokens.

## Testing Strategy

Pure model and geometry behavior is tested before adapter behavior. Test fixtures cover fragmented spans, two columns, wrapped hyphenation, superscript citations, ligatures, repeated phrases, scaled pages, scroll offsets, stale text layers, low-text pages, and drag/link conflicts.

Component tests verify event ordering and persistence handoff. Existing PDF item workspace tests remain in the regression set. Real-document validation uses external academic PDFs and the existing diagnostics bridge; large binary fixtures are not committed.

Required close-out commands:

```powershell
npm run test:run -- "src/lib/__tests__/pdf-page-text-cache.test.ts" "src/lib/__tests__/pdf-text-kernel.test.ts" "src/lib/__tests__/pdf-selection-reconciler.test.ts" "src/lib/__tests__/pdf-selection-session.test.ts"
npm run test:run -- "src/lib/__tests__/pdf-canonical-text-anchoring.test.ts" "src/lib/__tests__/pdf-link-navigation.test.ts" "src/lib/__tests__/pdf-reference-preview.test.ts"
npm run test:run -- "src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx" "src/components/renderers/__tests__/pdf-item-workspace-panel.test.tsx"
npm run typecheck
npm run qa:gate
```

## Sources

- Zotero Reader: https://github.com/zotero/reader
- Zotero PDF selection implementation: https://github.com/zotero/reader/blob/master/src/pdf/selection.js
- PDF.js text layer: https://github.com/mozilla/pdf.js/blob/master/src/display/text_layer.js
- PDF.js annotation layer: https://github.com/mozilla/pdf.js/blob/master/src/display/annotation_layer.js
- PDF.js link service: https://github.com/mozilla/pdf.js/blob/master/web/pdf_link_service.js

