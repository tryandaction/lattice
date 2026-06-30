# Formula Extractor reliability plan

## Root cause

The current Formula Extractor is not a true formula OCR engine. For PDF files it primarily consumes the PDF text layer and applies heuristic filters. This fails on scientific PDFs because displayed equations are split into many positioned text fragments, while references and dense prose can look symbol-heavy after PDF text extraction.

## Practical architecture

1. Built-in extraction, always available:
   - Group PDF text fragments by visual rows and display blocks.
   - Detect equation layout using geometry, symbol structure, labels, and nearby continuation lines.
   - Convert common Unicode/math text patterns to LaTeX.
   - Produce stable targets with page and bounding box for reveal.
   - Support copy/export as Markdown and LaTeX.

2. Optional local OCR backend, implemented as an on-demand desktop path:
   - pix2tex/LaTeX-OCR for cropped formula images from the current PDF selection.
   - Surya/Marker for full-page/layout-aware extraction.
   - Keep this optional because these require Python, model weights, and user-managed runtime resources.

## Current implementation scope

- Fix common paper equations from PDF text geometry without requiring Python.
- Improve Hamiltonian/quantum-state formulas such as `H_{00}(t)`, `|q⟩`, `Ω(t)e^{iφ(t)}`, `O(ε^2)`, and `θ_{11}=2θ_{01}-θ_{00}+π`.
- Preserve diagnostics for rejected candidates.
- Keep export and reveal behavior unchanged, but feed them reliable formulas.
- Add a PDF selection OCR command that crops the active single-page formula region, calls local `pix2tex`, and inserts the result as reviewable LaTeX.

## OCR backend decision

- Default: no bundled model and no background OCR, so ordinary document scans stay fast.
- Desktop optional backend: `pix2tex` command on PATH. Users can install it separately via the LaTeX-OCR project.
- Fallback behavior: if `pix2tex` is unavailable, the plugin reports a clear error and keeps text-layer extraction intact.
