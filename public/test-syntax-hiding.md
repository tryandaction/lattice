# Syntax Marker Hiding Test

This file tests that syntax markers hide when cursor is away and reveal when cursor is on the element.

## Test 1: Heading Markers (#)

# Heading 1 - Move cursor here to see # marker
## Heading 2 - Move cursor here to see ## markers
### Heading 3 - Move cursor here to see ### markers
#### Heading 4 - Move cursor here to see #### markers
##### Heading 5 - Move cursor here to see ##### markers
###### Heading 6 - Move cursor here to see ###### markers

**Expected**: # markers should be hidden when cursor is away, visible when cursor is on the heading.

## Test 2: Bold Markers (**)

This is **bold text** that should hide ** markers.

Multiple **bold** words **in** one **line**.

**Expected**: ** markers should be hidden when cursor is away, visible when cursor is on the bold text.

## Test 3: Italic Markers (*, _)

This is *italic text* with asterisks.

This is _italic text_ with underscores.

Multiple *italic* words *in* one *line*.

**Expected**: * and _ markers should be hidden when cursor is away, visible when cursor is on the italic text.

## Test 4: Code Markers (`)

This is `inline code` with backticks.

Multiple `code` snippets `in` one `line`.

**Expected**: ` markers should be hidden when cursor is away, visible when cursor is on the code.

## Test 5: Link Markers ([]())

This is a [link to example](https://example.com) with markers.

Multiple [link1](https://example1.com) and [link2](https://example2.com) in one line.

**Expected**: []() markers should be hidden when cursor is away, visible when cursor is on the link.

## Test 6: Blockquote Markers (>)

> This is a blockquote line 1
> This is a blockquote line 2
> This is a blockquote line 3

**Expected**: > markers should be hidden when cursor is away, visible when cursor is on the blockquote line.

## Test 7: List Markers (-, *, +)

Unordered list with -:
- Item 1
- Item 2
- Item 3

Unordered list with *:
* Item A
* Item B
* Item C

Unordered list with +:
+ Item X
+ Item Y
+ Item Z

Ordered list:
1. First item
2. Second item
3. Third item

Task list:
- [ ] Unchecked task
- [x] Checked task
- [ ] Another unchecked task

**Expected**: List markers should be styled (• for bullets, numbers for ordered, checkboxes for tasks).

## Test 8: Strikethrough Markers (~~)

This is ~~strikethrough text~~ with markers.

Multiple ~~strike1~~ and ~~strike2~~ in one line.

**Expected**: ~~ markers should be hidden when cursor is away, visible when cursor is on the strikethrough text.

## Test 9: Highlight Markers (==)

This is ==highlighted text== with markers.

Multiple ==highlight1== and ==highlight2== in one line.

**Expected**: == markers should be hidden when cursor is away, visible when cursor is on the highlighted text.

## Test 10: Math Markers ($)

Inline math: $E=mc^2$ with markers.

Multiple formulas: $a^2$ and $b^2$ in one line.

Block math:
$
x^2 + y^2 = z^2
$

**Expected**: $ markers should be hidden when cursor is away, visible when cursor is on the formula.

## Test 11: Nested Formatting

**Bold with *italic* inside** - test nested marker hiding.

*Italic with **bold** inside* - test nested marker hiding.

**Bold with `code` inside** - test nested marker hiding.

**Expected**: Each element's markers should reveal independently when cursor is on that specific element.

## Test 12: Complex Line

This line has **bold**, *italic*, `code`, [link](https://example.com), and $x^2$ all together.

**Expected**: Each element's markers should hide/reveal independently based on cursor position.

## How to Test

1. **Move cursor away** from any formatted text
   - All syntax markers should be hidden
   - Text should appear cleanly formatted

2. **Move cursor onto** a formatted element
   - Only that element's markers should reveal
   - Other elements on the same line should remain hidden

3. **Test granular reveal**
   - In Test 12, move cursor to each element
   - Verify only the current element's markers reveal
   - Other elements should keep markers hidden

4. **Check transitions**
   - Marker reveal/hide should be smooth (0.15s transition)
   - No flickering or jumping

## Expected Behavior Summary

- **Default state**: All syntax markers hidden, text appears formatted
- **Cursor on element**: Only that element's markers reveal with opacity 0.5
- **Granular reveal**: Only the specific element under cursor reveals, not the whole line
- **Smooth transitions**: Markers fade in/out smoothly
- **No layout shift**: Revealing markers should not cause text to jump
