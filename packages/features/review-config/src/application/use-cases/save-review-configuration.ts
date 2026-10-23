import {
  parseRepositoryReviewPolicyOverride,
  parseReviewConfigurationStrict,
} from "../../domain/review-configuration";
import type { ReviewConfigurationTarget } from "../../domain/review-configuration-target";
import type {
  PersistedReviewConfiguration,
  ReviewConfigurationRepositoryPort,
  ReviewConfigurationOperationInput,
  ReviewConfigurationOperationRepositoryPort,
  ReviewPolicySaveInput,
} from "../ports/review-configuration-repository-port";

export async function saveReviewConfigurationWithOperation(
  input: ReviewConfigurationOperationInput,
  dependencies: {
    readonly configurations: ReviewConfigurationOperationRepositoryPort;
  },
): Promise<PersistedReviewConfiguration> {
  return dependencies.configurations.saveNextVersionWithOperation(
    snapshotReviewConfigurationOperation(input),
  );
}

export async function findReviewConfigurationOperation(
  input: {
    readonly target: ReviewConfigurationTarget;
    readonly operationId: string;
    readonly expectedVersion: number | null;
  },
  dependencies: {
    readonly configurations: ReviewConfigurationOperationRepositoryPort;
  },
): Promise<PersistedReviewConfiguration | null> {
  return dependencies.configurations.findOperation(
    snapshotReviewConfigurationOperationLookup(input),
  );
}

/** Capture original lookup intent before any repository I/O, including direct ingress. */
export function snapshotReviewConfigurationOperationLookup(
  input: Parameters<
    ReviewConfigurationOperationRepositoryPort["findOperation"]
  >[0],
): Parameters<ReviewConfigurationOperationRepositoryPort["findOperation"]>[0] {
  return Object.freeze({
    target: snapshotOperationTarget(input.target),
    operationId: validateReviewConfigurationOperationId(input.operationId),
    expectedVersion: validateReviewConfigurationExpectedVersion(
      input.expectedVersion,
    ),
  });
}

/** Owned, frozen intent before the first await, also used at direct adapter ingress. */
export function snapshotReviewConfigurationOperation(
  input: ReviewConfigurationOperationInput,
): ReviewConfigurationOperationInput {
  const expectedVersion = validateReviewConfigurationExpectedVersion(
    input.expectedVersion,
  );
  const target = snapshotOperationTarget(input.target);
  const common = {
    expectedVersion,
    operationId: validateReviewConfigurationOperationId(input.operationId),
  };
  return freezeOperationIntent(
    target.scope === "workspace"
      ? {
          target,
          policy: parseReviewConfigurationStrict(input.policy),
          ...common,
        }
      : {
          target,
          policy: parseRepositoryReviewPolicyOverride(input.policy),
          ...common,
        },
  );
}

function validateReviewConfigurationExpectedVersion(
  expectedVersion: number | null,
): number | null {
  if (
    expectedVersion !== null &&
    (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
  ) {
    throw new Error("review_configuration_expected_version_invalid");
  }
  return expectedVersion;
}

export function validateReviewConfigurationOperationId(
  operationId: string,
): string {
  if (
    typeof operationId !== "string" ||
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.exec(operationId)?.[0] !== operationId
  ) {
    throw new Error("review_configuration_operation_id_invalid");
  }
  return operationId;
}

function snapshotOperationTarget(
  target: ReviewConfigurationTarget,
): ReviewConfigurationTarget {
  if (
    typeof target.workspaceId !== "string" ||
    !target.workspaceId ||
    (target.scope !== "workspace" && target.scope !== "repository") ||
    (target.scope === "repository" &&
      (typeof target.repositoryId !== "string" || !target.repositoryId))
  ) {
    throw new Error("review_configuration_target_invalid");
  }
  return Object.freeze(
    target.scope === "repository"
      ? {
          scope: target.scope,
          workspaceId: target.workspaceId,
          repositoryId: target.repositoryId,
        }
      : { scope: target.scope, workspaceId: target.workspaceId },
  );
}

function freezeOperationIntent<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeOperationIntent(child);
    Object.freeze(value);
  }
  return value;
}

export async function saveReviewConfiguration(
  input: {
    readonly target: ReviewConfigurationTarget;
    readonly policy: ReviewPolicySaveInput["policy"];
    readonly expectedVersion?: number | null;
  },
  dependencies: {
    readonly configurations: ReviewConfigurationRepositoryPort;
  },
): Promise<PersistedReviewConfiguration> {
  const policy = snapshotPolicy(input.target, input.policy);

  return dependencies.configurations.saveNextVersion({
    target: input.target,
    policy,
    ...(input.expectedVersion !== undefined
      ? { expectedVersion: input.expectedVersion }
      : {}),
  });
}

function snapshotPolicy(
  target: ReviewConfigurationTarget,
  policy: ReviewPolicySaveInput["policy"],
): ReviewPolicySaveInput["policy"] {
  return target.scope === "workspace"
    ? parseReviewConfigurationStrict(policy)
    : parseRepositoryReviewPolicyOverride(policy);
}

export async function findReviewConfiguration(
  target: ReviewConfigurationTarget,
  dependencies: {
    readonly configurations: ReviewConfigurationRepositoryPort;
  },
): Promise<PersistedReviewConfiguration | null> {
  return dependencies.configurations.findLatest(target);
}

export async function clearReviewConfiguration(
  target: ReviewConfigurationTarget & {
    readonly expectedVersion?: number | null;
  },
  dependencies: {
    readonly configurations: ReviewConfigurationRepositoryPort;
  },
): Promise<boolean> {
  return dependencies.configurations.deleteTarget(
    target,
    target.expectedVersion,
  );
}
