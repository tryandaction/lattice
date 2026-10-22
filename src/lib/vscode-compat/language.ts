import { useVSCodeCompatStore } from "@/stores/vscode-compat-store";
import { getCodeEditorLanguage } from "@/lib/file-utils";
import { isVSCodeCompatEnabled } from "@/lib/vscode-compat/enabled";

type CodeEditorLanguage = ReturnType<typeof getCodeEditorLanguage>;

function normalizePattern(pattern: string): string {
  return pattern.trim().toLowerCase();
}

function matchesPattern(fileName: string, pattern: string): boolean {
  const normalizedFileName = fileName.toLowerCase();
  const normalizedPattern = normalizePattern(pattern);
  if (!normalizedPattern) return false;

  if (normalizedPattern === "*") return true;
  if (normalizedPattern.startsWith("*.")) {
    return normalizedFileName.endsWith(normalizedPattern.slice(1));
  }
  if (normalizedPattern.includes("*")) {
    const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i").test(normalizedFileName);
  }
  return normalizedFileName === normalizedPattern || normalizedFileName.endsWith(`.${normalizedPattern}`);
}

function getFileNameExtension(fileName: string): string {
  const cleanName = fileName.split(/[\\/]/).pop() ?? fileName;
  const dotIndex = cleanName.lastIndexOf(".");
  return dotIndex >= 0 ? cleanName.slice(dotIndex + 1).toLowerCase() : cleanName.toLowerCase();
}

function mapVSCodeLanguageIdToCodeEditorLanguage(languageId: string): CodeEditorLanguage | null {
  switch (languageId.toLowerCase()) {
    case "javascript":
    case "javascriptreact":
      return "javascript";
    case "typescript":
    case "typescriptreact":
      return "typescript";
    case "json":
    case "jsonc":
      return "json";
    case "html":
    case "vue":
    case "svelte":
    case "astro":
      return "html";
    case "python":
      return "python";
    case "markdown":
    case "mdx":
      return "markdown";
    case "latex":
    case "tex":
      return "latex";
    case "c":
      return "c";
    case "cpp":
    case "cuda-cpp":
      return "cpp";
    case "plaintext":
    case "shellscript":
    case "powershell":
    case "yaml":
    case "toml":
    case "ini":
      return "plaintext";
    default:
      return null;
  }
}

export function resolveCodeEditorLanguageForFile(fileName: string): CodeEditorLanguage {
  const extension = getFileNameExtension(fileName);
  const languageId = resolveVSCodeLanguageIdForFile(fileName);
  const mappedLanguage = languageId ? mapVSCodeLanguageIdToCodeEditorLanguage(languageId) : null;
  return mappedLanguage ?? getCodeEditorLanguage(extension);
}

export function resolveVSCodeLanguageIdForFile(fileName: string): string | null {
  if (!isVSCodeCompatEnabled()) return null;
  const compat = useVSCodeCompatStore.getState();
  const lower = fileName.toLowerCase();
  for (const [pattern, languageId] of Object.entries(compat.settings.filesAssociations)) {
    if (matchesPattern(lower, pattern)) {
      return languageId;
    }
  }
  return null;
}
