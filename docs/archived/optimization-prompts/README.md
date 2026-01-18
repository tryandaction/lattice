# Lattice Optimization Prompts

This folder contains structured optimization prompts for Claude Code to systematically improve the Lattice project.

## How to Use

1. Open each prompt file in order (01 → 02 → 03...)
2. Copy the content and paste it to Claude Code
3. Let Claude Code analyze and implement the fixes
4. Test the changes before moving to the next prompt

## Priority Levels

- **P0 (Critical)**: Core functionality broken, must fix immediately
- **P1 (High)**: Major UX issues, significant bugs
- **P2 (Medium)**: Enhancement opportunities, minor bugs
- **P3 (Low)**: Polish, optimization, nice-to-have

## Prompt Index

| File | Priority | Focus Area | Status |
|------|----------|------------|--------|
| 01-ppt-rendering-fixes.md | P1 | PowerPoint rendering quality | Complete (2026-01-07) |
| 02-formula-editing-enhancement.md | P1 | Math formula editing experience | Complete (2026-01-07) |
| 03-pdf-annotation-polish.md | P1 | PDF annotation interaction | Complete (2026-01-07) |
| 04-file-viewer-experience.md | P2 | Multi-format file reading | Complete (2026-01-07) |
| 05-quantum-keyboard-deep.md | P2 | Quantum keyboard advanced features | Complete (2026-01-07) |
| 06-ui-adaptation-responsive.md | P2 | UI/Layout responsiveness | Complete (2026-01-07) |
| 07-basic-interactions-fix.md | P1 | Core interaction bugs | Complete (2026-01-07) |
| 08-notebook-editor-polish.md | P2 | Jupyter notebook editing | Complete (2026-01-07) |
| 09-performance-optimization.md | P3 | Performance improvements | Complete (2026-01-07) |
| 10-code-quality-cleanup.md | P3 | Code cleanup and refactoring | Complete (2026-01-07) |

## Recommended Execution Order

For maximum impact, execute prompts in this order:

### Phase 1: Critical Fixes (Do First)
1. **07-basic-interactions-fix.md** - Fix fundamental interaction bugs
2. **03-pdf-annotation-polish.md** - Fix PDF annotation (core feature)
3. **02-formula-editing-enhancement.md** - Fix math editing (core feature)

### Phase 2: Feature Quality
4. **01-ppt-rendering-fixes.md** - Improve PPT rendering
5. **04-file-viewer-experience.md** - Improve file viewing
6. **08-notebook-editor-polish.md** - Polish notebook editing

### Phase 3: Enhancement
7. **05-quantum-keyboard-deep.md** - Enhance Quantum keyboard
8. **06-ui-adaptation-responsive.md** - Improve responsiveness

### Phase 4: Polish
9. **09-performance-optimization.md** - Optimize performance
10. **10-code-quality-cleanup.md** - Clean up code

## Estimated Total Work

- P1 Critical fixes: ~8-12 hours
- P2 Enhancements: ~6-10 hours
- P3 Polish: ~4-6 hours
- **Total: ~20-28 hours**

## Project Context

### Tech Stack
- **Frontend**: Next.js 15+, React 19, Tailwind CSS
- **Editors**: Tiptap, CodeMirror 6, MathLive
- **PDF**: react-pdf, react-pdf-highlighter
- **State**: Zustand, Jotai
- **Desktop**: Tauri

### Key Features
- Multi-format file viewing (PDF, Markdown, Jupyter, Word, PPT, Code)
- PDF annotation system (highlights, areas, text notes)
- Math formula editing with Quantum keyboard
- Jupyter notebook editing with Pyodide
- Desktop app with Tauri

### Existing Specs
The project has 20 existing specs in `.kiro/specs/` covering various features.
Review relevant specs before implementing changes.

## Notes

- Each prompt is self-contained with context and specific tasks
- Prompts reference existing code files and specs
- Test after each prompt before proceeding
- Run `npm run test:run` to verify changes don't break existing functionality
