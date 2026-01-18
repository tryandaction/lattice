# Lattice Roadmap V2 - Deep Optimization & Feature Enhancement

## Project Vision

**Lattice** aims to be the **ultimate zero-cost, local-first reading, annotation, editing, and note-taking solution for STEM users**. This roadmap focuses on polishing existing features to production quality and adding essential functionality requested by users.

## Core Principles

1. **Zero Cost**: No backend, no subscription, fully local
2. **STEM-First**: Prioritize formulas, scientific notation, technical documents
3. **Cross-Platform**: Web + Desktop (Tauri) with native feel
4. **Non-Destructive**: All annotations stored separately, never modify originals
5. **Obsidian-Like UX**: Clean, focused, keyboard-first interface

---

## Execution Order

### Phase 0: Critical Bug Fixes (MUST DO FIRST)
| File | Priority | Focus | Est. Time |
|------|----------|-------|-----------|
| 00-critical-bugs-fix.md | P0 | All reported bugs in one sweep | 4-6h |

### Phase 1: Core Experience (High Impact)
| File | Priority | Focus | Est. Time |
|------|----------|-------|-----------|
| 01-markdown-editor-complete.md | P1 | Tables, formulas in context, lists | 3-4h |
| 02-annotation-system-overhaul.md | P1 | Sidebar, defaults, toggle button | 3-4h |
| 03-quantum-keyboard-smart.md | P1 | Smart positioning, avoid blocking | 2-3h |

### Phase 2: Interface & Layout
| File | Priority | Focus | Est. Time |
|------|----------|-------|-----------|
| 04-sidebar-settings-obsidian.md | P2 | Settings button, left sidebar | 2-3h |
| 05-desktop-app-polish.md | P2 | Fullscreen default, layout fix | 2-3h |
| 06-file-management-pro.md | P2 | New folder, rename extension | 2-3h |

### Phase 3: Advanced Features
| File | Priority | Focus | Est. Time |
|------|----------|-------|-----------|
| 07-annotation-batch-export.md | P3 | Batch management, export fix | 3-4h |
| 08-ink-annotation-merge.md | P3 | Continuous ink as single annotation | 2-3h |
| 09-image-viewer-stability.md | P3 | Image disappearing fix | 2-3h |

### Phase 4: Future Planning
| File | Priority | Focus | Est. Time |
|------|----------|-------|-----------|
| FUTURE-ROADMAP.md | P4 | Mobile, tablet, AI integration | Planning |

---

## Total Estimated Time

- **Phase 0**: 4-6 hours (Critical)
- **Phase 1**: 8-11 hours (High Impact)
- **Phase 2**: 6-9 hours (Interface)
- **Phase 3**: 7-10 hours (Features)
- **Total**: ~25-36 hours

---

## Bug Summary (From User Report)

### Critical (P0)
1. Image disappears automatically during editing
2. MD table not rendering correctly
3. Formulas in tables or with bold/styling not rendering
4. List/bullet point format display incorrect
5. Quantum keyboard blocks formula editing position

### High (P1)
6. PDF annotation panel toggle button still on right side
7. Some annotations display incorrectly after export
8. Annotation sidebar should be closed by default

### Medium (P2)
9. Ink/drawing annotations in continuous area should be ONE annotation
10. Need batch annotation management
11. Settings button should be in left sidebar bottom (Obsidian style)
12. Desktop app layout cuts off bottom, should default to fullscreen

### Enhancement
13. Need to create new folders
14. Need to rename file extensions to change file type

---

## Technical Context

### Tech Stack
- **Frontend**: Next.js 15, React 19, Tailwind CSS
- **Editors**: Tiptap (Markdown), CodeMirror 6 (Code), MathLive (Math)
- **PDF**: react-pdf, react-pdf-highlighter
- **Image**: Tldraw
- **State**: Zustand, Jotai
- **Desktop**: Tauri v2

### Key Directories
```
src/
├── components/
│   ├── editor/           # Markdown editor, extensions
│   ├── hud/              # Quantum keyboard
│   ├── renderers/        # PDF, Image, PPT viewers
│   ├── sidebar/          # File browser, settings
│   └── ui/               # Shared UI components
├── hooks/                # Custom React hooks
├── lib/                  # Utilities
├── stores/               # Zustand stores
└── types/                # TypeScript types
```

### Key Files Reference
- `src/components/editor/advanced-markdown-editor.tsx` - Main MD editor
- `src/components/hud/keyboard-hud.tsx` - Quantum keyboard
- `src/components/renderers/pdf-highlighter-adapter.tsx` - PDF viewer
- `src/components/renderers/image-tldraw-adapter.tsx` - Image editor
- `src/components/sidebar/file-browser.tsx` - File management

---

## Quality Checklist

Before marking any prompt complete:
- [ ] No new TypeScript errors (`npx tsc --noEmit`)
- [ ] No new lint errors (`npm run lint`)
- [ ] Tests pass (`npm run test:run`)
- [ ] Manual testing on target feature
- [ ] Dark/light theme both work
- [ ] Desktop app tested (if applicable)

---

## Notes for Implementation

1. **Read existing code first** - Understand patterns before changing
2. **Small commits** - One feature/fix per commit
3. **Test as you go** - Don't accumulate untested changes
4. **Preserve existing behavior** - Don't break working features
5. **Document complex logic** - Add comments for non-obvious code
