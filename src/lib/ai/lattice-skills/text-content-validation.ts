const textExtension = /\.(?:mdx?|txt|json|ya?ml|csv|tsv|tsx?|jsx?|py|tex|html?|css|scss|ipynb|rs|go|java|c|cpp|h|sql|r|jl|toml|xml|sh|ps1)$/i;
export function isLatticeTextDocumentPath(path: string): boolean { return textExtension.test(path); }
export function validateLatticeTextContent(path: string, content: string): void {
  if (!isLatticeTextDocumentPath(path) || content.length > 400_000 || /\u0000/u.test(content)) throw new Error('Only bounded UTF-8 Markdown/code/Notebook/text content is supported.');
  if (/\.(?:json|ipynb)$/i.test(path)) {
    let value: unknown;
    try { value = JSON.parse(content); } catch { throw new Error('File content must be valid JSON.'); }
    if (/\.ipynb$/i.test(path) && (!value || typeof value !== 'object' || (value as { nbformat?: number }).nbformat !== 4 || !Array.isArray((value as { cells?: unknown }).cells))) throw new Error('File content must be a valid Notebook.');
  }
}
