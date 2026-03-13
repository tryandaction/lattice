/**
 * Loading Indicator Component
 *
 * 显示 Pyodide 加载进度和状态
 */

'use client';

import { Loader2 } from 'lucide-react';

interface LoadingIndicatorProps {
  status: 'loading' | 'ready' | 'error';
  message?: string;
}

export function LoadingIndicator({ status, message }: LoadingIndicatorProps) {
  if (status === 'ready') return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-card border border-border rounded-lg shadow-lg p-4 min-w-[300px]">
        <div className="flex items-center gap-3">
          {status === 'loading' && (
            <>
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div>
                <p className="text-sm font-medium">正在加载 Python 环境...</p>
                {message && (
                  <p className="text-xs text-muted-foreground mt-1">{message}</p>
                )}
              </div>
            </>
          )}
          {status === 'error' && (
            <>
              <div className="h-5 w-5 rounded-full bg-red-500/10 flex items-center justify-center">
                <span className="text-red-500 text-sm">✕</span>
              </div>
              <div>
                <p className="text-sm font-medium text-red-500">加载失败</p>
                {message && (
                  <p className="text-xs text-muted-foreground mt-1">{message}</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
