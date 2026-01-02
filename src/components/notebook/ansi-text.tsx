/**
 * AnsiText Component
 * 
 * Renders text with ANSI escape sequences as colored HTML.
 * Uses monospace font for terminal-style output.
 */

"use client";

import { useMemo } from "react";
import { renderAnsiToHtml, containsAnsiCodes } from "@/lib/ansi-renderer";

interface AnsiTextProps {
  text: string;
  className?: string;
}

/**
 * AnsiText Component
 * 
 * Renders text containing ANSI escape sequences with proper colors and styles.
 * Falls back to plain text if no ANSI codes are present.
 */
export function AnsiText({ text, className = "" }: AnsiTextProps) {
  const html = useMemo(() => {
    if (!text) return "";
    return renderAnsiToHtml(text);
  }, [text]);

  const hasAnsi = useMemo(() => containsAnsiCodes(text), [text]);

  // Base styles for terminal output
  const baseClassName = `font-mono text-sm whitespace-pre-wrap ${className}`;

  if (!hasAnsi) {
    // No ANSI codes, render as plain text
    return (
      <pre className={baseClassName}>
        {text}
      </pre>
    );
  }

  // Render with ANSI colors
  return (
    <pre
      className={baseClassName}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
