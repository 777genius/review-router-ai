import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkApplicationCompositionBoundaries } from "../lib/application-composition-boundaries.ts";
import { collectBoundaryFiles, extractImportSpecifiers } from "./sources.ts";
import { checkReviewActionV2ProtocolBoundaries } from "./action-protocol.ts";
import { checkRevisionAwareReviewRatchet } from "./strict-review-contexts.ts";
import { checkPrismaTransactionQuerySerialization } from "./transaction-serialization.ts";
import {
  checkCodexRuntimeOwnershipBoundaries,
  checkReviewExecutionExtractionBoundaries,
  checkReleaseRolloutProviderNeutrality,
  checkAccountMetadataHostBoundaries,
} from "./feature-seams.ts";
import type {
  ArchitectureCheckResult,
  ArchitectureViolation,
} from "./types.ts";

const forbiddenImports = [
  {
    pattern: /^@prisma\/client(?:\/.*)?$/,
    reason: "Prisma is an infrastructure adapter",
  },
  {
    pattern: /^@octokit(?:\/.*)?$/,
    reason: "Octokit is a GitHub adapter",
  },
  {
    pattern: /^fastify(?:\/.*)?$/,
    reason: "Fastify belongs in API/interface adapters",
  },
  {
    pattern: /^@trpc(?:\/.*)?$/,
    reason: "tRPC belongs in API/interface adapters",
  },
  {
    pattern: /^next(?:\/.*)?$/,
    reason: "Next.js belongs in web/interface adapters",
  },
  {
    pattern: /^next-auth(?:\/.*)?$/,
    reason: "Auth.js belongs behind auth ports",
  },
  {
    pattern: /^@reviewrouter\/protocol-review-action-v2(?:\/.*)?$/,
    reason:
      "generated transport DTOs are allowed only in action-control-plane v2 interface adapters",
  },
];

export async function checkArchitectureBoundaries(
  root: string,
): Promise<ArchitectureCheckResult> {
  const boundaryRoots = [
    join(root, "packages", "features"),
    join(root, "packages", "subscription-runtime"),
  ].filter((directory) => existsSync(directory));
  const files = (
    await Promise.all(
      boundaryRoots.map((directory) =>
        collectBoundaryFiles(directory, directory),
      ),
    )
  ).flat();
  const violations: ArchitectureViolation[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const imported of extractImportSpecifiers(source)) {
      const match = forbiddenImports.find((item) =>
        item.pattern.test(imported),
      );
      if (match) {
        violations.push({ file, imported, reason: match.reason });
      }
    }
  }

  const wrapperSyncPath = join(
    root,
    "scripts",
    "sync-public-action-runtime.mjs",
  );
  if (
    existsSync(wrapperSyncPath) &&
    readFileSync(wrapperSyncPath, "utf8").includes(
      "src/control-plane/generated/review-action-v2",
    )
  ) {
    violations.push({
      file: wrapperSyncPath,
      imported: "src/control-plane/generated/review-action-v2",
      reason:
        "wrapper sync must remain separate from the branch-aware v2 contract handoff",
    });
  }

  await checkReviewActionV2ProtocolBoundaries(root, violations);
  await checkRevisionAwareReviewRatchet(root, violations);
  await checkPrismaTransactionQuerySerialization(root, violations);
  await checkReleaseRolloutProviderNeutrality(root, violations);
  await checkCodexRuntimeOwnershipBoundaries(root, violations);
  await checkReviewExecutionExtractionBoundaries(root, violations);
  checkAccountMetadataHostBoundaries(root, violations);
  violations.push(
    ...(await checkApplicationCompositionBoundaries(
      root,
      extractImportSpecifiers,
    )),
  );

  return { checkedFiles: files.length, violations };
}
