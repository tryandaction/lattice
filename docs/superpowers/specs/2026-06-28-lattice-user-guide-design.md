# Lattice User Guide Design

## Goal

Upgrade the question-mark help entry from a Markdown-only live preview guide into a concise product-level Lattice user guide.

## Scope

The guide covers seven user-facing areas:

1. Quick start
2. Markdown writing
3. PDF annotations and sidecar documents
4. Quantum keyboard
5. AI workspace
6. Plugins and commands
7. Links and file navigation

## Interaction

- The guide opens as a true modal using the shared elevated modal overlay.
- The modal must visually cover sidebars, resize handles, and pane splitters.
- The left rail lists guide sections and scrolls independently.
- The right pane shows the selected section, keeps content concise, and scrolls independently.
- Previous and Next buttons let users move through sections without relying only on the left rail.
- The close button remains visible in the header.

## Language

Guide copy is stored as bilingual structured content.

- `zh-CN`: Simplified Chinese.
- `en-US`: English.

The component selects content using the existing `useI18n` language state and falls back to English when a locale is unavailable.

## Content Style

- Use short, direct descriptions.
- Prefer "what it does" and "how to start" over long tutorial text.
- Avoid long marketing copy.
- Keep each section scannable: summary, key actions, tips, and related entry points.

## Implementation Boundaries

- Keep the existing exported component name `LivePreviewGuide` for route compatibility, but change visible product copy to `Lattice Guide`.
- Replace corrupted guide content data with clean bilingual content.
- Do not build or update the desktop release in this step.

