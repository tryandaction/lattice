/**
 * Export Button Component - Task 10.5
 * 
 * Provides UI for exporting markdown documents in various formats
 */

'use client';

import React, { useState } from 'react';
import { Download, FileText, Code, FileImage } from 'lucide-react';
import { ExportUtils } from '@/lib/export-utils';

interface ExportButtonProps {
  content: string;
  filename?: string;
  className?: string;
}

type ExportFormat = 'markdown' | 'html' | 'pdf';

export function ExportButton({ content, filename = 'document', className = '' }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async (format: ExportFormat) => {
    setIsExporting(true);
    setError(null);

    try {
      switch (format) {
        case 'markdown':
          ExportUtils.exportMarkdown(content, {
            filename: `${filename}.md`,
          });
          break;

        case 'html':
          await ExportUtils.exportHTML(content, {
            filename: `${filename}.html`,
            title: filename,
            includeCSS: true,
          });
          break;

        case 'pdf':
          await ExportUtils.exportPDF(content, {
            title: filename,
          });
          break;
      }

      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
      console.error('Export error:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      {/* Export Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700"
        disabled={isExporting}
      >
        <Download className="w-4 h-4" />
        <span>Export</span>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Menu */}
          <div className="absolute right-0 z-20 mt-2 w-56 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none dark:bg-gray-800 dark:ring-gray-700">
            <div className="py-1">
              {/* Markdown Export */}
              <button
                onClick={() => handleExport('markdown')}
                disabled={isExporting}
                className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FileText className="w-4 h-4 mr-3" />
                <div className="flex-1 text-left">
                  <div className="font-medium">Markdown</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Raw markdown (.md)
                  </div>
                </div>
              </button>

              {/* HTML Export */}
              <button
                onClick={() => handleExport('html')}
                disabled={isExporting}
                className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Code className="w-4 h-4 mr-3" />
                <div className="flex-1 text-left">
                  <div className="font-medium">HTML</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    With rendered formulas (.html)
                  </div>
                </div>
              </button>

              {/* PDF Export */}
              <button
                onClick={() => handleExport('pdf')}
                disabled={isExporting}
                className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FileImage className="w-4 h-4 mr-3" />
                <div className="flex-1 text-left">
                  <div className="font-medium">PDF</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Print to PDF (.pdf)
                  </div>
                </div>
              </button>
            </div>

            {/* Error Message */}
            {error && (
              <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-t border-red-100 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
                {error}
              </div>
            )}

            {/* Loading State */}
            {isExporting && (
              <div className="px-4 py-2 text-xs text-blue-600 bg-blue-50 border-t border-blue-100 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400">
                Exporting...
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Compact Export Button (icon only)
 */
export function ExportButtonCompact({ content, filename = 'document', className = '' }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    setIsExporting(true);

    try {
      switch (format) {
        case 'markdown':
          ExportUtils.exportMarkdown(content, { filename: `${filename}.md` });
          break;
        case 'html':
          await ExportUtils.exportHTML(content, { filename: `${filename}.html`, title: filename });
          break;
        case 'pdf':
          await ExportUtils.exportPDF(content, { title: filename });
          break;
      }
      setIsOpen(false);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700"
        title="Export document"
        disabled={isExporting}
      >
        <Download className="w-5 h-5" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-48 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 dark:bg-gray-800 dark:ring-gray-700">
            <div className="py-1">
              <button
                onClick={() => handleExport('markdown')}
                disabled={isExporting}
                className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                <FileText className="w-4 h-4 mr-2" />
                Markdown
              </button>
              <button
                onClick={() => handleExport('html')}
                disabled={isExporting}
                className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                <Code className="w-4 h-4 mr-2" />
                HTML
              </button>
              <button
                onClick={() => handleExport('pdf')}
                disabled={isExporting}
                className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                <FileImage className="w-4 h-4 mr-2" />
                PDF
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
