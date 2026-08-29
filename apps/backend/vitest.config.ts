import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@wpt/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
      "@wpt/crypto": resolve(__dirname, "../../packages/crypto/src/index.ts"),
    },
  },
});
