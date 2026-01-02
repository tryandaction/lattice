"use client";

import { FileQuestion } from "lucide-react";
import { getFileExtension } from "@/lib/file-utils";

interface UnsupportedFileProps {
  fileName: string;
}

const SUPPORTED_TYPES = [
  { ext: ".md", name: "Markdown" },
  { ext: ".pdf", name: "PDF" },
  { ext: ".ipynb", name: "Jupyter Notebook" },
  { ext: ".py", name: "Python" },
  { ext: ".js", name: "JavaScript" },
  { ext: ".json", name: "JSON" },
  { ext: ".tex", name: "LaTeX" },
  { ext: ".txt", name: "Plain Text" },
  { ext: ".doc/.docx", name: "Word Document" },
  { ext: ".ppt/.pptx", name: "PowerPoint" },
  { ext: ".html/.htm", name: "HTML" },
];

/**
 * Unsupported File placeholder component
 * Displays when a file type is not supported
 */
export function UnsupportedFile({ fileName }: UnsupportedFileProps) {
  const extension = getFileExtension(fileName);

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <FileQuestion className="h-16 w-16 text-muted-foreground" />
      
      <h2 className="mt-4 text-xl font-medium text-foreground">
        File type not supported
      </h2>
      
      <p className="mt-2 text-sm text-muted-foreground">
        <span className="font-medium">{fileName}</span>
        {extension && (
          <span className="ml-1">(.{extension})</span>
        )}
      </p>

      <div className="mt-8 max-w-md">
        <p className="text-center text-sm text-muted-foreground">
          Supported file types:
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {SUPPORTED_TYPES.map((type) => (
            <span
              key={type.ext}
              className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
            >
              {type.ext}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
