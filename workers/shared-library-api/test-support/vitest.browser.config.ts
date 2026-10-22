import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/** Dedicated required UI gate. Default unit discovery never starts a browser or depends on a dev port. */
export default defineConfig({
  test: {
    include: ["workers/shared-library-api/test-support/cloud-*.scenario.ts"],
    environment: "node",
    testTimeout: 240000,
    hookTimeout: 120000,
    maxWorkers: 1,
  },
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
});
