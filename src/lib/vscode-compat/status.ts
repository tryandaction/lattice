import type {
  VSCodeExtensionInventoryEntry,
  VSCodeExtensionThemeContribution,
  VSCodeKeybinding,
  VSCodeSnippetDefinition,
  VSCodeTask,
  VSCodeLaunchConfiguration,
  VSCodeWorkbenchSettings,
} from "./types";

export interface VSCodeExtensionCapability {
  id: string;
  label: string;
  status: "mapped" | "detected" | "external";
  detail: string;
}

export interface VSCodeCompatSummaryInput {
  settings: VSCodeWorkbenchSettings;
  keybindings: VSCodeKeybinding[];
  snippets: VSCodeSnippetDefinition[];
  tasks: VSCodeTask[];
  launches: VSCodeLaunchConfiguration[];
  extensions: VSCodeExtensionInventoryEntry[];
  importedAt: number | null;
  sourceLabel: string | null;
  warnings: string[];
}

export interface VSCodeCompatSummary {
  isImported: boolean;
  importedAtLabel: string | null;
  sourceLabel: string | null;
  counts: {
    keybindings: number;
    snippets: number;
    tasks: number;
    launches: number;
    extensions: number;
    fileAssociations: number;
    excludes: number;
    extensionLanguages: number;
    extensionSnippets: number;
    extensionCommands: number;
    extensionDebuggers: number;
    extensionViews: number;
    extensionMenus: number;
    extensionNotebooks: number;
    extensionNotebookRenderers: number;
    extensionGrammars: number;
    extensionThemes: number;
  };
  theme: {
    current: string | null;
    contributed: Array<VSCodeExtensionThemeContribution & {
      extensionId: string;
      extensionLabel: string;
    }>;
  };
  capabilities: VSCodeExtensionCapability[];
  warnings: string[];
}

const KNOWN_EXTENSION_CAPABILITIES: Record<string, Omit<VSCodeExtensionCapability, "id">> = {
  "dbaeumer.vscode-eslint": {
    label: "ESLint",
    status: "detected",
    detail: "Extension detected. Lattice uses imported settings/tasks today; full ESLint diagnostics require the upcoming VS Code extension host bridge.",
  },
  "esbenp.prettier-vscode": {
    label: "Prettier",
    status: "detected",
    detail: "Formatter extension detected. Lattice records the default formatter and exposes the formatter identity in code files.",
  },
  "ms-python.python": {
    label: "Python",
    status: "mapped",
    detail: "Mapped to Lattice local Python runner and interpreter discovery.",
  },
  "ms-python.vscode-pylance": {
    label: "Pylance",
    status: "detected",
    detail: "Language extension detected. Lattice keeps Python runner support active; full Pylance language server parity needs the extension host bridge.",
  },
  "ms-vscode.cpptools": {
    label: "C/C++",
    status: "mapped",
    detail: "Mapped to Lattice C/C++ runner checks where gcc/g++ are available.",
  },
  "rust-lang.rust-analyzer": {
    label: "Rust Analyzer",
    status: "detected",
    detail: "Extension detected. Lattice recognizes Rust files; full rust-analyzer language server activation is not yet embedded.",
  },
  "vue.volar": {
    label: "Vue",
    status: "detected",
    detail: "Vue language extension detected. Imported file associations are applied where configured.",
  },
};

function formatImportedAt(value: number | null): string | null {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export function summarizeVSCodeCompat(input: VSCodeCompatSummaryInput): VSCodeCompatSummary {
  const fileAssociations = Object.keys(input.settings.filesAssociations ?? {}).length;
  const excludes = Object.keys(input.settings.filesExclude ?? {}).length + Object.keys(input.settings.searchExclude ?? {}).length;
  const extensionLanguages = input.extensions.reduce((total, extension) => total + (extension.contributes?.languages?.length ?? 0), 0);
  const extensionSnippets = input.extensions.reduce((total, extension) => total + (extension.contributes?.snippets?.length ?? 0), 0);
  const extensionCommands = input.extensions.reduce((total, extension) => total + (extension.contributes?.commands ?? 0), 0);
  const extensionDebuggers = input.extensions.reduce((total, extension) => total + (extension.contributes?.debuggers ?? 0), 0);
  const extensionViews = input.extensions.reduce((total, extension) => total + (extension.contributes?.views?.length ?? 0), 0);
  const extensionMenus = input.extensions.reduce((total, extension) => total + (extension.contributes?.menus ?? 0), 0);
  const extensionNotebooks = input.extensions.reduce((total, extension) => total + (extension.contributes?.notebooks?.length ?? 0), 0);
  const extensionNotebookRenderers = input.extensions.reduce((total, extension) => total + (extension.contributes?.notebookRenderers?.length ?? 0), 0);
  const extensionGrammars = input.extensions.reduce((total, extension) => total + (extension.contributes?.grammars?.length ?? 0), 0);
  const extensionThemes = input.extensions.reduce((total, extension) => total + (extension.contributes?.themes?.length ?? 0), 0);
  const contributedThemes = input.extensions.flatMap((extension) =>
    (extension.contributes?.themes ?? []).map((theme) => ({
      ...theme,
      extensionId: extension.id,
      extensionLabel: extension.displayName ?? extension.id,
    })),
  );
  const isImported = Boolean(
    input.importedAt ||
    input.keybindings.length > 0 ||
    input.snippets.length > 0 ||
    input.tasks.length > 0 ||
    input.extensions.length > 0 ||
    fileAssociations > 0 ||
    excludes > 0 ||
    extensionLanguages > 0 ||
    extensionSnippets > 0 ||
    extensionViews > 0 ||
    extensionNotebooks > 0 ||
    Boolean(input.settings.colorTheme),
  );

  const capabilities = input.extensions.slice(0, 12).map((extension): VSCodeExtensionCapability => {
    const known = KNOWN_EXTENSION_CAPABILITIES[extension.id];
    if (known) {
      return {
        id: extension.id,
        ...known,
        label: extension.displayName || known.label,
      };
    }
    return {
      id: extension.id,
      label: extension.displayName || extension.id,
      status: "external",
      detail: "Extension installed in VS Code and recorded by Lattice. Full extension activation requires the VS Code extension host bridge.",
    };
  });

  return {
    isImported,
    importedAtLabel: formatImportedAt(input.importedAt),
    sourceLabel: input.sourceLabel,
    counts: {
      keybindings: input.keybindings.length,
    snippets: input.snippets.length,
    tasks: input.tasks.length,
    launches: input.launches.length,
    extensions: input.extensions.length,
      fileAssociations,
      excludes,
      extensionLanguages,
      extensionSnippets,
      extensionCommands,
      extensionDebuggers,
      extensionViews,
      extensionMenus,
      extensionNotebooks,
      extensionNotebookRenderers,
      extensionGrammars,
      extensionThemes,
    },
    theme: {
      current: input.settings.colorTheme ?? null,
      contributed: contributedThemes,
    },
    capabilities,
    warnings: input.warnings,
  };
}
