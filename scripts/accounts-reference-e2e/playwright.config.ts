import { dirname, join } from "node:path";
import { defineConfig } from "@playwright/test";

const baseURL = process.env.ACCOUNTS_REFERENCE_E2E_BASE_URL;

export default defineConfig({
  testDir: "./src/tests",
  outputDir: process.env.ACCOUNTS_REFERENCE_E2E_RESULT_JSON
    ? join(
        dirname(process.env.ACCOUNTS_REFERENCE_E2E_RESULT_JSON),
        "browser-artifacts",
      )
    : "../../tmp/accounts-reference-e2e/browser-artifacts",
  fullyParallel: false,
  ...(process.env.ACCOUNTS_REFERENCE_E2E_GREP
    ? { grep: new RegExp(process.env.ACCOUNTS_REFERENCE_E2E_GREP) }
    : {}),
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    ...(baseURL ? { baseURL } : {}),
    browserName: "chromium",
    headless: true,
    ...(process.env.ACCOUNTS_REFERENCE_E2E_BROWSER_EXECUTABLE
      ? {
          launchOptions: {
            executablePath:
              process.env.ACCOUNTS_REFERENCE_E2E_BROWSER_EXECUTABLE,
            args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
          },
        }
      : {}),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  reporter: [
    ["line"],
    [
      "json",
      {
        outputFile:
          process.env.ACCOUNTS_REFERENCE_E2E_RESULT_JSON ??
          "../../tmp/accounts-reference-e2e/playwright-result.json",
      },
    ],
  ],
});
