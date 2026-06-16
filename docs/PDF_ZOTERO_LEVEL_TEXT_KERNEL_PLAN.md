# PDF Zotero-Level Text Kernel Plan

This document defines the release-quality target for Lattice PDF text recognition,
selection, copy, and annotation anchoring. The goal is not to claim perfect PDF
recognition, but to make PDF behavior measurable and regression-gated at a level
that can approach Zotero-class reliability over a growing corpus.

## Quality Bar

Lattice PDF text handling must treat DOM selection as a user gesture, not as the
source of truth. Final copied text and persisted annotations should come from the
PDF text kernel whenever a born-digital text layer is available.

Release gates:

- Browser PDF.js probe loads a real PDF fixture without worker errors.
- PDF annotations render core loads page 1 canvas and text layer in annotations mode.
- Text selection copy returns kernel-backed text, not raw DOM `selection.toString()`.
- Highlight save/restore persists PDF page-space rects/quads and restores on reopen.
- CJK continuous text cannot shift by one character while keeping the same length.
- Two-column fixtures cannot cross into the neighboring column.
- Formula, Greek, ligature, superscript, and citation-adjacent selections remain scoped.
- Scanned pages use OCR only when born-digital text is absent or insufficient.
- Real local corpus audit stays reproducible and flags invalid/scan-heavy PDFs
  before desktop release packaging.

## Kernel Requirements

Every page-level kernel should expose:

- `charIndex`
- `text`
- `normalizedText`
- `pdfRect`
- `pdfQuad`
- `viewportRect`
- `source`
- `confidence`
- `itemIndex`
- `lineIndex`
- `wordIndex`
- `columnIndex`
- `spaceAfter`
- `lineBreakAfter`
- `wordBreakAfter`
- `paragraphBreakAfter`
- `fontSize`
- `baseline`

Persisted text annotations should include:

- PDF page-space rects/quads
- exact quote
- prefix/suffix
- char range
- text kernel model version
- text source and confidence

## Multi-Source Strategy

Priority order:

1. PDF.js/PDFium born-digital character model.
2. Geometry-reconciled PDF.js rendered text model.
3. PDFium native text layout where available in desktop mode.
4. OCR fallback only for low-text/scanned pages.
5. DOM selection only as a gesture and fallback hint.

The reconciler must prefer candidates that best match visual geometry unless a
trusted live text candidate exactly matches the selected quote and does not drift
outside the selected rects.

## Quality Harness

The `pdf-text-kernel-quality` module scores kernel anchors with:

- text score
- geometry overlap score
- boundary drift in characters
- source
- confidence

Minimum release thresholds for curated born-digital fixtures:

- text score: `1.0`
- geometry score: `>= 0.85`
- boundary drift: `0`
- source: `pdfjs-text-model` or `pdfium-native`

OCR fixtures may use lower text/geometry thresholds, but OCR must never degrade
born-digital parsing.

## Real Corpus Gate

The read-only corpus audit checks the user's local paper/course PDF library with
PDF.js `getDocument()` + `getTextContent()` and never modifies source PDFs.
It classifies files before the runtime kernel path is blamed for impossible
cases such as scanned pages with no text layer.

Default corpus roots:

- `C:/universe/MyStudy/atom/Categorized Papers`
- `C:/universe/MyStudy/atom/Professor`
- `C:/universe/Course/选修/机器学习/courseML/课件`
- `C:/universe/Course`

Latest full audit on 2026-06-08:

- 882 unique PDFs, 3.93 GB total.
- 775 born-digital PDFs can enter the PDF.js text-kernel path.
- 44 PDFs expose no sampled text and require OCR fallback.
- 62 PDFs expose sparse text and should be routed through low-text/OCR
  inspection before promising copy/search fidelity.
- 1 PDF has invalid PDF structure:
  `C:/universe/MyStudy/atom/Categorized Papers/Supplementary_Materials/Manetsch 等 - 2025 - A tweezer array with 6,100 highly coherent atomic qubits_Supplementary.pdf`.

By root:

- `C:/universe/MyStudy/atom/Categorized Papers`: 70 born-digital, 1 error.
- `C:/universe/MyStudy/atom/Professor`: 306 born-digital.
- `C:/universe/Course`: 399 born-digital, 62 low-text, 44 OCR-required.

Release interpretation:

- Born-digital PDF failures are Lattice/PDF.js kernel bugs until proven
  otherwise.
- OCR-required PDFs are expected to have no reliable selectable text until OCR
  succeeds; region annotation must still work.
- Low-text PDFs require page-level inspection because textbooks/slides may mix
  searchable text, scanned pages, images, and formulas.

Runtime behavior:

- Rendered pages store `data-pdf-text-layer-source` as `pdfjs`, `low-text`, or
  `empty` for diagnostics and fallback decisions.
- `low-text` pages still allow PDF.js/PDFium text selection, but desktop mode
  asynchronously warms the free Tesseract OCR cache for likely scanned regions.
- `empty` pages do not treat DOM selection as reliable text truth. Text
  selection is cancelled unless PDFium native text is available; area
  annotations remain available.
- OCR cache warming is non-blocking and page-scoped, so scrolling and page
  switching should not wait for Tesseract.
- `PdfTextKernelPage` is cached per `PdfPageTextModel`, avoiding repeated
  character-kernel construction during selection, copy, and highlight save.

## Fixture Matrix

Required fixture classes:

- Rydberg/Jaksch/Saffman-style two-column physics papers.
- Chinese continuous prose with no spaces.
- CJK mixed with English identifiers.
- Formula-adjacent prose.
- Greek letters and math symbols.
- Superscripts/subscripts.
- Ligatures.
- Citation brackets and superscript-like references.
- Cross-line selection.
- Right-column-only selection.
- Scanned English page.
- Scanned Chinese page with `chi_sim` language pack.

## Validation Commands

Core:

```bash
npx tsc --noEmit --pretty false
npm run test:run -- src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx src/lib/__tests__/pdf-selection-reconciler.test.ts src/lib/__tests__/pdf-page-text-cache.test.ts src/lib/__tests__/pdf-selection-session.test.ts src/lib/__tests__/pdf-highlighter-adapter-utils.test.ts src/lib/__tests__/pdf-text-kernel.test.ts src/lib/__tests__/pdf-text-kernel-quality.test.ts src/lib/__tests__/pdf-ocr-text-engine.test.ts
```

Browser:

```bash
npm run test:browser-regression:pdf -- --segment pdfjs-probe
npm run test:browser-regression:pdf -- --segment pdf-render-core
npm run test:browser-regression:pdf -- --segment selection-copy
npm run test:browser-regression:pdf -- --segment highlight-save-restore
```

Real local corpus:

```bash
npm run test:pdf-corpus -- --max-pages 4
npm run test:pdf-corpus:gate -- --max-pages 4
```

`test:pdf-corpus:gate` fails on invalid PDF parsing errors. It does not fail on
`ocr-required` or `low-text`; those are routed to OCR/inspection instead.

## Remaining Work

- Promote representative real-paper corpus samples into curated fixtures with
  expected text/rect assertions.
- Add a browser diagnostics step that emits kernel quality scores.
- Add OCR browser/desktop smoke once Tesseract availability can be detected.
- Add a release report that fails when any curated born-digital fixture has text
  score below `1.0` or boundary drift above `0`.
