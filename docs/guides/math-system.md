# Math System Guide

This guide explains how math input, normalization, rendering, and copy/export work across Lattice editors.

---

## 1. Supported Inputs

### Markdown (CodeMirror)
- Inline: `$E=mc^2$`
- Block:
  ```markdown
  $$
  \int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
  $$
  ```
- Bracketed delimiters: `\(a+b\)` and `\[a+b\]` (auto-normalized)
- LaTeX environments: `\begin{align} ... \end{align}` (treated as display)
- MathML / OMML paste (auto-converted when possible)

### MathLive (Visual Editor)
- Double-click a rendered formula to open the MathLive editor.
- Use the symbol palette or Quantum Keyboard for structured input.

---

## 2. Normalization Pipeline

When text enters the system:
1. **Delimiter normalization** converts `\(...\)` / `\[...\]` to `$...$` / `$$...$$`.
2. **MathML / OMML conversion** attempts to map XML formulas into LaTeX.
3. **Display mode detection** uses newlines or block environments to select `$$...$$`.

Key helpers:
- `normalizeFormulaInput()` in `src/lib/formula-utils.ts`
- `normalizeScientificText()` in `src/lib/markdown-converter.ts`

---

## 3. Rendering Pipeline

### CodeMirror Live Preview
- Parsing: `decoration-coordinator.ts`
- Rendering: `MathWidget` + KaTeX
- Behavior:
  - Single-click: cursor jumps to formula start
  - Double-click: open MathLive editor
  - Right-click: copy Markdown formula
  - Shift/Alt + right-click: copy LaTeX only

### Tiptap MathLive Nodes
- Nodes: `mathlive-node.tsx`
- Paste handler: `latex-paste-handler.ts`
- Visual editing uses MathLive with KaTeX fallback for static display.

---

## 4. Copy & Export

- **Live Preview (CodeMirror):**
  - Right-click formula → copies Markdown (`$...$` / `$$...$$`)
  - Shift/Alt + right-click → copies pure LaTeX
- **Math Editor overlay:**
  - “Copy MD” and “Copy LaTeX” buttons

---

## 5. Paste Behavior (CodeMirror)

If clipboard content looks like a standalone formula:
- Auto-wraps into Markdown math
- Accepts LaTeX, MathML, OMML, or math-delimited text

If clipboard content looks like regular Markdown:
- Normal paste (no interception)

---

## 6. Troubleshooting

- **Formula not rendering**: check KaTeX CSS is loaded and the formula is valid.
- **Weird copy output**: use Shift/Alt + right-click to force LaTeX copy.
- **Paste not detected**: ensure clipboard is a standalone formula (not mixed prose).

---

## 7. Related Files

- `src/lib/formula-utils.ts`
- `src/lib/markdown-converter.ts`
- `src/lib/katex-config.ts`
- `src/components/editor/codemirror/live-preview/decoration-coordinator.ts`
- `src/components/editor/codemirror/live-preview/widgets.ts`
- `src/components/editor/codemirror/live-preview/math-paste-plugin.ts`
- `src/components/editor/math-editor.tsx`
- `src/components/editor/extensions/latex-paste-handler.ts`
- `src/components/editor/extensions/mathlive-node.tsx`

---

If you add new math behavior, update this guide and `DOCS_INDEX.md`.
