import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  collectModuleImportSpecifiers,
  isSyntaxNode,
  parseSourceAst,
  walkSourceAst,
} from "../lib/module-import-specifiers.ts";
import { collectAllSourceFiles, extractImportSpecifiers } from "./sources.ts";
import type { ArchitectureViolation } from "./types.ts";

/**
 * The Action entrypoint composes narrowly owned adapters. New adapter sources
 * must never depend on the entrypoint, and the trusted domain must never
 * acquire imports from the Action transport. Keep this checked as source grows.
 */
export async function checkCodexRuntimeOwnershipBoundaries(
  root: string,
  violations: ArchitectureViolation[],
): Promise<void> {
  const sourceRoot = join(
    root,
    "packages",
    "features",
    "codex-oauth-rotating",
    "src",
  );
  const actionRoot = join(sourceRoot, "action");
  const domainRoot = join(sourceRoot, "domain");
  if (!existsSync(actionRoot) || !existsSync(domainRoot)) return;

  const actionFiles = await collectAllSourceFiles(actionRoot);
  for (const file of actionFiles) {
    if (
      file.endsWith("github-action.ts") ||
      /\.(?:test|spec)\.[cm]?tsx?$/u.test(file)
    ) {
      continue;
    }
    for (const imported of extractImportSpecifiers(
      readFileSync(file, "utf8"),
    )) {
      if (/^\.\/github-action(?:\.(?:js|ts|mts|cts))?$/u.test(imported)) {
        violations.push({
          file,
          imported,
          reason:
            "Action adapters must not import the Action composition entrypoint",
        });
      }
    }
  }

  const domainFiles = await collectAllSourceFiles(domainRoot);
  for (const file of domainFiles) {
    if (/\.(?:test|spec)\.[cm]?tsx?$/u.test(file)) continue;
    const isExtractedWorkflowOwner =
      /(?:^|[\\/])codex-(?:contract|workflow)\.ts$/u.test(file);
    for (const imported of extractImportSpecifiers(
      readFileSync(file, "utf8"),
    )) {
      if (
        imported.startsWith("../action/") ||
        (isExtractedWorkflowOwner &&
          /^\.\/codex-oauth-rotating(?:\.(?:js|ts|mts|cts))?$/u.test(imported))
      ) {
        violations.push({
          file,
          imported,
          reason:
            "Codex domain/workflow owners must not depend on Action adapters or the OAuth facade",
        });
      }
    }
  }
}

/**
 * The post-#818 refactor keeps its read/serialization helpers behind the
 * existing feature store and the pure response mappers behind the API host.
 * Guard only these concrete seams; broader package policy is owned elsewhere.
 */
export async function checkReviewExecutionExtractionBoundaries(
  root: string,
  violations: ArchitectureViolation[],
): Promise<void> {
  const prismaRoot = join(
    root,
    "packages",
    "features",
    "review-executions",
    "src",
    "infrastructure",
    "prisma",
  );
  const adapterFiles = [
    "prisma-review-execution-mappers.ts",
    "prisma-review-execution-snapshot.ts",
  ];
  for (const name of adapterFiles) {
    const file = join(prismaRoot, name);
    if (!existsSync(file)) continue;
    for (const imported of extractImportSpecifiers(
      readFileSync(file, "utf8"),
    )) {
      if (
        /^\.\/prisma-review-execution-store(?:\.[cm]?[jt]s)?$/u.test(
          imported,
        ) ||
        /(?:^|\/)apps\/(?:api|web|worker)\//u.test(imported)
      ) {
        violations.push({
          file,
          imported,
          reason:
            "Review-execution private readers and mappers must not import their store or application hosts",
        });
      }
    }
  }

  const apiMappers = [
    {
      name: "review-action-v2-execution-result-mappers.ts",
      host: "review-action-v2-execution-evidence-composition",
    },
    {
      name: "review-action-v2-context-result-mappers.ts",
      host: "review-action-v2-context-attestation-composition",
    },
  ];
  for (const mapper of apiMappers) {
    const file = join(root, "apps", "api", "src", mapper.name);
    if (!existsSync(file)) continue;
    for (const imported of extractImportSpecifiers(
      readFileSync(file, "utf8"),
    )) {
      if (
        imported === `./${mapper.host}` ||
        imported === `./${mapper.host}.js` ||
        imported === `./${mapper.host}.ts` ||
        /^@prisma\/client(?:\/.*)?$/u.test(imported) ||
        /^@octokit(?:\/.*)?$/u.test(imported) ||
        /^(?:fastify|next)(?:\/.*)?$/u.test(imported)
      ) {
        violations.push({
          file,
          imported,
          reason:
            "Review Action v2 pure result mappers must not import their composition host or infrastructure SDK",
        });
      }
    }
  }
}

export async function checkReleaseRolloutProviderNeutrality(
  root: string,
  violations: ArchitectureViolation[],
): Promise<void> {
  const sourceRoot = join(
    root,
    "packages",
    "features",
    "release-rollout",
    "src",
  );
  if (!existsSync(sourceRoot)) return;
  const neutralBoundaryFiles = (await collectAllSourceFiles(sourceRoot)).filter(
    (file) =>
      !/\.(?:test|spec)\.[cm]?tsx?$/u.test(file) &&
      /(?:^|[\\/])(?:domain|application)[\\/]/u.test(
        relative(sourceRoot, file),
      ) &&
      /(?:service-transition[^/\\]*|transactional-service-cutover)\.[cm]?tsx?$/u.test(
        file,
      ),
  );
  for (const file of neutralBoundaryFiles) {
    const source = readFileSync(file, "utf8");
    if (/\bRender|reviewrouter\.render|api\.render\.com/u.test(source)) {
      violations.push({
        file,
        imported: "Render provider vocabulary",
        reason:
          "release-rollout domain/application contracts must be provider-neutral",
      });
    }
    for (const imported of extractImportSpecifiers(source)) {
      if (/(?:^|\/)adapters(?:\/|$)/u.test(imported)) {
        violations.push({
          file,
          imported,
          reason:
            "release-rollout domain/application must not import provider adapters",
        });
      }
    }
    if (/ghcr\.io\/777genius\/review-router-saas-runtime/iu.test(source)) {
      violations.push({
        file,
        imported: "fixed release image repository",
        reason:
          "release-rollout policy accepts digest-pinned artifacts independently of registry",
      });
    }
  }
}

/** Exact host seams; Foundation separately governs their application and SQL targets. */
export function checkAccountMetadataHostBoundaries(
  root: string,
  violations: ArchitectureViolation[],
): void {
  const files = {
    "account-metadata-service.ts": new Set([
      "node:crypto",
      "@prisma/client",
      "@reviewrouter/features-provider-accounts/account-metadata",
      "@reviewrouter/features-provider-accounts/account-metadata/composition",
      "./account-metadata/authorization",
    ]),
    "account-metadata-sdk-reader.ts": new Set([
      "@agent-teams/account-gateway/http",
      "@agent-teams/account-gateway/contracts",
      "@reviewrouter/features-provider-accounts/account-metadata",
    ]),
  };
  for (const [name, allowed] of Object.entries(files)) {
    const file = join(root, "apps/web/src/server", name);
    if (!existsSync(file)) continue;
    const source = parseSourceAst(file, readFileSync(file, "utf8"));
    function reject(imported: string): void {
      violations.push({
        file,
        imported,
        reason:
          "account metadata host must use only its declared public SDK, composition and authorization seams",
      });
    }
    for (const imported of collectModuleImportSpecifiers(source)) {
      if (!allowed.has(imported)) reject(imported);
    }
    walkSourceAst(source.root, (node) => {
      if (
        node.type === "CallExpression" &&
        isSyntaxNode(node.callee) &&
        node.callee.type === "Identifier" &&
        node.callee.name === "fetch"
      )
        reject("direct fetch");
    });
  }
}
