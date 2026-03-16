import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  distDir: "web-dist",
  images: {
    unoptimized: true,
  },
  // Transpile pptx-preview for compatibility
  transpilePackages: ["pptx-preview"],
};

export default nextConfig;
