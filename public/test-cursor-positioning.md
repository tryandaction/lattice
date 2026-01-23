# Cursor Positioning Test

This file tests cursor positioning accuracy in various widgets.

## Test 1: Bold Text Widget

Click at different positions in **this bold text** to test cursor positioning.

Try clicking:
- At the start: **|bold**
- In the middle: **bo|ld**
- At the end: **bold|**

## Test 2: Italic Text Widget

Click at different positions in *this italic text* to test cursor positioning.

Try clicking:
- At the start: *|italic*
- In the middle: *ita|lic*
- At the end: *italic|*

## Test 3: Code Widget

Click at different positions in `this code text` to test cursor positioning.

Try clicking:
- At the start: `|code`
- In the middle: `co|de`
- At the end: `code|`

## Test 4: Link Widget

Click at different positions in [this link text](https://example.com) to test cursor positioning.

Try clicking:
- At the start: [|link]
- In the middle: [li|nk]
- At the end: [link|]
- Ctrl+Click to open link

## Test 5: Math Widget

Click at different positions in $E=mc^2$ to test cursor positioning.

Try clicking:
- At the start: $|E=mc^2$
- In the middle: $E=|mc^2$
- At the end: $E=mc^2|$
- Double-click to open math editor

## Test 6: Long Text Widget

Click at different positions in **this is a much longer bold text to test cursor positioning accuracy** to test.

Try clicking at various positions throughout the long text.

## Test 7: Multiple Widgets on Same Line

Click in **bold**, *italic*, `code`, [link](https://example.com), and $x^2$ on the same line.

Each widget should position cursor accurately.

## Test 8: Nested Widgets

Click in **bold with *italic* inside** to test nested cursor positioning.

Try clicking:
- In the bold part (outside italic)
- In the italic part (inside bold)

## Test 9: Adjacent Widgets

Click between **bold1** **bold2** to test cursor positioning between adjacent widgets.

Try clicking:
- In bold1
- Between bold1 and bold2
- In bold2

## Test 10: Widget at Line Start

**Bold at start** of line.

*Italic at start* of line.

`Code at start` of line.

## Test 11: Widget at Line End

Line ends with **bold at end**

Line ends with *italic at end*

Line ends with `code at end`

## Test 12: Empty Content Edge Case

Click in ** ** (empty bold - should handle gracefully).

Click in * * (empty italic - should handle gracefully).

## Expected Behavior

1. **Accurate positioning**: Cursor should appear at the clicked position within the widget
2. **Start/middle/end**: Clicking at start, middle, or end should position cursor correctly
3. **No jumping**: Cursor should not jump to unexpected positions
4. **Smooth interaction**: Clicking should feel natural and responsive
5. **Edge cases**: Empty or very short content should handle gracefully

## How to Test

1. Click at various positions within each widget
2. Verify cursor appears at the expected position
3. Type to verify cursor is actually at that position
4. Test edge cases (start, end, empty)
5. Test with keyboard navigation (arrow keys)

## Known Limitations

- Some widgets may position cursor at the start/end rather than exact click position
- This is acceptable as long as it's consistent and predictable
- The goal is to make editing feel natural, not necessarily pixel-perfect
