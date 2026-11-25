import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function reviewActionCompanionContractsSource(repositoryRoot) {
  return (
    "// Generated from shared/src/review-action-companion-contracts.ts. Do not edit.\n" +
    (await readFile(
      join(
        repositoryRoot,
        "packages/shared/src/review-action-companion-contracts.ts",
      ),
      "utf8",
    ))
  );
}
