import { getFileExtension, getImageMimeType, getRendererForExtension, isTextFile } from "@/lib/file-utils";
import type { ItemKind } from "./domain";
import type { SharedLibraryItemContent } from "./content-store";

/** Normalize actual bytes at the cloud boundary, including cross-realm buffers. */
export function cloudArrayBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer;
  if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") return new Uint8Array(value as ArrayBuffer).slice().buffer;
  return null;
}

export function cloudFileKind(name: string, mimeType: string): ItemKind {
  switch (getRendererForExtension(getFileExtension(name))) {
    case "pdf": return "pdf";
    case "markdown": return "markdown";
    case "jupyter": return "notebook";
    case "word": return "docx";
    case "powerpoint": return "pptx";
    case "image": return "image";
    case "code": case "html": return "code";
    default: return mimeType.startsWith("image/") ? "image" : "data";
  }
}

export function cloudContentFromBytes(name: string, data: ArrayBuffer, mimeType: string, updatedAt: string): SharedLibraryItemContent {
  const extension = getFileExtension(name);
  const renderer = getRendererForExtension(extension);
  const binary = ["pdf", "word", "powerpoint", "image"].includes(renderer);
  const text = !binary && (isTextFile(extension) || /^(text\/)|json|javascript|xml|yaml/i.test(mimeType));
  const resolvedMime = mimeType && mimeType !== "application/octet-stream" ? mimeType
    : renderer === "image" ? getImageMimeType(extension)
      : renderer === "markdown" ? "text/markdown"
        : renderer === "jupyter" ? "application/json"
          : renderer === "html" ? "text/html"
            : text ? "text/plain" : "application/octet-stream";
  if (text) {
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
      // Binary formats with a text-like extension must retain their original bytes.
      if (!decoded.includes("\0")) return { kind: "text", text: decoded, mimeType: resolvedMime, updatedAt };
    } catch { /* Unknown encodings remain downloadable byte-for-byte. */ }
  }
  return { kind: "binary", data, mimeType: resolvedMime, updatedAt };
}
