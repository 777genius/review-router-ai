import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Web source files have at most `webMaxLines` lines. Files that were already
// longer keep their size as a ceiling: lower it in the PR that shrinks the
// file, and raise it only with a reason in the PR description.
// See ai-docs/architecture/83-file-size-governance.md.
const webMaxLines = 600;
const webMaxLinesCeilings = {
  "apps/web/app/dashboard/account-gateway-account-controls.tsx": 2910,
  "apps/web/app/dashboard/account-lifecycle-controls.tsx": 812,
  "apps/web/app/dashboard/actions.ts": 3979,
  "apps/web/app/dashboard/dashboard-copy.ts": 921,
  "apps/web/app/dashboard/dashboard-workspace-page.tsx": 3509,
  "apps/web/app/dashboard/personal-account-controls.tsx": 1870,
  "apps/web/app/dashboard/provider-setup-actions.ts": 1020,
  "apps/web/app/dashboard/provider-setup/gateway-reviewer-roster.tsx": 898,
  "apps/web/app/dashboard/provider-setup/provider-credential-delivery.tsx": 1374,
  "apps/web/app/dashboard/provider-setup/provider-list.tsx": 842,
  "apps/web/app/dashboard/provider-setup/provider-setup-dialog.tsx": 2608,
  "apps/web/app/dashboard/provider-usage-tables.tsx": 629,
  "apps/web/app/dashboard/provider-usage-view.tsx": 753,
  "apps/web/app/dashboard/repository-live-search.tsx": 671,
  "apps/web/app/dashboard/repository-policy-editor.tsx": 1145,
  "apps/web/app/dashboard/repository-setup-progress-panel.tsx": 944,
  "apps/web/app/dashboard/repository-skills-dialog.tsx": 742,
  "apps/web/app/dashboard/review-skills-library.tsx": 816,
  "apps/web/app/dashboard/skill-catalog-dialog.tsx": 779,
  "apps/web/app/dashboard/workspace-personal-accounts.tsx": 643,
  "apps/web/app/setup/page.tsx": 688,
  "apps/web/src/features/memory/interface/components/memory-knowledge-screen.tsx": 859,
  "apps/web/src/features/provider-setup/provider-setup-model.ts": 628,
  "apps/web/src/server/account-gateway-accounts.ts": 2530,
  "apps/web/src/server/dashboard-mutations.ts": 1105,
  "apps/web/src/server/personal-account-composition.ts": 848,
  "apps/web/src/server/personal-canonical-accounts.ts": 1154,
};

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
      // Generated from the authoritative TS parser; checked by exact bundle parity.
      "deploy/self-hosted/conversation-verifier.mjs",
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
  {
    files: ["apps/web/**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
    ignores: [
      "**/*.test.*",
      "**/*.test-*",
      "**/*.spec.*",
      "**/tests/**",
      "**/test-support/**",
      // Third-party components copied as-is.
      "apps/web/app/vendor/**",
    ],
    rules: { "max-lines": ["error", { max: webMaxLines }] },
  },
  ...Object.entries(webMaxLinesCeilings).map(([file, max]) => ({
    files: [file],
    rules: { "max-lines": ["error", { max }] },
  })),
];
