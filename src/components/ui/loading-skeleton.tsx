"use client";

import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

/**
 * Basic skeleton component for loading states
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted",
        className
      )}
    />
  );
}

/**
 * Document loading skeleton
 * Shows a skeleton UI while document content is loading
 */
export function DocumentSkeleton() {
  return (
    <div className="mx-auto max-w-4xl p-8">
      {/* Title skeleton */}
      <Skeleton className="h-8 w-3/4 mb-4" />
      
      {/* Subtitle skeleton */}
      <Skeleton className="h-4 w-1/2 mb-8" />
      
      {/* Content paragraphs */}
      <div className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      
      {/* Image placeholder */}
      <Skeleton className="h-48 w-full mt-8 mb-8" />
      
      {/* More content */}
      <div className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}

/**
 * Code loading skeleton
 * Shows a skeleton UI while code content is loading
 */
export function CodeSkeleton() {
  return (
    <div className="p-4">
      {/* Header */}
      <Skeleton className="h-6 w-48 mb-4" />
      
      {/* Code lines */}
      <div className="space-y-2 font-mono">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

/**
 * PDF loading skeleton
 * Shows a skeleton UI while PDF is loading
 */
export function PDFSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Toolbar skeleton */}
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
        <Skeleton className="h-4 w-32" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-24" />
        </div>
      </div>
      
      {/* PDF page skeleton */}
      <div className="flex-1 flex items-center justify-center p-4 bg-muted/30">
        <Skeleton className="h-[800px] w-[600px] shadow-lg" />
      </div>
    </div>
  );
}
