# Test Headings - All Levels and Contexts

This file tests all 6 heading levels with various content types.

# Heading 1 - Largest
## Heading 2 - Large
### Heading 3 - Medium-Large
#### Heading 4 - Medium
##### Heading 5 - Small
###### Heading 6 - Smallest

## Test 1: Headings with Plain Text

# This is a level 1 heading with plain text
## This is a level 2 heading with plain text
### This is a level 3 heading with plain text
#### This is a level 4 heading with plain text
##### This is a level 5 heading with plain text
###### This is a level 6 heading with plain text

## Test 2: Headings with Bold Text

# Heading with **bold text** inside
## Heading with **bold text** inside
### Heading with **bold text** inside
#### Heading with **bold text** inside
##### Heading with **bold text** inside
###### Heading with **bold text** inside

## Test 3: Headings with Italic Text

# Heading with *italic text* inside
## Heading with *italic text* inside
### Heading with *italic text* inside
#### Heading with *italic text* inside
##### Heading with *italic text* inside
###### Heading with *italic text* inside

## Test 4: Headings with Code

# Heading with `code` inside
## Heading with `code` inside
### Heading with `code` inside
#### Heading with `code` inside
##### Heading with `code` inside
###### Heading with `code` inside

## Test 5: Headings with Math Formulas

# Heading with $E=mc^2$ formula
## Heading with $\alpha + \beta$ formula
### Heading with $\sum_{i=1}^{n} i$ formula
#### Heading with $\int_0^1 x dx$ formula
##### Heading with $\frac{a}{b}$ formula
###### Heading with $\sqrt{x}$ formula

## Test 6: Headings with Links

# Heading with [link](https://example.com)
## Heading with [link](https://example.com)
### Heading with [link](https://example.com)
#### Heading with [link](https://example.com)
##### Heading with [link](https://example.com)
###### Heading with [link](https://example.com)

## Test 7: Headings with Multiple Formatting

# Heading with **bold**, *italic*, and `code`
## Heading with **bold**, *italic*, and `code`
### Heading with **bold**, *italic*, and `code`
#### Heading with **bold**, *italic*, and `code`
##### Heading with **bold**, *italic*, and `code`
###### Heading with **bold**, *italic*, and `code`

## Test 8: Headings with Complex Formulas

# Maxwell's Equations: $\nabla \times \vec{E} = -\frac{\partial \vec{B}}{\partial t}$
## Schrödinger Equation: $i\hbar\frac{\partial}{\partial t}\Psi = \hat{H}\Psi$
### Euler's Identity: $e^{i\pi} + 1 = 0$

## Test 9: Long Headings

# This is a very long heading that contains a lot of text to test how the heading wraps and displays when it exceeds the width of the editor
## This is another very long heading with **bold**, *italic*, `code`, and $x^2$ to test complex wrapping behavior

## Test 10: Heading Marker Hiding

Move your cursor to each heading below and verify that:
- # markers are hidden when cursor is away
- # markers appear when cursor is on the heading
- Only the specific heading's markers reveal (not all headings)

# Test heading 1
## Test heading 2
### Test heading 3

## Test 11: Consecutive Headings

# First Heading
## Second Heading
### Third Heading
#### Fourth Heading
##### Fifth Heading
###### Sixth Heading

No text between them - verify spacing is correct.

## Test 12: Headings in Lists

- # Heading 1 in list (should this work?)
- ## Heading 2 in list
- ### Heading 3 in list

Note: Headings in lists may not be standard Markdown, but test behavior.

## Test 13: Headings After Blockquotes

> This is a blockquote

# Heading after blockquote

Verify spacing between blockquote and heading.

## Expected Behavior

### Font Sizes (Task 7.2)
- H1: 2em (32px at 16px base)
- H2: 1.5em (24px at 16px base)
- H3: 1.25em (20px at 16px base)
- H4: 1.1em (17.6px at 16px base)
- H5: 1em (16px at 16px base)
- H6: 0.9em (14.4px at 16px base)

### Line Heights
- All headings: 1.3

### Font Weight
- All headings: 600 (semi-bold)

### Spacing (Task 7.4)
- Margin-top: 1em
- Margin-bottom: 0.5em

### Marker Hiding (Task 11.8)
- # markers hidden when cursor away
- # markers visible (opacity 0.5) when cursor on heading
- Smooth transition (0.15s)

### Formulas in Headings (Task 11.7)
- Formulas should render correctly in headings
- Both heading style and formula should work together
- No "undefined" rendering

## How to Test

1. **Visual inspection**: Check font sizes are correct and proportional
2. **Spacing**: Verify margins between headings and content
3. **Marker hiding**: Move cursor on/off headings to test reveal
4. **Formulas**: Verify all formulas in headings render correctly
5. **Formatting**: Verify bold, italic, code work in headings
6. **Links**: Verify links in headings are clickable
7. **Wrapping**: Test long headings wrap correctly
8. **Transitions**: Verify smooth marker reveal/hide

## Success Criteria

✅ All 6 heading levels display with correct font sizes
✅ Line heights are consistent (1.3)
✅ Spacing is appropriate (1em top, 0.5em bottom)
✅ # markers hide/reveal correctly
✅ Formulas render in headings
✅ Bold, italic, code work in headings
✅ Links work in headings
✅ No layout jumping or flickering
✅ Smooth transitions
