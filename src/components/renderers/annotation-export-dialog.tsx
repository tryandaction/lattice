"use client";

/**
 * Annotation Export Dialog Component
 *
 * Provides UI for exporting PDF annotations in multiple formats
 * with customizable options (Zotero-style)
 */

import { useState } from 'react';
import { Download, Copy, Check, FileText, FileJson, File } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AnnotationFile } from '@/types/annotation';
import {
  exportAnnotations,
  downloadExport,
  type ExportFormat,
  type ExportOptions,
  type GroupBy,
} from '@/lib/annotation-export';

interface AnnotationExportDialogProps {
  annotationFile: AnnotationFile;
  isOpen: boolean;
  onClose: () => void;
}

export function AnnotationExportDialog({
  annotationFile,
  isOpen,
  onClose,
}: AnnotationExportDialogProps) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('markdown');
  const [options, setOptions] = useState<ExportOptions>({
    format: 'markdown',
    groupBy: 'page',
    includePageNumbers: true,
    includeTimestamps: true,
    includeColors: true,
    includeImages: false,
  });
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const formats: Array<{
    value: ExportFormat;
    label: string;
    icon: React.ReactNode;
    description: string;
  }> = [
    {
      value: 'markdown',
      label: 'Markdown',
      icon: <FileText className="h-4 w-4" />,
      description: 'Obsidian-compatible format',
    },
    {
      value: 'json',
      label: 'JSON',
      icon: <FileJson className="h-4 w-4" />,
      description: 'Structured data interchange',
    },
    {
      value: 'text',
      label: 'Plain Text',
      icon: <File className="h-4 w-4" />,
      description: 'Simple text format',
    },
  ];

  const handleDownload = () => {
    const result = exportAnnotations(
      annotationFile.annotations,
      { ...options, format: selectedFormat },
      annotationFile.fileId
    );
    downloadExport(result, annotationFile.fileId.replace(/\.[^/.]+$/, ''));
  };

  const handleCopy = async () => {
    try {
      const result = exportAnnotations(
        annotationFile.annotations,
        { ...options, format: selectedFormat },
        annotationFile.fileId
      );
      await navigator.clipboard.writeText(result.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const annotationCount = annotationFile.annotations.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-lg shadow-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-xl font-semibold">Export Annotations</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {annotationCount} annotation{annotationCount !== 1 ? 's' : ''} • {annotationFile.fileId}
          </p>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-6">
          {/* Format Selection */}
          <div>
            <label className="block text-sm font-medium mb-3">Export Format</label>
            <div className="grid grid-cols-3 gap-3">
              {formats.map((format) => (
                <button
                  key={format.value}
                  onClick={() => setSelectedFormat(format.value)}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border-2 transition-all text-left',
                    selectedFormat === format.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  )}
                >
                  <div className="mt-0.5">{format.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{format.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {format.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Export Options */}
          <div>
            <label className="block text-sm font-medium mb-3">Options</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.includePageNumbers}
                  onChange={(e) =>
                    setOptions({ ...options, includePageNumbers: e.target.checked })
                  }
                  className="rounded border-border"
                />
                <span className="text-sm">Include page numbers</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.includeTimestamps}
                  onChange={(e) =>
                    setOptions({ ...options, includeTimestamps: e.target.checked })
                  }
                  className="rounded border-border"
                />
                <span className="text-sm">Include timestamps</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.includeColors}
                  onChange={(e) =>
                    setOptions({ ...options, includeColors: e.target.checked })
                  }
                  className="rounded border-border"
                />
                <span className="text-sm">Include color indicators</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.includeImages}
                  onChange={(e) =>
                    setOptions({ ...options, includeImages: e.target.checked })
                  }
                  className="rounded border-border"
                />
                <span className="text-sm">Include area screenshots</span>
              </label>
            </div>
          </div>

          {/* Group By */}
          <div>
            <label className="block text-sm font-medium mb-2">Group by</label>
            <div className="flex gap-2">
              {[
                { value: 'page' as GroupBy, label: 'Page' },
                { value: 'color' as GroupBy, label: 'Color' },
                { value: 'type' as GroupBy, label: 'Type' },
                { value: 'none' as GroupBy, label: 'None' },
              ].map((group) => (
                <button
                  key={group.value}
                  onClick={() =>
                    setOptions({ ...options, groupBy: group.value })
                  }
                  className={cn(
                    'px-3 py-1.5 text-sm rounded-md border transition-colors',
                    options.groupBy === group.value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:border-primary/50'
                  )}
                >
                  {group.label}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div>
            <label className="block text-sm font-medium mb-2">Preview</label>
            <div className="bg-muted rounded-lg p-4 text-xs font-mono max-h-48 overflow-auto whitespace-pre-wrap">
              {(() => {
                try {
                  const result = exportAnnotations(
                    annotationFile.annotations,
                    { ...options, format: selectedFormat },
                    annotationFile.fileId
                  );
                  const lines = result.content.split('\n');
                  const preview = lines.slice(0, 20).join('\n');
                  return preview + (lines.length > 20 ? '\n...' : '');
                } catch {
                  return 'Preview unavailable';
                }
              })()}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md hover:bg-muted transition-colors"
          >
            Cancel
          </button>

          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted transition-colors flex items-center gap-2"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy
                </>
              )}
            </button>

            <button
              onClick={handleDownload}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Download
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
