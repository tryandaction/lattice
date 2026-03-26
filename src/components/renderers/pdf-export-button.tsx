"use client";

/**
 * PDF Export Button Component
 * 
 * Provides "Export with Annotations" functionality for PDF viewer toolbar.
 * Handles export with error fallback to JSON download.
 * Supports both web download and Tauri native save dialog.
 */

import React, { useState, useCallback } from "react";
import { Download, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  exportFlattenedPDF,
  downloadAnnotationsJSON,
} from "@/lib/pdf-burn-in-exporter";
import { exportFile } from "@/lib/export-adapter";
import { showExportToast, updateExportToast, dismissExportToast } from "@/components/ui/export-toast";
import type { AnnotationItem } from "@/types/universal-annotation";

// ============================================================================
// Types
// ============================================================================

interface PDFExportButtonProps {
  originalContent: ArrayBuffer;
  annotations: AnnotationItem[];
  fileName: string;
  disabled?: boolean;
}

export async function exportPdfWithAnnotations(
  originalContent: ArrayBuffer,
  annotations: AnnotationItem[],
  fileName: string,
): Promise<void> {
  const toastId = showExportToast({
    type: 'progress',
    message: 'Exporting PDF...',
    progress: 0,
  });

  try {
    const pdfAnnotations = annotations.filter((annotation) => annotation.target.type === 'pdf');

    let pdfBytes: Uint8Array;
    if (pdfAnnotations.length === 0) {
      pdfBytes = new Uint8Array(originalContent);
      updateExportToast(toastId, { progress: 50 });
    } else {
      updateExportToast(toastId, { progress: 30 });
      pdfBytes = await exportFlattenedPDF(originalContent, pdfAnnotations);
      updateExportToast(toastId, { progress: 70 });
    }

    const exportFileName = fileName.replace(/\.pdf$/i, '') + '_annotated.pdf';
    const result = await exportFile(pdfBytes, {
      defaultFileName: exportFileName,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    });

    dismissExportToast(toastId);

    if (result.cancelled) {
      return;
    }

    if (result.success) {
      showExportToast({
        type: 'success',
        message: 'Export successful',
        filePath: result.filePath,
      });
      return;
    }

    throw new Error(result.error || 'Export failed');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Export failed';

    dismissExportToast(toastId);
    showExportToast({
      type: 'error',
      message: 'Export failed',
      error: errorMessage,
    });

    const shouldDownloadJSON = window.confirm(
      'PDF export failed. Would you like to download your annotations as JSON instead?'
    );

    if (shouldDownloadJSON) {
      downloadAnnotationsJSON(annotations, fileName);
    }

    throw new Error(errorMessage);
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * Export button component for PDF viewer toolbar
 * Handles export with error fallback to JSON download
 */
export function PDFExportButton({
  originalContent,
  annotations,
  fileName,
  disabled = false,
}: PDFExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    if (isExporting || disabled) return;
    
    setIsExporting(true);
    setError(null);

    try {
      await exportPdfWithAnnotations(originalContent, annotations, fileName);
    } catch (err) {
      console.error('PDF export failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Export failed';
      setError(errorMessage);
    } finally {
      setIsExporting(false);
    }
  }, [originalContent, annotations, fileName, isExporting, disabled]);

  // Count PDF annotations
  const pdfAnnotationCount = annotations.filter(a => a.target.type === 'pdf').length;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleExport}
        disabled={disabled || isExporting}
        className="gap-2"
        title={pdfAnnotationCount > 0 
          ? `Export PDF with ${pdfAnnotationCount} annotation${pdfAnnotationCount !== 1 ? 's' : ''}`
          : 'Export PDF'
        }
      >
        {isExporting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        <span className="hidden sm:inline">
          {isExporting ? 'Exporting...' : 'Export'}
        </span>
        {pdfAnnotationCount > 0 && !isExporting && (
          <span className="text-xs bg-primary/20 px-1.5 py-0.5 rounded">
            {pdfAnnotationCount}
          </span>
        )}
      </Button>
      
      {error && (
        <div className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          <span className="hidden sm:inline">{error}</span>
        </div>
      )}
    </div>
  );
}

export default PDFExportButton;
