import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVSCodeCompatStore } from "@/stores/vscode-compat-store";
import { useSettingsStore } from "@/stores/settings-store";

vi.mock("@/lib/file-utils", () => ({
  getCodeEditorLanguage: (extension: string) => {
    if (extension === "ts" || extension.endsWith(".ts")) return "typescript";
    if (extension === "md" || extension.endsWith(".md")) return "markdown";
    return "plaintext";
  },
}));

import { resolveCodeEditorLanguageForFile } from "../language";

describe("vscode compat language resolution", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        vscodeCompatEnabled: false,
      },
    });
    useVSCodeCompatStore.setState({
      ...useVSCodeCompatStore.getState(),
      settings: {
        ...useVSCodeCompatStore.getState().settings,
        filesAssociations: {},
      },
    });
  });

  it("ignores vscode file associations while compatibility is disabled", () => {
    useVSCodeCompatStore.setState({
      ...useVSCodeCompatStore.getState(),
      settings: {
        ...useVSCodeCompatStore.getState().settings,
        filesAssociations: {
          "*.spec": "javascript",
        },
      },
    });

    expect(resolveCodeEditorLanguageForFile("widget.spec")).toBe("plaintext");
  });

  it("honors vscode file associations when compatibility is enabled", () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        vscodeCompatEnabled: true,
      },
    });
    useVSCodeCompatStore.setState({
      ...useVSCodeCompatStore.getState(),
      settings: {
        ...useVSCodeCompatStore.getState().settings,
        filesAssociations: {
          "*.spec": "javascript",
        },
      },
    });

    expect(resolveCodeEditorLanguageForFile("widget.spec")).toBe("javascript");
    expect(resolveCodeEditorLanguageForFile("notes.md")).toBe("markdown");
  });

  it("maps common VS Code language ids to available Lattice editor modes", () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        vscodeCompatEnabled: true,
      },
    });
    useVSCodeCompatStore.setState({
      ...useVSCodeCompatStore.getState(),
      settings: {
        ...useVSCodeCompatStore.getState().settings,
        filesAssociations: {
          "*.vue": "vue",
          "*.jsonc": "jsonc",
          "*.tsx": "typescriptreact",
        },
      },
    });

    expect(resolveCodeEditorLanguageForFile("App.vue")).toBe("html");
    expect(resolveCodeEditorLanguageForFile("settings.jsonc")).toBe("json");
    expect(resolveCodeEditorLanguageForFile("App.tsx")).toBe("typescript");
  });
});
