import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  collectAllSourceFiles,
  extractImportSpecifiers,
  record,
} from "./sources.ts";
import type { ArchitectureViolation } from "./types.ts";

type StrictReviewContext = Readonly<{
  name: string;
  packageRoot: string;
  sourceRoot: string;
  requiredExports: readonly string[] | null;
  rootIndex: string | null;
}>;

export async function checkRevisionAwareReviewRatchet(
  root: string,
  violations: ArchitectureViolation[],
): Promise<void> {
  const contexts: StrictReviewContext[] = [
    strictContext(root, "review-context-attestation", true),
    strictContext(root, "review-investigation-operations", false),
    strictContext(root, "review-investigations", true),
    strictContext(root, "review-run-control", true),
    strictContext(root, "review-evidence", true),
    strictContext(root, "review-executions", true),
    strictContext(root, "review-processes", false),
    strictContext(root, "review-statistics", false),
    strictV2Context(root, "review-publishing"),
    strictV2Context(root, "review-snapshots"),
    {
      name: "signed-capabilities",
      packageRoot: join(root, "packages", "platform", "signed-capabilities"),
      sourceRoot: join(
        root,
        "packages",
        "platform",
        "signed-capabilities",
        "src",
      ),
      requiredExports: null,
      rootIndex: null,
    },
  ];

  for (const context of contexts) {
    if (!existsSync(context.sourceRoot)) continue;
    const sourceFiles = await collectAllSourceFiles(context.sourceRoot);
    for (const file of sourceFiles) {
      const source = readFileSync(file, "utf8");
      const layer = strictLayer(file, context.sourceRoot);
      for (const imported of extractImportSpecifiers(source)) {
        if (imported.startsWith("@reviewrouter/features-")) {
          violations.push({
            file,
            imported,
            reason:
              "strict review contexts communicate through consuming ports, Published Language, or app composition adapters",
          });
        }
        if (imported.startsWith(".")) {
          const resolved = new URL(imported, `file://${file}`).pathname;
          if (!isInside(resolved, context.sourceRoot)) {
            violations.push({
              file,
              imported,
              reason:
                "strict context relative imports cannot escape its source root",
            });
          }
          if (
            layer === "domain" &&
            !isInside(resolved, join(context.sourceRoot, "domain"))
          ) {
            violations.push({
              file,
              imported,
              reason: "strict domain code may depend only on its own domain",
            });
          }
          if (
            layer === "application" &&
            !isInside(resolved, join(context.sourceRoot, "domain")) &&
            !isInside(resolved, join(context.sourceRoot, "application"))
          ) {
            violations.push({
              file,
              imported,
              reason:
                "strict application code may depend only on its own domain and application ports/use cases",
            });
          }
          continue;
        }
        if (
          layer &&
          imported !== "@reviewrouter/shared" &&
          !imported.startsWith("@reviewrouter/shared/")
        ) {
          violations.push({
            file,
            imported,
            reason:
              "strict domain/application code cannot import frameworks, validation libraries, Node adapters, or another package",
          });
        }
      }

      if (
        layer &&
        /\bas\s+[A-Z][A-Za-z0-9]*(?:Kind|State|Type|Status|Reason|Mode|Capability|Outcome)\b/.test(
          source,
        )
      ) {
        violations.push({
          file,
          imported: "enum assertion cast",
          reason:
            "strict domain enums require an exhaustive anti-corruption mapper, not an assertion cast",
        });
      }
      if (
        layer &&
        /export\s+type\s+[A-Za-z0-9]*(?:Kind|State|Type|Status|Reason|Mode|Outcome)\s*=\s*["'][^"']+["']\s*\|/.test(
          source,
        )
      ) {
        violations.push({
          file,
          imported: "string-union discriminator",
          reason: "new domain/application discriminators must be strict enums",
        });
      }
    }

    if (context.requiredExports) {
      checkRequiredExportMap(context, violations);
    }
    if (context.rootIndex && existsSync(context.rootIndex)) {
      for (const imported of extractImportSpecifiers(
        readFileSync(context.rootIndex, "utf8"),
      )) {
        if (
          /(?:^|\/)(?:infrastructure|interface|composition|testing|contract-source)(?:\/|$)/.test(
            imported,
          )
        ) {
          violations.push({
            file: context.rootIndex,
            imported,
            reason:
              "strict package root exports only domain identifiers and application commands/ports",
          });
        }
      }
    }

    const contractSourceRoot = join(context.sourceRoot, "contract-source");
    if (existsSync(contractSourceRoot)) {
      for (const file of await collectAllSourceFiles(contractSourceRoot)) {
        const source = readFileSync(file, "utf8");
        for (const imported of extractImportSpecifiers(source)) {
          if (!imported.startsWith(".")) {
            violations.push({
              file,
              imported,
              reason:
                "contract-source may use only declarative local domain/canonicalizer input",
            });
          }
        }
        if (/\b(?:process|fetch|Deno|Bun)\b|node:/.test(source)) {
          violations.push({
            file,
            imported: "side effect or runtime dependency",
            reason: "contract-source must remain deterministic and I/O-free",
          });
        }
      }
    }
  }

  for (const legacy of ["review-publishing", "review-snapshots"]) {
    const legacyIndex = join(
      root,
      "packages",
      "features",
      legacy,
      "src",
      "index.ts",
    );
    if (
      existsSync(legacyIndex) &&
      readFileSync(legacyIndex, "utf8").includes("/v2")
    ) {
      violations.push({
        file: legacyIndex,
        imported: "v2",
        reason: "legacy package root must not re-export v2 symbols",
      });
    }
  }
}

function strictContext(
  root: string,
  name: string,
  protocolFacing: boolean,
): StrictReviewContext {
  const packageRoot = join(root, "packages", "features", name);
  return {
    name,
    packageRoot,
    sourceRoot: join(packageRoot, "src"),
    requiredExports: protocolFacing
      ? [".", "./composition", "./contract-source", "./testing"]
      : [".", "./composition", "./testing"],
    rootIndex: join(packageRoot, "src", "index.ts"),
  };
}

function strictV2Context(root: string, name: string): StrictReviewContext {
  const packageRoot = join(root, "packages", "features", name);
  return {
    name,
    packageRoot,
    sourceRoot: join(packageRoot, "src", "v2"),
    requiredExports: [
      ".",
      "./v2",
      "./v2/composition",
      "./v2/contract-source",
      "./v2/testing",
    ],
    rootIndex: join(packageRoot, "src", "v2", "index.ts"),
  };
}

function strictLayer(
  file: string,
  sourceRoot: string,
): "domain" | "application" | null {
  const first = relative(sourceRoot, file).split(/[\\/]/)[0];
  return first === "domain" || first === "application" ? first : null;
}

function isInside(candidate: string, directory: string): boolean {
  const path = relative(directory, candidate);
  return path === "" || (!path.startsWith("..") && !path.startsWith("/"));
}

function checkRequiredExportMap(
  context: StrictReviewContext,
  violations: ArchitectureViolation[],
): void {
  const packageJsonPath = join(context.packageRoot, "package.json");
  if (!existsSync(packageJsonPath)) return;
  const packageJson: unknown = JSON.parse(
    readFileSync(packageJsonPath, "utf8"),
  );
  const actual = Object.keys(record(record(packageJson)?.exports) ?? {}).sort();
  const expected = [...(context.requiredExports ?? [])].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    violations.push({
      file: packageJsonPath,
      imported: actual.join(","),
      reason: `${context.name} export map must be exactly ${expected.join(",")}`,
    });
  }
}
