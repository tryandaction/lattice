"use client";

import type { ReactNode } from "react";
import { registerSharedLibraryAdapters } from "@/components/shared-library/register-shared-library-adapters";

// Idempotent; ensures the default item workspace adapters (PDF reuse) are
// available before the library shell mounts.
registerSharedLibraryAdapters();

export default function LibraryLayout({ children }: { children: ReactNode }) {
  return <div className="h-dvh min-h-0 overflow-hidden">{children}</div>;
}
