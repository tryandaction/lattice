# Markdown Coverage Fixture

## Inline Formats

Bold **bold**, italic *italic*, bold-italic ***both***, strike ~~strike~~, highlight ==mark==.

Inline code: `code` and ``code `with` backticks``.

Inline math: $E=mc^2$ and \(a^2+b^2=c^2\).

Inline link [text](https://example.com) and autolink <https://example.com> and bare https://example.com/path?x=1.

Reference links: [full][ref-link], [collapsed][], [shortcut].

Reference image: ![ref-img][ref-image] and ![ref-shortcut].

Wiki links: [[Page]], [[Page|Alias]], [[Page#Section|Alias]].

Image: ![alt](https://example.com/a.png) and embed: ![[file.pdf]].

Tag #tag and #tag/sub and footnote ref [^1].

## Block Formats

> Blockquote line
> Second line

> [!NOTE] Callout Title
> Callout content line 1
> Callout content line 2 with **bold** and $x+y$.

<details open>
<summary>Details Title</summary>
Details content line 1
Details content line 2 with `code`.
</details>

- [ ] Task item
- [x] Task item checked
1. Numbered item
2. Numbered item

| Head 1 | Head 2 |
|:------ | -----:|
| cell **bold** | $a+b$ |

```js
const a = 1; // code block should not parse **bold** or $math$
```

## Horizontal Rules

---

- - -

* * *

$$
\begin{equation}
E=mc^2
\end{equation}
$$

[^1]: Footnote definition text
    continuation line

[ref-link]: https://example.com/ref "Ref Title"
[collapsed]: https://example.com/collapsed
[shortcut]: https://example.com/shortcut
[ref-image]: https://example.com/ref.png "Image Title"
[ref-shortcut]: https://example.com/shortcut.png
