"use client";

/**
 * AnnotationMarkdownRenderer
 *
 * Compact Markdown + KaTeX renderer designed for the narrow PDF annotation sidebar.
 * Features:
 * - text-xs sizing throughout
 * - Scrollable tables and code blocks
 * - KaTeX math (dynamic import, graceful fallback)
 * - GFM: tables, strikethrough, task lists
 * - No copy buttons (too wide for sidebar)
 */

import "katex/dist/katex.min.css";
import { useState, useEffect, type ComponentPropsWithoutRef, type CSSProperties, type JSX } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { KATEX_MACROS } from "@/lib/katex-config";

type RehypeKatexPlugin = typeof import("rehype-katex").default;
type MarkdownProps<T extends keyof JSX.IntrinsicElements> = ComponentPropsWithoutRef<T> & { node?: unknown };
type MarkdownCodeProps = MarkdownProps<"code"> & { inline?: boolean };

interface AnnotationMarkdownRendererProps {
  content: string;
  className?: string;
}

export function AnnotationMarkdownRenderer({ content, className }: AnnotationMarkdownRendererProps) {
  const [rehypeKatex, setRehypeKatex] = useState<RehypeKatexPlugin | null>(null);

  useEffect(() => {
    let active = true;
    import("rehype-katex")
      .then((mod) => {
        if (!active) return;
        setRehypeKatex(() => (mod.default ?? mod) as RehypeKatexPlugin);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  return (
    <div className={`annotation-md text-xs leading-relaxed break-words ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={rehypeKatex ? [[rehypeKatex, { macros: KATEX_MACROS, throwOnError: false, strict: false, trust: true }]] : []}
        components={{
          p: ({ children }) => <p className="my-0.5 leading-relaxed">{children}</p>,

          h1: ({ children }) => <p className="font-bold text-sm mt-1 mb-0.5 border-b border-border pb-0.5">{children}</p>,
          h2: ({ children }) => <p className="font-bold text-xs mt-1 mb-0.5">{children}</p>,
          h3: ({ children }) => <p className="font-semibold text-xs mt-0.5 mb-0">{children}</p>,
          h4: ({ children }) => <p className="font-semibold text-xs">{children}</p>,
          h5: ({ children }) => <p className="font-medium text-xs">{children}</p>,
          h6: ({ children }) => <p className="font-medium text-xs text-muted-foreground">{children}</p>,

          code({ inline, className: cls, children, style: _s, node: _n, ...props }: MarkdownCodeProps) {
            const match = /language-(\w+)/.exec(cls || "");
            const lang = match ? match[1] : "";
            if (!inline && lang) {
              return (
                <div className="my-1 overflow-x-auto rounded text-[11px]">
                  <SyntaxHighlighter
                    style={oneDark as Record<string, CSSProperties>}
                    language={lang}
                    PreTag="div"
                    customStyle={{ margin: 0, padding: "5px 8px", fontSize: "11px", borderRadius: "4px" }}
                    {...props}
                  >
                    {String(children).replace(/\n$/, "")}
                  </SyntaxHighlighter>
                </div>
              );
            }
            if (!inline) {
              return (
                <pre className="my-1 overflow-x-auto rounded bg-muted px-2 py-1 text-[11px] font-mono">
                  <code className={cls} {...props}>{children}</code>
                </pre>
              );
            }
            return (
              <code className="rounded bg-muted px-1 py-0.5 text-[11px] font-mono text-primary" {...props}>
                {children}
              </code>
            );
          },

          ul: ({ children }) => <ul className="list-disc pl-4 my-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 my-0.5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,

          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/40 pl-2 my-1 italic text-muted-foreground bg-muted/20 rounded-r">
              {children}
            </blockquote>
          ),

          table: ({ children }) => (
            <div className="overflow-x-auto my-1 rounded border border-border">
              <table className="w-full border-collapse text-[11px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
          tr: ({ children }) => <tr className="hover:bg-muted/30">{children}</tr>,
          th: ({ children }) => <th className="px-2 py-1 text-left font-semibold border-b border-border">{children}</th>,
          td: ({ children }) => <td className="px-2 py-1">{children}</td>,

          a: ({ href, children }) => (
            <a href={href} className="text-primary underline decoration-primary/40 hover:decoration-primary" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),

          hr: () => <hr className="my-1 border-0 border-t border-border" />,
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => <del className="line-through text-muted-foreground">{children}</del>,

          input: ({ type, checked, ...props }) => {
            if (type === "checkbox") {
              return <input type="checkbox" checked={checked} readOnly className="mr-1 rounded border-border pointer-events-none" {...props} />;
            }
            return <input type={type} {...props} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
