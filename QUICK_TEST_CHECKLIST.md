# Quick Test Checklist - Lattice Editor Final Fixes

**Quick 10-minute test to verify all fixes are working**

## 1. Text Duplication Test (2 min)
📄 Open: `public/test-nested-formatting.md`

✅ Check:
- **Bold text** appears once (not duplicated)
- *Italic text* appears once
- `Code text` appears once
- **Bold with *italic* inside** renders correctly
- No syntax markers visible when cursor is away

## 2. Math Formula Test (2 min)
📄 Open: `public/test-formula-rendering.md`

✅ Check:
- Inline math $E=mc^2$ renders (not "undefined")
- Block math with single `$` works
- Block math with double `$$` works
- Inline block `$$x^2$$` works and is centered
- Formulas in headings work

## 3. File Switching Test (2 min)
📄 Open: Multiple files in split panes

✅ Check:
- Open 2 panes side by side
- Open different files in each pane
- Switch files in both panes
- Verify correct content in each pane
- No content mixing between panes

## 4. Syntax Hiding Test (2 min)
📄 Open: `public/test-syntax-hiding.md`

✅ Check:
- Move cursor away from **bold** - markers hidden
- Move cursor onto **bold** - markers appear
- Same for *italic*, `code`, [links]()
- # heading markers hide/reveal correctly
- Smooth transitions (no flickering)

## 5. Typography Test (2 min)
📄 Open: `public/test-headings.md`

✅ Check:
- H1 is largest, H6 is smallest
- Headings have proper spacing
- Text is readable (16px base font)
- Lines have comfortable spacing
- Formulas in headings work

## Quick Browser Console Check
Press F12 and check Console tab:

❌ Should NOT see:
- "undefined" latex warnings
- Range validation errors
- KaTeX errors

✅ Should see (optional):
- File switch logs (if switching files)
- Debug logs (if enabled)

## Pass/Fail Criteria

### ✅ PASS if:
- No text duplication anywhere
- All formulas render (no "undefined")
- File switching works correctly
- Syntax markers hide/reveal smoothly
- Typography looks professional
- No console errors

### ❌ FAIL if:
- Text appears duplicated
- Formulas show "undefined"
- File switching mixes content
- Markers don't hide/reveal
- Typography looks broken
- Console shows errors

## If Tests Pass ✅

**Congratulations!** The editor is working correctly. You can now:
1. Use the editor for real work
2. Test additional features (export, quantum keyboard)
3. Provide feedback on UX improvements

## If Tests Fail ❌

**Report the issue with**:
1. Which test failed
2. What you expected to see
3. What you actually saw
4. Browser console errors (if any)
5. Screenshot (if helpful)

## Extended Testing (Optional)

If you have more time, test:
- Large files (test-1000-lines.md, test-10000-lines.md)
- Cursor positioning (test-cursor-positioning.md)
- Performance (smooth scrolling, fast editing)
- Dark mode (if supported)
- Mobile/tablet (if applicable)

## Performance Quick Check

Open `public/test-1000-lines.md`:
- Should load in <2 seconds
- Scrolling should be smooth (60 FPS)
- Editing should feel instant (<100ms)

If performance is poor, check:
- Browser console for errors
- CPU usage (should be reasonable)
- Memory usage (should not leak)

---

**Total Time**: ~10 minutes for basic verification  
**Recommended**: Run this checklist after any code changes
