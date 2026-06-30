# Lattice i18n and Theme Audit

## Goal

Make language switching global enough that AI Chat, Agent, Prompt templates, dialogs, and related generated UI copy follow the active locale. Preserve user-authored content exactly as written.

## Priority

1. Built-in Prompt templates
   - Localize title, description, system prompt, and user prompt.
   - Keep user templates untouched.
   - Ensure preview and execution use the same localized prompt payload.
2. AI / Agent visible UI
   - Replace remaining mixed-language zh-CN labels.
   - Move visible hardcoded labels into i18n resources where practical.
   - Keep product terms such as AI, Agent, PDF, Markdown, and Prompt when they are clearer as domain labels.
3. Prompt context and generated workflow text
   - Localize context summaries and execution notes that users see in approvals or workbench records.
4. Dialog and theme consistency
   - Use shared layer classes and semantic theme tokens.
   - Avoid native browser prompt/alert for product UI.
5. Verification
   - Add or update focused tests for template localization and prompt rendering.
   - Run focused tests, typecheck, lint, and production build.

## Current Findings

- `src/lib/prompt/builtin-templates.ts` stores built-in templates as static text, and current Chinese copy is mojibake in the file.
- `PromptPicker` and `PromptRunSheet` render `template.title` / `template.description` directly, so built-in template names do not react to language changes.
- `renderPromptTemplate()` resolves context summaries with English labels such as `Current File: ready`.
- `surface-actions.ts` generates approval task text and notes in English.
- `zh-CN.ts` still contains mixed English copy for Prompt, Agent Protocol, and some Agent Trace entries.

## Implementation Notes

- Add optional per-locale localization to `PromptTemplate`.
- Add a localizer helper that returns localized copies for built-in templates only.
- Thread current locale through Prompt UI rendering and execution preview.
- Keep persisted `PromptRun` text as the exact prompt used at execution time for auditability.
- Use i18n keys for generated task labels and approval notes.

