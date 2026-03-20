"use client";

import { startTransition, useEffect, useState } from "react";

export function useDataUrl(blob: Blob | null): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      startTransition(() => {
        setDataUrl(null);
      });
      return;
    }

    const reader = new FileReader();
    let disposed = false;

    reader.onload = () => {
      if (disposed) {
        return;
      }

      startTransition(() => {
        setDataUrl(typeof reader.result === "string" ? reader.result : null);
      });
    };

    reader.onerror = () => {
      if (disposed) {
        return;
      }

      startTransition(() => {
        setDataUrl(null);
      });
    };

    reader.readAsDataURL(blob);

    return () => {
      disposed = true;
      if (reader.readyState === FileReader.LOADING) {
        reader.abort();
      }
    };
  }, [blob]);

  return dataUrl;
}
