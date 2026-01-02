"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary component
 * Catches JavaScript errors in child components and displays a fallback UI
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("Error caught by boundary:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorFallback
          error={this.state.error}
          onReset={this.handleReset}
        />
      );
    }

    return this.props.children;
  }
}

interface ErrorFallbackProps {
  error: Error | null;
  onReset?: () => void;
}

/**
 * Default error fallback component
 */
export function ErrorFallback({ error, onReset }: ErrorFallbackProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <AlertCircle className="h-12 w-12 text-destructive" />
      
      <h2 className="mt-4 text-lg font-medium text-foreground">
        Something went wrong
      </h2>
      
      <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
        {error?.message || "An unexpected error occurred while rendering this content."}
      </p>

      {onReset && (
        <button
          onClick={onReset}
          className="mt-6 flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      )}

      <details className="mt-6 max-w-lg">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Technical details
        </summary>
        <pre className="mt-2 overflow-auto rounded bg-muted p-3 text-xs">
          {error?.stack || "No stack trace available"}
        </pre>
      </details>
    </div>
  );
}

/**
 * Renderer-specific error fallback
 */
export function RendererErrorFallback({ 
  fileName, 
  error, 
  onRetry 
}: { 
  fileName: string; 
  error: Error | null; 
  onRetry?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <AlertCircle className="h-10 w-10 text-destructive" />
      
      <h2 className="mt-4 text-lg font-medium text-foreground">
        Failed to render file
      </h2>
      
      <p className="mt-2 text-sm text-muted-foreground">
        Could not display: <span className="font-medium">{fileName}</span>
      </p>

      {error && (
        <p className="mt-2 max-w-md text-center text-xs text-destructive">
          {error.message}
        </p>
      )}

      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      )}
    </div>
  );
}
