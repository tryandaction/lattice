# 🎯 Final Testing Guide - All Phases

## 📋 Quick Status

| Phase | Status | Test File | Priority |
|-------|--------|-----------|----------|
| Phase 1: Long File Display | ✅ Complete | `test-100-lines.md` | CRITICAL |
| Phase 2: File Switching | ✅ Complete | Multiple files | CRITICAL |
| Phase 3: Text Duplication | ✅ Complete | `test-text-duplication.md` | HIGH |
| Phase 4: Formula Rendering | ✅ Complete | `test-formula-rendering.md` | HIGH |
| Phase 5: Syntax Hiding | ⚠️ Verify | Any markdown file | MEDIUM |

---

## 🚀 Quick Start

1. **Start Development Server**
   ```bash
   npm run dev
   ```
   Open: http://localhost:3000

2. **Open Browser Console**
   - Press F12
   - Go to Console tab
   - Keep it open to see debug logs

3. **Run Tests**
   - Follow the test sections below
   - Check off each item as you test
   - Report any issues found

---

## 📝 Test 1: Long File Display (Phase 1)

### Objective
Verify that long files display completely without truncation.

### Steps
1. Open `public/test-100-lines.md`
2. Scroll to the bottom
3. Verify you can see "Line 100"
4. Check console for `[parseDocument]` logs

### Expected Results
- ✅ All 100 lines visible
- ✅ Scrolling is smooth
- ✅ Console shows: `Total elements parsed: [number]`
- ✅ Console shows: `Doc lines: 100`

### Test with Larger Files
- [ ] `test-500-lines.md` - 500 lines
- [ ] `test-1000-lines.md` - 1000 lines
- [ ] `test-10000-lines.md` - 10000 lines (performance test)

### Console Logs to Check
```
[parseDocument] ===== START PARSING =====
[parseDocument] Doc lines: 100 Doc length: [number]
[parseDocument] ViewportOnly: false
[parseDocument] Processing range - startLine: 1 endLine: 100
[parseDocument] ===== PARSING COMPLETE =====
[parseDocument] Total elements parsed: [number]
```

### Issues to Look For
- ❌ File truncated (can't scroll to bottom)
- ❌ Missing lines
- ❌ Console errors
- ❌ Slow performance (>3 seconds to load)

---

## 📝 Test 2: File Switching (Phase 2)

### Objective
Verify that switching between files shows correct content.

### Steps
1. Create or open File A (e.g., `test-100-lines.md`)
2. Note the first line content
3. Open File B (e.g., `test-text-duplication.md`)
4. Verify File B content is displayed
5. Switch back to File A
6. Verify File A content is displayed

### Expected Results
- ✅ File B shows correct content (not File A)
- ✅ Switching back shows File A correctly
- ✅ No content mixing or confusion
- ✅ Console shows file switch logs

### Rapid Switching Test
1. Quickly click: File A → B → C → D
2. Verify final file (D) displays correctly
3. No flickering or content mixing

### Console Logs to Check
```
[FileSwitch] ===== FILE CHANGED =====
[FileSwitch] From: file-a.md To: file-b.md
[EditorInit] ===== INITIALIZING EDITOR =====
[EditorInit] fileId: file-b.md
[EditorInit] Decoration cache cleared
[EditorInit] ===== INITIALIZATION COMPLETE =====
```

### Issues to Look For
- ❌ Wrong file content displayed
- ❌ Content from previous file visible
- ❌ Flickering or blank screen
- ❌ Console errors

---

## 📝 Test 3: Text Duplication (Phase 3)

### Objective
Verify that formatted text appears only once (no duplication).

### Steps
1. Open `public/test-text-duplication.md`
2. Scroll through all test cases
3. Look for any duplicated text

### Test Cases to Check

#### Bold Text
- [ ] `**bold text**` appears as: **bold text** (not "**bold text**bold text")
- [ ] Multiple bold words on one line work correctly

#### Italic Text
- [ ] `*italic*` appears as: *italic*
- [ ] `_italic_` appears as: *italic*

#### Inline Code
- [ ] `` `code` `` appears as: `code`
- [ ] Multiple code blocks on one line work

#### Links
- [ ] `[text](url)` appears as clickable link
- [ ] `[[wiki link]]` appears as wiki link
- [ ] `[[wiki|display]]` shows "display" text

#### Images
- [ ] `![alt](url)` shows image
- [ ] `![alt|200](url)` shows image with width

#### Nested Formatting
- [ ] `**bold with *italic* inside**` works
- [ ] `*italic with **bold** inside*` works
- [ ] `**bold with `code` inside**` works
- [ ] `**bold with $E=mc^2$ inside**` works

### Expected Results
- ✅ All formatted elements appear ONCE
- ✅ No syntax markers visible (unless cursor is on element)
- ✅ Nested formatting works correctly
- ✅ No console warnings about invalid ranges

### Console Logs to Check
```
[Decoration] Creating INLINE_BOLD widget: { from: X, to: Y, content: "..." }
```

### Issues to Look For
- ❌ Text appears twice (e.g., "**bold**bold")
- ❌ Syntax markers always visible
- ❌ Nested formatting broken
- ❌ Console warnings: "Invalid range"

---

## 📝 Test 4: Formula Rendering (Phase 4)

### Objective
Verify that math formulas render correctly (not as "undefined").

### Steps
1. Open `public/test-formula-rendering.md`
2. Check all formula test cases

### Test Cases to Check

#### Basic Inline Math
- [ ] `$E=mc^2$` renders as math (not "undefined" or raw text)
- [ ] `$a^2 + b^2 = c^2$` renders correctly

#### Formulas in Context
- [ ] Heading with $E=mc^2$ works
- [ ] List item with $\int_0^1 x dx$ works
- [ ] Blockquote with $\sqrt{2}$ works
- [ ] Bold with $E=mc^2$ works
- [ ] Italic with $\alpha$ works

#### Block Math
- [ ] Block formula centered and formatted:
  ```
  $
  E = mc^2
  $
  ```

#### Complex Formulas
- [ ] Fractions: $\frac{a}{b}$
- [ ] Square roots: $\sqrt{x}$
- [ ] Summation: $\sum_{i=1}^{n} i$
- [ ] Integration: $\int_0^1 x dx$
- [ ] Matrices work

#### Greek Letters
- [ ] $\alpha$, $\beta$, $\gamma$, $\delta$ render

#### Edge Cases
- [ ] Empty formula `$$` handled gracefully
- [ ] Formula with spaces `$ x + y $` works
- [ ] Multiple formulas: `$a$ and $b$ and $c$`

### Expected Results
- ✅ All formulas render as math (not "undefined")
- ✅ Formulas work in all contexts
- ✅ Complex formulas display correctly
- ✅ Invalid formulas show error indicator ⚠️
- ✅ No console errors

### Console Logs to Check
```
[Decoration] Creating INLINE_MATH widget: { latex: "E=mc^2", latexLength: 6 }
```

### Issues to Look For
- ❌ Formula shows as "undefined"
- ❌ Formula shows as raw LaTeX (e.g., "$E=mc^2$")
- ❌ Formula fails in specific context
- ❌ Console errors: "Empty latex"
- ❌ KaTeX loading errors

### Interactive Features
- [ ] Click formula → cursor positions correctly
- [ ] Double-click formula → opens editor
- [ ] Right-click formula → copies LaTeX

---

## 📝 Test 5: Syntax Marker Hiding (Phase 5)

### Objective
Verify that markdown syntax markers are hidden when not editing.

### Steps
1. Open any markdown file (or create a new one)
2. Type some formatted text
3. Move cursor away from the text
4. Observe if syntax markers are hidden

### Test Cases to Check

#### Headings
- [ ] Type: `# Heading`
- [ ] Move cursor away
- [ ] Verify `#` is hidden
- [ ] Click on heading
- [ ] Verify `#` appears

#### Bold
- [ ] Type: `**bold**`
- [ ] Move cursor away
- [ ] Verify `**` markers are hidden
- [ ] Click on bold text
- [ ] Verify `**` markers appear

#### Italic
- [ ] Type: `*italic*`
- [ ] Move cursor away
- [ ] Verify `*` markers are hidden
- [ ] Click on italic text
- [ ] Verify `*` markers appear

#### Inline Code
- [ ] Type: `` `code` ``
- [ ] Move cursor away
- [ ] Verify `` ` `` markers are hidden
- [ ] Click on code
- [ ] Verify `` ` `` markers appear

#### Links
- [ ] Type: `[text](url)`
- [ ] Move cursor away
- [ ] Verify `[]()` markers are hidden, only "text" visible
- [ ] Click on link
- [ ] Verify `[]()` markers appear

#### Blockquotes
- [ ] Type: `> quote`
- [ ] Move cursor away
- [ ] Verify `>` is hidden
- [ ] Click on quote
- [ ] Verify `>` appears

#### Lists
- [ ] Type: `- item`
- [ ] Move cursor away
- [ ] Verify `-` is replaced with bullet
- [ ] Click on list item
- [ ] Verify `-` appears

### Expected Results
- ✅ All syntax markers hidden when cursor is away
- ✅ Syntax markers appear when cursor is on element
- ✅ Smooth transitions between states
- ✅ Only the element under cursor shows syntax

### Issues to Look For
- ❌ Syntax markers always visible
- ❌ Syntax markers never appear (even when editing)
- ❌ Jerky transitions
- ❌ Multiple elements reveal at once

### If Issues Found
Check these files:
1. `cursor-context-plugin.ts` - `shouldRevealAt()` logic
2. `decoration-coordinator.ts` - Element-level reveal checks
3. `live-preview-theme.css` - CSS transitions

---

## 🔍 Console Log Reference

### Normal Operation Logs

#### Document Parsing
```
[parseDocument] ===== START PARSING =====
[parseDocument] Doc lines: 100 Doc length: 5000
[parseDocument] ViewportOnly: false
[parseDocument] Found 5 code blocks
[parseDocument] Found 2 math blocks
[parseDocument] Found 1 tables
[parseDocument] Processing range - startLine: 1 endLine: 100 total lines to process: 100
[parseDocument] ===== PARSING COMPLETE =====
[parseDocument] Total elements parsed: 150
```

#### Decoration Building
```
[buildDecorations] ===== START BUILDING =====
[buildDecorations] Input elements: 150
[buildDecorations] Processed elements: 140 / 150
[buildDecorations] Skipped (revealed) elements: 10
[buildDecorations] Created 140 decoration entries
[buildDecorations] ===== BUILDING COMPLETE =====
```

#### File Switching
```
[FileSwitch] ===== FILE CHANGED =====
[FileSwitch] From: file-a.md To: file-b.md
[FileSwitch] New content length: 1234
[EditorInit] ===== INITIALIZING EDITOR =====
[EditorInit] fileId: file-b.md
[EditorInit] content length: 1234
[EditorInit] Decoration cache cleared
[EditorInit] ===== INITIALIZATION COMPLETE =====
```

### Warning Logs (Should Not Appear)

```
❌ [parseInlineElements] Invalid bold range: X Y
❌ [parseInlineElements] Empty latex for inline math
❌ [parseMathBlocks] Empty math block at lines X - Y
❌ [Decoration] Invalid range for INLINE_BOLD: X Y
❌ [Decoration] Empty latex for INLINE_MATH at X Y
❌ [MathWidget] Invalid latex: undefined at X Y
```

If you see any warning logs, please report them!

---

## 📊 Performance Benchmarks

### Expected Performance

| File Size | Load Time | Scroll FPS | Edit Latency |
|-----------|-----------|------------|--------------|
| 100 lines | <0.5s | 60 FPS | <50ms |
| 500 lines | <1s | 60 FPS | <50ms |
| 1000 lines | <2s | 60 FPS | <100ms |
| 10000 lines | <3s | 30+ FPS | <200ms |

### How to Measure

1. **Load Time**: Time from opening file to content visible
2. **Scroll FPS**: Smoothness when scrolling (use browser DevTools Performance tab)
3. **Edit Latency**: Time from keypress to character appearing

### If Performance is Poor

1. Check console for errors
2. Check browser DevTools Performance tab
3. Report file size and performance metrics
4. Consider enabling viewport optimization (currently disabled for correctness)

---

## 🐛 Bug Reporting Template

If you find any issues, please report using this template:

```markdown
### Bug Description
[Clear description of the issue]

### Steps to Reproduce
1. [Step 1]
2. [Step 2]
3. [Step 3]

### Expected Behavior
[What should happen]

### Actual Behavior
[What actually happens]

### Test File
[Which test file were you using?]

### Console Logs
[Copy relevant console logs]

### Screenshots
[If applicable]

### Browser
[Chrome/Firefox/Safari/Edge + version]

### Additional Context
[Any other relevant information]
```

---

## ✅ Final Checklist

Before marking testing complete, verify:

### Functionality
- [ ] All 5 phases tested
- [ ] All test files opened and checked
- [ ] All test cases passed
- [ ] No console errors or warnings
- [ ] Interactive features work (click, double-click, right-click)

### Performance
- [ ] Large files load in reasonable time
- [ ] Scrolling is smooth
- [ ] Editing is responsive
- [ ] No memory leaks (check DevTools Memory tab)

### User Experience
- [ ] Syntax markers hide/reveal correctly
- [ ] Transitions are smooth
- [ ] No flickering or visual glitches
- [ ] Formatting looks correct

### Regression
- [ ] Existing features still work
- [ ] Quantum keyboard works
- [ ] File operations work
- [ ] Settings work

---

## 🎉 Success Criteria

Testing is complete when:

1. ✅ All 5 phases pass their tests
2. ✅ No critical bugs found
3. ✅ Performance is acceptable
4. ✅ No regression issues
5. ✅ User experience is smooth

---

## 📞 Support

If you encounter any issues or have questions:

1. Check the console logs
2. Review the relevant phase documentation
3. Check `PHASE_3_4_5_SUMMARY.md` for technical details
4. Report bugs using the template above

---

**Happy Testing!** 🚀

Remember: The goal is to find and fix bugs, not to prove the code works. Be thorough and report everything you find!
