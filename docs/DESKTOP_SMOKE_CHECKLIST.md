# Lattice Desktop Smoke Checklist

This checklist is the mandatory real-desktop smoke pass before a release candidate. Run it in the installed app or `npm run tauri:dev`; browser-only checks are not a substitute.

## Preconditions

- Use a real workspace folder on disk, not a mocked fixture.
- Include at least one PDF, one Markdown file, one `.py`, one `.js` or `.ts`, one C/C++ source file, and one `.ipynb` notebook.
- Ensure local Python is available when validating the notebook/Python runner path.
- Run `node scripts/code-runner-manual-smoke.mjs` before the manual pass to print the current code runner checklist and local toolchain visibility.

## P0 Flow

1. Open workspace
   - Start Lattice desktop.
   - Open the test workspace folder.
   - Confirm Explorer shows the real folder tree and the active workspace name.

2. Open PDF
   - Open a PDF from Explorer.
   - Confirm the PDF renders in the active pane and the PDF toolbar/sidebar are usable.

3. Create PDF annotation
   - Select text or create a highlight.
   - Add a short comment.
   - Confirm the annotation appears in the PDF sidebar.
   - Confirm `.lattice/items/<fileId>/_annotations.md` is created only after the first real annotation.

4. Jump annotation
   - Click the annotation in the sidebar.
   - Confirm the PDF scrolls to the annotated page/region.
   - If the annotation has a backlink from a note, confirm the backlink jumps back to the PDF annotation.

5. Open image
   - Open a real `.png` or `.jpg` from Explorer.
   - Confirm workspace-buffer images open in the image annotation workbench when file handles are available.
   - Confirm desktop preview URL images still open in the lightweight image viewer.
   - Confirm zoom, fit, fit width, fit height, actual size, pan, rotate, reset, and download actions work without a blank pane.

6. Create image annotation
   - Open `/diagnostics/image-viewer` and leave it visible for at least 20 seconds.
   - Open `/diagnostics/image-annotation`.
   - Click `创建样例标注`, then `读取 sidecar`.
   - Confirm `Adapter Ready` is `true`, shape count is non-zero, and `Sidecar 含 image target` is `true`.
   - Click `重新挂载` and confirm the sample annotation restores.
   - Export an annotated PNG from the image command bar when testing a real workspace image.

7. Write Markdown
   - Open or create a Markdown file.
   - Edit text and confirm live preview updates.
   - Add a link to the PDF annotation or another workspace file and confirm in-app navigation works.

8. Run Python cell
   - Open a notebook.
   - Run a Python code cell such as `x = 41; x + 1`.
   - Confirm output appears in the notebook runner feedback area.
   - Confirm failures appear in Problems rather than only in console logs.

9. Run code files
   - Open a `.py` file, run it, then introduce a known exception and click the Problems or stderr location.
   - Open a `.js` or `.ts` file and run it through Node.
   - Open a saved `.c` or `.cpp` file from a path with spaces, run it, then introduce a compile error and click the emitted location when available.
   - Confirm Run / Stop / Rerun state is clear for success, error, and stopped runs.

10. Code editor workflow
   - Use Search, Go to Line, and Outline from the active pane command bar.
   - Confirm Outline shows symbols for Markdown/Python/JS/TS/C/C++ files and clicking a symbol jumps to the correct line.
   - Confirm opening/closing Outline does not resize or obscure the bottom Run / Problems dock.

11. Explorer context menu workflow
   - Right-click a code file and confirm Open to the Side creates or uses a side pane.
   - Use Copy Path and Copy Relative Path and paste the clipboard content into a scratch note.
   - In the desktop app, use Reveal in File Explorer and Open With to confirm the OS receives the selected path.
   - Right-click a file and a folder and use Open in Integrated Terminal; confirm the terminal starts in the file's parent folder or selected folder.
   - Use Select for Compare on one text file, then Compare with Selected on another text file; confirm both files open side by side and the File Compare dialog shows added/removed lines.
   - Confirm Rename, Delete, Copy/Cut/Paste, New File, and New Folder still work after these actions.

12. Restart and restore workspace
   - Close Lattice completely.
   - Reopen Lattice.
   - Confirm the last workspace, pane layout, open tabs, active file, PDF/image view state, and runner preferences restore.

## Pass Criteria

- No React runtime error, blank pane, or frozen command bar during the flow.
- No console error requiring a reload to continue.
- All created PDF/image annotations and Markdown edits persist after restart.
- Python, Node, C/C++, and Notebook execution either have visible output or actionable diagnostics.
- Problems entries and clickable stderr locations navigate back to the relevant file line when the runner emits a parseable location.

## Known Out-Of-Scope For Launch Gate

- PPT/Word/plugin/Webview expansion beyond existing usable behavior.
- Full LSP/debugger parity for code files.
- Remote kernel management.

## v2.3.0 PDF Smoke Addendum

Latest automated PDF pass: 2026-06-07.

Automated browser coverage now passes through `npm run test:browser-regression:pdf -- --continue-on-failure`:

- `pdfjs-probe`: browser PDF.js `getDocument` single and dual document probes.
- `pdf-render-core`: PDF pane boot, text layer probes, formula-adjacent text, split layout bounds.
- `pdf-interaction-core`: annotation sidebar, left pane zoom, right pane zoom.
- `selection-copy`: kernel-backed copy text around formulas, ligatures, Greek notation, and references.
- `highlight-save-restore`: save a text highlight and restore it from PDF page-space anchors.
- `position-restore`: close/reopen state restore for page, scroll position, zoom, and PDF sidebar state.
- `pdf-state-core`: deep scroll, right file switch, manual zoom restore after file switch.

The synthetic fixture intentionally covers the PDF cases that caused the regression:

- Rydberg-style two-column paper layout.
- Formula-adjacent prose and explicit `T2* / Omega / Delta2 / g2 / alpha/beta` probes.
- Ligature words such as `affinity` and `fluorescence`.
- Citation/reference probes including `[21]` and `[12, 17]`.
- Multi-page right pane switching, pane-scoped zoom restoration, and close/reopen page restoration.

Manual real-PDF smoke still required before final publish:

- Open the real Rydberg-style two-column paper used during debugging.
- Select and copy text before and after a left-column equation.
- Select and copy right-column body text.
- Drag a cross-line highlight and confirm it does not jump columns.
- Confirm Greek letters, superscript/subscript notation, ligatures, and citation numbers remain selectable enough for copy/annotation.
- Save a PDF annotation, close the app, reopen, and jump back to the saved annotation.
- Scroll to a middle or late page, close and reopen Lattice, and confirm the same PDF returns near the last viewed position instead of page 1.
- Open and close the annotation sidebar, Evidence, Workbench, and Selection AI entry points while viewing a later page; confirm those operations do not reset the PDF scroll position.
- For scanned-PDF coverage, install local Tesseract with the needed language packs, open a scanned fixture, and confirm OCR either provides usable copy text or fails gracefully without affecting born-digital PDF parsing.
- Install and launch both `releases/v2.3.0/Lattice_2.3.0_x64-setup.exe` and `releases/v2.3.0/Lattice_2.3.0_x64_en-US.msi`.

Installer execution was not performed during the automated pass because it modifies the local Windows installation state and requires explicit operator confirmation.
