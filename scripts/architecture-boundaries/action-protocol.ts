import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  collectModuleImportSpecifiers,
  isSyntaxNode,
  parseSourceAst,
} from "../lib/module-import-specifiers.ts";
import {
  collectAllSourceFiles,
  extractImportSpecifiers,
  record,
} from "./sources.ts";
import type { ArchitectureViolation } from "./types.ts";

export async function checkReviewActionV2ProtocolBoundaries(
  root: string,
  violations: ArchitectureViolation[],
): Promise<void> {
  const protocolPackageRoot = join(
    root,
    "packages",
    "protocol-review-action-v2",
  );
  const actionControlPlaneRoot = join(
    root,
    "packages",
    "features",
    "action-control-plane",
  );
  if (!existsSync(protocolPackageRoot)) {
    return;
  }

  const featureFiles = await collectAllSourceFiles(
    join(root, "packages", "features"),
  );
  for (const file of featureFiles) {
    const source = readFileSync(file, "utf8");
    const repositoryPath = relative(root, file).replaceAll("\\", "/");
    for (const imported of extractImportSpecifiers(source, file)) {
      if (
        /^@reviewrouter\/protocol-review-action-v2(?:\/.*)?$/.test(imported) &&
        // These exact adapters/fixtures attest the canonical transport contract.
        ![
          "packages/features/codex-oauth-rotating/src/action/provider-usage-delivery.ts",
          "packages/features/codex-oauth-rotating/src/action/provider-usage-responses.ts",
          "packages/features/codex-oauth-rotating/src/tests/provider-usage-bootstrap.test.ts",
          "packages/features/workflow-provisioning/src/infrastructure/review-v2-mutation-proof-facts.ts",
          "packages/features/workflow-provisioning/src/tests/gateway-review-v2-provisioning.test.ts",
          "packages/features/workflow-provisioning/src/tests/installed-gateway-review-confirmation.postgres.test.ts",
        ].includes(repositoryPath) &&
        !repositoryPath.startsWith(
          "packages/features/action-control-plane/src/v2/interface/",
        ) &&
        !repositoryPath.startsWith(
          "packages/features/action-control-plane/src/tests/",
        ) &&
        // The hosted Action is the client-side v2 transport boundary. Keep
        // generated DTOs out of its domain/application and legacy paths.
        !/^packages\/features\/codex-oauth-rotating\/src\/action\/hosted-v4-[\w-]+\.ts$/.test(
          repositoryPath,
        ) &&
        !/^packages\/features\/codex-oauth-rotating\/src\/tests\/hosted-v4-[\w-]+\.test\.ts$/.test(
          repositoryPath,
        )
      ) {
        violations.push({
          file,
          imported,
          reason:
            "generated Review Action v2 protocol is only consumed by v2 server or hosted Action transport interfaces",
        });
      }
    }
  }

  const protocolFiles = await collectAllSourceFiles(
    join(protocolPackageRoot, "src"),
  );
  for (const file of protocolFiles) {
    for (const imported of extractImportSpecifiers(
      readFileSync(file, "utf8"),
      file,
    )) {
      if (imported.startsWith("@reviewrouter/features-")) {
        violations.push({
          file,
          imported,
          reason:
            "generated protocol packages cannot depend on feature packages",
        });
      }
    }
  }

  const contractSourcePath = join(
    actionControlPlaneRoot,
    "src",
    "v2",
    "contract-source",
    "index.ts",
  );
  if (existsSync(contractSourcePath)) {
    const source = readFileSync(contractSourcePath, "utf8");
    if (
      extractImportSpecifiers(source, contractSourcePath).size > 0 ||
      /\b(?:process|fetch|Deno|Bun)\b|node:/.test(source)
    ) {
      violations.push({
        file: contractSourcePath,
        imported: "side effect or runtime dependency",
        reason: "contract-source must remain declarative and side-effect-free",
      });
    }
  }

  const packageJson: unknown = JSON.parse(
    readFileSync(join(actionControlPlaneRoot, "package.json"), "utf8"),
  );
  const packageExports = record(record(packageJson)?.exports);
  const oidcExport = record(packageExports?.["./oidc"]);
  if (
    !oidcExport ||
    Object.keys(oidcExport).sort().join(",") !== "default,production,types" ||
    oidcExport.types !== "./src/oidc.ts" ||
    oidcExport.default !== "./src/oidc.ts" ||
    oidcExport.production !== "./dist/oidc.js"
  ) {
    violations.push({
      file: join(actionControlPlaneRoot, "package.json"),
      imported: "./oidc",
      reason:
        "the OIDC subpath must target the isolated reviewed verifier adapter",
    });
  }
  const publicExports = Object.keys(packageExports ?? {}).sort();
  const expectedExports = [
    ".",
    "./conflict-runtime-contract",
    "./oidc",
    "./v2",
    "./v2/contract-source",
  ];
  if (JSON.stringify(publicExports) !== JSON.stringify(expectedExports)) {
    violations.push({
      file: join(actionControlPlaneRoot, "package.json"),
      imported: publicExports.join(","),
      reason:
        "action-control-plane exports must keep only the v1 root and reviewed oidc, v2 interface, contract-source and conflict-runtime domain subpaths",
    });
  }
  await checkActionConflictRuntimePublishedContract(
    root,
    actionControlPlaneRoot,
    packageJson,
    violations,
  );
}

/**
 * This is a published-language seam, not an alternative eager feature root.
 * Keep both the conditional exports and the re-export declarations exact.
 * No extra import or adapter symbol can be made available to domain consumers.
 */
async function checkActionConflictRuntimePublishedContract(
  root: string,
  actionControlPlaneRoot: string,
  packageJson: unknown,
  violations: ArchitectureViolation[],
): Promise<void> {
  const facade = join(
    actionControlPlaneRoot,
    "src",
    "conflict-runtime-contract.ts",
  );
  const condition = record(record(packageJson)?.exports)?.[
    "./conflict-runtime-contract"
  ];
  const expectedCondition = {
    types: "./src/conflict-runtime-contract.ts",
    production: "./dist/conflict-runtime-contract.js",
    default: "./src/conflict-runtime-contract.ts",
  };
  if (
    !condition ||
    JSON.stringify(condition) !== JSON.stringify(expectedCondition)
  ) {
    violations.push({
      file: join(actionControlPlaneRoot, "package.json"),
      imported: "./conflict-runtime-contract",
      reason:
        "conflict-runtime domain contract must have exact source, types and production exports",
    });
  }
  if (!existsSync(facade)) {
    violations.push({
      file: facade,
      imported: "missing contract",
      reason:
        "conflict-runtime needs an explicit pure published domain contract",
    });
  } else {
    const source = parseSourceAst(facade, readFileSync(facade, "utf8"));
    const statements: unknown[] = Array.isArray(source.root.body)
      ? source.root.body
      : [];
    const exports = statements.map((statement) => {
      if (
        !isSyntaxNode(statement) ||
        statement.type !== "ExportNamedDeclaration" ||
        !isSyntaxNode(statement.source) ||
        typeof statement.source.value !== "string" ||
        !Array.isArray(statement.specifiers)
      )
        return null;
      return {
        from: statement.source.value,
        typeOnly: statement.exportKind === "type",
        names: statement.specifiers.map((element: unknown) => {
          if (
            !isSyntaxNode(element) ||
            !isSyntaxNode(element.exported) ||
            !isSyntaxNode(element.local)
          )
            return null;
          return {
            name: element.exported.name ?? element.exported.value,
            source: element.local.name ?? element.local.value,
            typeOnly: element.exportKind === "type",
          };
        }),
      };
    });
    const expected = [
      {
        from: "./domain/conflict-review-runtime-contract.js",
        typeOnly: false,
        names: [
          "actionConflictReviewRuntimeConfigSchema",
          "conflictReviewAdvisoryStatusContext",
          "conflictReviewSummaryMaxBytes",
        ].map((name) => ({ name, source: name, typeOnly: false })),
      },
      {
        from: "./domain/conflict-review-runtime-contract.js",
        typeOnly: true,
        names: [
          {
            name: "ActionConflictReviewRuntimeConfig",
            source: "ActionConflictReviewRuntimeConfig",
            typeOnly: false,
          },
        ],
      },
    ];
    if (
      source.errors.length > 0 ||
      JSON.stringify(exports) !== JSON.stringify(expected)
    ) {
      violations.push({
        file: facade,
        imported: "contract statements",
        reason:
          "conflict-runtime needs an explicit pure published domain contract; no adapters, aliases or extra exports",
      });
    }
  }

  const owned = join(
    actionControlPlaneRoot,
    "src/domain/conflict-review-runtime-contract.ts",
  );
  if (!existsSync(owned)) {
    violations.push({
      file: owned,
      imported: "missing domain owner",
      reason:
        "conflict-runtime published contract needs its standalone domain owner",
    });
  } else {
    const source = parseSourceAst(owned, readFileSync(owned, "utf8"));
    for (const imported of collectModuleImportSpecifiers(source)) {
      if (imported !== "zod" && imported !== "@reviewrouter/shared") {
        violations.push({
          file: owned,
          imported,
          reason:
            "conflict-runtime domain contract may depend only on zod and shared validation",
        });
      }
    }
  }

  const conflictSource = join(root, "packages/features/conflict-runtime/src");
  if (existsSync(conflictSource)) {
    const allowedLegacyAdapters = new Set([
      "infrastructure/action-control-plane-runtime-config-client.ts",
      "infrastructure/github-actions-oidc-token-provider.ts",
    ]);
    for (const file of await collectAllSourceFiles(conflictSource)) {
      const relativePath = relative(conflictSource, file).replaceAll("\\", "/");
      if (allowedLegacyAdapters.has(relativePath)) continue;
      const source = parseSourceAst(file, readFileSync(file, "utf8"));
      const imports = collectModuleImportSpecifiers(source);
      if (
        imports.has("@reviewrouter/features-action-control-plane") ||
        imports.has("computed module import")
      ) {
        violations.push({
          file,
          imported: imports.has("computed module import")
            ? "computed module import"
            : "@reviewrouter/features-action-control-plane",
          reason:
            "conflict-runtime must use statically known narrow published contracts rather than the eager Action root",
        });
      }
    }
  }
}
