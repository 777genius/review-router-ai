import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: fileURLToPath(new URL("../../output/vite-cache", import.meta.url)),
  test: {
    include: [
      "scripts/local-checks/lint-format-native.test.ts",
      "scripts/local-checks/lint-format-proof.test.ts",
    ],
    environment: "node",
    globals: false,
    allowOnly: false,
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
