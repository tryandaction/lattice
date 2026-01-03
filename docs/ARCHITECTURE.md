# Lattice Architecture

> **Source of Truth** for the Lattice project's technical decisions and component relationships.
> 
> Last Updated: January 2026 | Version: 1.0

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [Frontend Core](#frontend-core)
3. [State Management](#state-management)
4. [Editor Ecosystem](#editor-ecosystem)
5. [Execution Engine](#execution-engine)
6. [Storage Layer](#storage-layer)
7. [Component Diagrams](#component-diagrams)

---

## Philosophy

### Lightweight & High-Performance

Lattice follows a **"Lightweight & High-Performance"** architecture principle. Every technology choice prioritizes:

- **Bundle size**: Smaller is better. We reject bloated libraries.
- **Time-to-interactive**: The app must feel instant.
- **Lazy loading**: Heavy resources load on-demand, never eagerly.
- **Web standards**: Prefer native browser APIs over polyfills.

This philosophy directly influenced our rejection of Monaco Editor (2MB+ bundle) in favor of CodeMirror 6 (~150KB), and our lazy-loading strategy for Pyodide (20MB WASM runtime).

---

## Frontend Core

| Technology | Version | Purpose |
|------------|---------|---------|
| **Next.js** | 15+ | Framework with App Router |
| **React** | 19 | UI library with concurrent features |
| **Tailwind CSS** | 4+ | Utility-first styling |

### Why This Stack?

- **Next.js App Router**: Server components, streaming, and file-based routing
- **React 19**: Concurrent rendering for smooth editor interactions
- **Tailwind**: Zero-runtime CSS, tree-shakeable, design system friendly

---

## State Management

We use a **dual-store architecture** to separate concerns:

| Library | Scope | Use Case |
|---------|-------|----------|
| **Zustand** | Global | Workspace state (open files, layout, settings) |
| **Jotai** | Atomic | Editor state (cursor position, selection, undo history) |

### Why Two Libraries?

```
┌─────────────────────────────────────────────────────────┐
│                    Zustand Store                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Open Files  │  │   Layout    │  │  Settings   │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    Jotai Atoms                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
│  │ Editor1 │  │ Editor2 │  │ Editor3 │  │ Editor4 │   │
│  │  State  │  │  State  │  │  State  │  │  State  │   │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘   │
└─────────────────────────────────────────────────────────┘
```

- **Zustand**: Simple, minimal boilerplate, perfect for app-wide state
- **Jotai**: Atomic updates prevent unnecessary re-renders in editors

---

## Editor Ecosystem

### Overview

```mermaid
graph TB
    subgraph "Editor Ecosystem"
        TIPTAP[Tiptap<br/>Notes & Markdown]
        MATHLIVE[MathLive<br/>Math Formulas]
        CM6[CodeMirror 6<br/>Code Editing]
    end
    
    TIPTAP -->|NodeView wrapper| MATHLIVE
    TIPTAP -->|NodeView wrapper| CM6
    
    subgraph "Use Cases"
        NOTES[Markdown Notes]
        JUPYTER[Jupyter Notebooks]
        CODE[Standalone Code Files]
    end
    
    TIPTAP --> NOTES
    CM6 --> JUPYTER
    CM6 --> CODE
```

### Notes Editor: Tiptap

**Technology**: [Tiptap](https://tiptap.dev/) (built on ProseMirror)

**Features**:
- Block-based Markdown editing
- Extensible via custom NodeViews
- Collaborative editing ready (Y.js compatible)

**Integration Points**:
- Math blocks → MathLive NodeView
- Code blocks → CodeMirror 6 NodeView

### Math Editor: MathLive

**Technology**: [MathLive](https://cortexjs.io/mathlive/) (Web Component)

**Integration**: Wrapped as a Tiptap NodeView

**Why MathLive?**
- Native web component (framework agnostic)
- Visual WYSIWYG math editing
- Supports LaTeX input/output
- Accessible (screen reader support)

See [UX_GUIDELINES.md](./UX_GUIDELINES.md) for the "Structure-First" interaction philosophy.

### Code Editor: CodeMirror 6

> ⚠️ **CRITICAL DECISION**: We use **CodeMirror 6**, NOT Monaco Editor.

**Technology**: [CodeMirror 6](https://codemirror.net/)

**Use Cases**:
1. Standalone code files (.py, .js, .ts, etc.)
2. Jupyter notebook code cells
3. Inline code blocks in Tiptap

#### Why CodeMirror 6 Over Monaco?

| Criteria | CodeMirror 6 | Monaco Editor |
|----------|--------------|---------------|
| Bundle Size | ~150KB | 2MB+ |
| Mobile Support | ✅ Excellent | ❌ Poor |
| Customization | ✅ Modular | ⚠️ Monolithic |
| Performance | ✅ Lightweight | ⚠️ Heavy |
| Integration | ✅ Easy embed | ⚠️ Complex |

**Monaco is REJECTED** for the following reasons:
1. **Bundle bloat**: 2MB+ adds unacceptable load time
2. **Mobile unfriendly**: Monaco has poor touch/mobile support
3. **Overkill**: We don't need full IDE features (IntelliSense, debugging)
4. **Integration friction**: Monaco wants to own the entire viewport

---

## PDF Annotation System

### Overview (Zotero-style)

The PDF annotation system is designed to match Zotero's professional annotation experience.

```
┌─────────────────────────────────────────────────────────────────┐
│  [filename.pdf]     [H][U][N][T][A][D]     [-][120%][+][⟷]     │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │                    PDF Content                          │   │
│  │                                                         │   │
│  │    ████████████  ← Highlighted text                     │   │
│  │                                                         │   │
│  │    📝 ← Sticky note                                     │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Toolbar Layout

| Section | Tools |
|---------|-------|
| **Left** | File name |
| **Center** | Annotation tools: Highlight (H), Underline (U), Note (N), Text (T), Area (A), Draw (D) |
| **Right** | Zoom controls: Zoom out (-), Percentage, Zoom in (+), Fit width (⟷), Export |

### Annotation Tools

| Tool | Shortcut | Description |
|------|----------|-------------|
| **Highlight** | H | Select text to highlight with chosen color |
| **Underline** | U | Select text to underline |
| **Sticky Note** | N | Click anywhere to add a note |
| **Text** | T | Add text annotation |
| **Area** | A | Drag to select rectangular area |
| **Draw** | D | Freehand drawing (ink) |
| **Escape** | Esc | Return to select mode |

### Zoom Controls

| Control | Shortcut | Description |
|---------|----------|-------------|
| **Zoom In** | Ctrl++ | Increase by 25% |
| **Zoom Out** | Ctrl+- | Decrease by 25% |
| **Reset** | Ctrl+0 | Reset to 100% |
| **Wheel Zoom** | Ctrl+Scroll | Smooth zoom |
| **Fit Width** | Button | Fit PDF to container width |

### Key Features

1. **Viewport Center Preservation**: When zooming, the document point at viewport center stays centered
2. **Color Picker**: Quick color selection for highlights (dropdown from highlight tool)
3. **Tool Hints**: Status bar shows current tool and usage instructions
4. **Persistent Storage**: Annotations saved to `.lattice/annotations/` directory
5. **Export**: Export PDF with embedded annotations

---

## Execution Engine

### Pyodide (Python in WebAssembly)

**Technology**: [Pyodide](https://pyodide.org/) - CPython compiled to WebAssembly

**Runtime Environment**: Isolated **Web Worker**

```mermaid
sequenceDiagram
    participant UI as Main Thread
    participant Worker as Web Worker
    participant Pyodide as Pyodide Runtime
    
    UI->>UI: User clicks "Run"
    UI->>Worker: postMessage(code)
    
    Note over Worker: First run only
    Worker->>Pyodide: Load runtime (~20MB)
    Pyodide-->>Worker: Ready
    
    Worker->>Pyodide: exec(code)
    Pyodide-->>Worker: result/output
    Worker-->>UI: postMessage(result)
    UI->>UI: Display output
```

### Loading Strategy: Lazy-on-Demand

> ⚠️ **CRITICAL**: Pyodide is **NEVER** loaded on page load.

**The 20MB runtime is only fetched when**:
1. User clicks "Run" button on a code cell
2. User explicitly requests Python execution

**Why Lazy Loading?**
- 20MB is too large for eager loading
- Most users may never execute Python
- Preserves fast initial page load
- Progressive enhancement pattern

**Implementation**:
```typescript
// ❌ WRONG: Eager loading
import { loadPyodide } from 'pyodide';
const pyodide = await loadPyodide(); // Blocks page load!

// ✅ CORRECT: Lazy loading
async function runPython(code: string) {
  const { loadPyodide } = await import('pyodide');
  const pyodide = await loadPyodide();
  return pyodide.runPython(code);
}
```

---

## Storage Layer

### Dual Storage Architecture

```mermaid
graph LR
    subgraph "User's Machine"
        FS[File System<br/>Native Files]
    end
    
    subgraph "Browser"
        FSAPI[File System Access API]
        IDB[(IndexedDB<br/>Metadata Cache)]
    end
    
    subgraph "Lattice App"
        APP[Application]
    end
    
    APP -->|Read/Write| FSAPI
    FSAPI -->|Native Access| FS
    APP -->|Cache Metadata| IDB
```

### Primary: File System Access API

**Technology**: [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)

**Capabilities**:
- Direct read/write to user's local files
- No upload/download friction
- Real file handles (not copies)
- Directory picker for workspaces

**Browser Support**: Chrome, Edge (Chromium-based browsers)

### Secondary: IndexedDB (Metadata Cache)

**Purpose**: Cache file metadata for performance

**Cached Data**:
- File tree structure
- Last modified timestamps
- File type classifications
- Recently opened files

**NOT Cached**: File contents (always read from disk)

---

## Component Diagrams

### Full System Architecture

```mermaid
graph TB
    subgraph "Presentation Layer"
        NEXT[Next.js App Router]
        REACT[React 19 Components]
    end
    
    subgraph "Editor Layer"
        TIPTAP[Tiptap Editor]
        MATHLIVE[MathLive]
        CM6[CodeMirror 6]
    end
    
    subgraph "State Layer"
        ZUSTAND[Zustand<br/>Global State]
        JOTAI[Jotai<br/>Editor Atoms]
    end
    
    subgraph "Execution Layer"
        WORKER[Web Worker]
        PYODIDE[Pyodide WASM]
    end
    
    subgraph "Storage Layer"
        FSAPI[File System Access API]
        IDB[(IndexedDB)]
    end
    
    NEXT --> REACT
    REACT --> TIPTAP
    REACT --> CM6
    TIPTAP --> MATHLIVE
    
    REACT --> ZUSTAND
    REACT --> JOTAI
    
    REACT --> WORKER
    WORKER --> PYODIDE
    
    ZUSTAND --> FSAPI
    ZUSTAND --> IDB
```

### Data Flow: File Operations

```mermaid
sequenceDiagram
    participant User
    participant UI as React UI
    participant Store as Zustand Store
    participant FS as File System API
    participant Cache as IndexedDB
    
    User->>UI: Open file
    UI->>Store: requestFile(path)
    Store->>Cache: checkMetadata(path)
    Cache-->>Store: metadata (if cached)
    Store->>FS: readFile(handle)
    FS-->>Store: fileContent
    Store->>Cache: updateMetadata(path)
    Store-->>UI: fileData
    UI-->>User: Display content
```

---

## Related Documents

- [UX_GUIDELINES.md](./UX_GUIDELINES.md) - Interaction philosophy and patterns
- [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) - Current status and decision log
