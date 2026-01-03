"use client";

/**
 * PDF Export Button Component
 * 
 * Provides "Export with Annotations" functionality for PDF viewer toolbar.
 * Handles export with error fallback to JSON download.
 */

import React, { useState, useCallback } from "react";
import { Download, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  exportFlattenedPDF,
  downloadFlattenedPDF,
  downloadAnnotationsJSON,
} from "@/lib/pdf-burn-in-exporter";
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
      // Filter to only PDF annotations
      const pdfAnnotations = annotations.filter(a => a.target.type === 'pdf');
      
      if (pdfAnnotations.length === 0) {
        // No annotations to export, just download original
        const blob = new Blob([originalContent], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      
      // Export with annotations burned in
      const pdfBytes = await exportFlattenedPDF(originalContent, pdfAnnotations);
      downloadFlattenedPDF(pdfBytes, fileName);
    } catch (err) {
      console.error('PDF export failed:', err);
      setError(err instanceof Error ? err.message : 'Export failed');
      
      // Offer JSON fallback
      const shouldDownloadJSON = window.confirm(
        'PDF export failed. Would you like to download your annotations as JSON instead?'
      );
      
      if (shouldDownloadJSON) {
        downloadAnnotationsJSON(annotations, fileName);
      }
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
