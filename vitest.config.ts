import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Covers the algorithmic core only (prompt.md §3): BKT, Elo, adaptive selection,
 * RRF fusion, chain hashing, chunking, prerequisite cycle detection. These are
 * pure functions with no database dependency, so they run anywhere.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@data": fileURLToPath(new URL("./data", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
