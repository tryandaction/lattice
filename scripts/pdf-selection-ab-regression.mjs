import fs from "node:fs/promises";
import path from "node:path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const pathologicalPdfPath = "C:/universe/MyStudy/atom/files/Reviews_Classics/Saffman - 2016 - Quantum computing with atomic qubits and Rydberg interactions progress and challenges.pdf";
const controlPdfPath = "C:/universe/MyStudy/atom/files/Reviews_Classics/Browaeys和Lahaye - 2020 - Many-body physics with individually controlled Rydberg atoms.pdf";

const phraseBaselines = {
  pathological: [
    "computation",
    "quantum computation based on",
    "attracting great interest",
    "intrinsic features of",
    "In this review",
  ],
  control: [
    "Many-body",
    "physics",
    "studies",
    "ensembles",
  ],
};

async function readPdfStats(filePath, phrases) {
  const fileBuffer = new Uint8Array(await fs.readFile(filePath));
  const document = await pdfjsLib.getDocument({
    data: fileBuffer,
    disableWorker: true,
  }).promise;

  const pageStats = [];
  const phraseHits = new Map(phrases.map((phrase) => [phrase, []]));

  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 5); pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent({
      includeMarkedContent: false,
      disableNormalization: false,
    });
    const items = textContent.items.filter((item) => typeof item.str === "string");
    const joinedText = items.map((item) => item.str).join(" ");

    pageStats.push({
      pageNumber,
      itemCount: items.length,
      longItems: items.filter((item) => item.str.length >= 20).length,
      maxLen: items.reduce((max, item) => Math.max(max, item.str.length), 0),
    });

    for (const phrase of phrases) {
      if (joinedText.toLowerCase().includes(phrase.toLowerCase())) {
        phraseHits.get(phrase)?.push(pageNumber);
      }
    }
  }

  return {
    fileName: path.basename(filePath),
    numPages: document.numPages,
    pageStats,
    phraseHits: Object.fromEntries(phraseHits),
  };
}

async function main() {
  const inputs = [
    { label: "pathological", filePath: pathologicalPdfPath, phrases: phraseBaselines.pathological },
    { label: "control", filePath: controlPdfPath, phrases: phraseBaselines.control },
  ];

  const results = [];
  for (const input of inputs) {
    try {
      await fs.access(input.filePath);
    } catch {
      throw new Error(`Missing PDF baseline: ${input.filePath}`);
    }

    results.push({
      label: input.label,
      filePath: input.filePath,
      ...(await readPdfStats(input.filePath, input.phrases)),
    });
  }

  for (const result of results) {
    const missingPhrase = Object.entries(result.phraseHits)
      .find(([, pages]) => !Array.isArray(pages) || pages.length === 0);
    if (missingPhrase) {
      throw new Error(`Baseline phrase "${missingPhrase[0]}" was not found in ${result.fileName}`);
    }
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
