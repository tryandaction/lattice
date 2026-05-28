"use client";

function stripExecutableMarkup(root: ParentNode): void {
  root.querySelectorAll("script").forEach((node) => node.remove());
  root.querySelectorAll<HTMLElement>("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) {
        element.removeAttribute(attribute.name);
      }
    }
  });
}

function ensureDocumentShell(html: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

export function extractHtmlDocumentTitle(html: string): string | null {
  const document = ensureDocumentShell(html);
  const title = document.querySelector("title")?.textContent?.trim();
  return title || null;
}

export function buildHtmlPreviewDocument(input: {
  html: string;
  baseHref?: string | null;
  contentType?: string | null;
}): string {
  const rawHtml = input.contentType?.includes("text/plain")
    ? `<!doctype html><html><head><title>Plain Text</title></head><body><pre>${escapeHtml(input.html)}</pre></body></html>`
    : input.html;
  const document = ensureDocumentShell(rawHtml);
  stripExecutableMarkup(document);

  const head = document.head ?? document.createElement("head");
  const body = document.body ?? document.createElement("body");
  if (!document.head) {
    document.documentElement.prepend(head);
  }
  if (!document.body) {
    document.documentElement.append(body);
  }

  head.querySelectorAll("base[data-lattice-preview-base]").forEach((node) => node.remove());
  if (input.baseHref) {
    const base = document.createElement("base");
    base.setAttribute("href", input.baseHref);
    base.setAttribute("data-lattice-preview-base", "true");
    head.prepend(base);
  }

  if (!head.querySelector('meta[charset]')) {
    const charset = document.createElement("meta");
    charset.setAttribute("charset", "utf-8");
    head.prepend(charset);
  }
  if (!head.querySelector('meta[name="viewport"]')) {
    const viewport = document.createElement("meta");
    viewport.setAttribute("name", "viewport");
    viewport.setAttribute("content", "width=device-width, initial-scale=1");
    head.append(viewport);
  }

  const style = document.createElement("style");
  style.setAttribute("data-lattice-preview-style", "true");
  style.textContent = `
    html, body { min-height: 100%; }
    body { margin: 0; padding: 16px; box-sizing: border-box; overflow-wrap: anywhere; }
    img, video, canvas, svg, iframe { max-width: 100%; height: auto; }
    table { max-width: 100%; }
    pre { white-space: pre-wrap; overflow-x: auto; }
  `;
  head.querySelectorAll('style[data-lattice-preview-style="true"]').forEach((node) => node.remove());
  head.append(style);

  return `<!DOCTYPE html>\n${document.documentElement.outerHTML}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
