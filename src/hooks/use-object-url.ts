"use client";

import { startTransition, useEffect, useRef, useState } from "react";

export function useObjectUrl(blob: Blob | null): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const currentUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!blob) {
      startTransition(() => {
        setObjectUrl(null);
      });
      return;
    }

    const nextUrl = URL.createObjectURL(blob);
    currentUrlRef.current = nextUrl;
    startTransition(() => {
      setObjectUrl(nextUrl);
    });

    return () => {
      if (currentUrlRef.current === nextUrl) {
        currentUrlRef.current = null;
      }
      URL.revokeObjectURL(nextUrl);
    };
  }, [blob]);

  return objectUrl;
}
