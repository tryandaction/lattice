import mammoth from "mammoth";
import { isCodeFile } from "@/lib/file-utils";

const NON_LINE_NAVIGABLE_SEARCH_EXTENSIONS = new Set(["html", "htm", "ipynb", "docx", "pptx"]);

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function isSearchableTextExtension(extension: string): boolean {
  const ext = extension.toLowerCase();
  return ext === "md" || ext === "html" || ext === "htm" || ext === "ipynb" || ext === "docx" || ext === "pptx" || isCodeFile(ext);
}

export function isLineNavigableSearchExtension(extension: string): boolean {
  const ext = extension.toLowerCase();
  return isSearchableTextExtension(ext) && !NON_LINE_NAVIGABLE_SEARCH_EXTENSIONS.has(ext);
}

export async function extractSearchableTextForFile(input: {
  extension: string;
  file: File;
}): Promise<string> {
  const extension = input.extension.toLowerCase();

  if (extension === "html" || extension === "htm") {
    const text = await input.file.text();
    return htmlToPlainText(text);
  }

  if (extension === "md" || isCodeFile(extension)) {
    const text = await input.file.text();
    return text;
  }

  if (extension === "ipynb") {
    const text = await input.file.text();
    try {
      const notebook = JSON.parse(text) as { cells?: Array<{ source?: string[] | string }> };
      return (notebook.cells ?? [])
        .map((cell) => Array.isArray(cell.source) ? cell.source.join("") : cell.source ?? "")
        .join("\n");
    } catch {
      return text;
    }
  }

  if (extension === "docx") {
    const buffer = await input.file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value;
  }

  if (extension === "pptx") {
    const buffer = await input.file.arrayBuffer();
    const { extractTextFromPptx } = await import("@/lib/pptx-formula-extractor");
    const slides = await extractTextFromPptx(buffer);
    return slides
      .flatMap((slide) => slide.paragraphs.map((paragraph) => paragraph.text))
      .filter(Boolean)
      .join("\n");
  }

  if (extension === "doc") {
    return "";
  }

  return "";
}
