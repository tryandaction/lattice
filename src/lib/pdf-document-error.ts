export type PdfDocumentErrorKind = "damaged" | "password" | "missing" | "generic";

function getPdfDocumentErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.trim();
  }
  return typeof error === "string" ? error : "";
}

export function classifyPdfDocumentError(error: unknown): PdfDocumentErrorKind {
  const message = getPdfDocumentErrorMessage(error).toLowerCase();

  if (/passwordexception|password required|incorrect password|no password given/.test(message)) {
    return "password";
  }
  if (/missingpdfexception|missing pdf|unexpected server response.*404|not found/.test(message)) {
    return "missing";
  }
  if (/invalidpdfexception|invalid pdf structure|formaterror|xref|bad trailer|unexpected eof/.test(message)) {
    return "damaged";
  }
  return "generic";
}
