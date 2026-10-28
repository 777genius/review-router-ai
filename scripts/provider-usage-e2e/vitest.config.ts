import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["scripts/provider-usage-e2e/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 30000,
  },
});
