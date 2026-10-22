import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const createNextConfig = (phase: string): NextConfig => ({
  // Static hosting uses the exported `/library` shell plus the Pages
  // fallback in `public/_redirects`. Development keeps request-time dynamic
  // routes enabled so arbitrary Library/Item deep links can be debugged.
  ...(phase === PHASE_DEVELOPMENT_SERVER ? {} : { output: "export" as const }),
  distDir: process.env.NEXT_DIST_DIR?.trim() || (phase === PHASE_DEVELOPMENT_SERVER ? "web-dist-dev" : "web-dist"),
  images: {
    unoptimized: true,
  },
  // Transpile pptx-preview for compatibility
  transpilePackages: ["pptx-preview"],
});

export default createNextConfig;
