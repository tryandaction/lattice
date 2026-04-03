/**
 * @vitest-environment jsdom
 */

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAutoOpenWorkspacePath, useAutoOpenFolder } from "../use-auto-open-folder";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

describe("resolveAutoOpenWorkspacePath", () => {
  it("prefers last workspace path over legacy and default folder", () => {
    expect(resolveAutoOpenWorkspacePath({
      lastWorkspacePath: "C:/workspace/last",
      lastOpenedFolder: "C:/workspace/recent",
      defaultFolder: "C:/workspace/default",
    })).toBe("C:/workspace/last");
  });

  it("prefers workspace key display mapping over stale workspace paths", () => {
    expect(resolveAutoOpenWorkspacePath({
      lastWorkspacePath: "C:/workspace/parent",
      lastWorkspaceKey: "web:child",
      workspaceDisplayPaths: {
        "web:child": "C:/workspace/parent/child",
      },
      lastOpenedFolder: "C:/workspace/recent",
      defaultFolder: "C:/workspace/default",
    })).toBe("C:/workspace/parent/child");
  });

  it("falls back to default folder when no recent workspace exists", () => {
    expect(resolveAutoOpenWorkspacePath({
      lastOpenedFolder: null,
      defaultFolder: "C:/workspace/default",
    })).toBe("C:/workspace/default");
  });
});

describe("useAutoOpenFolder", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState((state) => ({
      ...state,
      isInitialized: true,
      settings: {
        ...state.settings,
        onboardingCompleted: true,
        defaultFolder: null,
        lastOpenedFolder: "C:/vault-legacy",
        lastWorkspacePath: "C:/vault-last",
        recentWorkspacePaths: [],
      },
    }));
    useWorkspaceStore.setState((state) => ({
      ...state,
      rootHandle: null,
      workspaceRootPath: null,
      fileTree: { root: null },
      isLoading: false,
      error: null,
    }));

    const tauriWindow = window as Window & {
      __TAURI__?: unknown;
      __TAURI_INTERNALS__?: unknown;
    };
    delete tauriWindow.__TAURI__;
    (tauriWindow as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
        if (command === "get_setting") {
          return useSettingsStore.getState().settings;
        }

        if (command === "set_setting" || command === "remove_setting" || command === "clear_settings") {
          return null;
        }

        if (command === "resolve_startup_workspace") {
          useSettingsStore.setState((state) => ({
            ...state,
            settings: {
              ...state.settings,
              lastOpenedFolder: "C:/vault-last",
              lastWorkspacePath: "C:/vault-last",
              recentWorkspacePaths: ["C:/vault-last"],
            },
          }));
          return {
            path: "C:/vault-last",
            source: "last_workspace_path",
          };
        }

        if (command === "desktop_read_dir") {
          const path = String(args?.path ?? "");
          if (path === "C:/vault-last") {
            return [
              { name: "docs", isDirectory: true, isFile: false, isSymlink: false },
              { name: "notes.md", isDirectory: false, isFile: true, isSymlink: false },
            ];
          }

          if (path === "C:/vault-last/docs") {
            return [
              { name: "paper.pdf", isDirectory: false, isFile: true, isSymlink: false },
            ];
          }
        }

        if (command === "desktop_is_directory") {
          return true;
        }

        throw new Error(`Unexpected invoke: ${command}`);
      }),
    };
  });

  it("restores startup workspace in desktop mode through __TAURI_INTERNALS__.invoke", async () => {
    renderHook(() => useAutoOpenFolder());

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspaceRootPath).toBe("C:/vault-last");
    });

    const workspace = useWorkspaceStore.getState();
    expect(workspace.rootHandle?.name).toBe("vault-last");
    expect(workspace.fileTree.root?.children.map((node) => node.name)).toEqual(["docs", "notes.md"]);
    expect(useSettingsStore.getState().settings.lastWorkspacePath).toBe("C:/vault-last");
    expect(useSettingsStore.getState().settings.recentWorkspacePaths[0]).toBe("C:/vault-last");
  });

  it("drops invalid recent paths and falls back to the next valid desktop workspace", async () => {
    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        lastOpenedFolder: "C:/missing",
        lastWorkspacePath: "C:/missing",
        recentWorkspacePaths: ["C:/missing", "C:/vault-valid"],
      },
    }));

    (window as { __TAURI_INTERNALS__?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__ = {
      invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
        if (command === "get_setting") {
          return useSettingsStore.getState().settings;
        }

        if (command === "set_setting" || command === "remove_setting" || command === "clear_settings") {
          return null;
        }

        if (command === "resolve_startup_workspace") {
          useSettingsStore.setState((state) => ({
            ...state,
            settings: {
              ...state.settings,
              lastOpenedFolder: "C:/vault-valid",
              lastWorkspacePath: "C:/vault-valid",
              recentWorkspacePaths: ["C:/vault-valid"],
            },
          }));
          return {
            path: "C:/vault-valid",
            source: "recent_workspace_paths",
          };
        }

        if (command === "desktop_read_dir") {
          const path = String(args?.path ?? "");
          if (path === "C:/vault-valid") {
            return [
              { name: "paper.md", isDirectory: false, isFile: true, isSymlink: false },
            ];
          }
        }

        throw new Error(`Unexpected invoke: ${command}`);
      }),
    };

    renderHook(() => useAutoOpenFolder());

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspaceRootPath).toBe("C:/vault-valid");
    });

    const nextSettings = useSettingsStore.getState().settings;
    expect(nextSettings.lastWorkspacePath).toBe("C:/vault-valid");
    expect(nextSettings.lastOpenedFolder).toBe("C:/vault-valid");
    expect(nextSettings.recentWorkspacePaths).toEqual(["C:/vault-valid"]);
  });
});
