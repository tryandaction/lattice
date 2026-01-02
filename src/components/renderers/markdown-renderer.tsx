"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/cjs/styles/prism";
import type { Components } from "react-markdown";

interface MarkdownRendererProps {
  content: string;
  fileName?: string;
  className?: string;
}

/**
 * Custom components for ReactMarkdown
 */
const components: Components = {
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
          className="rounded-lg my-4 text-sm"
          {...props}
        >
          {String(children).replace(/\n$/, "")}
        </SyntaxHighlighter>
      );
    }
    
    if (!inline) {
      return (
        <pre className="bg-muted rounded-lg p-4 my-4 overflow-x-auto">
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      );
    }
    
    return (
      <code className="bg-muted rounded px-1.5 py-0.5 text-sm font-mono" {...props}>
        {children}
      </code>
    );
  },
  
  // Tables
  table({ children, ...props }: any) {
    return (
      <div className="overflow-x-auto my-4">
        <table className="w-full border-collapse text-sm" {...props}>
          {children}
        </table>
      </div>
    );
  },
  
  thead({ children, ...props }: any) {
    return (
      <thead className="bg-muted" {...props}>
        {children}
      </thead>
    );
  },
  
  th({ children, ...props }: any) {
    return (
      <th className="border border-border px-3 py-2 text-left font-semibold" {...props}>
        {children}
      </th>
    );
  },
  
  td({ children, ...props }: any) {
    return (
      <td className="border border-border px-3 py-2" {...props}>
        {children}
      </td>
    );
  },
  
  // Headings with proper styling
  h1({ children, ...props }: any) {
    return (
      <h1 className="text-3xl font-bold mt-8 mb-4 pb-2 border-b border-border" {...props}>
        {children}
      </h1>
    );
  },
  
  h2({ children, ...props }: any) {
    return (
      <h2 className="text-2xl font-bold mt-6 mb-3 pb-1 border-b border-border/50" {...props}>
        {children}
      </h2>
    );
  },
  
  h3({ children, ...props }: any) {
    return (
      <h3 className="text-xl font-semibold mt-5 mb-2" {...props}>
        {children}
      </h3>
    );
  },
  
  h4({ children, ...props }: any) {
    return (
      <h4 className="text-lg font-semibold mt-4 mb-2" {...props}>
        {children}
      </h4>
    );
  },
  
  // Blockquotes
  blockquote({ children, ...props }: any) {
    return (
      <blockquote 
        className="border-l-4 border-primary/40 pl-4 my-4 italic text-muted-foreground bg-muted/30 py-2 pr-4 rounded-r"
        {...props}
      >
        {children}
      </blockquote>
    );
  },
  
  // Lists
  ul({ children, ...props }: any) {
    return (
      <ul className="list-disc pl-6 my-3 space-y-1" {...props}>
        {children}
      </ul>
    );
  },
  
  ol({ children, ...props }: any) {
    return (
      <ol className="list-decimal pl-6 my-3 space-y-1" {...props}>
        {children}
      </ol>
    );
  },
  
  // Paragraphs
  p({ children, ...props }: any) {
    return (
      <p className="my-3 leading-relaxed" {...props}>
        {children}
      </p>
    );
  },
  
  // Links
  a({ children, href, ...props }: any) {
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
  hr({ ...props }: any) {
    return <hr className="my-8 border-border" {...props} />;
  },
  
  // Strong/Bold
  strong({ children, ...props }: any) {
    return (
      <strong className="font-bold" {...props}>
        {children}
      </strong>
    );
  },
  
  // Emphasis/Italic
  em({ children, ...props }: any) {
    return (
      <em className="italic" {...props}>
        {children}
      </em>
    );
  },
};

/**
 * High-quality Markdown renderer with:
 * - GitHub Flavored Markdown (tables, strikethrough, etc.)
 * - Math rendering via KaTeX
 * - Syntax highlighting for code blocks
 * - Responsive tables
 */
export function MarkdownRenderer({ content, fileName, className = "" }: MarkdownRendererProps) {
  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
