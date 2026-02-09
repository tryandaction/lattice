"use client";

import { useState, useCallback, type ComponentPropsWithoutRef, type CSSProperties, type JSX } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/cjs/styles/prism";
import type { Components } from "react-markdown";
import { Check, Copy } from "lucide-react";
import { KATEX_MACROS } from "@/lib/katex-config";

interface MarkdownRendererProps {
  content: string;
  fileName?: string;
  className?: string;
}

type MarkdownProps<T extends keyof JSX.IntrinsicElements> = ComponentPropsWithoutRef<T> & {
  node?: unknown;
};

type MarkdownCodeProps = MarkdownProps<"code"> & { inline?: boolean };

/**
 * Copy button component for code blocks
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
      title={copied ? "Copied!" : "Copy code"}
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </button>
  );
}

/**
 * Custom components for ReactMarkdown
 */
const components: Components = {
  // Code blocks with syntax highlighting and copy button
  code({ inline, className, children, style: _style, node: _node, ...props }: MarkdownCodeProps) {
    const match = /language-([^\s]+)/.exec(className || "");
    const language = match ? match[1].toLowerCase() : "";
    const codeString = String(children).replace(/\n$/, "");

    if (!inline && language) {
      return (
        <div className="relative group my-4">
          <SyntaxHighlighter
            style={oneDark as Record<string, CSSProperties>}
            language={language}
            PreTag="div"
            className="rounded-lg text-sm !mt-0 !mb-0"
            {...props}
          >
            {codeString}
          </SyntaxHighlighter>
          <CopyButton text={codeString} />
        </div>
      );
    }

    if (!inline) {
      return (
        <div className="relative group my-4">
          <pre className="bg-muted rounded-lg p-4 overflow-x-auto">
            <code className={className} {...props}>
              {children}
            </code>
          </pre>
          <CopyButton text={codeString} />
        </div>
      );
    }

    return (
      <code className="bg-muted rounded px-1.5 py-0.5 text-sm font-mono" {...props}>
        {children}
      </code>
    );
  },
  
  // Tables
  table({ children, ...props }: MarkdownProps<"table">) {
    return (
      <div className="overflow-x-auto my-4">
        <table className="w-full border-collapse text-sm" {...props}>
          {children}
        </table>
      </div>
    );
  },
  
  thead({ children, ...props }: MarkdownProps<"thead">) {
    return (
      <thead className="bg-muted" {...props}>
        {children}
      </thead>
    );
  },
  
  th({ children, ...props }: MarkdownProps<"th">) {
    return (
      <th className="border border-border px-3 py-2 text-left font-semibold" {...props}>
        {children}
      </th>
    );
  },
  
  td({ children, ...props }: MarkdownProps<"td">) {
    return (
      <td className="border border-border px-3 py-2" {...props}>
        {children}
      </td>
    );
  },
  
  // Headings with proper styling
  h1({ children, ...props }: MarkdownProps<"h1">) {
    return (
      <h1 className="text-3xl font-bold mt-8 mb-4 pb-2 border-b border-border" {...props}>
        {children}
      </h1>
    );
  },
  
  h2({ children, ...props }: MarkdownProps<"h2">) {
    return (
      <h2 className="text-2xl font-bold mt-6 mb-3 pb-1 border-b border-border/50" {...props}>
        {children}
      </h2>
    );
  },
  
  h3({ children, ...props }: MarkdownProps<"h3">) {
    return (
      <h3 className="text-xl font-semibold mt-5 mb-2" {...props}>
        {children}
      </h3>
    );
  },
  
  h4({ children, ...props }: MarkdownProps<"h4">) {
    return (
      <h4 className="text-lg font-semibold mt-4 mb-2" {...props}>
        {children}
      </h4>
    );
  },

  h5({ children, ...props }: MarkdownProps<"h5">) {
    return (
      <h5 className="text-base font-semibold mt-3 mb-1" {...props}>
        {children}
      </h5>
    );
  },

  h6({ children, ...props }: MarkdownProps<"h6">) {
    return (
      <h6 className="text-sm font-semibold mt-3 mb-1 text-muted-foreground" {...props}>
        {children}
      </h6>
    );
  },
  
  // Blockquotes
  blockquote({ children, ...props }: MarkdownProps<"blockquote">) {
    return (
      <blockquote 
        className="border-l-4 border-primary/40 pl-4 my-4 italic text-muted-foreground bg-muted/30 py-2 pr-4 rounded-r"
        {...props}
      >
        {children}
      </blockquote>
    );
  },
  
  // Lists with better nesting support
  ul({ children, ...props }: MarkdownProps<"ul">) {
    return (
      <ul className="list-disc pl-6 my-3 space-y-1.5 [&_ul]:my-1.5 [&_ul]:space-y-1 [&_ol]:my-1.5 [&_ol]:space-y-1" {...props}>
        {children}
      </ul>
    );
  },

  ol({ children, ...props }: MarkdownProps<"ol">) {
    return (
      <ol className="list-decimal pl-6 my-3 space-y-1.5 [&_ul]:my-1.5 [&_ul]:space-y-1 [&_ol]:my-1.5 [&_ol]:space-y-1" {...props}>
        {children}
      </ol>
    );
  },

  li({ children, ...props }: MarkdownProps<"li">) {
    return (
      <li className="leading-relaxed" {...props}>
        {children}
      </li>
    );
  },
  
  // Paragraphs
  p({ children, ...props }: MarkdownProps<"p">) {
    return (
      <p className="my-3 leading-relaxed" {...props}>
        {children}
      </p>
    );
  },
  
  // Links
  a({ children, href, ...props }: MarkdownProps<"a">) {
    return (
      <a 
        href={href}
        className="text-primary underline underline-offset-2 hover:text-primary/80"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    );
  },
  
  // Horizontal rule
  hr({ ...props }: MarkdownProps<"hr">) {
    return <hr className="my-8 border-0 border-t border-border" {...props} />;
  },
  
  // Strong/Bold
  strong({ children, ...props }: MarkdownProps<"strong">) {
    return (
      <strong className="font-bold" {...props}>
        {children}
      </strong>
    );
  },
  
  // Emphasis/Italic
  em({ children, ...props }: MarkdownProps<"em">) {
    return (
      <em className="italic" {...props}>
        {children}
      </em>
    );
  },

  // Strikethrough
  del({ children, ...props }: MarkdownProps<"del">) {
    return (
      <del className="line-through text-muted-foreground" {...props}>
        {children}
      </del>
    );
  },

  // Images
  img({ src, alt, ...props }: MarkdownProps<"img">) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img 
        src={src}
        alt={alt || ""}
        className="rounded-lg my-4 max-w-full h-auto"
        loading="lazy"
        {...props}
      />
    );
  },

  // Pre element (for code blocks without language)
  pre({ children, ...props }: MarkdownProps<"pre">) {
    return (
      <pre className="bg-muted rounded-lg p-4 my-4 overflow-x-auto text-sm" {...props}>
        {children}
      </pre>
    );
  },
};

const katexOptions = {
  macros: KATEX_MACROS,
  throwOnError: false,
  strict: false,
  trust: true,
};

/**
 * High-quality Markdown renderer with:
 * - GitHub Flavored Markdown (tables, strikethrough, etc.)
 * - Math rendering via KaTeX
 * - Syntax highlighting for code blocks
 * - Responsive tables
 *
 * Note: HTML content should be converted to Markdown before reaching this component
 * via normalizeScientificText() in universal-file-viewer.tsx
 */
export function MarkdownRenderer({ content, fileName: _fileName, className = "" }: MarkdownRendererProps) {
  // Content should already be normalized to Markdown by upstream (universal-file-viewer)
  // If HTML is still present, it will be handled by rehypeRaw plugin safely
  
  return (
    <div className={`prose prose-lattice dark:prose-invert max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeKatex, katexOptions]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
