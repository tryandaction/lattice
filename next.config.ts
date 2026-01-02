import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: "export",
  basePath: isProd ? "/lattice" : "",
  assetPrefix: isProd ? "/lattice/" : "",
  images: {
    unoptimized: true,
  },
  // Transpile pptx-preview for compatibility
  transpilePackages: ["pptx-preview"],
};

export default nextConfig;
