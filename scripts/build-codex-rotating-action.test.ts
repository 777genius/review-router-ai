import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

describe("Codex rotating Action bundle reproducibility", () => {
  it("normalizes generated wrapper labels without changing source strings or template contents", () => {
    const source = [
      "var require_real = __commonJS({",
      '  "pinned-dependency:real@1.0.0/node_modules/real/index.js"(exports) {',
      '    exports.path = "node_modules/parent/node_modules/real/source.js";',
      "  }",
      "});",
      "var init_other = __esm({",
      '  "node_modules/parent/node_modules/other/index.js"() {}',
      "});",
      "var template = `",
      "var require_fake = __commonJS({",
      '  "pinned-dependency:fake@1.0.0/node_modules/fake/index.js"(exports) {',
      '    exports.path = "pinned-dependency:fake@1.0.0/node_modules/fake/source.js";',
      "  }",
      "});",
      "`;",
    ].join("\n");
    const normalized = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import { readFileSync } from "node:fs"; import { normalizeDependencyWrapperLabels } from "./scripts/lib/codex-rotating-action-build.mjs"; process.stdout.write(normalizeDependencyWrapperLabels(readFileSync(0, "utf8")));',
      ],
      { input: source, encoding: "utf8" },
    );
    expect(normalized).toBe(
      source
        .replace(
          '"pinned-dependency:real@1.0.0/node_modules/real/index.js"',
          '"node_modules/real/index.js"',
        )
        .replace(
          '"node_modules/parent/node_modules/other/index.js"',
          '"node_modules/other/index.js"',
        ),
    );
  });

  it("is byte-identical across clean hoisted and linked-store checkouts without path leakage", () => {
    const sourceRoot = process.cwd();
    const tempRoot = mkdtempSync(
      join(tmpdir(), "reviewrouter-action-reproducibility-"),
    );
    try {
      const checkouts = [
        {
          root: join(tempRoot, "ordinary-clean-checkout"),
          nodeLinker: "hoisted",
        },
        {
          root: join(tempRoot, "differently-named-linked-store-checkout"),
          nodeLinker: "isolated",
        },
      ];

      for (const checkout of checkouts) {
        copyBuildInputs(sourceRoot, checkout.root);
        execFileSync(
          "pnpm",
          [
            "install",
            "--frozen-lockfile",
            "--offline",
            "--ignore-scripts",
            `--node-linker=${checkout.nodeLinker}`,
          ],
          { cwd: checkout.root, stdio: "pipe" },
        );
        copyInstalledSubscriptionRuntime(sourceRoot, checkout.root, tempRoot);
        execFileSync(
          process.execPath,
          ["scripts/build-codex-rotating-action.mjs"],
          { cwd: checkout.root, stdio: "pipe" },
        );
      }

      const bundles = checkouts.map(({ root }) =>
        readFileSync(join(root, "action-dist/index.cjs")),
      );
      const hashes = bundles.map((bundle) =>
        createHash("sha256").update(bundle).digest("hex"),
      );
      expect(hashes[1]).toBe(hashes[0]);

      const committedBundle = readFileSync(
        join(sourceRoot, "action-dist/index.cjs"),
      );
      for (const bundle of bundles) {
        expect(bundle.equals(committedBundle)).toBe(true);
      }

      const firstBundle = bundles[0];
      if (!firstBundle) {
        throw new Error("No Action bundles were produced");
      }
      const bundleText = firstBundle.toString("utf8");
      for (const forbidden of [
        "/var/data",
        "/tmp",
        "node_modules/.pnpm",
        sourceRoot,
        tempRoot,
        ...checkouts.map(({ root }) => root),
      ]) {
        expect(bundleText).not.toContain(forbidden);
      }
      expect(bundleText).toContain("ReviewRouter Action third-party notices");
      expect(bundleText).not.toMatch(/^\/\/ .*node_modules\//mu);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 180_000);
});

function copyBuildInputs(sourceRoot: string, checkoutRoot: string) {
  const trackedFiles = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--",
      "packages/features/codex-oauth-rotating",
      "packages/protocol-review-action-v2",
      "packages/shared",
      "vendor/account-gateway",
    ],
    { cwd: sourceRoot },
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const files = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "scripts/build-codex-rotating-action.mjs",
    "scripts/codex-rotating-action-third-party-licenses.txt",
    "scripts/lib/codex-rotating-action-build.mjs",
    ...trackedFiles,
  ];
  for (const file of files) {
    const target = join(checkoutRoot, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(sourceRoot, file), target);
  }
}

function copyInstalledSubscriptionRuntime(
  sourceRoot: string,
  checkoutRoot: string,
  reproductionRoot: string,
) {
  const source = join(
    sourceRoot,
    "node_modules/@777genius/subscription-runtime",
  );
  const target = join(
    checkoutRoot,
    "node_modules/@777genius/subscription-runtime",
  );
  const targetParent = relative(
    realpathSync(reproductionRoot),
    realpathSync(dirname(target)),
  );
  if (
    targetParent === "" ||
    targetParent === ".." ||
    targetParent.startsWith(`..${sep}`) ||
    isAbsolute(targetParent)
  ) {
    throw new Error(
      "Action runtime target escaped the disposable reproduction root",
    );
  }
  // A cached install may hardlink these files to the source package. Replace
  // only this disposable entry, never its resolved symlink target or the store.
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { dereference: true, recursive: true });
}
