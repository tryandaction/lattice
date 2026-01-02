# Lattice UX Guidelines

> **Interaction Philosophy** for the Lattice editor ecosystem.
> 
> Last Updated: January 2026 | Version: 1.0

---

## Table of Contents

1. [Core Philosophy](#core-philosophy)
2. [Math Interaction: Structure-First](#math-interaction-structure-first)
3. [Code Interaction](#code-interaction)
4. [Keyboard Conventions](#keyboard-conventions)
5. [Visual Design Principles](#visual-design-principles)

---

## Core Philosophy

### Calm, Focused Editing

Lattice is designed to feel like a **calm workspace**, not a busy IDE. We prioritize:

- **Focus**: Minimize distractions, maximize content visibility
- **Flow**: Smooth transitions, no jarring interruptions
- **Clarity**: Clear visual hierarchy, obvious affordances
- **Speed**: Instant response to user actions

### Performance Over Features

> "A fast, simple tool beats a slow, feature-rich one."

We deliberately choose **fewer features done well** over comprehensive feature sets:

- No feature bloat
- No "just in case" functionality
- Every feature must justify its performance cost
- Lazy load everything that isn't immediately needed

### Progressive Disclosure

Complex features reveal themselves gradually:

1. **Level 1**: Basic editing works immediately
2. **Level 2**: Power features discoverable via shortcuts
3. **Level 3**: Advanced customization in settings

---

## Math Interaction: Structure-First

### Philosophy: GNU TeXmacs / Mogan Inspired

Lattice adopts a **"Structure-First"** approach to mathematical editing, inspired by [GNU TeXmacs](https://www.texmacs.org/) and [Mogan](https://mogan.app/).

**Core Principle**: Users manipulate mathematical **structure**, not LaTeX source code.

```
┌─────────────────────────────────────────────────────────┐
│                  Structure-First                        │
│                                                         │
│   User thinks:  "fraction with x on top"               │
│   User does:    Press "/" → type "x" → Tab → type "y"  │
│   User sees:    x/y rendered beautifully               │
│                                                         │
│   NOT:          Type "\frac{x}{y}" and hope it works   │
└─────────────────────────────────────────────────────────┘
```

### Visual Editing Over LaTeX Source

| Approach | Lattice Priority |
|----------|------------------|
| Visual WYSIWYG editing | ✅ **Primary** |
| LaTeX source editing | ⚠️ Secondary (escape hatch) |
| Raw text input | ❌ Discouraged |

**Why Visual First?**
- Lower barrier to entry
- Immediate feedback
- Fewer syntax errors
- More intuitive for non-LaTeX users

**LaTeX as Escape Hatch**:
- Power users can still type LaTeX
- Copy/paste LaTeX from external sources
- Export to LaTeX for papers

### Tab Cycling Navigation

**The Tab key is the primary navigation tool in math mode.**

```
┌─────────────────────────────────────────────────────────┐
│  Fraction Example:  ∫ □/□ dx                           │
│                       ↑                                 │
│                    cursor                               │
│                                                         │
│  [Tab]     → Move to next placeholder (denominator)    │
│  [Tab]     → Move to next placeholder (dx)             │
│  [Tab]     → Exit math block                           │
│                                                         │
│  [Shift+Tab] → Move backwards through placeholders     │
└─────────────────────────────────────────────────────────┘
```

**Tab Cycling Rules**:
1. Tab moves forward through empty placeholders (□)
2. Shift+Tab moves backward
3. Final Tab exits the math block
4. Placeholders are visually distinct (light gray box)

### The Quantum HUD (Planned Feature)

> 🚧 **Status**: Planned for future implementation

**Concept**: Double-tap Tab to reveal a **1:1 mapped virtual keyboard** for mathematical symbols.

```
┌─────────────────────────────────────────────────────────┐
│                    Quantum HUD                          │
│                                                         │
│  Trigger: Double-tap Tab (within 300ms)                │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  q → θ    w → ω    e → ε    r → ρ    t → τ     │   │
│  │  a → α    s → σ    d → δ    f → φ    g → γ     │   │
│  │  z → ζ    x → ξ    c → χ    v → ν    b → β     │   │
│  │                                                 │   │
│  │  1 → ¹    2 → ²    3 → ³    / → ÷    * → ×     │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  The HUD overlays the keyboard, showing symbol         │
│  mappings. Press any key to insert its symbol.         │
└─────────────────────────────────────────────────────────┘
```

**Design Goals**:
- Zero learning curve (keys map to similar-sounding Greek letters)
- Muscle memory friendly
- Dismisses automatically after input
- Semi-transparent overlay (doesn't block content)

### Math Input Shortcuts

| Input | Result | Description |
|-------|--------|-------------|
| `/` | Fraction | Creates □/□ structure |
| `^` | Superscript | Creates x^□ |
| `_` | Subscript | Creates x_□ |
| `sqrt` | Square root | Creates √□ |
| `sum` | Summation | Creates Σ with bounds |
| `int` | Integral | Creates ∫ with bounds |
| `lim` | Limit | Creates lim with subscript |
| `matrix` | Matrix | Creates matrix structure |

---

## Code Interaction

### VS Code-Like Feel, Lightweight Performance

Code editing in Lattice should feel familiar to VS Code users, but without the heavyweight features.

**What We Include**:
- Syntax highlighting (all major languages)
- Basic autocomplete (local symbols)
- Bracket matching and auto-close
- Line numbers and minimap (optional)
- Multiple cursors
- Find and replace

**What We Exclude** (by design):
- Full IntelliSense / language servers
- Integrated debugging
- Git integration in editor
- Extension marketplace
- Terminal integration

### Code Cell Behavior (Jupyter)

```
┌─────────────────────────────────────────────────────────┐
│  [1] │ import numpy as np                              │
│      │ x = np.linspace(0, 10, 100)                     │
│      │ y = np.sin(x)                                   │
│      │                                          [Run ▶]│
├──────┼─────────────────────────────────────────────────┤
│  Out │ <matplotlib figure>                             │
└──────┴─────────────────────────────────────────────────┘
```

**Cell Interactions**:
- `Shift+Enter`: Run cell and move to next
- `Ctrl+Enter`: Run cell and stay
- `Escape`: Exit edit mode (cell selection mode)
- `Enter`: Enter edit mode
- `A`: Insert cell above (in selection mode)
- `B`: Insert cell below (in selection mode)

### Standalone Code Files

For `.py`, `.js`, `.ts`, and other code files:

- Full-window CodeMirror 6 editor
- Language-appropriate syntax highlighting
- No execution (view/edit only, unless Jupyter context)

---

## Keyboard Conventions

### Global Shortcuts

| Shortcut | Action | Context |
|----------|--------|---------|
| `Ctrl+S` | Save file | All editors |
| `Ctrl+Z` | Undo | All editors |
| `Ctrl+Shift+Z` | Redo | All editors |
| `Ctrl+F` | Find | All editors |
| `Ctrl+H` | Find and replace | All editors |
| `Ctrl+P` | Quick open file | Global |
| `Ctrl+Shift+P` | Command palette | Global |
| `Ctrl+W` | Close tab | Global |
| `Ctrl+Tab` | Next tab | Global |
| `Ctrl+Shift+Tab` | Previous tab | Global |

### Editor-Specific Shortcuts

#### Markdown/Notes (Tiptap)

| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+K` | Insert link |
| `Ctrl+Shift+M` | Insert math block |
| `Ctrl+Shift+C` | Insert code block |
| `Ctrl+1` through `Ctrl+6` | Heading levels |

#### Math (MathLive)

| Shortcut | Action |
|----------|--------|
| `Tab` | Next placeholder |
| `Shift+Tab` | Previous placeholder |
| `Escape` | Exit math mode |
| `Tab Tab` (double) | Quantum HUD (planned) |
| `/` | Fraction |
| `^` | Superscript |
| `_` | Subscript |

#### Code (CodeMirror 6)

| Shortcut | Action |
|----------|--------|
| `Ctrl+/` | Toggle comment |
| `Ctrl+D` | Select next occurrence |
| `Ctrl+Shift+K` | Delete line |
| `Alt+Up/Down` | Move line up/down |
| `Ctrl+Shift+D` | Duplicate line |
| `Ctrl+[` / `Ctrl+]` | Indent/outdent |

---

## Visual Design Principles

### Color and Contrast

- **High contrast** for text readability
- **Subtle backgrounds** for UI elements
- **Accent colors** used sparingly for actions
- **Dark mode** as first-class citizen

### Typography

- **Monospace** for code: JetBrains Mono, Fira Code
- **Serif** for math: Latin Modern, STIX Two
- **Sans-serif** for UI: Inter, system fonts

### Spacing and Rhythm

- Consistent 4px/8px spacing grid
- Generous whitespace around content
- Clear visual separation between sections

### Animation

- **Subtle** transitions (150-200ms)
- **Purposeful** animation (indicates state change)
- **Reducible** (respect `prefers-reduced-motion`)

---

## Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Technical blueprint and component relationships
- [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) - Current status and decision log
