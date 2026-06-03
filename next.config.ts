import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const createNextConfig = (phase: string): NextConfig => ({
  output: "export",
  distDir: process.env.NEXT_DIST_DIR?.trim() || (phase === PHASE_DEVELOPMENT_SERVER ? "web-dist-dev" : "web-dist"),
  images: {
    unoptimized: true,
  },
  // Transpile pptx-preview for compatibility
  transpilePackages: ["pptx-preview"],
});

export default createNextConfig;
