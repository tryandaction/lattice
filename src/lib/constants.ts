import {
  FileText,
  FileCode,
  Code,
  Image,
  File,
  Presentation,
  BookOpen,
  type LucideIcon,
} from "lucide-react";

/**
 * Allowed file extensions for STEM research files
 * Only these file types will be shown in the explorer
 */
export const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "ppt",
  "pptx",
  "md",
  "txt",
  "py",
  "ipynb",
  "png",
  "jpg",
  "jpeg",
]);

/**
 * Directories to ignore when scanning
 * These are typically not relevant for research work
 */
export const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".next",
  ".vscode",
  ".idea",
  "venv",
  ".venv",
  "env",
  ".env",
]);

/**
 * File type to icon mapping
 * Returns appropriate Lucide icon for each file type
 */
export const FILE_ICONS: Record<string, LucideIcon> = {
  // Documents
  pdf: FileText,
  txt: FileText,
  
  // Presentations
  ppt: Presentation,
  pptx: Presentation,
  
  // Markdown/Notes
  md: FileCode,
  
  // Code
  py: Code,
  ipynb: BookOpen,
  
  // Images
  png: Image,
  jpg: Image,
  jpeg: Image,
  
  // Default fallback
  default: File,
};

/**
 * Get the icon component for a file extension
 * @param extension - File extension without the dot
 * @returns Lucide icon component
 */
export function getFileIcon(extension: string): LucideIcon {
  const normalizedExt = extension.toLowerCase();
  return FILE_ICONS[normalizedExt] ?? FILE_ICONS.default;
}

/**
 * Check if a file extension is allowed
 * @param extension - File extension without the dot
 * @returns true if the extension is in the allowed list
 */
export function isAllowedExtension(extension: string): boolean {
  return ALLOWED_EXTENSIONS.has(extension.toLowerCase());
}

/**
 * Check if a directory should be ignored
 * @param name - Directory name
 * @returns true if the directory should be skipped
 */
export function isIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name);
}

/**
 * Extract file extension from filename
 * @param filename - Full filename with extension
 * @returns Extension without the dot, or empty string if none
 */
export function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === 0) return "";
  return filename.slice(lastDot + 1).toLowerCase();
}
