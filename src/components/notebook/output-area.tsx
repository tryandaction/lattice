/**
 * OutputArea Component
 * 
 * Renders execution outputs from Python code cells.
 * Supports text, images, and error outputs with appropriate styling.
 */

"use client";

import { memo } from 'react';
import type { ExecutionOutput } from '@/lib/python-worker-manager';

interface OutputAreaProps {
  outputs: ExecutionOutput[];
  className?: string;
}

/**
 * Render a single text output
 */
function TextOutput({ content }: { content: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-sm text-foreground bg-muted rounded-md p-3">
      {content}
    </pre>
  );
}

/**
 * Render an image output
 */
function ImageOutput({ src }: { src: string }) {
  return (
    <div className="rounded-md overflow-hidden bg-white p-2">
      <img 
        src={src} 
        alt="Plot output" 
        className="max-w-full h-auto"
        style={{ maxHeight: '500px' }}
      />
    </div>
  );
}

/**
 * Render an error output
 */
function ErrorOutput({ content }: { content: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-sm text-destructive bg-destructive/10 rounded-md p-3 border border-destructive/20">
      {content}
    </pre>
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
 */
export const OutputArea = memo(function OutputArea({ outputs, className = '' }: OutputAreaProps) {
  if (outputs.length === 0) {
    return null;
  }
  
  return (
    <div className={`space-y-2 ${className}`}>
      {outputs.map((output, index) => (
        <OutputItem key={index} output={output} />
      ))}
    </div>
  );
});

export default OutputArea;
