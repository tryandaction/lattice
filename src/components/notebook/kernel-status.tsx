/**
 * KernelStatus Component
 * 
 * Displays the current Python kernel status with appropriate visual feedback.
 * Shows progress bar during loading and spinner during execution.
 */

"use client";

import { memo } from 'react';
import type { KernelStatus as KernelStatusType } from '@/lib/python-worker-manager';

interface KernelStatusProps {
  status: KernelStatusType;
  className?: string;
}

/**
 * Loading indicator with progress bar
 */
function LoadingIndicator() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <div className="relative w-32 h-1.5 bg-muted rounded-full overflow-hidden">
        <div 
          className="absolute inset-y-0 left-0 bg-primary rounded-full loading-progress-bar"
        />
      </div>
      <span className="text-xs">Initializing Python...</span>
    </div>
  );
}

/**
 * Running indicator with spinner
 */
function RunningIndicator() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <svg 
        className="animate-spin h-4 w-4 text-primary" 
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
      <span className="text-xs">Running...</span>
    </div>
  );
}

/**
 * KernelStatus Component
 * 
 * Shows visual feedback for kernel loading and code execution states.
 */
export const KernelStatus = memo(function KernelStatus({ 
  status, 
  className = '' 
}: KernelStatusProps) {
  // Only show for loading and running states
  if (status !== 'loading' && status !== 'running') {
    return null;
  }
  
  return (
    <div className={`py-2 ${className}`}>
      {status === 'loading' && <LoadingIndicator />}
      {status === 'running' && <RunningIndicator />}
    </div>
  );
});

export default KernelStatus;
