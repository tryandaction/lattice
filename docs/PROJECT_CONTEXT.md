# Lattice Project Context

> **Current Status & Decision Log** for the Lattice project.
> 
> Last Updated: January 2026 | Version: 1.0

---

## Table of Contents

1. [Current Phase](#current-phase)
2. [Completed Phases](#completed-phases)
3. [Component Status](#component-status)
4. [Upcoming Phases](#upcoming-phases)
5. [Decision Log](#decision-log)

---

## Current Phase

### Phase: Interaction Polish (Step 6)

| Attribute | Value |
|-----------|-------|
| **Phase Name** | Interaction Polish |
| **Step Number** | 6 |
| **Status** | 🟢 **ACTIVE** |
| **Started** | January 2026 |
| **Focus** | Architecture definition, documentation, editor integration planning |

### Current Objectives

1. ✅ Define architecture documentation (this document)
2. ⏳ Plan CodeMirror 6 integration
3. ⏳ Plan MathLive integration
4. ⏳ Design Pyodide lazy-loading strategy

### Blockers

None currently.

---

## Completed Phases

### Step 1: Project Setup
- **Status**: ✅ Complete
- **Deliverables**: Next.js project scaffolding, Tailwind configuration, basic routing

### Step 2: File System Integration
- **Status**: ✅ Complete
- **Deliverables**: File System Access API integration, directory picker, file tree

### Step 3: Layout System
- **Status**: ✅ Complete
- **Deliverables**: Resizable panes, tab management, drag-and-drop

### Step 4: Basic Viewers
- **Status**: ✅ Complete
- **Deliverables**: Image viewer, PDF viewer, basic text display

### Step 5: Basic Rendering
- **Status**: ✅ Complete
- **Deliverables**: 
  - Markdown rendering
  - Jupyter notebook rendering (read-only)
  - PowerPoint viewer
  - Word document viewer
  - Code syntax highlighting (read-only)

### Step 5.5: PDF Annotation System (Zotero-style)
- **Status**: ✅ Complete
- **Deliverables**:
  - Zotero-style annotation toolbar
  - Text highlighting with color picker
  - Sticky notes (click to add)
  - Area selection (Alt+drag or tool button)
  - Zoom controls (Ctrl+wheel, Ctrl++/-, fit-width)
  - Viewport center preservation during zoom
  - Keyboard shortcuts for tools (H/U/N/T/A/D/Esc)
  - Annotation persistence (.lattice/annotations/)
  - PDF export with annotations

---

## Component Status

### Editor Components

| Component | Status | Notes |
|-----------|--------|-------|
| **Tiptap** | 🟡 PARTIAL | Basic integration exists, needs enhancement |
| **MathLive** | 🔴 PENDING | Not yet integrated |
| **CodeMirror 6** | 🔴 PENDING | Chosen, not yet integrated |
| **Monaco Editor** | ⛔ DEPRECATED | **CANCELLED** - See [Decision Log](#decision-monaco-rejection) |

### Execution Components

| Component | Status | Notes |
|-----------|--------|-------|
| **Pyodide** | 🔴 PENDING | Lazy-loading strategy defined |
| **Web Worker** | 🔴 PENDING | Required for Pyodide isolation |

### Storage Components

| Component | Status | Notes |
|-----------|--------|-------|
| **File System Access API** | 🟢 ACTIVE | Primary storage, working |
| **IndexedDB** | 🟡 PARTIAL | Metadata caching, needs expansion |

### State Management

| Component | Status | Notes |
|-----------|--------|-------|
| **Zustand** | 🟢 ACTIVE | Global workspace state |
| **Jotai** | 🔴 PENDING | Planned for editor atoms |

### Legend

| Symbol | Meaning |
|--------|---------|
| 🟢 ACTIVE | Fully implemented and in use |
| 🟡 PARTIAL | Partially implemented, needs work |
| 🔴 PENDING | Planned, not yet started |
| ⛔ DEPRECATED | Rejected or cancelled |

---

## Upcoming Phases

### Step 7: Editing Phase

**Focus**: Full editing capabilities for notes and documents

**Deliverables**:
- [ ] Enhanced Tiptap integration
- [ ] Block-based editing
- [ ] Slash commands
- [ ] Collaborative editing foundation (Y.js)

**Dependencies**: Current phase completion

### Step 8: Math Phase

**Focus**: Mathematical formula editing

**Deliverables**:
- [ ] MathLive integration as Tiptap NodeView
- [ ] Structure-First editing implementation
- [ ] Tab cycling navigation
- [ ] Quantum HUD (stretch goal)

**Dependencies**: Step 7 (Tiptap enhancement)

### Step 9: Code Phase

**Focus**: Code editing and execution

**Deliverables**:
- [ ] CodeMirror 6 integration
- [ ] Jupyter cell editing
- [ ] Pyodide integration (lazy-loaded)
- [ ] Web Worker execution environment

**Dependencies**: Step 7 (editor foundation)

### Step 10: Polish Phase

**Focus**: Performance optimization and UX refinement

**Deliverables**:
- [ ] Performance profiling and optimization
- [ ] Accessibility audit
- [ ] Mobile responsiveness
- [ ] Error handling improvements

**Dependencies**: Steps 7-9 completion

---

## Decision Log

### Decision: Monaco Rejection
<a name="decision-monaco-rejection"></a>

| Attribute | Value |
|-----------|-------|
| **Date** | January 2026 |
| **Decision** | Reject Monaco Editor in favor of CodeMirror 6 |
| **Status** | ⛔ **FINAL** |

**Context**:
Monaco Editor was initially considered for code editing due to its VS Code heritage and feature richness.

**Problem**:
1. **Bundle size**: Monaco adds 2MB+ to the bundle
2. **Mobile support**: Poor touch and mobile experience
3. **Integration complexity**: Monaco wants to own the viewport
4. **Feature overkill**: We don't need IntelliSense, debugging, etc.

**Decision**:
Use CodeMirror 6 instead.

**Rationale**:
- ~150KB bundle (vs 2MB+)
- Excellent mobile support
- Modular architecture (use only what you need)
- Easy to embed in other editors (Tiptap NodeView)
- Active development and modern API

**Consequences**:
- No built-in IntelliSense (acceptable trade-off)
- Need to implement some features manually
- Better performance and smaller bundle

---

### Decision: Pyodide Lazy Loading

| Attribute | Value |
|-----------|-------|
| **Date** | January 2026 |
| **Decision** | Lazy-load Pyodide only on first "Run" action |
| **Status** | ✅ **APPROVED** |

**Context**:
Pyodide (Python in WebAssembly) is required for Jupyter notebook execution.

**Problem**:
Pyodide runtime is ~20MB. Eager loading would:
1. Slow initial page load significantly
2. Waste bandwidth for users who never run Python
3. Block the main thread during initialization

**Decision**:
Implement lazy-on-demand loading:
1. Pyodide is NOT loaded on page load
2. Pyodide is loaded when user clicks "Run" for the first time
3. Loading happens in a Web Worker (non-blocking)
4. Show loading indicator during first load

**Rationale**:
- Preserves fast initial page load
- Progressive enhancement pattern
- Most users may never execute Python
- Web Worker isolation prevents main thread blocking

**Consequences**:
- First "Run" has ~5-10 second delay (one-time)
- Need loading UI for first execution
- Subsequent runs are instant (cached)

---

### Decision: Dual State Management

| Attribute | Value |
|-----------|-------|
| **Date** | January 2026 |
| **Decision** | Use Zustand for global state, Jotai for editor atoms |
| **Status** | ✅ **APPROVED** |

**Context**:
Need state management for both application-level state and fine-grained editor state.

**Problem**:
Single store approach causes:
1. Unnecessary re-renders when any state changes
2. Complex selectors for editor-specific state
3. Difficulty managing multiple editor instances

**Decision**:
Dual-store architecture:
- **Zustand**: Global workspace state (open files, layout, settings)
- **Jotai**: Atomic editor state (cursor, selection, undo history)

**Rationale**:
- Zustand: Simple API, minimal boilerplate, good DevTools
- Jotai: Atomic updates, no unnecessary re-renders, scales with editors
- Clear separation of concerns

**Consequences**:
- Two libraries to learn/maintain
- Need clear boundaries between stores
- Better performance for editor-heavy workloads

---

### Decision: Structure-First Math Editing

| Attribute | Value |
|-----------|-------|
| **Date** | January 2026 |
| **Decision** | Adopt Structure-First approach for math editing |
| **Status** | ✅ **APPROVED** |

**Context**:
Need to decide on math editing paradigm.

**Options Considered**:
1. **LaTeX source editing**: User types raw LaTeX
2. **Structure-First**: User manipulates visual structure
3. **Hybrid**: Both approaches equally supported

**Decision**:
Structure-First with LaTeX as escape hatch.

**Rationale**:
- Lower barrier to entry for non-LaTeX users
- Immediate visual feedback
- Fewer syntax errors
- Inspired by proven tools (TeXmacs, Mogan)
- LaTeX still available for power users

**Consequences**:
- Need robust visual math editor (MathLive)
- Tab cycling navigation required
- Quantum HUD feature planned for symbol input

---

## Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Technical blueprint and component relationships
- [UX_GUIDELINES.md](./UX_GUIDELINES.md) - Interaction philosophy and patterns
