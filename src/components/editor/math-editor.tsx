"use client";

/**
 * MathEditor - Visual LaTeX Formula Editor
 *
 * Uses MathLive for WYSIWYG formula editing.
 * Integrates with CodeMirror's MathWidget for seamless editing experience.
 *
 * Features:
 * - Visual formula editing with MathLive
 * - Enter to save, Escape to cancel
 * - Real-time LaTeX preview
 * - Keyboard shortcuts
 * - Positioned overlay near formula
 */

import { useEffect, useRef, useState } from 'react';
import type { MathfieldElement } from 'mathlive';
import { MathSymbolPalette } from './math-symbol-palette';
import { getTemplateByPrefix, insertTemplate, searchTemplates, type MathTemplate } from '@/lib/math-templates';

export interface MathEditorProps {
  /** Initial LaTeX content */
  initialLatex: string;

  /** Whether this is a block formula ($$...$$) or inline ($...$) */
  isBlock: boolean;

  /** Callback when user saves the formula (Enter key) */
  onSave: (latex: string) => void;

  /** Callback when user cancels editing (Escape key) */
  onCancel: () => void;

  /** Position to display the editor */
  position: {
    top: number;
    left: number;
  };
}

/**
 * MathEditor Component
 *
 * Provides a visual LaTeX editor using MathLive.
 * Opens as an overlay when user double-clicks a formula.
 */
export function MathEditor({
  initialLatex,
  isBlock,
  onSave,
  onCancel,
  position,
}: MathEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mathfieldRef = useRef<MathfieldElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showSymbolPalette, setShowSymbolPalette] = useState(false);
  const [templateSuggestion, setTemplateSuggestion] = useState<{
    key: string;
    template: MathTemplate;
  } | null>(null);

  useEffect(() => {
    let mounted = true;

    // Dynamically import MathLive
    import('mathlive').then((module) => {
      if (!mounted) return;

      // Create MathfieldElement
      const mf = new module.MathfieldElement();

      // Set initial value
      mf.value = initialLatex;

      // Note: MathLive 0.108.2 API - options are set via attributes or properties
      // Most options work out of the box with sensible defaults

      // Handle keyboard shortcuts
      mf.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          // Enter: Save
          e.preventDefault();
          onSave(mf.value);
        } else if (e.key === 'Escape') {
          // Escape: Cancel
          e.preventDefault();
          onCancel();
        } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
          // Ctrl+Shift+M: Toggle symbol palette
          e.preventDefault();
          setShowSymbolPalette((prev) => !prev);
        } else if (e.key === 'Tab' && templateSuggestion) {
          // Tab: Insert template
          e.preventDefault();

          // Get current value and find the /prefix
          const currentValue = mf.value;
          const lastSlashIndex = currentValue.lastIndexOf('/');

          if (lastSlashIndex !== -1) {
            // Remove the /prefix
            const beforeSlash = currentValue.substring(0, lastSlashIndex);
            const afterPrefix = currentValue.substring(lastSlashIndex).replace(/^\/\w+/, '');

            // Set value without prefix
            mf.value = beforeSlash + afterPrefix;

            // Insert template
            insertTemplate(mf, templateSuggestion.template.latex);
          }

          setTemplateSuggestion(null);
        }
      });

      // Handle input to detect template prefixes
      mf.addEventListener('input', () => {
        const value = mf.value;

        // Check for /prefix pattern
        const match = value.match(/\/(\w+)$/);

        if (match) {
          const prefix = match[1];
          const template = getTemplateByPrefix(prefix);

          if (template) {
            setTemplateSuggestion({ key: prefix, template });
          } else {
            setTemplateSuggestion(null);
          }
        } else {
          setTemplateSuggestion(null);
        }
      });

      // Store reference
      mathfieldRef.current = mf;

      // Append to container
      if (containerRef.current) {
        containerRef.current.appendChild(mf);
      }

      // Focus after a brief delay to ensure rendering
      setTimeout(() => {
        if (mounted) {
          mf.focus();
          setIsLoading(false);
        }
      }, 50);
    }).catch((err) => {
      console.error('Failed to load MathLive:', err);
      if (mounted) {
        setIsLoading(false);
      }
    });

    return () => {
      mounted = false;
      if (mathfieldRef.current) {
        mathfieldRef.current.remove();
        mathfieldRef.current = null;
      }
    };
  }, [initialLatex, onSave, onCancel]);

  const handleSave = () => {
    if (mathfieldRef.current) {
      onSave(mathfieldRef.current.value);
    }
  };

  const handleCancel = () => {
    onCancel();
  };

  // Handle click outside to cancel
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onCancel();
      }
    };

    // Add listener after a brief delay to avoid immediate trigger
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onCancel]);

  // Handle symbol insertion from palette
  const handleSymbolInsert = (latex: string) => {
    if (mathfieldRef.current) {
      mathfieldRef.current.insert(latex);
      mathfieldRef.current.focus();
    }
  };

  return (
    <div
      className="math-editor-overlay"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 1000,
      }}
    >
      <div className="math-editor-container">
        <div className="math-editor-header">
          <span className="math-editor-title">
            {isBlock ? 'Block Formula' : 'Inline Formula'}
          </span>
          <span className="math-editor-hint">
            Enter to save • Esc to cancel
          </span>
        </div>

        <div
          ref={containerRef}
          className="math-editor-field"
          style={{
            minWidth: isBlock ? '500px' : '300px',
            minHeight: isBlock ? '80px' : '50px',
          }}
        >
          {isLoading && (
            <div className="math-editor-loading">
              Loading editor...
            </div>
          )}
        </div>

        {/* Template Suggestion */}
        {templateSuggestion && (
          <div className="template-suggestion">
            <div className="template-suggestion-content">
              <span className="template-suggestion-label">
                Template: <strong>/{templateSuggestion.key}</strong>
              </span>
              <span className="template-suggestion-desc">
                {templateSuggestion.template.description}
              </span>
            </div>
            <span className="template-suggestion-hint">
              Press Tab to insert
            </span>
          </div>
        )}

        <div className="math-editor-actions">
          <button
            onClick={() => setShowSymbolPalette(!showSymbolPalette)}
            className="math-editor-button math-editor-button-secondary"
            disabled={isLoading}
            title="Toggle symbol palette (Ctrl+Shift+M)"
          >
            Σ Symbols
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={handleSave}
            className="math-editor-button math-editor-button-primary"
            disabled={isLoading}
          >
            Save (Enter)
          </button>
          <button
            onClick={handleCancel}
            className="math-editor-button math-editor-button-secondary"
          >
            Cancel (Esc)
          </button>
        </div>
      </div>

      {/* Symbol Palette */}
      <MathSymbolPalette
        isOpen={showSymbolPalette}
        onInsert={handleSymbolInsert}
        onClose={() => setShowSymbolPalette(false)}
      />

      <style jsx>{`
        .math-editor-overlay {
          filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.15));
        }

        .math-editor-container {
          background: white;
          border: 2px solid hsl(var(--primary));
          border-radius: 8px;
          padding: 12px;
          max-width: 90vw;
        }

        .math-editor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid hsl(var(--border));
        }

        .math-editor-title {
          font-size: 14px;
          font-weight: 600;
          color: hsl(var(--foreground));
        }

        .math-editor-hint {
          font-size: 12px;
          color: hsl(var(--muted-foreground));
        }

        .math-editor-field {
          margin-bottom: 12px;
        }

        .math-editor-field :global(math-field) {
          font-size: 18px;
          padding: 8px;
          border: 1px solid hsl(var(--border));
          border-radius: 4px;
          width: 100%;
          min-height: inherit;
          background: hsl(var(--background));
        }

        .math-editor-field :global(math-field:focus) {
          outline: 2px solid hsl(var(--ring));
          outline-offset: 2px;
        }

        .math-editor-loading {
          padding: 20px;
          text-align: center;
          color: hsl(var(--muted-foreground));
          font-size: 14px;
        }

        .template-suggestion {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          margin-bottom: 12px;
          background: hsl(var(--accent) / 0.5);
          border: 1px solid hsl(var(--primary) / 0.3);
          border-radius: 4px;
          animation: slideIn 0.2s ease-out;
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .template-suggestion-content {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .template-suggestion-label {
          font-size: 13px;
          color: hsl(var(--foreground));
        }

        .template-suggestion-label strong {
          color: hsl(var(--primary));
          font-weight: 600;
        }

        .template-suggestion-desc {
          font-size: 12px;
          color: hsl(var(--muted-foreground));
        }

        .template-suggestion-hint {
          font-size: 11px;
          color: hsl(var(--muted-foreground));
          background: hsl(var(--background));
          padding: 4px 8px;
          border-radius: 3px;
          border: 1px solid hsl(var(--border));
        }

        .math-editor-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }

        .math-editor-button {
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          border: 1px solid hsl(var(--border));
        }

        .math-editor-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .math-editor-button-primary {
          background: hsl(var(--primary));
          color: hsl(var(--primary-foreground));
          border-color: hsl(var(--primary));
        }

        .math-editor-button-primary:hover:not(:disabled) {
          opacity: 0.9;
        }

        .math-editor-button-secondary {
          background: hsl(var(--background));
          color: hsl(var(--foreground));
        }

        .math-editor-button-secondary:hover {
          background: hsl(var(--accent));
        }

        /* Dark mode support */
        @media (prefers-color-scheme: dark) {
          .math-editor-container {
            background: hsl(var(--background));
          }
        }
      `}</style>
    </div>
  );
}
