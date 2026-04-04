import type { NextConfig } from "next";

const distDir = process.env.NEXT_DIST_DIR?.trim() || "web-dist";

const nextConfig: NextConfig = {
  output: "export",
  distDir,
  images: {
    unoptimized: true,
  },
  // Transpile pptx-preview for compatibility
  transpilePackages: ["pptx-preview"],
};

export default nextConfig;
