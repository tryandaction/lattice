import mammoth from "mammoth";

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

export async function extractSearchableTextForFile(input: {
  extension: string;
  file: File;
}): Promise<string> {
  const extension = input.extension.toLowerCase();

  if (["md", "txt", "py", "js", "jsx", "ts", "tsx", "json", "css", "html", "htm"].includes(extension)) {
    const text = await input.file.text();
    return extension === "html" || extension === "htm"
      ? htmlToPlainText(text)
      : text;
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

  if (extension === "doc") {
    return "";
  }

  return "";
}
