# Advanced Markdown Features Test

This file demonstrates all the advanced markdown rendering features.

## 1. Superscript and Subscript

- Water formula: H~2~O
- Einstein's equation: E = mc^2^
- Chemical formula: CO~2~ + H~2~O → H~2~CO~3~
- Math notation: x^2^ + y^2^ = r^2^

## 2. Keyboard Keys

Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to copy.

Common shortcuts:
- <kbd>Ctrl</kbd> + <kbd>S</kbd> - Save
- <kbd>Ctrl</kbd> + <kbd>Z</kbd> - Undo
- <kbd>Alt</kbd> + <kbd>Tab</kbd> - Switch windows
- <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> - Command palette

## 3. Footnotes

Here is a sentence with a footnote[^1].

Another reference to a different footnote[^note].

And one more[^long].

[^1]: This is the first footnote.
[^note]: This is a named footnote with more details.
[^long]: This is a longer footnote that contains multiple sentences. It can include **bold** and *italic* text.

## 4. Embeds

Embed another file: ![[README.md]]

Embed with heading: ![[docs/ARCHITECTURE.md#Overview]]

Embed an image: ![[app-icon.png]]

## 5. Collapsible Content (Details/Summary)

<details>
<summary>Click to expand this section</summary>

This is the hidden content that appears when you click the summary.

It can contain:
- Lists
- **Bold text**
- *Italic text*
- `code`

</details>

<details open>
<summary>This section is open by default</summary>

Since we used `<details open>`, this content is visible immediately.

</details>

## 6. Callouts / Admonitions

> [!NOTE]
> This is a note callout. Use it for general information.

> [!TIP] Pro Tip
> This is a tip with a custom title. Great for helpful suggestions!

> [!WARNING]
> Be careful! This is a warning callout.

> [!DANGER]
> This is dangerous! Pay attention to this critical information.

> [!INFO]
> Additional information that might be useful.

> [!IMPORTANT]
> This is important information you shouldn't miss.

> [!EXAMPLE]
> Here's an example of how to use this feature.

> [!QUOTE]
> "The only way to do great work is to love what you do." - Steve Jobs

> [!ABSTRACT]
> This is an abstract or summary of the content below.

> [!SUCCESS]
> Operation completed successfully!

> [!QUESTION]
> Have you considered this approach?

> [!FAILURE]
> The operation failed. Please try again.

### Foldable Callouts

> [!NOTE]- Collapsed by default
> This content is hidden until you click to expand.

> [!TIP]+ Expanded by default
> This content is visible but can be collapsed.

## 7. Combined Features

Here's a complex example combining multiple features:

> [!EXAMPLE] Chemical Reaction
> The combustion of methane:
> 
> CH~4~ + 2O~2~ → CO~2~ + 2H~2~O
> 
> Press <kbd>Enter</kbd> to continue.
> 
> See also: footnote[^chem]

[^chem]: This reaction releases energy in the form of heat and light.

<details>
<summary>More about this reaction</summary>

The complete combustion of methane produces:
- Carbon dioxide (CO~2~)
- Water (H~2~O)
- Energy (heat)

Temperature: approximately 1950°C^[1]^

</details>

## 8. Existing Features (Still Working)

### Inline Formatting
- **Bold text**
- *Italic text*
- ***Bold and italic***
- ~~Strikethrough~~
- ==Highlighted text==
- `inline code`

### Links
- [External link](https://example.com)
- [[Internal wiki link]]
- [[wiki link|with alias]]

### Math
Inline: $E = mc^2$

Block:
$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

### Tables

| Feature | Status | Notes |
|---------|--------|-------|
| **Bold** | ✅ | Works in tables |
| *Italic* | ✅ | Works in tables |
| `Code` | ✅ | Works in tables |
| ==Highlight== | ✅ | Works in tables |
| [[Links]] | ✅ | Wiki links work |

---

End of test file.
