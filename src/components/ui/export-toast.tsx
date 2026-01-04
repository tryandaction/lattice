'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, FolderOpen, X, Loader2 } from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import { showInFolder } from '@/lib/export-adapter';
import { isTauri } from '@/lib/storage-adapter';
import { cn } from '@/lib/utils';

export interface ExportToastData {
  id: string;
  type: 'success' | 'error' | 'progress';
  message: string;
  filePath?: string;
  progress?: number;
  error?: string;
}

// Global toast state
let toastListeners: Set<(toasts: ExportToastData[]) => void> = new Set();
let currentToasts: ExportToastData[] = [];

function notifyListeners() {
  toastListeners.forEach(listener => listener([...currentToasts]));
}

export function showExportToast(toast: Omit<ExportToastData, 'id'>): string {
  const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const newToast: ExportToastData = { ...toast, id };
  currentToasts = [...currentToasts, newToast];
  notifyListeners();
  
  // Auto-dismiss success/error toasts after 5 seconds
  if (toast.type !== 'progress') {
    setTimeout(() => {
      dismissExportToast(id);
    }, 5000);
  }
  
  return id;
}

export function updateExportToast(id: string, updates: Partial<ExportToastData>) {
  currentToasts = currentToasts.map(t => 
    t.id === id ? { ...t, ...updates } : t
  );
  notifyListeners();
}

export function dismissExportToast(id: string) {
  currentToasts = currentToasts.filter(t => t.id !== id);
  notifyListeners();
}

/**
 * Single toast item component
 */
function ExportToastItem({ toast, onDismiss }: { toast: ExportToastData; onDismiss: () => void }) {
  const { t } = useI18n();

  const handleShowInFolder = useCallback(async () => {
    if (toast.filePath) {
      await showInFolder(toast.filePath);
    }
  }, [toast.filePath]);

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 rounded-lg shadow-lg border",
        "bg-background/95 backdrop-blur-sm",
        "animate-in slide-in-from-right-full duration-300",
        toast.type === 'success' && "border-green-500/30",
        toast.type === 'error' && "border-red-500/30",
        toast.type === 'progress' && "border-blue-500/30"
      )}
    >
      {/* Icon */}
      <div className="flex-shrink-0 mt-0.5">
        {toast.type === 'success' && (
          <CheckCircle className="h-5 w-5 text-green-500" />
        )}
        {toast.type === 'error' && (
          <XCircle className="h-5 w-5 text-red-500" />
        )}
        {toast.type === 'progress' && (
          <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {toast.type === 'success' && t('export.success')}
          {toast.type === 'error' && t('export.error')}
          {toast.type === 'progress' && t('export.progress')}
        </p>
        
        {toast.filePath && toast.type === 'success' && (
          <p className="text-xs text-muted-foreground mt-1 truncate" title={toast.filePath}>
            {toast.filePath}
          </p>
        )}
        
        {toast.error && (
          <p className="text-xs text-red-500 mt-1">
            {toast.error}
          </p>
        )}

        {toast.type === 'progress' && toast.progress !== undefined && (
          <div className="mt-2">
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${toast.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        {toast.type === 'success' && toast.filePath && isTauri() && (
          <button
            onClick={handleShowInFolder}
            className="flex items-center gap-1 mt-2 text-xs text-primary hover:underline"
          >
            <FolderOpen className="h-3 w-3" />
            {t('export.showInFolder')}
          </button>
        )}
      </div>

      {/* Dismiss button */}
      <button
        onClick={onDismiss}
        className="flex-shrink-0 p-1 rounded hover:bg-muted transition-colors"
      >
        <X className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
}

/**
 * Export toast container - renders all active toasts
 */
export function ExportToastContainer() {
  const [toasts, setToasts] = useState<ExportToastData[]>([]);

  useEffect(() => {
    const listener = (newToasts: ExportToastData[]) => setToasts(newToasts);
    toastListeners.add(listener);
    return () => {
      toastListeners.delete(listener);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map(toast => (
        <ExportToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => dismissExportToast(toast.id)}
        />
      ))}
    </div>
  );
}
