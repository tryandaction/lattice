"use client";

import { Loader2 } from "lucide-react";
import { LoadingIndicatorProps } from "@/types/ppt-viewer";

/**
 * PPT Loading Indicator Component
 * 
 * Displays loading progress with a progress bar and status text.
 * No download prompts or file selection dialogs.
 */
export function PPTLoadingIndicator({
  progress,
  status,
  isVisible,
}: LoadingIndicatorProps) {
  if (!isVisible) {
    return null;
  }

  // Clamp progress between 0 and 100
  const clampedProgress = Math.min(100, Math.max(0, progress));

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm z-10 transition-opacity duration-300">
      <div className="flex flex-col items-center gap-4 p-8 max-w-xs">
        {/* Spinning loader */}
        <div className="relative">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          {/* Progress ring overlay */}
          <svg 
            className="absolute inset-0 h-10 w-10 -rotate-90"
            viewBox="0 0 40 40"
          >
            <circle
              className="text-muted stroke-current"
              strokeWidth="3"
              fill="transparent"
              r="16"
              cx="20"
              cy="20"
            />
            <circle
              className="text-primary stroke-current transition-all duration-300 ease-out"
              strokeWidth="3"
              strokeLinecap="round"
              fill="transparent"
              r="16"
              cx="20"
              cy="20"
              style={{
                strokeDasharray: `${2 * Math.PI * 16}`,
                strokeDashoffset: `${2 * Math.PI * 16 * (1 - clampedProgress / 100)}`,
              }}
            />
          </svg>
        </div>
        
        {/* Status text */}
        <p className="text-sm text-muted-foreground text-center">{status}</p>
        
        {/* Progress bar */}
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
            style={{ width: `${clampedProgress}%` }}
          />
        </div>
        
        {/* Progress percentage */}
        <p className="text-xs text-muted-foreground tabular-nums">
          {Math.round(clampedProgress)}%
        </p>
      </div>
    </div>
  );
}
