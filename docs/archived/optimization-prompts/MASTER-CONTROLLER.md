# Lattice Project Optimization - Master Controller

## Instructions for Claude Code

You are tasked with systematically optimizing the Lattice project. This is a long-running autonomous task that requires you to work through multiple optimization prompts sequentially.

## Your Mission

Read and execute ALL optimization prompts in the `.kiro/optimization-prompts/` folder, implementing fixes and improvements for each area. Work autonomously, making decisions and implementing changes without waiting for user confirmation on each step.

## Execution Protocol

### Phase 1: Assessment
1. Read the README.md in this folder to understand the overall plan
2. Review the project structure and existing code
3. Run `npm run test:run` to establish baseline test status

### Phase 2: Sequential Execution
Execute prompts in this order (optimized for dependency and impact):

**Critical Fixes First:**
1. `07-basic-interactions-fix.md` - Fix fundamental interactions
2. `03-pdf-annotation-polish.md` - Fix PDF annotation system
3. `02-formula-editing-enhancement.md` - Fix math editing

**Feature Quality:**
4. `01-ppt-rendering-fixes.md` - Improve PPT rendering
5. `04-file-viewer-experience.md` - Improve file viewers
6. `08-notebook-editor-polish.md` - Polish notebook editor

**Enhancements:**
7. `05-quantum-keyboard-deep.md` - Enhance Quantum keyboard
8. `06-ui-adaptation-responsive.md` - Improve responsiveness

**Polish:**
9. `09-performance-optimization.md` - Optimize performance
10. `10-code-quality-cleanup.md` - Clean up code

### Phase 3: Validation
After completing all prompts:
1. Run full test suite: `npm run test:run`
2. Run type check: `npx tsc --noEmit`
3. Run linter: `npm run lint`
4. Create a summary of all changes made

## For Each Prompt File

When processing each optimization prompt:

1. **Read the prompt file completely**
2. **Understand the context and issues**
3. **Review the related files mentioned**
4. **Implement the tasks one by one**
5. **Run relevant tests after each major change**
6. **Update the prompt's status in README.md when complete**
7. **Move to the next prompt**

## Decision Making Guidelines

### When to proceed autonomously:
- Bug fixes with clear solutions
- Code refactoring that doesn't change behavior
- Adding missing error handling
- Improving code organization
- Adding tests for existing functionality

### When to ask for user input:
- Major architectural changes
- Removing features
- Adding new dependencies
- Changes that might break existing workflows
- Unclear requirements or conflicting goals

## Progress Tracking

After completing each prompt, update the README.md status:
- Change `Pending` to `In Progress` when starting
- Change `In Progress` to `Complete` when finished
- Add completion date in format: `Complete (YYYY-MM-DD)`

## Error Handling

If you encounter blocking issues:
1. Document the issue clearly
2. Attempt alternative solutions
3. If still blocked, note it and move to next prompt
4. Return to blocked items at the end

## Quality Standards

All changes must:
- Pass existing tests
- Not introduce new TypeScript errors
- Follow existing code style
- Be properly commented where complex
- Handle errors gracefully

## Time Management

- Spend maximum 2 hours per prompt
- If a prompt is taking too long, complete what you can and note remaining items
- Prioritize high-impact, low-effort fixes first within each prompt

## Final Deliverable

When all prompts are complete, create a file `OPTIMIZATION-REPORT.md` with:
1. Summary of all changes made
2. List of issues fixed
3. List of remaining issues (if any)
4. Recommendations for future improvements
5. Test results summary

---

## START COMMAND

To begin the optimization process, read this file and then start with:

```
I will now begin the Lattice project optimization. Starting with Phase 1: Assessment.
```

Then proceed through all phases autonomously.

---

## Project Quick Reference

### Key Directories
- `src/components/` - React components
- `src/hooks/` - Custom hooks
- `src/lib/` - Utility functions
- `src/stores/` - Zustand stores
- `src/types/` - TypeScript types

### Key Commands
- `npm run dev` - Start development server
- `npm run test:run` - Run all tests
- `npm run lint` - Run linter
- `npx tsc --noEmit` - Type check

### Tech Stack
- Next.js 15+, React 19
- Tiptap, CodeMirror 6, MathLive
- Zustand, Jotai
- Tailwind CSS
- Vitest for testing
