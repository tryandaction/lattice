"use client";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export async function getDiagnosticsWorkspaceHandle(name = "lattice-browser-regression"): Promise<FileSystemDirectoryHandle> {
  if (!("storage" in navigator) || !("getDirectory" in navigator.storage)) {
    throw new Error("当前浏览器不支持 OPFS diagnostics workspace。");
  }

  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(name, { create: true });
}

export async function ensureSubdirectory(
  rootHandle: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle> {
  const parts = path.split("/").filter(Boolean);
  let current = rootHandle;

  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }

  return current;
}

export async function writeArrayBufferFile(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
  content: ArrayBuffer,
): Promise<FileSystemFileHandle> {
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
  return fileHandle;
}

export async function createSamplePdfBuffer(title: string, totalPages = 8): Promise<ArrayBuffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`${title} · Page ${pageIndex + 1}`, {
      x: 48,
      y: 740,
      size: 20,
      font,
      color: rgb(0.12, 0.12, 0.18),
    });

    for (let line = 0; line < 24; line += 1) {
      page.drawText(
        `Diagnostic paragraph ${line + 1} on page ${pageIndex + 1}. Keep scrolling to verify stable zoom and reading progress.`,
        {
          x: 48,
          y: 690 - line * 24,
          size: 12,
          font,
          color: rgb(0.18, 0.18, 0.24),
          maxWidth: 520,
        },
      );
    }
  }

  return toArrayBuffer(await pdf.save());
}

export async function loadPublicAssetBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load diagnostics asset: ${url} (${response.status})`);
  }
  return response.arrayBuffer();
}
