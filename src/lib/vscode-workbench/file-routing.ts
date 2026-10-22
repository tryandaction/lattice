import {
  getFileExtension,
  getRendererForExtension,
  isCodeFile,
  isImageFile,
  isTextFile,
} from "@/lib/file-utils";

export type WorkspaceFileSurface = "lattice" | "vscode" | "unsupported";

export interface WorkspaceFileRoutingInput {
  fileName: string;
  vscodeEnabled: boolean;
  desktopAvailable: boolean;
  importedLanguageId?: string | null;
}

const LATTICE_DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "md",
  "mdx",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "ink",
  "lattice",
]);

const LATTICE_MEDIA_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "flac",
  "mp4",
  "webm",
  "mov",
  "avi",
  "mkv",
]);

const CODE_FILE_NAMES = new Set([
  "dockerfile",
  "makefile",
  "cmakelists.txt",
  "justfile",
  "procfile",
  "gemfile",
  "rakefile",
]);

export function resolveWorkspaceFileSurface(
  input: WorkspaceFileRoutingInput,
): WorkspaceFileSurface {
  const normalizedFileName = input.fileName.trim().toLowerCase();
  const extension = getFileExtension(normalizedFileName);

  if (
    LATTICE_DOCUMENT_EXTENSIONS.has(extension)
    || LATTICE_MEDIA_EXTENSIONS.has(extension)
    || isImageFile(extension)
  ) {
    return "lattice";
  }

  if (
    CODE_FILE_NAMES.has(normalizedFileName)
    || isCodeFile(extension)
    || isTextFile(extension)
    || getRendererForExtension(extension) !== "unsupported"
    || Boolean(input.importedLanguageId)
  ) {
    return "lattice";
  }

  return "unsupported";
}
