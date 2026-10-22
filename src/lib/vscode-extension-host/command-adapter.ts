import type { VSCodeExtensionInventoryEntry } from "@/lib/vscode-compat/types";
import type { VSCodeHostCommand } from "@/lib/vscode-extension-host/types";

export function buildVSCodeHostCommandCatalog(
  extensions: VSCodeExtensionInventoryEntry[],
): VSCodeHostCommand[] {
  const commands = extensions.flatMap((extension) => {
    const path = extension.path?.trim();
    const main = extension.main?.trim();
    if (!path || !main) {
      return [];
    }

    return (extension.contributes?.commandItems ?? []).map<VSCodeHostCommand>((command) => ({
      id: command.command,
      title: command.title,
      extensionId: extension.id,
      category: command.category,
      source: "host",
    }));
  });

  const seen = new Set<string>();
  return commands.filter((command) => {
    if (seen.has(command.id)) {
      return false;
    }
    seen.add(command.id);
    return true;
  });
}
