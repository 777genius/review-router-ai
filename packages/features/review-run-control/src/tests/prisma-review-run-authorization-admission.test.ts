import { Prisma, type PrismaClient } from "@prisma/client";
import { isPrismaTransactionConflictError } from "../infrastructure/prisma/prisma-review-run-control-utils";
import { describe, expect, it, vi } from "vitest";
import { ReviewRunAuthorizationCreateStatus } from "../application/ports/review-run-authorization-ports";
import {
  canonicalJson,
  ProducerReleaseState,
  ReviewMutationMode,
} from "../domain/review-run-control-types";
import { PrismaReviewRunAuthorizationRepository } from "../infrastructure/prisma/prisma-review-run-authorization-repository";
import { createReviewRunControlTestKit } from "../testing/review-run-control-test-kit";
import { provisionV2AuthorizationContext } from "./fixtures";

// Execute the production transaction callback without opening a database connection.
describe("Prisma selected-release admission precondition", () => {
  it("recognizes the real Prisma 7 adapter's nested serialization code for Skills fence retries", () => {
    const failure = (originalCode: string) =>
      new Prisma.PrismaClientKnownRequestError("Raw query failed", {
        code: "P2010",
        clientVersion: "7.8.0",
        meta: {
          driverAdapterError: {
            cause: {
              originalCode,
              originalMessage:
                "could not serialize access due to concurrent update",
              kind: "TransactionWriteConflict",
            },
          },
        },
      });
    expect(isPrismaTransactionConflictError(failure("40001"))).toBe(true);
    expect(isPrismaTransactionConflictError(failure("40P01"))).toBe(true);
    expect(isPrismaTransactionConflictError(failure("42501"))).toBe(false);
  });
  it.each(["missing", "revoked", "identity drift", "registered", "unmatched"])(
    "checks the attested base inside the transaction: %s",
    async (state) => {
      const kit = createReviewRunControlTestKit();
      const fixture = await provisionV2AuthorizationContext(kit);
      const admit = vi.spyOn(
        kit.store,
        "createOrRestoreReviewRunAuthorizationAtomically",
      );
      await kit.control.authorizations.authorizeReviewRun(
        fixture.authorizeInput,
      );
      const original = admit.mock.calls[0]![0];
      const expectedBase = {
        ...original.fence.producerRelease,
        producerReleaseId: "attested_base",
      };
      const row = {
        ...expectedBase,
        agentProfilesJson: expectedBase.agentProfiles
          ? JSON.stringify(expectedBase.agentProfiles)
          : null,
        state:
          state === "revoked"
            ? ProducerReleaseState.Revoked
            : ProducerReleaseState.Registered,
        runtimeCommitSha:
          state === "identity drift"
            ? "f".repeat(40)
            : expectedBase.runtimeCommitSha,
        reviewInvestigationCapability: null,
        reviewInvestigationCoverageProfileHash: null,
        reviewInvestigationPolicyHash: null,
      };
      const create = vi.fn();
      const furtherFenceRead = new Error("base_precondition_passed");
      const transaction = {
        $queryRaw: vi.fn(async () => []),
        reviewRunAuthorization: { findUnique: vi.fn(async () => null), create },
        scmRepositoryIdentity: { findUnique: vi.fn(async () => ({})) },
        reviewMutationAuthority: { findUnique: vi.fn(async () => ({})) },
        producerRelease: {
          findUnique: vi.fn(
            async ({ where }: { where: { producerReleaseId: string } }) =>
              where.producerReleaseId === expectedBase.producerReleaseId &&
              state === "missing"
                ? null
                : row,
          ),
        },
        reviewProtocolLimitsV2: {
          findUnique: vi.fn(async () => {
            throw furtherFenceRead;
          }),
        },
      };
      const transact = vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      );
      const repository = new PrismaReviewRunAuthorizationRepository({
        $transaction: transact,
      } as unknown as PrismaClient);
      const result = repository.createOrRestoreReviewRunAuthorizationAtomically(
        {
          candidate: original.candidate,
          fence: {
            ...original.fence,
            ...(state === "unmatched"
              ? {}
              : { expectedBaseProducerRelease: expectedBase }),
          },
        },
      );
      if (state === "registered" || state === "unmatched") {
        // Remaining fence checks still execute; this is not a full admission success mock.
        await expect(result).rejects.toBe(furtherFenceRead);
      } else {
        await expect(result).resolves.toEqual({
          status: ReviewRunAuthorizationCreateStatus.EligibilityChanged,
        });
        expect(
          transaction.reviewProtocolLimitsV2.findUnique,
        ).not.toHaveBeenCalled();
      }
      expect(
        transaction.producerRelease.findUnique.mock.calls.map(
          ([input]) => input.where.producerReleaseId,
        ),
      ).toEqual(
        state === "unmatched"
          ? [original.candidate.producerReleaseId]
          : [
              original.candidate.producerReleaseId,
              expectedBase.producerReleaseId,
            ],
      );
      expect(transact).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: "Serializable",
      });
      expect(create).not.toHaveBeenCalled();
    },
  );
});

/** Execute the production transaction callback and record commit versus rollback.
 * The fake does not convert a false result into rollback: only a thrown failure does. */
async function freshnessFixture(
  expireAt?: "authority" | "authorization" | "outbox",
) {
  const kit = createReviewRunControlTestKit();
  const fixture = await provisionV2AuthorizationContext(kit);
  const admit = vi.spyOn(
    kit.store,
    "createOrRestoreReviewRunAuthorizationAtomically",
  );
  await kit.control.authorizations.authorizeReviewRun(fixture.authorizeInput);
  const original = admit.mock.calls[0]![0];
  const snapshot = canonicalJson({
    snapshotVersion: 3,
    configurationSource: "workspace",
    configurationVersion: 1,
    workspaceConfigurationVersion: 1,
    repositoryConfigurationVersion: null,
    effectivePolicyDigest: `sha256:${"a".repeat(64)}`,
    agent: {
      profileRef: "codex-default",
      agentKind: "codex",
      binarySha256: "a".repeat(64),
      packageVersion: "1.0.0",
      modelTransports: ["account_gateway"],
      contextGateway: true,
      cancellation: true,
    },
    agentProfileDigest: "b".repeat(64),
    producer: {
      producerReleaseId: original.candidate.producerReleaseId,
      actionCommitSha: original.fence.producerRelease.actionCommitSha,
      runtimeCommitSha: original.fence.producerRelease.runtimeCommitSha,
    },
    configurationCanonicalJson: canonicalJson({ schemaVersion: 3 }),
    deadline: original.candidate.maxExpiresAt.toISOString(),
    gateway: {
      providerIndex: 0,
      bindingId: "binding",
      connectionId: "connection",
      bindingRevision: 1,
      policySubject: "binding",
      policyRevision: 1,
      permittedAccountRef: "account",
      profileRef: "profile",
      invocationId: "invocation",
      attemptId: "attempt",
      operationId: "operation",
      limits: {
        requests: 1,
        concurrency: 1,
        requestBytes: 1024,
        outputBytes: 2048,
        tokens: 100,
      },
    },
  });
  const input = {
    ...original,
    candidate: {
      ...original.candidate,
      runtimeSnapshotCanonicalJson: snapshot,
    },
  };
  const release = original.fence.producerRelease;
  let now = 29_999;
  let rollbacks = 0;
  type AuthorizationData = Prisma.ReviewRunAuthorizationUncheckedCreateInput;
  type OutboxData = Prisma.OutboxEventUncheckedCreateInput;
  let committedAuthorizations: AuthorizationData[] = [];
  let committedOutbox: OutboxData[] = [];
  const writes: string[] = [];
  const runtimeFence = vi.fn(async () => true);
  const fresh = vi.fn(() => now < 30_000);
  const transact = async <T>(
    callback: (transaction: unknown) => Promise<T>,
  ) => {
    const authorizations = [...committedAuthorizations];
    const outbox = [...committedOutbox];
    const transaction = {
      $queryRaw: async () => [],
      reviewRunAuthorization: {
        findUnique: async ({
          where,
        }: {
          where: { oidcReplayKeyHash?: string; authorizationId?: string };
        }) =>
          authorizations.find((row) =>
            where.authorizationId
              ? row.authorizationId === where.authorizationId
              : row.oidcReplayKeyHash === where.oidcReplayKeyHash,
          ) ?? null,
        findFirst: async () => authorizations[0] ?? null,
        create: async ({ data }: { data: AuthorizationData }) => {
          writes.push("authorization");
          authorizations.push(data);
          if (expireAt === "authorization") now = 30_000;
          return data;
        },
      },
      outboxEvent: {
        findUnique: async () => outbox[0] ?? null,
        create: async ({ data }: { data: OutboxData }) => {
          writes.push("outbox");
          outbox.push(data);
          if (expireAt === "outbox") now = 30_000;
          return data;
        },
      },
      scmRepositoryIdentity: {
        findUnique: async () => ({
          version: input.fence.repositoryIdentityVersion,
          currentWorkspaceId: input.candidate.workspaceId,
          currentRepositoryConnectionId: input.candidate.repositoryConnectionId,
        }),
      },
      reviewMutationAuthority: {
        findUnique: async () => {
          if (expireAt === "authority") now = 30_000;
          return {
            version: input.fence.mutationAuthorityVersion,
            mode: ReviewMutationMode.V2Active,
            epoch: input.candidate.mutationEpoch,
          };
        },
      },
      producerRelease: {
        findUnique: async () => ({
          ...release,
          agentProfilesJson: release.agentProfiles
            ? JSON.stringify(release.agentProfiles)
            : null,
          reviewInvestigationCapability: null,
          reviewInvestigationCoverageProfileHash: null,
          reviewInvestigationPolicyHash: null,
        }),
      },
      reviewProtocolLimitsV2: {
        findUnique: async () => ({
          limitsDigest: input.fence.protocolLimitsDigest,
        }),
      },
      reviewOperationalSloProfileV2: {
        findUnique: async () => ({
          sloDigest: input.fence.operationalSloDigest,
        }),
      },
      reviewSafetyPolicy: {
        findMany: async () => {
          const versions = input.fence.safetySnapshot.capabilityDecisions.find(
            (decision) => decision.capability === "run_authorization_v2",
          )!.contributingPolicyVersions;
          return versions.map((entry) => {
            const [policyId, version, rolloutMode] = entry.split(":");
            return {
              policyId,
              version: Number(version),
              rolloutMode,
              policyScope: "global",
            };
          });
        },
      },
      reviewSafetyEmergencyControl: {
        findMany: async () => {
          const [emergencyControlId, version, state] =
            input.fence.safetySnapshot.emergencyVersionVector[0]!.split(":");
          return [
            {
              emergencyControlId,
              version: Number(version),
              stopped: state === "stopped",
              policyScope: "global",
              workspaceId: null,
              repositoryConnectionId: null,
              scmRepositoryIdentityId: null,
            },
          ];
        },
      },
    };
    try {
      const result = await callback(transaction);
      committedAuthorizations = authorizations;
      committedOutbox = outbox;
      return result;
    } catch (error) {
      rollbacks++;
      throw error;
    }
  };
  const repository = new PrismaReviewRunAuthorizationRepository(
    { $transaction: transact } as unknown as PrismaClient,
    runtimeFence,
    fresh,
  );
  return {
    repository,
    input,
    fresh,
    runtimeFence,
    writes,
    expire() {
      now = 30_000;
    },
    committed() {
      return {
        authorizations: committedAuthorizations.length,
        outbox: committedOutbox.length,
        rollbacks,
      };
    },
  };
}

it.each(["authority", "authorization", "outbox"] as const)(
  "rolls back the actual admission callback when qualification expires during later %s SQL",
  async (phase) => {
    const f = await freshnessFixture(phase);
    expect(
      await f.repository.createOrRestoreReviewRunAuthorizationAtomically(
        f.input,
      ),
    ).toEqual({
      status: ReviewRunAuthorizationCreateStatus.EligibilityChanged,
    });
    expect(f.runtimeFence).toHaveBeenCalledOnce();
    expect(f.fresh).toHaveBeenCalledOnce();
    expect(f.writes).toEqual(["authorization", "outbox"]);
    expect(f.committed()).toEqual({
      authorizations: 0,
      outbox: 0,
      rollbacks: 1,
    });
  },
);

it("keeps exact persisted replay independent of expired native qualification", async () => {
  const f = await freshnessFixture();
  expect(
    (
      await f.repository.createOrRestoreReviewRunAuthorizationAtomically(
        f.input,
      )
    ).status,
  ).toBe(ReviewRunAuthorizationCreateStatus.Created);
  f.expire();
  expect(
    (
      await f.repository.createOrRestoreReviewRunAuthorizationAtomically(
        f.input,
      )
    ).status,
  ).toBe(ReviewRunAuthorizationCreateStatus.Restored);
  expect(f.runtimeFence).toHaveBeenCalledOnce();
  expect(f.fresh).toHaveBeenCalledOnce();
  expect(f.committed()).toEqual({ authorizations: 1, outbox: 1, rollbacks: 0 });
});

it("keeps legacy admissions without a runtime snapshot outside the native final validator", async () => {
  const f = await freshnessFixture();
  f.expire();
  expect(
    (
      await f.repository.createOrRestoreReviewRunAuthorizationAtomically({
        ...f.input,
        candidate: { ...f.input.candidate, runtimeSnapshotCanonicalJson: null },
      })
    ).status,
  ).toBe(ReviewRunAuthorizationCreateStatus.Created);
  expect(f.runtimeFence).not.toHaveBeenCalled();
  expect(f.fresh).not.toHaveBeenCalled();
  expect(f.committed()).toEqual({ authorizations: 1, outbox: 1, rollbacks: 0 });
});
