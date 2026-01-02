"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/cjs/styles/prism";

interface MarkdownCellProps {
  source: string;
  isActive: boolean;
  onChange: (source: string) => void;
  onFocus: () => void;
}

/**
 * Rendered Markdown view using ReactMarkdown with KaTeX support
 */
function RenderedMarkdown({ content }: { content: string }) {
  if (!content || content.trim() === "") {
    return (
      <div className="px-4 py-2 min-h-[40px] text-muted-foreground italic pointer-events-none">
        Empty markdown cell (double-click to edit)
      </div>
    );
  }

  return (
    <div className="markdown-cell-content px-4 py-2 pointer-events-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Code blocks with syntax highlighting
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || "");
            const language = match ? match[1] : "";
            
            if (!inline && language) {
              return (
                <SyntaxHighlighter
                  style={oneDark}
                  language={language}
                  PreTag="div"
                  className="rounded-lg my-2 text-sm"
                  {...props}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              );
            }
            
            if (!inline) {
              return (
                <pre className="bg-muted rounded-lg p-3 my-2 overflow-x-auto text-sm">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              );
            }
            
            return (
              <code className="bg-muted rounded px-1 py-0.5 text-sm font-mono" {...props}>
                {children}
              </code>
            );
          },
          // Headings
          h1: ({ children }) => <h1 className="text-2xl font-bold mt-4 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-xl font-bold mt-3 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-lg font-semibold mt-2 mb-1">{children}</h3>,
          h4: ({ children }) => <h4 className="text-base font-semibold mt-2 mb-1">{children}</h4>,
          // Paragraphs - use div to avoid nesting issues with pre/code blocks
          p: ({ children, node }) => {
            // Check if children contain block-level elements
            const hasBlockChild = node?.children?.some((child: any) => 
              child.type === 'element' && ['pre', 'div', 'table', 'ul', 'ol', 'blockquote'].includes(child.tagName)
            );
            // Use div if contains block elements, otherwise use p
            if (hasBlockChild) {
              return <div className="my-2 leading-relaxed">{children}</div>;
            }
            return <p className="my-2 leading-relaxed">{children}</p>;
          },
          // Lists
          ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-primary/40 pl-3 my-2 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          // Tables
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1">{children}</td>
          ),
          // Links - need pointer events for clicking
          a: ({ href, children }) => (
            <a 
              href={href} 
              className="text-primary underline hover:text-primary/80 pointer-events-auto" 
              target="_blank" 
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {children}
            </a>
          ),
          // Horizontal rule
          hr: () => <hr className="my-4 border-border" />,
          // Strong/Bold
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          // Emphasis/Italic
          em: ({ children }) => <em className="italic">{children}</em>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Markdown Cell Component
 * 
 * Renders a markdown cell with two modes:
 * - View mode: Rendered Markdown with KaTeX (default)
 * - Edit mode: Plain text editor (activated by double-click)
 */
export function MarkdownCell({
  source,
  onChange,
  onFocus,
}: MarkdownCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(source);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync edit content when source changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditContent(source);
    }
  }, [source, isEditing]);

  // Handle double-click to enter edit mode
  const handleDoubleClick = () => {
    setIsEditing(true);
    setEditContent(source);
    onFocus();
    // Focus textarea after a short delay and auto-resize
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        // Auto-resize to fit content
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = Math.max(150, textareaRef.current.scrollHeight) + "px";
        // Move cursor to end
        textareaRef.current.selectionStart = textareaRef.current.value.length;
        textareaRef.current.selectionEnd = textareaRef.current.value.length;
      }
    }, 50);
  };

  // Handle exiting edit mode
  const exitEditMode = () => {
    setIsEditing(false);
    // Save changes
    if (editContent !== source) {
      onChange(editContent);
    }
  };

  // Handle click outside to exit edit mode
  useEffect(() => {
    if (!isEditing) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        exitEditMode();
      }
    };

    // Delay adding listener to avoid immediate trigger
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isEditing, editContent, source]);

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      // Cancel changes
      setEditContent(source);
      setIsEditing(false);
    }
    // Ctrl+Enter to save and exit
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      exitEditMode();
    }
  };

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditContent(e.target.value);
    // Auto-resize
    e.target.style.height = "auto";
    e.target.style.height = Math.max(150, e.target.scrollHeight) + "px";
  };

  return (
    <div ref={containerRef}>
      {isEditing ? (
        <div className="rounded-lg border-2 border-primary bg-background overflow-hidden">
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            className="w-full min-h-[150px] p-4 bg-background text-foreground font-mono text-sm resize-none focus:outline-none"
            placeholder="Enter markdown content..."
          />
          <div className="px-4 py-1 text-[10px] text-muted-foreground border-t border-border bg-muted/30">
            <kbd className="px-1 py-0.5 rounded bg-muted">Ctrl+Enter</kbd> to save • <kbd className="px-1 py-0.5 rounded bg-muted">Esc</kbd> to cancel
          </div>
        </div>
      ) : (
        <div
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleDoubleClick();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onFocus();
          }}
          className="rounded-lg border border-border bg-background overflow-hidden cursor-pointer hover:border-primary/50 transition-colors select-none"
        >
          <RenderedMarkdown content={source} />
        </div>
      )}
    </div>
  );
}
