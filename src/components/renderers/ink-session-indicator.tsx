/**
 * InkSessionIndicator Component
 * 
 * Visual indicator shown during active ink drawing session.
 * Displays stroke count and hints user to pause to finish.
 */

"use client";

import React from "react";
import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface InkSessionIndicatorProps {
  isDrawing: boolean;
  strokeCount: number;
  onCancel?: () => void;
  onFinalize?: () => void;
  className?: string;
}

export function InkSessionIndicator({
  isDrawing,
  strokeCount,
  onCancel,
  onFinalize,
  className,
}: InkSessionIndicatorProps) {
  if (!isDrawing || strokeCount === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 -translate-x-1/2 z-50",
        "bg-background/95 backdrop-blur-sm border rounded-full",
        "px-4 py-2 shadow-lg",
        "flex items-center gap-3",
        "animate-in fade-in slide-in-from-bottom-2 duration-200",
        className
      )}
    >
      {/* Pulsing indicator */}
      <div className="relative">
        <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
        <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-primary/50 animate-ping" />
      </div>

      {/* Drawing icon */}
      <Pencil className="h-4 w-4 text-muted-foreground" />

      {/* Status text */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">
          绘制中...
        </span>
        <span className="text-sm text-primary font-semibold">
          {strokeCount} 笔画
        </span>
      </div>

      {/* Hint */}
      <span className="text-xs text-muted-foreground">
        (暂停2秒完成)
      </span>

      {/* Action buttons */}
      <div className="flex items-center gap-1 ml-2">
        {onFinalize && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onFinalize}
          >
            完成
          </Button>
        )}
        {onCancel && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={onCancel}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

export default InkSessionIndicator;
