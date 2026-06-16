# Lattice Image Workbench Plan

Updated: 2026-06-08

## Scope

This plan upgrades Lattice image reading and editing into a professional workbench without turning the first pass into an unbounded rewrite. The near-term goal is a stable, non-destructive image viewer and annotation base, plus a testable architecture for daily pixel edits and scientific measurement.

## Current State

### Entry Routing

Images enter the main viewer through `src/components/main-area/universal-file-viewer.tsx`.

- `getRendererForExtension(getFileExtension(fileName))` maps image extensions to the `image` renderer.
- `content.kind === "desktop-url"` renders `ImageViewer` directly because the app already has a desktop preview URL and no browser file handle is needed.
- `fileHandle && rootHandle && content.kind === "buffer"` renders `ImageTldrawAdapter` because sidecar annotations need a real workspace file handle and root handle.
- Buffer images without a full handle context fall back to `ImageViewer`.
- Text or web URL content on the image route fails closed with the binary/text error state.

Supported image extensions are defined in `src/lib/file-utils.ts`:

`png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `bmp`, `ico`, `tiff`, `tif`, `eps`, `avif`, `heic`, `heif`.

Important limitation: extension recognition is not full codec support. Browser `<img>` support for TIFF, EPS, HEIC/HEIF, and some AVIF deployments is runtime-dependent. Scientific TIFF/OME-TIFF/16-bit data must not be treated as fully supported until a dedicated decoder path exists.

### ImageViewer

`src/components/renderers/image-viewer.tsx` is the lightweight read path. It currently supports:

- Buffer and desktop-url sources.
- Object URL lifecycle management via `useObjectUrl`.
- Zoom in/out, fit, fit width, fit height, actual size.
- Rotation by 90 degrees.
- Pan by drag and Ctrl/Cmd wheel zoom.
- Download original image URL/blob.
- Fullscreen.
- Pane command bar integration.
- Persisted view state keyed by workspace/file identity.
- Universal annotation navigation highlight for image percentage targets.

### ImageTldrawAdapter

`src/components/renderers/image-tldraw-adapter.tsx` is the non-destructive annotation path. It currently supports:

- Tldraw canvas with locked background image asset/shape.
- Draw, erase, rectangle, line, arrow, text, select, hand tools.
- Undo/redo through Tldraw.
- Optional universal annotation sidebar.
- Sidecar save/restore through `useAnnotationSystem`.
- Original image download.
- Export with annotations as PNG via Tldraw SVG rasterization.
- Diagnostic sample shape injection for browser smoke.
- Background shape/asset recovery to avoid blank canvas after user edits.

Persisted image annotations use universal annotation sidecars. Tldraw shapes are serialized with percentage coordinates in `src/lib/tldraw-serialization.ts`, then stored in `AnnotationItem.content`.

### Existing Test Coverage

- `src/components/renderers/__tests__/image-viewer.test.tsx`: object URL lifecycle and desktop-url path.
- `src/lib/__tests__/tldraw-serialization.test.ts`: shape percentage round trips and validation.
- `src/lib/__tests__/non-destructive-editing.test.ts`: verifies original image bytes remain unchanged by shape sidecar operations.
- `src/lib/__tests__/image-tldraw-state.test.ts`: background asset props, recovery checks, region center mapping.
- Diagnostics:
  - `/diagnostics/image-viewer`
  - `/diagnostics/image-annotation`

## Professional Benchmarks

### Tldraw

Official SDK guidance supports image asset records, image shapes, locked shapes, shape persistence through store records, and export through `editor.getSvgString(...)` / `editor.toImage(...)`. This makes Tldraw a good fit for vector annotation, whiteboard-like overlays, background image locking, and annotated exports. It is not the right abstraction for destructive or real pixel operations such as brightness, contrast, histogram, LUT, or calibrated raster processing.

Source: tldraw SDK docs via Context7 `/tldraw/tldraw` and tldraw official docs pages on default image shapes, locked shapes, and image export.

### ImageJ / Fiji

ImageJ/Fiji defines the scientific baseline: calibration, Set Scale, scale bars, ROI Manager, Analyze/Measure, histogram, line profile, LUT, metadata, and channel-aware workflows. Lattice should adopt the workflow model rather than copy the full application.

First Lattice slice: calibration metadata, line/rectangle ROI measurement, scale bar overlay model, histogram/line profile pure data utilities, and provenance on export.

Sources: ImageJ official user guide and ImageJ docs for Analyze, Set Scale, ROI Manager, Plot Profile, Histogram, and Scale Bar.

### napari

napari separates image data from image, shapes, points, metadata, scale, and multichannel layer concepts. This validates a Lattice model where the original image, vector annotation layer, ROI/measurement layer, and pixel edit operation list are separate serializable layers.

Sources: napari official docs for image layers, shapes layers, points layers, scale bar, metadata, and multichannel images.

### Konva / Fabric.js / Canvas / WebGL

Konva and Fabric.js both provide useful patterns for interactive canvas transforms, image crop, filters, serialization, and data URL export. They are candidates for a future UI layer, but adding either now would introduce bundle and migration risk.

First Lattice slice should use a native Canvas pipeline model and pure functions. A future ADR can compare:

- Native Canvas: smallest dependency surface, enough for P1 crop/rotate/flip/filters/export.
- Konva: strong interactive transform/filter tooling, but adds a scene graph dependency and React binding decisions.
- Fabric.js: rich object model, filters, JSON/SVG export, but heavier and overlaps with Tldraw for vector objects.
- WebGL/WASM: best for large/16-bit/scientific data later, too much scope for P1.

Sources: Konva official docs via Context7 `/konvajs/site`; Fabric.js official docs via Context7 `/websites/fabricjs`.

### GIMP / Photopea / VS Code / OpenSeadragon

- GIMP/Photopea: reference for daily edit UX: crop, rotate, flip, adjustments, layers, export, before/after preview.
- VS Code: reference for lightweight image viewing: stable, fast, command-driven, minimal chrome.
- OpenSeadragon: reference for deep zoom and pan of very large images.

First Lattice slice should stay closer to VS Code stability plus a professional tool surface. OpenSeadragon-style tile/deep-zoom is post-P1 unless large image profiling proves current rendering is insufficient.

## Architecture Decision

### Keep In Tldraw

- Vector annotation tools: draw, erase, rectangle, line, arrow, text.
- Annotation navigation and highlight.
- Locked background image.
- Sidecar persistence of shapes with percentage coordinates.
- Annotated PNG export through Tldraw export APIs or equivalent SVG rasterization.

### New Image Edit Pipeline

Pixel edits need a separate serializable operation model:

- `crop`
- `rotate`
- `flip`
- `resize`
- `adjust` for brightness, contrast, exposure, saturation, grayscale, invert/LUT basics

The operation list is non-destructive project state. The source image is never overwritten by default. Export creates a new PNG/JPEG with operation provenance.

### New Scientific Model

Minimum scientific closed loop:

- Calibration: pixels per unit with `um`, `mm`, `cm`, `inch`, or `px`.
- Scale bar configuration: length, unit, position, color, font size.
- Measurements: line length and rectangle ROI area.
- ROI model: id, name, color, visibility, geometry, optional notes.
- Export metadata: source image identity, edit operations, annotations summary, calibration, measurements, timestamp.

### Explicitly Out Of First Round

- Full ImageJ clone.
- Full layer compositor.
- AI ROI understanding.
- OME-TIFF/16-bit decoding.
- WebGL/WASM processing.
- New Konva/Fabric dependency.
- Direct destructive overwrite of original images.

## Phased Implementation

### Phase 0: Audit And Design

Done in this pass:

- Audit existing image viewer/annotation files.
- Create this plan.
- Establish pure image editor state and scientific model scaffolding.
- Add tests for serializable operations and measurement math.
- Establish a native Canvas pixel edit pipeline for crop, rotate, flip, resize, brightness, contrast, exposure, saturation, grayscale, invert, and Blob export.

### Phase 1: P0 Stability And Diagnostics

Targets:

- Keep `/diagnostics/image-viewer` and `/diagnostics/image-annotation` as the primary browser smoke pages.
- Extend desktop smoke checklist with image open, zoom, pan, rotate, annotate, sidecar restore, annotation jump, and annotated export.
- Protect against React maximum update depth regressions by keeping background recovery event-driven and debounced.
- Keep object URL lifecycle tests green.

### Phase 2: Architecture Split

Targets:

- Move non-UI image editor state into `src/lib/image-editor/`.
- Keep existing `ImageTldrawAdapter` behavior while gradually replacing internal helpers with pure modules.
- Preserve legacy sidecar format.

### Phase 3: Daily Pixel Editing Minimum Loop

Targets:

- Implement real Canvas export pipeline for crop, rotate, flip, brightness, contrast.
- Add preview original/edited, undo, reset, and export edited PNG/JPEG.
- Add a professional workbench UI with top/side tool surfaces and a compact status bar.

Current status:

- The core Canvas pipeline exists in `src/lib/image-editor/canvas-pipeline.ts`.
- UI integration remains the next step: wire operation state and edited-image export into the image workbench without changing original files by default.

### Phase 4: Scientific Minimum Loop

Targets:

- Calibration panel.
- Scale bar overlay/export.
- Line and rectangle ROI measurements.
- Measurement export as JSON/CSV.
- Histogram and line profile for 8-bit grayscale/browser-decoded images.
- Clear limitation messaging for TIFF/16-bit/OME-TIFF.

### Phase 5: Gate

Required commands:

```bash
npm run typecheck
npm run test:run
npm run build
```

Desktop-linked changes should also run:

```bash
npm run tauri:build
```

Manual/browser smoke:

- `/diagnostics/image-viewer`
- `/diagnostics/image-annotation`

## Risks And Controls

- React update loops: isolate editor listeners and debounce side effects.
- Unsupported scientific formats: recognize extensions but surface limitations until decoded by a dedicated pipeline.
- Bundle growth: no new canvas library dependency without ADR.
- Sidecar compatibility: do not change current Tldraw shape content format without migration.
- Coordinate confusion: keep separate types for image pixels, percentages, viewport coordinates, and calibrated units.
- Dirty worktree: keep changes scoped and do not revert unrelated user work.
