import fs from "node:fs/promises";
import path from "node:path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const CANDIDATE_BASELINES = [
  {
    label: "saffman-rydberg-review",
    filePath: "C:/universe/MyStudy/atom/Categorized Papers/Reviews_Classics/Saffman 等 - 2010 - Quantum information with Rydberg atoms.pdf",
    maxPages: 8,
    phrases: [
      "Quantum information with Rydberg atoms",
      "For small dc electric fields",
      "Fig. 5, that tend to cause shifts",
    ],
  },
  {
    label: "demon-like-cooling",
    filePath: "C:/universe/books&essay/physics/Essay/Demon-like algorithmic quantum cooling and its.pdf",
    phrases: [
      "Demon-like algorithmic quantum cooling",
      "realization with quantum optics",
      "Jin-Shi Xu",
    ],
  },
  {
    label: "quantum-biology-review",
    filePath: "C:/universe/books&essay/quantum biology/nphys2474.pdf",
    phrases: [
      "Quantum biology",
      "REVIEW ARTICLE",
      "Neill Lambert",
    ],
  },
  {
    label: "ajp-molecular-dynamics",
    filePath: "C:/Users/XINGLUOYUNSHEN/Downloads/AJP88_401_2020.pdf",
    phrases: [
      "Introduction to molecular dynamics simulations",
      "American Journal of Physics",
    ],
  },
];

async function readPdfStats(filePath, phrases, maxPages = 5) {
  const fileBuffer = new Uint8Array(await fs.readFile(filePath));
  const document = await pdfjsLib.getDocument({
    data: fileBuffer,
    disableWorker: true,
  }).promise;

  const pageStats = [];
  const phraseHits = new Map(phrases.map((phrase) => [phrase, []]));

  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, maxPages); pageNumber += 1) {
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
      sample: items.slice(0, 16).map((item) => item.str),
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
  const existingInputs = [];
  for (const input of CANDIDATE_BASELINES) {
    try {
      await fs.access(input.filePath);
      existingInputs.push(input);
    } catch {
      // Skip unavailable baselines on this machine.
    }
  }

  if (existingInputs.length === 0) {
    throw new Error("No available PDF baselines were found on this machine.");
  }

  const results = [];
  for (const input of existingInputs) {
    results.push({
      label: input.label,
      filePath: input.filePath,
      ...(await readPdfStats(input.filePath, input.phrases, input.maxPages)),
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
    baselinesUsed: existingInputs.map((input) => ({
      label: input.label,
      filePath: input.filePath,
    })),
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
