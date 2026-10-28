"use client";

import { useState } from "react";
import { CloudUploadToolbar } from "./cloud-upload-toolbar";

export interface CloudUploadActionProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
}

/** Selecting files is available before authentication; the host prepares their destination. */
export function CloudUploadAction({ onFiles, disabled = false, className, compact }: CloudUploadActionProps) {
  const [error, setError] = useState<string | null>(null);
  return <div className={className}>
    <CloudUploadToolbar disabled={disabled} compact={compact} className="border-0 px-0" testId="cloud-upload-action" progress={null}
      onFiles={files => { setError(null); onFiles(files); }}
      onError={value => setError(value instanceof Error ? value.message : String(value))} />
    {error ? <p role="alert" className="mt-1 text-xs text-destructive">{error}</p> : null}
  </div>;
}
