import { defineConfig } from "vitest/config";

// Explicit opt-in: ordinary discovery only selects *.test.ts / *.test.mts.
export default defineConfig({
  test: {
    include: [
      "scripts/local-checks/compiler-cli.pilot.ts",
      "scripts/lib/server-rendered-heading.test.ts",
    ],
    environment: "node",
    globals: false,
    testTimeout: 20_000,
  },
});
