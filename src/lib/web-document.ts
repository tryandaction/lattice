"use client";

import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";

export interface WebDocumentSnapshot {
  finalUrl: string;
  contentType?: string | null;
  body: string;
}

function parseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

export function canOpenUrlInternally(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }

  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

export function deriveWebDocumentName(url: string, title?: string | null): string {
  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  const parsed = parseUrl(url);
  if (!parsed) {
    return url;
  }

  const pathTail = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop();
  return pathTail || parsed.hostname || parsed.href;
}

export async function loadWebDocument(url: string): Promise<WebDocumentSnapshot> {
  if (isTauriHost()) {
    return invokeTauriCommand<WebDocumentSnapshot>("fetch_web_document", { url }, { timeoutMs: 20000 });
  }

  const response = await fetch(url, {
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Failed to load webpage: HTTP ${response.status}`);
  }

  return {
    finalUrl: response.url,
    contentType: response.headers.get("content-type"),
    body: await response.text(),
  };
}
