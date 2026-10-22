"use client";

import { useSettingsStore } from "@/stores/settings-store";
import { useAiProviderProfileStore } from "@/stores/ai-provider-profile-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { AiProviderProfile, AiRuntimeSettings } from "@/lib/ai/types";
import { getProfileDefaultModel } from "@/lib/ai/provider-profiles";
import { resolveSystemPrompt, type SystemPromptMode } from "@/lib/ai/system-prompt-profile";
import { isFileTabState } from "@/types/layout";
import { loadPdfJsDocument } from "@/lib/pdf-js-document-loader";
import { getPdfPageSearchText } from "@/lib/pdf-page-text-cache";
import { resolveAuthorizedDocumentHandle } from '@/lib/ai/document-source-capture';
import { getAgentDocumentVersion } from '@/lib/ai/document-source';

const AI_CONTEXT_FILE_MAX_CHARS = 70000;
const AI_CONTEXT_PDF_MAX_PAGES = 16;
const AI_CONTEXT_PDF_CACHE_MAX = 3;
const aiPdfContextCache = new Map<string, Promise<{ text: string; totalPages: number }>>();

function isPdfFile(filePath: string | undefined, file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(filePath ?? file.name);
}

export function isPdfPath(filePath: string | undefined): boolean {
  return /\.pdf$/i.test(filePath ?? "");
}

function clampAiContextText(text: string, maxChars = AI_CONTEXT_FILE_MAX_CHARS): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n\n[AI context truncated after ${maxChars} characters.]`;
}

export interface AiFileContextOptions {
  preferredPdfPages?: number[];
  /** The immutable File whose bytes actually supplied this request, never a later reread. */
  onSourceRead?: (file: File, path: string, details?: { version: string; totalPages: number }) => void | Promise<void>;
}

export function getRequestedPdfPages(query: string): number[] {
  return Array.from(query.matchAll(/第\s*(\d+)\s*页|\b(?:pages?|p\.?)\s*(\d+)(?:\s*[-–]\s*(\d+))?/gi))
    .flatMap((match) => {
      const first = Number(match[1] ?? match[2]);
      const last = Math.min(Number(match[3] ?? first), first + AI_CONTEXT_PDF_MAX_PAGES - 1);
      return Number.isSafeInteger(first) && first > 0 && last >= first
        ? Array.from({ length: last - first + 1 }, (_, index) => first + index)
        : [];
    });
}

export async function readFileForAiContext(file: File, label: string, options?: AiFileContextOptions): Promise<string> {
  if (!isPdfFile(label, file)) {
    await options?.onSourceRead?.(file, label);
    return clampAiContextText(await file.text());
  }

  const preferredPages = Array.from(new Set(options?.preferredPdfPages ?? []))
    .filter((page) => Number.isSafeInteger(page) && page > 0)
    .slice(0, AI_CONTEXT_PDF_MAX_PAGES);
  const version = await getAgentDocumentVersion(file, label);
  const cacheKey = `${version}:${preferredPages.join(',')}`;
  const cached = aiPdfContextCache.get(cacheKey);
  if (cached) {
    aiPdfContextCache.delete(cacheKey);
    aiPdfContextCache.set(cacheKey, cached);
    const result = await cached;
    await options?.onSourceRead?.(file, label, { version, totalPages: result.totalPages });
    return result.text;
  }

  const extraction = (async () => {
    const pdfDocument = await loadPdfJsDocument({
      data: await file.arrayBuffer(),
      label: `ai-context:${label}`,
    });

    try {
      const pageCount = Math.min(pdfDocument.numPages, AI_CONTEXT_PDF_MAX_PAGES);
      const pageNumbers = Array.from(new Set([
        ...preferredPages.filter((page) => page <= pdfDocument.numPages),
        ...Array.from({ length: pageCount }, (_, index) => index + 1),
      ])).slice(0, pageCount);
      const sections = [
        `[PDF text extracted from ${label}; supplied pages ${pageNumbers.join(', ')} of ${pdfDocument.numPages}.]`,
      ];

      for (const pageNumber of pageNumbers) {
        const pageText = (await getPdfPageSearchText(pdfDocument, pageNumber)).trim();
        if (pageText) {
          sections.push(`--- Page ${pageNumber} ---\n${pageText}`);
        }
      }

      if (pdfDocument.numPages > pageCount) {
        sections.push(`[PDF extraction limited to ${pageCount} pages. Omitted pages were not read. Ask for a specific page or selection for more detail.]`);
      }

      return { text: clampAiContextText(sections.join("\n\n")), totalPages: pdfDocument.numPages };
    } finally {
      void pdfDocument.destroy();
    }
  })();

  aiPdfContextCache.delete(cacheKey);
  aiPdfContextCache.set(cacheKey, extraction);
  while (aiPdfContextCache.size > AI_CONTEXT_PDF_CACHE_MAX) {
    const oldestKey = aiPdfContextCache.keys().next().value;
    if (!oldestKey) break;
    aiPdfContextCache.delete(oldestKey);
  }

  try {
    const result = await extraction;
    await options?.onSourceRead?.(file, label, { version, totalPages: result.totalPages });
    return result.text;
  } catch (error) {
    aiPdfContextCache.delete(cacheKey);
    throw error;
  }
}

export async function readWorkspaceFile(
  rootHandle: FileSystemDirectoryHandle,
  filePath: string,
  options?: AiFileContextOptions,
): Promise<string> {
  const fileHandle = await resolveAuthorizedDocumentHandle(rootHandle, filePath);
  const file = await fileHandle.getFile();
  return readFileForAiContext(file, filePath, options);
}

export async function resolveActiveFileContent(
  activeTab: ReturnType<typeof useWorkspaceStore.getState>["getActiveTab"] extends () => infer T ? T : never,
  activeContent: string | null,
  options?: AiFileContextOptions,
): Promise<string | undefined> {
  if (typeof activeContent === "string" && activeContent.trim().length > 0) {
    if (activeTab && isFileTabState(activeTab) && options?.onSourceRead) {
      let file: File | null = null;
      try { file = await activeTab.fileHandle.getFile(); } catch { /* An editor cache is still valid request input. */ }
      // Cached editor text can be unsaved. Bind exactly the supplied text; a later
      // on-disk validation will conservatively exclude it until that revision exists.
      const supplied = file && await file.text() === activeContent
        ? file
        : new File([activeContent], activeTab.fileName, { type: file?.type ?? 'text/plain' });
      await options.onSourceRead(supplied, activeTab.filePath || activeTab.fileName);
    }
    return activeContent;
  }
  if (!activeTab) {
    return activeContent ?? undefined;
  }
  if (!isFileTabState(activeTab)) {
    return activeContent ?? undefined;
  }
  try {
    const file = await activeTab.fileHandle.getFile();
    return await readFileForAiContext(file, activeTab.filePath || activeTab.fileName, options);
  } catch {
    return undefined;
  }
}

export interface VisiblePdfPageContext {
  page: number;
  text: string;
}

export function getVisiblePdfPageContext(paneId?: string): VisiblePdfPageContext | null {
  if (typeof document === "undefined") {
    return null;
  }

  const expectedTestId = paneId ? `pdf-scroll-container-${paneId}` : null;
  const containers = Array.from(document.querySelectorAll<HTMLElement>("[data-testid^='pdf-scroll-container-'], [data-testid^='pdf-viewer-container-']"));
  const container = containers.find((candidate) => candidate.dataset.testid === expectedTestId)
    ?? (expectedTestId ? null : containers[0])
    ?? null;
  if (!container) {
    return null;
  }

  const candidates = Array.from(container.querySelectorAll<HTMLElement>("[data-page-number]"))
    .map((pageElement) => {
      const page = Number(pageElement.dataset.pageNumber ?? "");
      const text = pageElement.querySelector<HTMLElement>(".textLayer")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      return Number.isInteger(page) && page > 0 && text ? { page, text, pageElement } : null;
    })
    .filter((candidate): candidate is { page: number; text: string; pageElement: HTMLElement } => candidate !== null);
  if (candidates.length === 0) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  const best = candidates
    .filter(({ pageElement }) => pageElement.dataset.pdfPageVisible !== "false")
    .map((candidate) => {
      const rect = candidate.pageElement.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top));
      return { ...candidate, score: visibleHeight > 0 ? visibleHeight : (candidate.pageElement.dataset.pdfPageVisible === "true" ? 1 : 0) };
    })
    .sort((left, right) => right.score - left.score)[0] ?? candidates[0];

  return { page: best.page, text: best.text };
}

export function buildVisiblePdfPageContext(filePath: string | undefined, paneId?: string): string | undefined {
  if (!filePath || !isPdfPath(filePath)) {
    return undefined;
  }
  const visiblePage = getVisiblePdfPageContext(paneId);
  return visiblePage ? `--- Page ${visiblePage.page} ---\n${visiblePage.text}` : undefined;
}

export function toRuntimeSettings(
  settings: ReturnType<typeof useSettingsStore.getState>["settings"],
  mode: SystemPromptMode = "chat",
  profileOverride?: AiProviderProfile | null,
): AiRuntimeSettings {
  const activeProfile = profileOverride === undefined
    ? (() => {
        const profileState = useAiProviderProfileStore.getState();
        return profileState.profiles.find((profile) => profile.id === profileState.activeProfileId) ?? null;
      })()
    : profileOverride;
  const providerId = activeProfile?.provider ?? (settings.aiProvider as AiRuntimeSettings["providerId"]) ?? null;
  const model = activeProfile ? getProfileDefaultModel(activeProfile) : settings.aiModel;

  return {
    aiEnabled: settings.aiEnabled,
    providerId,
    model,
    temperature: settings.aiTemperature,
    maxTokens: settings.aiMaxTokens,
    systemPrompt: resolveSystemPrompt(settings, mode),
    preferLocal: providerId === "ollama",
    agentOmittedSummaryEnabled: settings.aiAgentOmittedSummaryEnabled,
    ...(activeProfile ? { profileId: activeProfile.id } : {}),
  };
}

export function buildWorkspaceSummary(
  rootHandle: FileSystemDirectoryHandle | null,
  filePath: string | undefined,
): string | null {
  if (!rootHandle && !filePath) {
    return null;
  }

  return [
    rootHandle ? `Workspace: ${rootHandle.name}` : null,
    filePath ? `Active file: ${filePath}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

export function formatAnnotationContext(
  annotations: Array<{
    target?: { type?: string; page?: number; line?: number };
    comment?: string;
    content?: string;
  }>,
): string | null {
  if (annotations.length === 0) {
    return null;
  }

  return annotations
    .slice(0, 20)
    .map((annotation, index) => {
      const targetLabel = annotation.target?.type === "pdf"
        ? `Page ${annotation.target.page ?? "?"}`
        : annotation.target?.type === "code_line"
          ? `Line ${annotation.target.line ?? "?"}`
          : annotation.target?.type ?? "annotation";
      const note = annotation.comment?.trim() || annotation.content?.trim() || "[no text]";
      return `${index + 1}. ${targetLabel}: ${note}`;
    })
    .join("\n");
}
