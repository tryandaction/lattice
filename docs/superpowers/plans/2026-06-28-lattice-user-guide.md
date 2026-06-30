# Lattice User Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Markdown-only guide with a concise bilingual Lattice product guide.

**Architecture:** Store guide modules as bilingual structured data, render them through the existing guide component, and use the shared elevated modal overlay to avoid splitter bleed-through. Keep existing route/component names for compatibility while updating visible UX and content.

**Tech Stack:** React, Next.js, TypeScript, Tailwind CSS, Vitest, existing `useI18n`.

---

### Task 1: Guide Data Model And Content

**Files:**
- Modify: `src/components/diagnostics/live-preview-content.ts`

- [x] Replace corrupted Markdown-only scenario content with bilingual product guide sections.
- [x] Export helpers/types for localized guide text.
- [x] Preserve diagnostic fixture exports used by diagnostics pages.

### Task 2: Guide UI

**Files:**
- Modify: `src/components/diagnostics/live-preview-guide.tsx`

- [x] Render `Lattice Guide` instead of `Live Preview Guide`.
- [x] Select localized guide copy using `useI18n`.
- [x] Add independent scrolling for section list and content body.
- [x] Add Previous and Next buttons.
- [x] Keep reset/editable Markdown demo only for the Markdown section; other sections use concise cards.

### Task 3: Modal Layering

**Files:**
- Modify: `src/lib/ui-layers.ts`
- Modify: `src/components/layout/app-layout.tsx`
- Modify: `src/components/editor/markdown-export-dialog.tsx`
- Test: `src/lib/__tests__/ui-layers.test.ts`

- [x] Add shared modal overlay and panel classes.
- [x] Switch guide modal to the shared elevated overlay.
- [x] Switch Markdown export modal to the shared elevated overlay.
- [x] Add tests for the modal overlay layer.

### Task 4: Tests And Verification

**Files:**
- Test: `src/components/diagnostics/__tests__/live-preview-guide.test.tsx`

- [x] Add a guide test for Chinese and English rendering.
- [x] Add a guide test for Previous and Next navigation.
- [x] Run focused tests for guide, menu, export, and layer utilities.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
