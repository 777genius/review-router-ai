import { describe, expect, it } from "vitest";
import { createPrismaClient } from "@reviewrouter/platform-db";
import { PrismaProviderAccountRepository } from "@reviewrouter/features-provider-accounts";
import {
  parseReviewConfigurationStrict,
  PrismaReviewConfigurationRepository,
  saveReviewConfiguration,
  safeDefaultReviewConfiguration,
} from "@reviewrouter/features-review-config";
import {
  ManageReviewRunAuthorizations,
  canonicalJson,
  parseReviewRunRuntimeSnapshot,
  ReviewRunAuthorizationUseCaseStatus,
  type ReviewRunAuthorization,
  type ReviewRunRuntimeSnapshotPort,
} from "@reviewrouter/features-review-run-control";
import { createReviewActionV2E2EHarness } from "../../../scripts/review-action-v2-production-e2e/support/review-action-v2-e2e-harness";
import { composeReviewActionV2ProductionRunControl } from "./review-action-v2-production-composition";
import {
  ProductionReviewRunRuntimeSnapshot,
  reviewRunGatewayPreparationIdentity,
} from "./review-run-runtime-snapshot";

const enabled = process.env.RR_C2C_PG_TEST === "1";
function disposableDatabase(): string {
  const raw = process.env.RR_C2C_PG_TEST_URL ?? "";
  const url = new URL(raw);
  if (
    process.env.RR_C2C_MIGRATED_DISPOSABLE_DATABASE !== "1" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !/^rr_gateway_test_c2c_[a-z0-9_]+$/.test(url.pathname.slice(1)) ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "c2c_explicit_migrated_disposable_loopback_database_required",
    );
  }
  return raw;
}

// Regressions named before the test: first-admission winner + immutable settings;
// strict stored provider rows cannot be silently deduplicated at admission;
// settings switching to another live binding cannot replace or un-revoke the original;
// settings/binding races fenced at INSERT; original revoke/foreign owner denial;
// a live original-binding read that crosses the original deadline still denies;
// negotiation/new-token/new-ID cannot produce another admitted allowance identity.
// This is real RR PostgreSQL + existing synthetic OIDC/SCM fixture, no Gateway effect.
describe.skipIf(!enabled)("C2c actual first-admission runtime pin", () => {
  it("retains one original across competing admissions, settings and revocation", async () => {
    const databaseUrl = disposableDatabase();
    const harness = await createReviewActionV2E2EHarness(databaseUrl);
    const fresh = createPrismaClient({ databaseUrl, poolMax: 4 });
    try {
      const { prisma, workspaceId, repositoryConnectionId } = harness;
      const accounts = new PrismaProviderAccountRepository(prisma);
      const connection = await prisma.providerAccountConnection.create({
        data: {
          ownerWorkspaceId: workspaceId,
          gatewayAccountRef: `${harness.prefix}-account`,
          profileRef: "mimo-responses-v1",
          displayName: "Synthetic account",
          state: "active",
        },
      });
      const binding = await accounts.compareAndSetBinding({
        workspaceId,
        connectionId: connection.id,
        expectedRevision: 0,
        state: "active",
      });
      const configurations = new PrismaReviewConfigurationRepository(prisma);
      const target = {
        scope: "repository" as const,
        workspaceId,
        repositoryId: repositoryConnectionId,
      };
      const config = parseReviewConfigurationStrict({
        ...safeDefaultReviewConfiguration,
        providers: [
          {
            kind: "codex",
            authMode: "codex_account_gateway",
            model: "mimo-v2-pro",
            reasoningEffort: "high",
            fastMode: false,
            agenticContext: true,
            gatewayBindingId: binding.id,
            gatewayProfileRef: connection.profileRef,
          },
        ],
      });
      await saveReviewConfiguration(
        { target, config, expectedVersion: null },
        { configurations },
      );
      // The legacy reader deduplicates these rows; first admission must reject
      // them through the shared strict parser before creating any authorization.
      const providerRow =
        await prisma.reviewConfigurationVersionProvider.findFirstOrThrow({
          where: {
            workspaceId,
            configurationVersion: {
              configuration: {
                targetKey: `repo:${repositoryConnectionId}`,
              },
            },
          },
        });
      const duplicate = await prisma.reviewConfigurationVersionProvider.create({
        data: {
          ...providerRow,
          id: `${harness.prefix}-duplicate-provider`,
          order: providerRow.order + 1,
        },
      });
      await expect(harness.authorize()).rejects.toThrow();
      expect(
        await prisma.reviewRunAuthorization.count({
          where: { repositoryConnectionId },
        }),
      ).toBe(0);
      await prisma.reviewConfigurationVersionProvider.delete({
        where: { id: duplicate.id },
      });
      const contenders = await Promise.allSettled([
        harness.authorize(),
        harness.authorize(),
      ]);
      const winner = contenders.find((result) => result.status === "fulfilled");
      if (!winner || winner.status !== "fulfilled")
        throw new Error("c2c_first_admission_failed");
      const first = winner.value;
      const row = await fresh.reviewRunAuthorization.findUniqueOrThrow({
        where: { authorizationId: first.authorizationId },
      });
      const pin = parseReviewRunRuntimeSnapshot(
        row.runtimeSnapshotCanonicalJson,
      )!;
      expect(pin.configurationSource).toBe("repository");
      expect(pin.configurationVersion).toBe(1);
      expect(
        parseReviewConfigurationStrict(
          JSON.parse(pin.configurationCanonicalJson),
        ).providers[0]?.model,
      ).toBe("mimo-v2-pro");
      expect(pin.gateway?.permittedAccountRef).toBe(
        connection.gatewayAccountRef,
      );
      expect(pin.gateway?.bindingRevision).toBe(binding.revision);
      expect(pin.gateway?.policyRevision).toBe(binding.policyRevision);
      expect(
        await prisma.reviewRunAuthorization.count({
          where: {
            repositoryConnectionId,
            sourceRunId: row.sourceRunId,
            sourceRunAttempt: row.sourceRunAttempt,
          },
        }),
      ).toBe(1);
      expect(
        await prisma.outboxEvent.count({
          where: {
            aggregateId: first.authorizationId,
            type: "review.run.authorized",
          },
        }),
      ).toBe(1);
      const replay = await harness.authorize(); // New verified OIDC nonce, same owned tuple.
      expect(replay.authorizationId).toBe(first.authorizationId);
      const replacement = await prisma.providerAccountConnection.create({
        data: {
          ownerWorkspaceId: workspaceId,
          gatewayAccountRef: `${harness.prefix}-replacement-account`,
          profileRef: connection.profileRef,
          displayName: "Synthetic replacement account",
          state: "active",
        },
      });
      const replacementBinding = await accounts.compareAndSetBinding({
        workspaceId,
        connectionId: replacement.id,
        expectedRevision: 0,
        state: "active",
      });
      const changed = parseReviewConfigurationStrict({
        ...config,
        providers: [
          {
            ...config.providers[0]!,
            model: "mimo-v2-flash",
            reasoningEffort: "low",
            gatewayBindingId: replacementBinding.id,
          },
        ],
      });
      await saveReviewConfiguration(
        { target, config: changed, expectedVersion: 1 },
        { configurations },
      );
      expect((await harness.authorize()).authorizationId).toBe(
        first.authorizationId,
      );
      const reread = await fresh.reviewRunAuthorization.findUniqueOrThrow({
        where: { authorizationId: first.authorizationId },
      });
      expect(reread.runtimeSnapshotCanonicalJson).toBe(
        row.runtimeSnapshotCanonicalJson,
      );
      expect(reread.version).toBe(row.version);
      // Existing real private use case/repositories; no policy or publication bypass.
      const production = composeReviewActionV2ProductionRunControl({
        env: harness.env,
        prisma,
      });
      const original =
        await production.repositories.authorizations.findReviewRunAuthorizationById(
          first.authorizationId,
        );
      if (!original) throw new Error("c2c_original_missing");
      const input = (authorization: ReviewRunAuthorization) => ({
        verifiedIdentity: authorization,
        producerReleaseId: authorization.producerReleaseId,
        protocolOfferHash: authorization.protocolOfferHash,
        oidcReplayKeyHash: authorization.oidcReplayKeyHash,
        providerVoteLanes: authorization.providerVoteLanes,
        authorizationTtlMs: 60_000,
        maxAuthorizationLifetimeMs: 3_600_000,
      });
      const renewed =
        await production.runControl.authorizations.renewReviewRunAuthorization({
          authorizationId: original.authorizationId,
          verifiedIdentity: original,
          renewalReplayKeyHash: "a".repeat(64),
          requestedTtlMs: 1,
        });
      if (!("authorization" in renewed)) throw new Error("c2c_renewal_failed");
      expect(renewed.authorization.runtimeSnapshotCanonicalJson).toBe(
        row.runtimeSnapshotCanonicalJson,
      );
      expect(renewed.authorization.maxExpiresAt).toEqual(original.maxExpiresAt);
      expect(renewed.authorization.version).toBe(original.version);
      expect(
        (
          await production.runControl.authorizations.authorizeReviewRun({
            ...input(original),
            protocolOfferHash: "f".repeat(64),
            oidcReplayKeyHash: "e".repeat(64),
          })
        ).status,
      ).toBe(ReviewRunAuthorizationUseCaseStatus.Conflict);
      expect(
        (
          await production.runControl.authorizations.authorizeReviewRun({
            ...input(original),
            oidcReplayKeyHash: "d".repeat(64),
            verifiedIdentity: { ...original, headSha: "9".repeat(40) },
          })
        ).status,
      ).toBe(ReviewRunAuthorizationUseCaseStatus.Conflict);
      expect(
        await prisma.reviewRunAuthorization.count({
          where: { repositoryConnectionId },
        }),
      ).toBe(1);
      expect(
        reviewRunGatewayPreparationIdentity({
          ...original,
          sourceRunAttempt: "2",
        }).invocationId,
      ).toBe(pin.gateway?.invocationId);
      expect(
        reviewRunGatewayPreparationIdentity({
          ...original,
          sourceRunAttempt: "2",
        }).attemptId,
      ).not.toBe(pin.gateway?.attemptId);
      // The DB rejects retroactive pinning/replacement, independent of RR call paths.
      await expect(
        prisma.reviewRunAuthorization.update({
          where: { authorizationId: original.authorizationId },
          data: {
            runtimeSnapshotCanonicalJson: canonicalJson({
              ...pin,
              configurationVersion: 99,
            }),
          },
        }),
      ).rejects.toThrow();
      const snapshotSource = new ProductionReviewRunRuntimeSnapshot(prisma);
      const deniedAfterDeadline = await snapshotSource.isLive({
        snapshot: pin,
        identity: original,
        now: new Date(pin.deadline),
      });
      expect(deniedAfterDeadline).toBe(false);
      const foreign = await prisma.workspace.create({
        data: {
          slug: `${harness.prefix}-foreign`,
          name: "Synthetic foreign workspace",
        },
      });
      await expect(
        prisma.providerAccountConnection.update({
          where: { id: connection.id },
          data: { ownerWorkspaceId: foreign.id },
        }),
      ).rejects.toThrow("provider_account_owner_immutable");
      expect(
        await snapshotSource.isLive({
          snapshot: pin,
          identity: { ...original, workspaceId: foreign.id },
          now: production.clock.now(),
        }),
      ).toBe(false);
      expect(
        await prisma.reviewRunAuthorization.count({
          where: { repositoryConnectionId },
        }),
      ).toBe(1);
      expect(
        (
          await prisma.providerAccountConnection.findUniqueOrThrow({
            where: { id: connection.id },
          })
        ).ownerWorkspaceId,
      ).toBe(workspaceId);

      // Actual read/CAS/INSERT race: mutate the already captured config before the
      // existing atomic repository runs. No test-only production hook is added.
      let observedNow = production.clock.now();
      let crossDeadlineDuringBindingRead = false;
      const runtimePort: ReviewRunRuntimeSnapshotPort = {
        capture: async (captureInput) => {
          const captured = await snapshotSource.capture(captureInput);
          await saveReviewConfiguration(
            { target, config, expectedVersion: 2 },
            { configurations },
          );
          return captured;
        },
        isLive: async (liveInput) => {
          const live = await snapshotSource.isLive(liveInput);
          if (crossDeadlineDuringBindingRead)
            observedNow = new Date(liveInput.snapshot.deadline);
          return live;
        },
      };
      const control = new ManageReviewRunAuthorizations({
        runtimeSnapshots: runtimePort,
        clock: { now: () => observedNow },
        digest: production.digest,
        identifiers: { nextId: () => `${harness.prefix}-fenced-admission` },
        identities: production.repositories.repositoryIdentities,
        authorities: production.repositories.mutationAuthorities,
        releases: production.repositories.producerReleases,
        limits: production.repositories.producerReleases,
        slos: production.repositories.producerReleases,
        safetyDecisions: production.runControl.safetyResolver,
        authorizationQueries: production.repositories.authorizations,
        authorizationCommands: production.repositories.authorizations,
        tokens: production.prerequisites.tokens,
      });
      expect(
        (
          await control.authorizeReviewRun({
            ...input(original),
            verifiedIdentity: { ...original, sourceRunAttempt: "3" },
            oidcReplayKeyHash: "c".repeat(64),
          })
        ).status,
      ).toBe(ReviewRunAuthorizationUseCaseStatus.Denied);
      expect(
        await prisma.reviewRunAuthorization.count({
          where: { repositoryConnectionId },
        }),
      ).toBe(1);
      crossDeadlineDuringBindingRead = true;
      expect(
        (
          await control.resolveReviewRunAuthorizationToken({
            token: first.authorizationToken,
          })
        ).status,
      ).toBe("revoked");
      crossDeadlineDuringBindingRead = false;
      observedNow = production.clock.now();
      await accounts.compareAndSetBinding({
        workspaceId,
        connectionId: connection.id,
        expectedRevision: binding.revision,
        state: "revoked",
      });
      await expect(harness.authorize()).rejects.toThrow();
      await expect(
        harness.authorize({ sourceRunAttempt: "4" }),
      ).rejects.toThrow();
      // Current configuration now points to a different live account, but replay,
      // renewal and token resolution must still honor the original revocation.
      await saveReviewConfiguration(
        { target, config: changed, expectedVersion: 3 },
        { configurations },
      );
      expect(
        (
          await snapshotSource.capture({
            identity: original,
            deadline: original.maxExpiresAt,
          })
        )?.gateway?.bindingId,
      ).toBe(replacementBinding.id);
      await expect(harness.authorize()).rejects.toThrow();
      expect(
        (
          await production.runControl.authorizations.resolveReviewRunAuthorizationToken(
            {
              token: first.authorizationToken,
            },
          )
        ).status,
      ).toBe("revoked");
      expect(
        (
          await production.runControl.authorizations.renewReviewRunAuthorization(
            {
              authorizationId: first.authorizationId,
              verifiedIdentity: original,
              renewalReplayKeyHash: "b".repeat(64),
              requestedTtlMs: 60_000,
            },
          )
        ).status,
      ).toBe(ReviewRunAuthorizationUseCaseStatus.Denied);
      const unchanged = await fresh.reviewRunAuthorization.findUniqueOrThrow({
        where: { authorizationId: first.authorizationId },
      });
      expect(unchanged.runtimeSnapshotCanonicalJson).toBe(
        row.runtimeSnapshotCanonicalJson,
      );
      expect(unchanged.version).toBe(row.version);
      expect(
        await prisma.reviewRunAuthorization.count({
          where: { repositoryConnectionId },
        }),
      ).toBe(1);
    } finally {
      await fresh.$disconnect();
      await harness.close();
    }
  }, 60_000);
});
