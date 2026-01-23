# Text Duplication Test File

This file tests for text duplication issues in the Live Preview editor.

## Test 1: Bold Text

This is **bold text** in a sentence.

Multiple **bold** words **in** one **line**.

## Test 2: Italic Text

This is *italic text* in a sentence.

This is _also italic_ using underscores.

## Test 3: Inline Code

This is `inline code` in a sentence.

Multiple `code` blocks `in` one `line`.

## Test 4: Links

This is a [regular link](https://example.com) in a sentence.

This is a [[wiki link]] in a sentence.

This is a [[wiki link|with display text]] in a sentence.

## Test 5: Images

![Alt text](https://via.placeholder.com/150)

![Alt text|200](https://via.placeholder.com/200)

## Test 6: Combined Formatting

This is **bold with *italic* inside** it.

This is *italic with **bold** inside* it.

This is **bold with `code` inside** it.

This is a **bold [link](https://example.com)** in a sentence.

## Test 7: Math Formulas

This is $E=mc^2$ inline math.

This is **bold with $E=mc^2$ math** inside.

## Test 8: Lists

- **Bold** list item
- *Italic* list item
- `Code` list item
- [Link](https://example.com) list item

## Test 9: Headings with Formatting

### This is a **bold** heading

### This is an *italic* heading

### This is a `code` heading

## Test 10: Blockquotes with Formatting

> This is **bold** in a quote
> This is *italic* in a quote
> This is `code` in a quote

## Expected Behavior

- Each formatted element should appear ONLY ONCE
- No duplication of text (e.g., "**bold**bold" or "boldbo**ld**")
- Syntax markers (**, *, `, etc.) should be hidden when not editing
- When cursor is on the element, syntax markers should be revealed

## How to Test

1. Open this file in Live Preview mode
2. Scroll through and visually inspect each test case
3. Look for any duplicated text
4. Click on formatted text to see if syntax markers appear correctly
5. Move cursor away to see if syntax markers hide correctly
