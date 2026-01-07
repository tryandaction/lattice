/**
 * OutputArea Component
 * 
 * Renders execution outputs from Python code cells.
 * Supports text, images, and error outputs with appropriate styling.
 * Includes collapsible long outputs and improved error formatting.
 */

"use client";

import { memo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check, AlertTriangle } from 'lucide-react';
import type { ExecutionOutput } from '@/lib/python-worker-manager';

interface OutputAreaProps {
  outputs: ExecutionOutput[];
  className?: string;
  onClear?: () => void;
}

// Threshold for collapsing long outputs (lines)
const COLLAPSE_THRESHOLD = 20;

/**
 * Copy button component
 */
function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-background/50 transition-colors"
      title="Copy output"
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </button>
  );
}

/**
 * Render a single text output with collapsible support
 */
function TextOutput({ content }: { content: string }) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const lines = content.split('\n');
  const isLong = lines.length > COLLAPSE_THRESHOLD;
  
  const displayContent = isLong && isCollapsed 
    ? lines.slice(0, COLLAPSE_THRESHOLD).join('\n') + '\n...'
    : content;
  
  return (
    <div className="relative group">
      <pre className="whitespace-pre-wrap break-words font-mono text-sm text-foreground bg-muted rounded-md p-3 pr-8">
        {displayContent}
      </pre>
      
      {/* Copy button */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton content={content} />
      </div>
      
      {/* Expand/collapse button for long outputs */}
      {isLong && (
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center gap-1 mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {isCollapsed ? (
            <>
              <ChevronRight className="h-3 w-3" />
              <span>Show {lines.length - COLLAPSE_THRESHOLD} more lines</span>
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              <span>Collapse</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

/**
 * Render an image output
 */
function ImageOutput({ src }: { src: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <div className="rounded-md overflow-hidden bg-white dark:bg-gray-900 p-2">
      <img 
        src={src} 
        alt="Plot output" 
        className={`max-w-full h-auto cursor-pointer transition-all ${
          isExpanded ? '' : 'max-h-[400px] object-contain'
        }`}
        onClick={() => setIsExpanded(!isExpanded)}
        title={isExpanded ? "Click to collapse" : "Click to expand"}
      />
      {!isExpanded && (
        <p className="text-xs text-muted-foreground text-center mt-1">
          Click image to expand
        </p>
      )}
    </div>
  );
}

/**
 * Parse error content to extract error type and message
 */
function parseError(content: string): { type: string; message: string; traceback: string[] } {
  const lines = content.split('\n');
  let type = 'Error';
  let message = content;
  const traceback: string[] = [];
  
  // Try to extract error type and message from last line
  const lastLine = lines[lines.length - 1] || '';
  const errorMatch = lastLine.match(/^(\w+Error|\w+Exception|Error):\s*(.*)$/);
  
  if (errorMatch) {
    type = errorMatch[1];
    message = errorMatch[2] || lastLine;
    // Everything before the last line is traceback
    if (lines.length > 1) {
      traceback.push(...lines.slice(0, -1));
    }
  } else {
    // Check for common error patterns
    for (let i = lines.length - 1; i >= 0; i--) {
      const match = lines[i].match(/^(\w+Error|\w+Exception):\s*(.*)$/);
      if (match) {
        type = match[1];
        message = match[2] || lines[i];
        traceback.push(...lines.slice(0, i));
        break;
      }
    }
  }
  
  return { type, message, traceback };
}

/**
 * Render an error output with improved formatting
 */
function ErrorOutput({ content }: { content: string }) {
  const [showTraceback, setShowTraceback] = useState(false);
  const { type, message, traceback } = parseError(content);
  const hasTraceback = traceback.length > 0;
  
  return (
    <div className="rounded-md border border-destructive/30 overflow-hidden">
      {/* Error header */}
      <div className="flex items-start gap-2 bg-destructive/10 p-3">
        <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-destructive text-sm">{type}</div>
          <pre className="whitespace-pre-wrap break-words font-mono text-sm text-destructive/90 mt-1">
            {message}
          </pre>
        </div>
      </div>
      
      {/* Traceback (collapsible) */}
      {hasTraceback && (
        <>
          <button
            onClick={() => setShowTraceback(!showTraceback)}
            className="flex items-center gap-1 w-full px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 transition-colors border-t border-destructive/20"
          >
            {showTraceback ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <span>{showTraceback ? 'Hide' : 'Show'} traceback ({traceback.length} lines)</span>
          </button>
          
          {showTraceback && (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground bg-muted/30 p-3 border-t border-destructive/20 max-h-[300px] overflow-auto">
              {traceback.join('\n')}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Render a single output item
 */
function OutputItem({ output }: { output: ExecutionOutput }) {
  switch (output.type) {
    case 'text':
      return <TextOutput content={output.content} />;
    case 'image':
      return <ImageOutput src={output.content} />;
    case 'error':
      return <ErrorOutput content={output.content} />;
    default:
      return null;
  }
}

/**
 * OutputArea Component
 * 
 * Renders a list of execution outputs with appropriate styling for each type.
 * Supports collapsible long outputs and improved error formatting.
 */
export const OutputArea = memo(function OutputArea({ 
  outputs, 
  className = '',
  onClear 
}: OutputAreaProps) {
  if (outputs.length === 0) {
    return null;
  }
  
  return (
    <div className={`space-y-2 ${className}`}>
      {/* Clear button */}
      {onClear && outputs.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear output
          </button>
        </div>
      )}
      
      {outputs.map((output, index) => (
        <OutputItem key={index} output={output} />
      ))}
    </div>
  );
});

export default OutputArea;
