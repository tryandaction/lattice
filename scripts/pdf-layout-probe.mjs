import fs from "node:fs/promises";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const INPUTS = [
  {
    label: "demon-like-cooling",
    filePath: "C:/universe/books&essay/physics/Essay/Demon-like algorithmic quantum cooling and its.pdf",
  },
  {
    label: "quantum-biology-review",
    filePath: "C:/universe/books&essay/quantum biology/nphys2474.pdf",
  },
  {
    label: "ajp-molecular-dynamics",
    filePath: "C:/Users/XINGLUOYUNSHEN/Downloads/AJP88_401_2020.pdf",
  },
];

function toRect(item) {
  const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
  const left = transform[4] ?? 0;
  const height = Math.abs(item.height ?? transform[3] ?? 0);
  const top = (transform[5] ?? 0) - height;
  const width = Math.abs(item.width ?? 0);
  return {
    text: item.str,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    centerX: left + width / 2,
    centerY: top + height / 2,
    length: item.str.length,
  };
}

function summarizePage(rects, viewport) {
  const nonEmpty = rects.filter((rect) => rect.text.trim().length > 0);
  const topBand = nonEmpty.filter((rect) => rect.top < viewport.height * 0.24);
  const bodyBand = nonEmpty.filter((rect) => rect.top >= viewport.height * 0.24 && rect.top < viewport.height * 0.78);
  const footerBand = nonEmpty.filter((rect) => rect.top >= viewport.height * 0.78);

  const leftBody = bodyBand.filter((rect) => rect.centerX < viewport.width * 0.5);
  const rightBody = bodyBand.filter((rect) => rect.centerX >= viewport.width * 0.5);

  const narrowTall = nonEmpty.filter((rect) => rect.width > 0 && rect.height > 0 && rect.height > rect.width * 2);
  const smallMarkers = nonEmpty.filter((rect) => rect.height <= 16 && rect.width <= 40);

  return {
    itemCount: rects.length,
    nonEmptyCount: nonEmpty.length,
    topBand: topBand.slice(0, 20).map((rect) => ({
      text: rect.text,
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      centerX: Math.round(rect.centerX),
    })),
    leftBodyCenterAvg: leftBody.length > 0
      ? Math.round(leftBody.reduce((sum, rect) => sum + rect.centerX, 0) / leftBody.length)
      : null,
    rightBodyCenterAvg: rightBody.length > 0
      ? Math.round(rightBody.reduce((sum, rect) => sum + rect.centerX, 0) / rightBody.length)
      : null,
    bodyColumnsDetected: leftBody.length > 20 && rightBody.length > 20,
    narrowTallSamples: narrowTall.slice(0, 12).map((rect) => ({
      text: rect.text,
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })),
    smallMarkerSamples: smallMarkers.slice(0, 20).map((rect) => ({
      text: rect.text,
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })),
    footerSamples: footerBand.slice(0, 20).map((rect) => ({
      text: rect.text,
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })),
  };
}

async function analyzeFile(input) {
  const data = new Uint8Array(await fs.readFile(input.filePath));
  const document = await pdfjsLib.getDocument({ data, disableWorker: true }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 3); pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent({
      includeMarkedContent: false,
      disableNormalization: false,
    });
    const items = textContent.items.filter((item) => typeof item.str === "string");
    const rects = items.map(toRect);
    pages.push({
      pageNumber,
      viewportWidth: Math.round(viewport.width),
      viewportHeight: Math.round(viewport.height),
      ...summarizePage(rects, viewport),
    });
  }

  return {
    label: input.label,
    filePath: input.filePath,
    pages,
  };
}

async function main() {
  const available = [];
  for (const input of INPUTS) {
    try {
      await fs.access(input.filePath);
      available.push(input);
    } catch {
      // Skip unavailable files on this machine.
    }
  }

  if (available.length === 0) {
    throw new Error("No probe PDFs available on this machine.");
  }

  const results = [];
  for (const input of available) {
    results.push(await analyzeFile(input));
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
