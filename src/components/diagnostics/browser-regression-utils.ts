"use client";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export async function getDiagnosticsWorkspaceHandle(name = "lattice-browser-regression"): Promise<FileSystemDirectoryHandle> {
  if (!("storage" in navigator) || !("getDirectory" in navigator.storage)) {
    throw new Error("Current browser does not support the OPFS diagnostics workspace.");
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

export async function createSamplePdfBuffer(title: string, totalPages = 4): Promise<ArrayBuffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const italicFont = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const drawBodyLine = (page: ReturnType<PDFDocument["addPage"]>, text: string, x: number, y: number) => {
    page.drawText(text, {
      x,
      y,
      size: 9.5,
      font,
      color: rgb(0.18, 0.18, 0.24),
      maxWidth: 238,
    });
  };

  const drawFormulaProbe = (page: ReturnType<PDFDocument["addPage"]>, x: number, y: number) => {
    page.drawText("Formula probe: T2* = 3.7(4) s; Omega = sqrt(Delta2 + g2); alpha/beta phase.", {
      x,
      y: y + 18,
      size: 9.5,
      font,
      color: rgb(0.18, 0.18, 0.24),
      maxWidth: 512,
    });
    page.drawText("T", { x, y, size: 11, font: italicFont, color: rgb(0.1, 0.1, 0.16) });
    page.drawText("2", { x: x + 7, y: y - 4, size: 6, font, color: rgb(0.1, 0.1, 0.16) });
    page.drawText("*", { x: x + 13, y: y + 5, size: 6, font, color: rgb(0.1, 0.1, 0.16) });
    page.drawText(" = 3.7(4) s; ", {
      x: x + 20,
      y,
      size: 10,
      font,
      color: rgb(0.1, 0.1, 0.16),
    });
    page.drawText("Omega = sqrt(Delta", {
      x: x + 92,
      y,
      size: 10,
      font,
      color: rgb(0.1, 0.1, 0.16),
    });
    page.drawText("2 + g2); ", {
      x: x + 194,
      y,
      size: 10,
      font,
      color: rgb(0.1, 0.1, 0.16),
    });
    page.drawText("alpha/beta phase", {
      x: x + 240,
      y,
      size: 10,
      font,
      color: rgb(0.1, 0.1, 0.16),
    });
  };

  const drawGreekAndCitationProbe = (page: ReturnType<PDFDocument["addPage"]>, x: number, y: number) => {
    page.drawText("Greek glyph probe: ", {
      x,
      y,
      size: 10,
      font,
      color: rgb(0.12, 0.12, 0.18),
    });
    page.drawText("alpha beta gamma delta Omega Delta", {
      x: x + 92,
      y,
      size: 10,
      font,
      color: rgb(0.12, 0.12, 0.18),
    });
    page.drawText(" should stay near the formula text.", {
      x: x + 268,
      y,
      size: 10,
      font,
      color: rgb(0.12, 0.12, 0.18),
    });
    page.drawText("Citation superscript probe: Rydberg excitation", {
      x,
      y: y - 18,
      size: 10,
      font,
      color: rgb(0.12, 0.12, 0.18),
    });
    page.drawText("21", {
      x: x + 226,
      y: y - 12,
      size: 6,
      font,
      color: rgb(0.12, 0.12, 0.18),
    });
    page.drawText(" remains adjacent to body text.", {
      x: x + 238,
      y: y - 18,
      size: 10,
      font,
      color: rgb(0.12, 0.12, 0.18),
    });
  };

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`${title} - Page ${pageIndex + 1}`, {
      x: 48,
      y: 740,
      size: 20,
      font,
      color: rgb(0.12, 0.12, 0.18),
    });

    page.drawText("Minimal paper fixture: double-column selection, formulas, ligatures, and citations.", {
      x: 48,
      y: 716,
      size: 10,
      font,
      color: rgb(0.32, 0.32, 0.4),
    });

    const leftX = 48;
    const rightX = 324;
    const startY = 676;
    const lineHeight = 18;
    const leftLines = [
      "Rydberg states are extremely sensitive to small low-frequency fields.",
      "The left column includes formula-adjacent prose before and after an equation.",
      "Even so, the electric field stability required to hold Stark shifts below 1 MHz",
      "is typically of order 10 mV/cm in compact optical setups [21].",
      "Ligature probe: affinity and fluorescence remain searchable after extraction.",
      "Greek probe: omega, delta, alpha, and beta appear near body text.",
      "Cross-line probe starts here and continues with a stable anchor",
      "on the next line without jumping into the right column.",
    ];
    const rightLines = [
      "The right column explains the readout calibration sequence and preserves order.",
      "Possible interactions in the absence of applied fields are compared below.",
      "This section discusses dipole-dipole coupling without crossing columns.",
      "Fast, high-fidelity excitation to the Rydberg state21 enables mid-circuit checks.",
      "Reference probe [12, 17] should not merge with adjacent superscript-like text.",
      "Copy and highlight smoke checks use this text as a browser fixture target.",
    ];

    leftLines.forEach((line, index) => drawBodyLine(page, line, leftX, startY - index * lineHeight));
    rightLines.forEach((line, index) => drawBodyLine(page, line, rightX, startY - index * lineHeight));
    drawFormulaProbe(page, leftX, startY - 9 * lineHeight);
    drawGreekAndCitationProbe(page, rightX, startY - 7 * lineHeight);

    page.drawLine({
      start: { x: 306, y: 130 },
      end: { x: 306, y: 696 },
      thickness: 0.5,
      color: rgb(0.82, 0.82, 0.88),
    });

    for (let line = 0; line < 10; line += 1) {
      page.drawText(
        `Diagnostic paragraph ${line + 1} on page ${pageIndex + 1}. Keep scrolling to verify stable zoom and reading progress.`,
        {
          x: 48,
          y: 310 - line * 24,
          size: 11,
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
