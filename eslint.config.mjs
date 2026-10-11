import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      ".codex-tmp/**",
      ".worktrees/**",
      ".pnpm-store/**",
      ".tmp-*",
      "goal-*.js",
      "tmp/**",
      "playwright-report/**",
      "test-results/**",
      "node_modules/**",
      "dist/**",
      "action-dist/**",
      "build/**",
      "**/dist/**",
      ".next/**",
      "**/.next/**",
      ".turbo/**",
      "**/.turbo/**",
      "coverage/**",
      "**/coverage/**",
      "pnpm-lock.yaml",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        document: "readonly",
        window: "readonly",
        HTMLElement: "readonly",
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
