/**
 * KernelStatus Component
 * 
 * Displays the current Python kernel status with appropriate visual feedback.
 * Shows progress bar during loading, spinner during execution, and error state.
 */

"use client";

import { memo, useState, useEffect } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { RunnerStatus as KernelStatusType } from '@/lib/runner/types';

interface KernelStatusProps {
  status: KernelStatusType;
  error?: string | null;
  className?: string;
}

/**
 * Loading indicator with progress bar
 */
function LoadingIndicator() {
  return (
    <div className="code-workbench-muted-text flex items-center gap-2 text-sm">
      <div className="relative h-1.5 w-32 overflow-hidden rounded-full" style={{ backgroundColor: "var(--code-surface-muted)" }}>
        <div 
          className="loading-progress-bar absolute inset-y-0 left-0 rounded-full"
          style={{ backgroundColor: "var(--code-cursor)" }}
        />
      </div>
      <span className="text-xs">Initializing Python kernel...</span>
    </div>
  );
}

/**
 * Running indicator with spinner
 */
function RunningIndicator() {
  return (
    <div className="code-workbench-muted-text flex items-center gap-2 text-sm">
      <svg 
        className="h-4 w-4 animate-spin" 
        style={{ color: "var(--code-cursor)" }}
        xmlns="http://www.w3.org/2000/svg" 
        fill="none" 
        viewBox="0 0 24 24"
      >
        <circle 
          className="opacity-25" 
          cx="12" 
          cy="12" 
          r="10" 
          stroke="currentColor" 
          strokeWidth="4"
        />
        <path 
          className="opacity-75" 
          fill="currentColor" 
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      <span className="text-xs">Executing...</span>
    </div>
  );
}

/**
 * Ready indicator — icon only, fades out after 1.5s
 */
function ReadyIndicator() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 1500);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <div
      className="code-workbench-status-success flex items-center rounded-full px-2 py-1 transition-opacity duration-500"
      role="status"
      aria-label="Kernel ready"
    >
      <CheckCircle2 className="h-3 w-3" />
      <span className="sr-only">Kernel ready</span>
    </div>
  );
}

/**
 * Error indicator
 */
function ErrorIndicator({ error }: { error?: string | null }) {
  return (
    <div className="code-workbench-status-error flex items-center gap-1.5 rounded-full px-2 py-1 text-xs">
      <AlertCircle className="h-3 w-3" />
      <span>{error || 'Kernel error'}</span>
    </div>
  );
}

/**
 * KernelStatus Component
 * 
 * Shows visual feedback for kernel loading, execution, ready, and error states.
 */
export const KernelStatus = memo(function KernelStatus({ 
  status, 
  error,
  className = '' 
}: KernelStatusProps) {
  // Don't show anything for idle state
  if (status === 'idle') {
    return null;
  }
  
  return (
    <div className={`py-2 ${className}`}>
      {status === 'loading' && <LoadingIndicator />}
      {status === 'running' && <RunningIndicator />}
      {status === 'ready' && <ReadyIndicator />}
      {status === 'error' && <ErrorIndicator error={error} />}
    </div>
  );
});

export default KernelStatus;
