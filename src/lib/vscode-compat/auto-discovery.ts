"use client";

import { createDesktopDirectoryHandle } from "@/lib/desktop-file-system";
import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";
import {
  mergeVSCodeSettingsFiles,
  readVSCodeConfigFromDirectory,
  readVSCodeExtensionConfigFromDirectory,
} from "@/lib/vscode-compat/storage";
import type { VSCodeDirectoryImportResult, VSCodeSettingsFile } from "@/lib/vscode-compat/types";

export interface DesktopVSCodeProfileCandidate {
  product: string;
  userDir?: string | null;
  extensionsDir?: string | null;
}

const DISCOVER_VSCODE_PROFILES_TIMEOUT_MS = 7000;

export function shouldAutoImportVSCodeProfile(
  enabled: boolean,
  importedAt: number | null,
  profileStateLoaded = true,
): boolean {
  return profileStateLoaded && enabled && importedAt === null;
}

function uniqueProfiles(profiles: DesktopVSCodeProfileCandidate[]): DesktopVSCodeProfileCandidate[] {
  const seen = new Set<string>();
  const result: DesktopVSCodeProfileCandidate[] = [];
  for (const profile of profiles) {
    const key = `${profile.product}:${profile.userDir ?? ""}:${profile.extensionsDir ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(profile);
  }
  return result;
}

export async function discoverDesktopVSCodeProfiles(): Promise<DesktopVSCodeProfileCandidate[]> {
  if (!isTauriHost()) return [];
  const profiles = await invokeTauriCommand<DesktopVSCodeProfileCandidate[]>(
    "desktop_discover_vscode_profiles",
    undefined,
    { timeoutMs: DISCOVER_VSCODE_PROFILES_TIMEOUT_MS },
  );
  return uniqueProfiles(Array.isArray(profiles) ? profiles : []);
}

export function mergeVSCodeDirectoryImportResults(
  results: VSCodeDirectoryImportResult[],
  sourceLabel = "Auto-detected VS Code profiles",
): VSCodeDirectoryImportResult {
  const config = results.reduce<VSCodeSettingsFile>(
    (target, result) => mergeVSCodeSettingsFiles(target, result.config),
    {},
  );
  const discoveredFiles = Array.from(new Set(results.flatMap((result) => result.discoveredFiles)));
  const warnings = results.flatMap((result) => result.warnings);
  const extensionCount = config.extensions?.length ?? 0;
  const suffix = [
    `${discoveredFiles.length} file${discoveredFiles.length === 1 ? "" : "s"}`,
    `${extensionCount} extension${extensionCount === 1 ? "" : "s"}`,
  ].join(", ");

  return {
    config,
    sourceLabel: `${sourceLabel} (${suffix})`,
    discoveredFiles,
    warnings,
  };
}

export async function readVSCodeConfigFromDetectedProfiles(): Promise<VSCodeDirectoryImportResult> {
  const profiles = await discoverDesktopVSCodeProfiles();
  const results: VSCodeDirectoryImportResult[] = [];
  const warnings: string[] = [];

  if (profiles.length === 0) {
    return {
      config: {},
      sourceLabel: "Auto-detected VS Code profiles (0 files, 0 extensions)",
      discoveredFiles: [],
      warnings: ["No local VS Code profile was found."],
    };
  }

  for (const profile of profiles) {
    if (profile.userDir) {
      try {
        const userResult = await readVSCodeConfigFromDirectory(createDesktopDirectoryHandle(profile.userDir));
        results.push({
          ...userResult,
          sourceLabel: `${profile.product}: ${userResult.sourceLabel}`,
          discoveredFiles: userResult.discoveredFiles.map((file) => `${profile.product}/${file}`),
        });
      } catch (error) {
        warnings.push(`Could not read ${profile.product} user settings: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (profile.extensionsDir) {
      try {
        const extensionWarnings: string[] = [];
        const extensionConfig = await readVSCodeExtensionConfigFromDirectory(createDesktopDirectoryHandle(profile.extensionsDir), extensionWarnings);
        const extensions = extensionConfig.extensions ?? [];
        if (extensions.length > 0) {
          const discoveredFiles = [`${profile.product}/extensions/*/package.json`];
          if (Object.keys(extensionConfig.settings?.["files.associations"] ?? {}).length > 0) {
            discoveredFiles.push(`${profile.product}/extensions/*/contributes.languages`);
          }
          if (Object.keys(extensionConfig.snippets ?? {}).length > 0) {
            discoveredFiles.push(`${profile.product}/extensions/*/contributes.snippets`);
          }
          results.push({
            config: extensionConfig,
            sourceLabel: `${profile.product}: extensions`,
            discoveredFiles,
            warnings: extensionWarnings,
          });
        } else {
          warnings.push(...extensionWarnings);
        }
      } catch (error) {
        warnings.push(`Could not read ${profile.product} extensions: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (results.length === 0) {
    return {
      config: {},
      sourceLabel: "Auto-detected VS Code profiles (0 files, 0 extensions)",
      discoveredFiles: [],
      warnings: warnings.length > 0 ? warnings : ["No readable VS Code settings or extensions were found."],
    };
  }

  const merged = mergeVSCodeDirectoryImportResults(results);
  return {
    ...merged,
    warnings: [...merged.warnings, ...warnings],
  };
}
