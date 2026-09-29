import { AuthorityError } from "../domain/contracts.js";
import type { AuthenticatedEfExecution } from "./ef-authority-service.js";

export const sdkGrowthSourceBindingKeys = [
  "headRepositoryId",
  "baseRepositoryId",
  "baseRef",
  "baseCommit",
  "baseTree",
  "mergeBaseCommit",
  "mergeBaseTree",
] as const;

export type SdkGrowthSourceBinding = NonNullable<
  AuthenticatedEfExecution["sourceBinding"]
>;

export function parseSdkGrowthSourceBinding(
  value: unknown,
): SdkGrowthSourceBinding {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuthorityError("wrong-identity");
  const row = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(row).length !== sdkGrowthSourceBindingKeys.length ||
    !sdkGrowthSourceBindingKeys.every((key) => Object.hasOwn(row, key))
  )
    throw new AuthorityError("wrong-identity");
  for (const key of ["headRepositoryId", "baseRepositoryId"] as const) {
    const id = row[key];
    if (
      typeof id !== "string" ||
      !/^[1-9][0-9]*$/.test(id) ||
      !Number.isSafeInteger(Number(id))
    )
      throw new AuthorityError("wrong-identity");
  }
  const ref = row.baseRef;
  if (
    typeof ref !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(ref) ||
    ref.includes("..") ||
    ref.includes("//") ||
    ref.endsWith("/") ||
    ref.endsWith(".lock")
  )
    throw new AuthorityError("wrong-identity");
  for (const key of [
    "baseCommit",
    "baseTree",
    "mergeBaseCommit",
    "mergeBaseTree",
  ] as const) {
    if (typeof row[key] !== "string" || !/^[a-f0-9]{40}$/.test(row[key]))
      throw new AuthorityError("wrong-identity");
  }
  return {
    headRepositoryId: row.headRepositoryId as string,
    baseRepositoryId: row.baseRepositoryId as string,
    baseRef: ref,
    baseCommit: row.baseCommit as string,
    baseTree: row.baseTree as string,
    mergeBaseCommit: row.mergeBaseCommit as string,
    mergeBaseTree: row.mergeBaseTree as string,
  };
}

export function executionSourceBinding(
  execution: AuthenticatedEfExecution,
): SdkGrowthSourceBinding | null {
  if (!Object.hasOwn(execution, "sourceBinding")) return null;
  const binding = parseSdkGrowthSourceBinding(execution.sourceBinding);
  if (
    binding.headRepositoryId !== execution.githubRepositoryId ||
    binding.baseRepositoryId !== execution.githubRepositoryId
  )
    throw new AuthorityError("wrong-identity");
  return binding;
}

export function sameSourceBinding(
  stored: unknown,
  execution: AuthenticatedEfExecution,
): boolean {
  const expected = executionSourceBinding(execution);
  if (stored === null || stored === undefined) return expected === null;
  if (expected === null) return false;
  try {
    const observed = parseSdkGrowthSourceBinding(stored);
    return sdkGrowthSourceBindingKeys.every(
      (key) => observed[key] === expected[key],
    );
  } catch (error) {
    if (error instanceof AuthorityError) return false;
    throw error;
  }
}

export function sourceBindingIdentity(
  execution: AuthenticatedEfExecution,
): readonly string[] | null {
  const binding = executionSourceBinding(execution);
  return binding ? sdkGrowthSourceBindingKeys.map((key) => binding[key]) : null;
}
