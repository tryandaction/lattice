import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";

export interface FormulaOcrResult {
  latex: string;
  backend: "pix2tex";
  command: string;
}

export async function recognizeFormulaImageWithPix2tex(input: {
  imageDataUrl: string;
  command?: string;
}): Promise<FormulaOcrResult> {
  if (!isTauriHost()) {
    throw new Error("Formula OCR is available in the desktop app after installing pix2tex.");
  }
  const result = await invokeTauriCommand<{
    latex: string;
    backend: string;
    command: string;
  }>(
    "formula_ocr_pix2tex",
    {
      request: {
        imageDataUrl: input.imageDataUrl,
        command: input.command,
      },
    },
    { timeoutMs: 60000 },
  );
  return {
    latex: result.latex,
    backend: "pix2tex",
    command: result.command,
  };
}
