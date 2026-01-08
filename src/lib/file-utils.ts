/**
 * File type utility functions for the Polymorphic File Viewer
 * Handles extension-based routing, read mode detection, and language mapping
 */

/**
 * Renderer types supported by the Main Stage
 */
export type RendererType =
  | 'markdown'
  | 'pdf'
  | 'jupyter'
  | 'word'
  | 'powerpoint'
  | 'html'
  | 'code'
  | 'image'
  | 'handwriting'
  | 'unsupported';

/**
 * Image extensions with their MIME types
 */
export const IMAGE_EXTENSIONS: Record<string, string> = {
  // Common formats
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  // Scientific/technical formats
  tiff: 'image/tiff',
  tif: 'image/tiff',
  // Vector formats
  eps: 'image/eps',
  // Raw/specialized
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
};

/**
 * Code file extensions with their syntax highlighting language
 */
export const CODE_EXTENSIONS: Record<string, string> = {
  // Python ecosystem
  py: 'python',
  pyw: 'python',
  pyx: 'python',
  pxd: 'python',
  pyi: 'python',
  
  // JavaScript/TypeScript ecosystem
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  mjs: 'javascript',
  cjs: 'javascript',
  
  // MATLAB/Octave
  m: 'matlab',
  mat: 'matlab',
  
  // Java ecosystem
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  groovy: 'groovy',
  gradle: 'groovy',
  
  // C/C++ ecosystem
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  
  // C#/.NET
  cs: 'csharp',
  fs: 'fsharp',
  fsx: 'fsharp',
  vb: 'vbnet',
  
  // Systems programming
  rs: 'rust',
  go: 'go',
  zig: 'zig',
  nim: 'nim',
  
  // Scientific computing
  r: 'r',
  rmd: 'r',
  jl: 'julia',
  f: 'fortran',
  f90: 'fortran',
  f95: 'fortran',
  for: 'fortran',
  
  // Data & config
  json: 'json',
  jsonc: 'json',
  json5: 'json5',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  csv: 'csv',
  tsv: 'csv',
  
  // Shell scripting
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  bat: 'batch',
  cmd: 'batch',
  
  // Web technologies
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  vue: 'vue',
  svelte: 'svelte',
  
  // Markup & documentation
  tex: 'latex',
  latex: 'latex',
  bib: 'bibtex',
  rst: 'restructuredtext',
  adoc: 'asciidoc',
  org: 'org',
  
  // Database
  sql: 'sql',
  mysql: 'sql',
  pgsql: 'sql',
  plsql: 'plsql',
  
  // Functional languages
  hs: 'haskell',
  lhs: 'haskell',
  ml: 'ocaml',
  mli: 'ocaml',
  elm: 'elm',
  clj: 'clojure',
  cljs: 'clojure',
  erl: 'erlang',
  ex: 'elixir',
  exs: 'elixir',
  
  // Scripting languages
  rb: 'ruby',
  rake: 'ruby',
  gemspec: 'ruby',
  php: 'php',
  pl: 'perl',
  pm: 'perl',
  lua: 'lua',
  tcl: 'tcl',
  awk: 'awk',
  sed: 'sed',
  
  // DevOps & Infrastructure
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  tf: 'hcl',
  hcl: 'hcl',
  nginx: 'nginx',
  apache: 'apacheconf',
  
  // Build systems
  makefile: 'makefile',
  mk: 'makefile',
  cmake: 'cmake',
  
  // Assembly
  asm: 'nasm',
  s: 'nasm',
  
  // Misc
  txt: 'plaintext',
  log: 'log',
  diff: 'diff',
  patch: 'diff',
  gitignore: 'gitignore',
  env: 'dotenv',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  properties: 'properties',
  proto: 'protobuf',
  graphql: 'graphql',
  gql: 'graphql',
  wasm: 'wasm',
  wat: 'wasm',
  
  // HDL (Hardware Description)
  v: 'verilog',
  sv: 'systemverilog',
  vhd: 'vhdl',
  vhdl: 'vhdl',
  
  // Mobile
  swift: 'swift',
  dart: 'dart',
  
  // Game development
  gd: 'gdscript',
  shader: 'glsl',
  glsl: 'glsl',
  hlsl: 'hlsl',
  
  // Lisp family
  lisp: 'lisp',
  scm: 'scheme',
  rkt: 'racket',
};

/**
 * Extensions that should be read as text
 */
export const TEXT_EXTENSIONS = new Set([
  'md',
  'ipynb',
  'ink',      // Handwriting note files
  'lattice',  // Lattice handwriting files
  ...Object.keys(CODE_EXTENSIONS),
]);

/**
 * Extensions that should be read as binary (ArrayBuffer)
 */
export const BINARY_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  ...Object.keys(IMAGE_EXTENSIONS),
]);

/**
 * Mapping from file extension to syntax highlighting language
 * @deprecated Use CODE_EXTENSIONS instead
 */
export const EXTENSION_TO_LANGUAGE: Record<string, string> = CODE_EXTENSIONS;

/**
 * Check if a file extension is an image
 * @param extension - File extension without the leading dot
 * @returns true if the file is an image
 */
export function isImageFile(extension: string): boolean {
  return extension.toLowerCase() in IMAGE_EXTENSIONS;
}

/**
 * Get the MIME type for an image extension
 * @param extension - File extension without the leading dot
 * @returns The MIME type or 'application/octet-stream' if unknown
 */
export function getImageMimeType(extension: string): string {
  return IMAGE_EXTENSIONS[extension.toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Check if a file extension is a code file
 * @param extension - File extension without the leading dot
 * @returns true if the file is a code file
 */
export function isCodeFile(extension: string): boolean {
  return extension.toLowerCase() in CODE_EXTENSIONS;
}

/**
 * Check if a file extension should be read as text
 * @param extension - File extension without the leading dot
 * @returns true if the file should be read as text
 */
export function isTextFile(extension: string): boolean {
  const ext = extension.toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || isCodeFile(ext);
}

/**
 * Check if a file extension should be read as binary
 * @param extension - File extension without the leading dot
 * @returns true if the file should be read as ArrayBuffer
 */
export function isBinaryFile(extension: string): boolean {
  const ext = extension.toLowerCase();
  return BINARY_EXTENSIONS.has(ext) || isImageFile(ext);
}

/**
 * Get the appropriate renderer type for a file extension
 * @param extension - File extension without the leading dot
 * @returns The renderer type to use for this file
 */
export function getRendererForExtension(extension: string): RendererType {
  const ext = extension.toLowerCase();
  
  // Check specific types first
  if (ext === 'md') return 'markdown';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'ipynb') return 'jupyter';
  if (ext === 'doc' || ext === 'docx') return 'word';
  if (ext === 'ppt' || ext === 'pptx') return 'powerpoint';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'ink' || ext === 'lattice') return 'handwriting';
  
  // Check image files
  if (isImageFile(ext)) return 'image';
  
  // Check code files
  if (isCodeFile(ext)) return 'code';
  
  return 'unsupported';
}

/**
 * Get the syntax highlighting language for a file extension
 * @param extension - File extension without the leading dot
 * @returns The language identifier for syntax highlighting, or 'plaintext' if not found
 */
export function getLanguageForExtension(extension: string): string {
  const ext = extension.toLowerCase();
  return CODE_EXTENSIONS[ext] ?? 'plaintext';
}

/**
 * Extract the file extension from a filename
 * @param filename - The filename to extract extension from
 * @returns The extension without the leading dot, or empty string if none
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return '';
  }
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Editable file extensions (files that can be modified and saved)
 */
export const EDITABLE_EXTENSIONS = new Set(['md', 'txt', 'ipynb', 'ink', 'lattice']);

/**
 * Editable code file extensions (code files that can be edited with CodeEditor)
 * These are a subset of CODE_EXTENSIONS that have full CodeMirror language support
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */
export const EDITABLE_CODE_EXTENSIONS = new Set([
  'py',      // Python
  'js',      // JavaScript
  'jsx',     // JSX
  'ts',      // TypeScript
  'tsx',     // TSX
  'mjs',     // ES Modules
  'cjs',     // CommonJS
  'json',    // JSON
  'jsonc',   // JSON with comments
  'tex',     // LaTeX
  'latex',   // LaTeX
]);

/**
 * Read-only file extensions (files that can only be viewed)
 */
export const READ_ONLY_EXTENSIONS = new Set([
  'pdf',
  'ppt',
  'pptx',
  'doc',
  'docx',
  ...Object.keys(IMAGE_EXTENSIONS),
]);

/**
 * Check if a file extension is editable
 * @param extension - File extension without the leading dot
 * @returns true if the file can be edited and saved
 */
export function isEditableFile(extension: string): boolean {
  const ext = extension.toLowerCase();
  return EDITABLE_EXTENSIONS.has(ext) || EDITABLE_CODE_EXTENSIONS.has(ext);
}

/**
 * Check if a file extension is an editable code file
 * @param extension - File extension without the leading dot
 * @returns true if the file can be edited with CodeEditor
 */
export function isEditableCodeFile(extension: string): boolean {
  return EDITABLE_CODE_EXTENSIONS.has(extension.toLowerCase());
}

/**
 * Get the CodeEditor language for a file extension
 * Maps file extensions to CodeEditor language prop values
 * @param extension - File extension without the leading dot
 * @returns The CodeEditor language or 'javascript' as fallback
 */
export function getCodeEditorLanguage(extension: string): 'python' | 'javascript' | 'typescript' | 'json' | 'latex' | 'markdown' {
  const ext = extension.toLowerCase();
  
  switch (ext) {
    case 'py':
      return 'python';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'json':
    case 'jsonc':
      return 'json';
    case 'tex':
    case 'latex':
      return 'latex';
    case 'md':
      return 'markdown';
    default:
      return 'javascript'; // Fallback
  }
}

/**
 * Check if a file extension is read-only
 * @param extension - File extension without the leading dot
 * @returns true if the file can only be viewed
 */
export function isReadOnlyFile(extension: string): boolean {
  const ext = extension.toLowerCase();
  return READ_ONLY_EXTENSIONS.has(ext) || isImageFile(ext);
}
