export type FileOpenTarget = "lattice" | "vscode-workbench";

function fileExtension(fileName: string): string {
  const normalized = fileName.trim().toLowerCase();
  const dot = normalized.lastIndexOf(".");
  return dot > 0 ? normalized.slice(dot + 1) : "";
}

export function resolveFileOpenTarget(input: {
  fileName: string;
  desktopAvailable: boolean;
  workspacePath: string | null;
  absolutePath: string | null;
}): FileOpenTarget {
  void input;
  return "lattice";
}

export function getVSCodeWorkbenchResourceKind(fileName: string): "text" | "notebook" {
  return fileExtension(fileName) === "ipynb" ? "notebook" : "text";
}
