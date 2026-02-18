/**
 * Annotation Export Utilities
 * 
 * Provides export functionality for PDF annotations to various formats:
 * - Markdown (Obsidian-compatible)
 * - Plain text
 * - JSON
 * 
 * Requirements: 9.1-9.7
 */

import type { LatticeAnnotation, AnnotationType } from '../types/annotation';
import type { AnnotationItem } from '../types/universal-annotation';
import { HIGHLIGHT_COLORS } from './annotation-colors';

// ============================================================================
// Types
// ============================================================================

export type ExportFormat = 'markdown' | 'text' | 'json';
export type GroupBy = 'page' | 'color' | 'type' | 'none';

export interface ExportOptions {
  format: ExportFormat;
  groupBy: GroupBy;
  includeTimestamps: boolean;
  includePageNumbers: boolean;
  includeColors: boolean;
  includeImages: boolean;
  fileName?: string;
}

export interface ExportResult {
  content: string;
  format: ExportFormat;
  annotationCount: number;
}

// ============================================================================
// Default Options
// ============================================================================

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: 'markdown',
  groupBy: 'page',
  includeTimestamps: true,
  includePageNumbers: true,
  includeColors: true,
  includeImages: false,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format timestamp to readable date string
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Get color name from color value
 */
function getColorName(color: string): string {
  const found = HIGHLIGHT_COLORS.find(
    c => c.value === color || c.hex === color
  );
  return found?.nameCN || found?.name || color;
}

/**
 * Get annotation type display name
 */
function getTypeName(type: AnnotationType): string {
  const typeNames: Record<AnnotationType, string> = {
    text: '文本高亮',
    area: '区域选择',
    textNote: '文字批注',
  };
  return typeNames[type] || type;
}

/**
 * Escape markdown special characters
 */
function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/>/g, '\\>')
    .replace(/#/g, '\\#');
}

/**
 * Group annotations by specified criteria
 */
function groupAnnotations(
  annotations: LatticeAnnotation[],
  groupBy: GroupBy
): Map<string, LatticeAnnotation[]> {
  const groups = new Map<string, LatticeAnnotation[]>();
  
  if (groupBy === 'none') {
    groups.set('all', annotations);
    return groups;
  }
  
  for (const ann of annotations) {
    let key: string;
    
    switch (groupBy) {
      case 'page':
        key = `第 ${ann.page} 页`;
        break;
      case 'color':
        key = getColorName(ann.color);
        break;
      case 'type':
        key = getTypeName(ann.type);
        break;
      default:
        key = 'all';
    }
    
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(ann);
  }
  
  // Sort groups
  const sortedGroups = new Map<string, LatticeAnnotation[]>();
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    if (groupBy === 'page') {
      // Extract page numbers and sort numerically
      const numA = parseInt(a.match(/\d+/)?.[0] || '0');
      const numB = parseInt(b.match(/\d+/)?.[0] || '0');
      return numA - numB;
    }
    return a.localeCompare(b, 'zh-CN');
  });
  
  for (const key of sortedKeys) {
    sortedGroups.set(key, groups.get(key)!);
  }
  
  return sortedGroups;
}


// ============================================================================
// Export Functions
// ============================================================================

/**
 * Export annotations to Markdown format (Obsidian-compatible)
 */
function exportToMarkdown(
  annotations: LatticeAnnotation[],
  options: ExportOptions,
  fileName?: string
): string {
  const lines: string[] = [];
  
  // Header
  lines.push(`# 批注导出`);
  if (fileName) {
    lines.push(`**文件**: ${fileName}`);
  }
  lines.push(`**导出时间**: ${formatTimestamp(Date.now())}`);
  lines.push(`**批注数量**: ${annotations.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  
  // Group annotations
  const groups = groupAnnotations(annotations, options.groupBy);
  
  for (const [groupName, groupAnnotations] of groups) {
    if (options.groupBy !== 'none') {
      lines.push(`## ${groupName}`);
      lines.push('');
    }
    
    // Sort by timestamp within group
    const sorted = [...groupAnnotations].sort((a, b) => a.timestamp - b.timestamp);
    
    for (const ann of sorted) {
      // Build annotation entry
      const parts: string[] = [];
      
      // Page number
      if (options.includePageNumbers && options.groupBy !== 'page') {
        parts.push(`**p.${ann.page}**`);
      }
      
      // Color indicator
      if (options.includeColors && options.groupBy !== 'color') {
        const colorName = getColorName(ann.color);
        parts.push(`[${colorName}]`);
      }
      
      // Metadata line
      if (parts.length > 0) {
        lines.push(parts.join(' '));
      }
      
      // Highlighted text as blockquote
      if (ann.content.text) {
        lines.push(`> ${escapeMarkdown(ann.content.text)}`);
      } else if (ann.content.displayText) {
        lines.push(`> ${escapeMarkdown(ann.content.displayText)}`);
      }
      
      // User comment
      if (ann.comment) {
        lines.push('');
        lines.push(`**笔记**: ${escapeMarkdown(ann.comment)}`);
      }
      
      // Timestamp
      if (options.includeTimestamps) {
        lines.push('');
        lines.push(`*${formatTimestamp(ann.timestamp)}*`);
      }
      
      // Image (if area highlight and option enabled)
      if (options.includeImages && ann.type === 'area' && ann.content.image) {
        lines.push('');
        lines.push(`![区域截图](${ann.content.image})`);
      }
      
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }
  
  return lines.join('\n');
}

/**
 * Export annotations to plain text format
 */
function exportToText(
  annotations: LatticeAnnotation[],
  options: ExportOptions,
  fileName?: string
): string {
  const lines: string[] = [];
  
  // Header
  lines.push('批注导出');
  lines.push('='.repeat(40));
  if (fileName) {
    lines.push(`文件: ${fileName}`);
  }
  lines.push(`导出时间: ${formatTimestamp(Date.now())}`);
  lines.push(`批注数量: ${annotations.length}`);
  lines.push('');
  
  // Group annotations
  const groups = groupAnnotations(annotations, options.groupBy);
  
  for (const [groupName, groupAnnotations] of groups) {
    if (options.groupBy !== 'none') {
      lines.push('');
      lines.push(`【${groupName}】`);
      lines.push('-'.repeat(30));
    }
    
    // Sort by timestamp within group
    const sorted = [...groupAnnotations].sort((a, b) => a.timestamp - b.timestamp);
    
    for (const ann of sorted) {
      lines.push('');
      
      // Metadata
      const meta: string[] = [];
      if (options.includePageNumbers && options.groupBy !== 'page') {
        meta.push(`第${ann.page}页`);
      }
      if (options.includeColors && options.groupBy !== 'color') {
        meta.push(getColorName(ann.color));
      }
      if (meta.length > 0) {
        lines.push(`[${meta.join(' | ')}]`);
      }
      
      // Highlighted text
      if (ann.content.text) {
        lines.push(`"${ann.content.text}"`);
      } else if (ann.content.displayText) {
        lines.push(`"${ann.content.displayText}"`);
      }
      
      // User comment
      if (ann.comment) {
        lines.push(`→ ${ann.comment}`);
      }
      
      // Timestamp
      if (options.includeTimestamps) {
        lines.push(`  (${formatTimestamp(ann.timestamp)})`);
      }
    }
  }
  
  return lines.join('\n');
}

/**
 * Export annotations to JSON format
 */
function exportToJSON(
  annotations: LatticeAnnotation[],
  options: ExportOptions,
  fileName?: string
): string {
  const exportData = {
    version: 1,
    exportDate: Date.now(),
    fileName: fileName || null,
    options: {
      groupBy: options.groupBy,
      includeTimestamps: options.includeTimestamps,
      includePageNumbers: options.includePageNumbers,
      includeColors: options.includeColors,
    },
    annotationCount: annotations.length,
    annotations: annotations.map(ann => ({
      id: ann.id,
      page: ann.page,
      type: ann.type,
      color: ann.color,
      colorName: getColorName(ann.color),
      text: ann.content.text || ann.content.displayText || null,
      comment: ann.comment || null,
      timestamp: ann.timestamp,
      timestampFormatted: formatTimestamp(ann.timestamp),
    })),
  };
  
  return JSON.stringify(exportData, null, 2);
}

// ============================================================================
// Main Export Function
// ============================================================================

/**
 * Export annotations to specified format
 */
export function exportAnnotations(
  annotations: LatticeAnnotation[],
  options: Partial<ExportOptions> = {},
  fileName?: string
): ExportResult {
  const mergedOptions: ExportOptions = {
    ...DEFAULT_EXPORT_OPTIONS,
    ...options,
  };
  
  // Sort annotations by page then timestamp
  const sorted = [...annotations].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return a.timestamp - b.timestamp;
  });
  
  let content: string;
  
  switch (mergedOptions.format) {
    case 'markdown':
      content = exportToMarkdown(sorted, mergedOptions, fileName);
      break;
    case 'text':
      content = exportToText(sorted, mergedOptions, fileName);
      break;
    case 'json':
      content = exportToJSON(sorted, mergedOptions, fileName);
      break;
    default:
      content = exportToMarkdown(sorted, mergedOptions, fileName);
  }
  
  return {
    content,
    format: mergedOptions.format,
    annotationCount: annotations.length,
  };
}

/**
 * Export a single annotation to clipboard-friendly format
 */
export function exportSingleAnnotation(
  annotation: LatticeAnnotation,
  includeComment: boolean = true
): string {
  const parts: string[] = [];
  
  // Page info
  parts.push(`[第${annotation.page}页]`);
  
  // Highlighted text
  if (annotation.content.text) {
    parts.push(`"${annotation.content.text}"`);
  } else if (annotation.content.displayText) {
    parts.push(`"${annotation.content.displayText}"`);
  }
  
  // Comment
  if (includeComment && annotation.comment) {
    parts.push(`→ ${annotation.comment}`);
  }
  
  return parts.join(' ');
}

/**
 * Copy annotation to clipboard
 */
export async function copyAnnotationToClipboard(
  annotation: LatticeAnnotation,
  includeComment: boolean = true
): Promise<boolean> {
  try {
    const text = exportSingleAnnotation(annotation, includeComment);
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy annotation:', error);
    return false;
  }
}

/**
 * Download export as file
 */
export function downloadExport(
  result: ExportResult,
  fileName: string
): void {
  const extension = result.format === 'json' ? 'json' : 
                    result.format === 'markdown' ? 'md' : 'txt';
  const mimeType = result.format === 'json' ? 'application/json' : 'text/plain';
  
  const blob = new Blob([result.content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName}-annotations.${extension}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

/**
 * Export universal annotations (image/code/etc) to Markdown or JSON
 */
export function exportUniversalAnnotations(
  annotations: AnnotationItem[],
  format: 'markdown' | 'json',
  fileName?: string
): ExportResult {
  if (format === 'json') {
    const data = {
      version: 1,
      exportDate: Date.now(),
      fileName: fileName || null,
      annotationCount: annotations.length,
      annotations: annotations.map(a => ({
        id: a.id,
        target: a.target,
        style: a.style,
        content: a.content,
        author: a.author,
        createdAt: a.createdAt,
      })),
    };
    return { content: JSON.stringify(data, null, 2), format: 'json', annotationCount: annotations.length };
  }

  const lines: string[] = [];
  lines.push('# Annotations Export');
  if (fileName) lines.push(`**File**: ${fileName}`);
  lines.push(`**Exported**: ${formatTimestamp(Date.now())}`);
  lines.push(`**Count**: ${annotations.length}`);
  lines.push('', '---', '');

  for (const a of annotations) {
    const target = a.target;
    if (target.type === 'image') {
      lines.push(`### Image Region (${Math.round(target.x)}%, ${Math.round(target.y)}%) ${Math.round(target.width)}×${Math.round(target.height)}%`);
    } else if (target.type === 'pdf') {
      lines.push(`### Page ${target.page}`);
    } else if (target.type === 'code_line') {
      lines.push(`### Line ${target.line}`);
    } else {
      lines.push(`### Annotation`);
    }
    if (a.content) {
      lines.push('', `> ${a.content.slice(0, 200)}`);
    }
    lines.push('', `*${formatTimestamp(a.createdAt)}*`, '', '---', '');
  }

  return { content: lines.join('\n'), format: 'markdown', annotationCount: annotations.length };
}
