# PDF Item Workspace Routing Design

## Goal

PDF item workspaces must behave like durable document companions rather than path-only folders. A PDF can be moved, renamed, or copied, and Lattice should recover the same annotations and related files from the document identity.

## Design

- Use the PDF content fingerprint and stable `documentId` as the primary identity.
- Keep path-derived file ids only as storage aliases and migration candidates.
- When a PDF with an existing fingerprint opens at a new path:
  - If the previous PDF path still exists, treat the new PDF as a copy and reuse the original item workspace without duplicating files.
  - If the previous PDF path no longer exists, treat the new path as a move or rename and migrate the item workspace path.
- Recursively list item workspace entries, including folders and arbitrary file extensions.
- Treat the PDF Explorer row as a drop target. Dragging a file or folder onto a PDF moves that entry into the PDF's item workspace, refreshes the tree, and expands the PDF's virtual children.
- Rewrite managed Markdown and notebook PDF links recursively where possible.
- Keep copy routing explicit by recording the new path in `knownPdfPaths`; generated annotation markdown continues to point at the active opened PDF path.

## Explorer Drag-and-Drop

- Directory-to-directory drag keeps the existing filesystem move semantics.
- File/folder-to-PDF drag resolves the target PDF manifest first, then moves the source into `manifest.itemFolderPath`.
- The same move pipeline updates open tabs, Explorer selection, annotation sidecars, Markdown link indexes, and PDF item workspaces for nested PDFs.
- Invalid drops are ignored: a PDF cannot be dropped onto itself, and a folder cannot be moved into its own descendant item workspace.

## Runtime Boundary

Lattice cannot mutate `.lattice` while the desktop app is not running because the current Tauri layer has no background watcher or OS service. The recovery happens deterministically on the next open: content fingerprint lookup repairs manifests, sidecars, and generated links.
