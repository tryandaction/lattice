/**
 * Tests for the advanced markdown parser
 */

import { describe, it, expect } from "vitest";
import { parseMarkdown, isMarkdown } from "../markdown-parser";

describe("isMarkdown", () => {
  it("should detect headings", () => {
    expect(isMarkdown("# Heading")).toBe(true);
    expect(isMarkdown("## Heading 2")).toBe(true);
    expect(isMarkdown("###### Heading 6")).toBe(true);
  });

  it("should detect lists", () => {
    expect(isMarkdown("- item")).toBe(true);
    expect(isMarkdown("* item")).toBe(true);
    expect(isMarkdown("1. item")).toBe(true);
  });

  it("should detect code blocks", () => {
    expect(isMarkdown("```python\ncode\n```")).toBe(true);
  });

  it("should detect math", () => {
    expect(isMarkdown("$$x^2$$")).toBe(true);
    expect(isMarkdown("$x^2$")).toBe(true);
  });

  it("should detect tables", () => {
    expect(isMarkdown("| a | b |\n|---|---|")).toBe(true);
  });

  it("should return false for plain text", () => {
    expect(isMarkdown("Hello world")).toBe(false);
  });
});

describe("parseMarkdown", () => {
  describe("headings", () => {
    it("should parse h1", () => {
      const result = parseMarkdown("# Hello World");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("heading");
      expect(result[0].attrs?.level).toBe(1);
    });

    it("should parse h2-h6", () => {
      const result = parseMarkdown("## H2\n### H3\n#### H4");
      expect(result).toHaveLength(3);
      expect(result[0].attrs?.level).toBe(2);
      expect(result[1].attrs?.level).toBe(3);
      expect(result[2].attrs?.level).toBe(4);
    });
  });

  describe("inline math", () => {
    it("should parse inline math $...$", () => {
      const result = parseMarkdown("The formula $x^2 + y^2 = z^2$ is famous.");
      expect(result).toHaveLength(1);
      const content = result[0].content;
      expect(content).toBeDefined();
      expect(content?.some(n => n.type === "inlineMath")).toBe(true);
    });

    it("should parse multiple inline math", () => {
      const result = parseMarkdown("$\\alpha$ and $\\beta$");
      const content = result[0].content;
      const mathNodes = content?.filter(n => n.type === "inlineMath");
      expect(mathNodes).toHaveLength(2);
    });
  });

  describe("block math", () => {
    it("should parse single-line block math", () => {
      const result = parseMarkdown("$$E = mc^2$$");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("blockMath");
      expect(result[0].attrs?.latex).toBe("E = mc^2");
    });

    it("should parse multi-line block math", () => {
      const result = parseMarkdown("$$\n\\frac{1}{2}\n$$");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("blockMath");
      expect(result[0].attrs?.latex).toContain("\\frac{1}{2}");
    });
  });

  describe("code blocks", () => {
    it("should parse code block with language", () => {
      const result = parseMarkdown("```python\nprint('hello')\n```");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("codeBlock");
      expect(result[0].attrs?.language).toBe("python");
    });

    it("should parse code block without language", () => {
      const result = parseMarkdown("```\ncode\n```");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("codeBlock");
    });
  });

  describe("tables", () => {
    it("should parse simple table", () => {
      const md = `| A | B |
|---|---|
| 1 | 2 |
| 3 | 4 |`;
      const result = parseMarkdown(md);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("table");
      expect(result[0].content).toHaveLength(3); // header + 2 data rows
    });

    it("should parse table with math in cells", () => {
      const md = `| Formula | Value |
|---|---|
| $x^2$ | 4 |`;
      const result = parseMarkdown(md);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("table");
    });
  });

  describe("lists", () => {
    it("should parse unordered list", () => {
      const result = parseMarkdown("- item 1\n- item 2\n- item 3");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("bulletList");
      expect(result[0].content).toHaveLength(3);
    });

    it("should parse ordered list", () => {
      const result = parseMarkdown("1. first\n2. second\n3. third");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("orderedList");
      expect(result[0].content).toHaveLength(3);
    });
  });

  describe("blockquotes", () => {
    it("should parse blockquote", () => {
      const result = parseMarkdown("> This is a quote");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("blockquote");
    });

    it("should parse multi-line blockquote", () => {
      const result = parseMarkdown("> Line 1\n> Line 2");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("blockquote");
    });
  });

  describe("inline formatting", () => {
    it("should parse bold", () => {
      const result = parseMarkdown("**bold text**");
      const content = result[0].content;
      expect(content?.some(n => n.marks?.some(m => m.type === "bold"))).toBe(true);
    });

    it("should parse italic", () => {
      const result = parseMarkdown("*italic text*");
      const content = result[0].content;
      expect(content?.some(n => n.marks?.some(m => m.type === "italic"))).toBe(true);
    });

    it("should parse inline code", () => {
      const result = parseMarkdown("`code`");
      const content = result[0].content;
      expect(content?.some(n => n.marks?.some(m => m.type === "code"))).toBe(true);
    });
  });

  describe("complex documents", () => {
    it("should parse document with mixed content", () => {
      const md = `# Title

This is a paragraph with $\\kappa_T$ inline math.

$$
\\kappa_T = -\\frac{1}{V} \\left( \\frac{\\partial V}{\\partial P} \\right)_T
$$

## Section

| System | Formula |
|--------|---------|
| Gas | $PV = nRT$ |

- Item 1
- Item 2`;

      const result = parseMarkdown(md);
      
      // Should have: heading, paragraph, block math, heading, table, list
      expect(result.length).toBeGreaterThanOrEqual(5);
      
      // Check types
      const types = result.map(n => n.type);
      expect(types).toContain("heading");
      expect(types).toContain("paragraph");
      expect(types).toContain("blockMath");
      expect(types).toContain("table");
      expect(types).toContain("bulletList");
    });
  });
});
