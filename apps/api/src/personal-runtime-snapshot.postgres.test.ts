import {
  systemPolicyWriteFixture,
  workspacePolicyFixture,
  workspaceProviderFixture,
} from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import { parseReviewAgentProfiles } from "@reviewrouter/shared";
import { switchRepositoryConfigurationAuthMode } from "../../../packages/features/workflow-provisioning/src/infrastructure/prisma/prisma-hosted-pool-configuration";
import { describe, expect, it } from "vitest";
import { createPrismaClient } from "@reviewrouter/platform-db";
import {
  PrismaProviderAccountRepository,
  selectBinding,
} from "@reviewrouter/features-provider-accounts";
import { PrismaPersonalAccountOperations } from "../../../packages/features/provider-accounts/src/infrastructure/prisma/prisma-personal-account-operations";
import {
  createWorkspaceProviderProfile,
  PrismaReviewConfigurationRepository,
  PrismaReviewConfigurationTransactionRepository,
  PrismaWorkspaceProviderProfileRepository,
  parseReviewConfigurationStrict,
  saveReviewConfiguration,
} from "@reviewrouter/features-review-config";
import {
  canonicalJson,
  parseProducerPrDescriptionProfile,
  type ReviewRunAuthorizationCandidate,
  type ReviewRunRuntimeSnapshot,
} from "@reviewrouter/features-review-run-control";
import { createReviewActionV2E2EHarness } from "../../../scripts/review-action-v2-production-e2e/support/review-action-v2-e2e-harness";
import { composeReviewActionV2ProductionRunControl } from "./review-action-v2-production-composition";
import { ProductionReviewRunRuntimeSnapshot } from "./review-run-runtime-snapshot";

function disposableDatabase() {
  // Reuse the existing migrated C2c fixture cluster. No ambient DATABASE_URL,
  // provider/SCM network, shared production schema or destructive reset.
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
  )
    throw new Error(
      "personal_consumption_migrated_disposable_loopback_required",
    );
  return raw;
}

// This catches a positive personal policy bypass, stale epoch/role reads, config
// writes that skip the policy, and adopting BX2 for an old selection. SQL129's
// existing harness independently tests stored snapshot/selected epoch equality.
describe.skipIf(process.env.RR_H_PERSONAL_CONSUMPTION_PG_TEST !== "1")(
  "H disabled personal consumption foundation",
  () => {
    it("pins exact source epoch, validates all config writers, and never revives BX", async () => {
      const databaseUrl = disposableDatabase();
      const harness = await createReviewActionV2E2EHarness(databaseUrl);
      const observer = createPrismaClient({ databaseUrl, poolMax: 4 });
      const {
        prisma: db,
        workspaceId: x,
        repositoryConnectionId: repositoryId,
        prefix,
      } = harness;
      try {
        // Obtain a real server-verified run identity from the existing synthetic
        // OIDC/SCM harness before installing a gateway config. No fake user actor.
        const authorized = await harness.authorize();
        const production = composeReviewActionV2ProductionRunControl({
          prisma: db,
          env: harness.env,
        });
        const run =
          await production.repositories.authorizations.findReviewRunAuthorizationById(
            authorized.authorizationId,
          );
        if (!run) throw new Error("personal_fixture_run_missing");
        const producerRow = await db.producerRelease.findUniqueOrThrow({
          where: { producerReleaseId: harness.producerReleaseId },
          select: {
            producerReleaseId: true,
            actionCommitSha: true,
            runtimeCommitSha: true,
            agentProfilesJson: true,
            prDescriptionProfile: true,
          },
        });
        const producerRelease = {
          ...producerRow,
          prDescriptionProfile:
            producerRow.prDescriptionProfile == null
              ? null
              : parseProducerPrDescriptionProfile(
                  producerRow.prDescriptionProfile,
                ),
          agentProfiles: parseReviewAgentProfiles(
            JSON.parse(producerRow.agentProfilesJson!),
          ),
        };
        const u = `${prefix}-donor`,
          admin = `${prefix}-admin`,
          v = `${prefix}-other`;
        await db.user.createMany({
          data: [{ id: u }, { id: admin }, { id: v }],
        });
        const store = new PrismaPersonalAccountOperations(db);
        const p = await store.resolvePersonalWorkspace(u);
        const otherP = await store.resolvePersonalWorkspace(v);
        const y = await db.workspace.create({
          data: { slug: `${prefix}-y`, name: "Synthetic Y" },
        });
        const membership = await db.workspaceMember.create({
          data: { workspaceId: x, userId: u, role: "admin" },
        });
        await db.workspaceMember.createMany({
          data: [
            { workspaceId: x, userId: admin, role: "owner" },
            { workspaceId: y.id, userId: u, role: "admin" },
          ],
        });
        const source = await db.providerAccountConnection.create({
          data: {
            ownerUserId: u,
            gatewayAccountRef: `${prefix}-account`,
            profileRef: "mimo-responses-v1",
            displayName: "Shared personal source",
            state: "active",
            authorizationEpochMirror: 7n,
          },
        });
        const makeBinding = (workspaceId: string) =>
          db.workspaceAccountBinding.create({
            data: {
              workspaceId,
              connectionId: source.id,
              state: "active",
            },
          });
        const bx = await makeBinding(x),
          bp = await makeBinding(p),
          by = await makeBinding(y.id);
        const foreignP = await makeBinding(otherP);
        const profile = source.profileRef!;
        const limits = {
          requests: 2,
          concurrency: 1,
          requestBytes: 4096,
          outputBytes: 4096,
          tokens: 128,
        };
        const snapshots = new ProductionReviewRunRuntimeSnapshot(
          db,
          { profiles: [{ profileRef: profile, limits }] },
          undefined,
          true,
          "codex-default",
        );
        const closedSnapshots = new ProductionReviewRunRuntimeSnapshot(
          db,
          {
            profiles: [{ profileRef: profile, limits }],
          },
          undefined,
          false,
          "codex-default",
        );
        const configurations = new PrismaReviewConfigurationRepository(
          db,
          undefined,
          true,
          u,
        );
        const closedConfigurations = new PrismaReviewConfigurationRepository(
          db,
          undefined,
          false,
          undefined,
        );
        const accounts = new PrismaProviderAccountRepository(
          db,
          undefined,
          true,
        );
        const closedAccounts = new PrismaProviderAccountRepository(db);
        const config = (bindingId: string) =>
          parseReviewConfigurationStrict({
            ...workspacePolicyFixture,
            providers: [
              {
                kind: "codex",
                authMode: "codex_account_gateway",
                model: "mimo-v2-pro",
                reasoningEffort: "high",
                fastMode: false,
                agenticContext: true,
                gatewayBindingId: bindingId,
                gatewayProfileRef: profile,
              },
            ],
          });
        const target = {
          scope: "repository" as const,
          workspaceId: x,
          repositoryId,
        };
        // The harness stores repository version 1 (its rotating selection).
        const save = (bindingId: string, expectedVersion: number | null) =>
          saveReviewConfiguration(
            {
              target,
              expectedVersion,
              ...systemPolicyWriteFixture(config(bindingId), target),
            },
            { configurations },
          );
        const capture = async () => {
          const captured = await snapshots.capture({
            modelTransport: "account_gateway",
            identity: run,
            deadline: run.maxExpiresAt,
            producerRelease,
          });
          // No fixture here saves an explicit agentProfileRef, so capture must
          // never deny; surface a denial loudly instead of aliasing it to null.
          if (captured && "captureDenied" in captured)
            throw new Error(
              `personal_capture_denied:${captured.captureDenied}`,
            );
          return captured;
        };
        const live = (snapshot: ReviewRunRuntimeSnapshot) =>
          snapshots.isLive({ snapshot, identity: run, now: new Date() });
        const candidate = (
          snapshot: ReviewRunRuntimeSnapshot,
        ): ReviewRunAuthorizationCandidate => ({
          ...run,
          runtimeSnapshotCanonicalJson: canonicalJson(snapshot),
        });
        const matches = (snapshot: ReviewRunRuntimeSnapshot) =>
          db.$transaction(
            (tx) => snapshots.matchesAdmission(tx, candidate(snapshot)),
            { isolationLevel: "Serializable" },
          );

        await expect(
          saveReviewConfiguration(
            {
              target,
              expectedVersion: 1,
              ...systemPolicyWriteFixture(config(bx.id), target),
            },
            { configurations: closedConfigurations },
          ),
        ).rejects.toThrow("review_configuration_gateway_binding_unavailable");
        // The refused write stored neither a version nor a profile.
        expect(
          await db.reviewConfigurationVersion.count({
            where: {
              workspaceId: x,
              configuration: { targetKey: `repo:${repositoryId}` },
            },
          }),
        ).toBe(1);
        expect(
          await db.workspaceProviderProfile.count({
            where: { workspaceId: x, gatewayBindingId: bx.id },
          }),
        ).toBe(0);
        await expect(
          closedAccounts
            .findBinding({ workspaceId: x, bindingId: bx.id })
            .then((selection) => selectBinding(x, bx.id, selection)),
        ).rejects.toMatchObject({ code: "connection_unavailable" });
        await save(bx.id, 1);
        expect(
          await closedSnapshots.capture({
            modelTransport: "account_gateway",
            identity: run,
            deadline: run.maxExpiresAt,
            producerRelease,
          }),
        ).toBeNull();
        const pin = await capture();
        if (!pin || !pin.gateway || pin.snapshotVersion !== 3)
          throw new Error("personal_current_pin_required");
        expect(pin.gateway).toMatchObject({
          bindingId: bx.id,
          connectionId: source.id,
          expectedAuthorizationEpoch: 7,
          permittedAccountRef: source.gatewayAccountRef,
          limits,
        });
        expect(await matches(pin)).toBe(true);
        expect(await live(pin)).toBe(true);
        // Exercise the real production factory, not just the injected foundation.
        // Only the exact trusted server value enables consumption; no truthy coercion.
        expect(
          await production.runtimeSnapshots.capture({
            modelTransport: "account_gateway",
            identity: run,
            deadline: run.maxExpiresAt,
            producerRelease,
          }),
        ).toBeNull();
        for (const value of ["1", "true", " 1"]) {
          const composed = composeReviewActionV2ProductionRunControl({
            prisma: db,
            env: {
              ...harness.env,
              REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED: value,
              REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY: JSON.stringify({
                profiles: [{ profileRef: profile, limits }],
              }),
            },
          });
          const captured = await composed.runtimeSnapshots.capture({
            modelTransport: "account_gateway",
            identity: run,
            deadline: run.maxExpiresAt,
            producerRelease,
          });
          if (value === "1") expect(captured).toEqual(pin);
          else expect(captured).toBeNull();
        }
        const { expectedAuthorizationEpoch: _epoch, ...legacyGateway } =
          pin.gateway;
        expect(_epoch).toBe(7);
        expect(await live({ ...pin, gateway: legacyGateway })).toBe(false);

        // P uses its stable owner even without an org role. A different P cannot
        // consume the source even if somebody creates a raw cross-P binding.
        const ownPersonal = await accounts.findBinding({
          workspaceId: p,
          bindingId: bp.id,
        });
        expect(
          selectBinding(p, bp.id, ownPersonal).expectedAuthorizationEpoch,
        ).toBe(7);
        expect(() => selectBinding(otherP, foreignP.id, ownPersonal)).toThrow();
        await expect(
          accounts
            .findBinding({ workspaceId: otherP, bindingId: foreignP.id })
            .then((selection) => selectBinding(otherP, foreignP.id, selection)),
        ).rejects.toMatchObject({ code: "connection_unavailable" });
        await saveReviewConfiguration(
          {
            target: { scope: "workspace", workspaceId: p },
            expectedVersion: null,
            ...systemPolicyWriteFixture(config(bp.id), {
              scope: "workspace",
              workspaceId: p,
            }),
          },
          { configurations },
        );

        // The transaction repository is used by batch/default composition too;
        // its default remains closed and it never trusts picker-page visibility.
        await expect(
          db.$transaction((tx) =>
            new PrismaReviewConfigurationTransactionRepository(
              tx,
              undefined,
              false,
              undefined,
            ).saveNextVersion({
              target: { scope: "workspace", workspaceId: y.id },
              expectedVersion: null,
              ...systemPolicyWriteFixture(config(by.id), {
                scope: "workspace",
                workspaceId: y.id,
              }),
            }),
          ),
        ).rejects.toThrow("review_configuration_gateway_binding_unavailable");
        await db.$transaction((tx) =>
          new PrismaReviewConfigurationTransactionRepository(
            tx,
            undefined,
            true,
            u,
          ).saveNextVersion({
            target: { scope: "workspace", workspaceId: y.id },
            expectedVersion: null,
            ...systemPolicyWriteFixture(config(by.id), {
              scope: "workspace",
              workspaceId: y.id,
            }),
          }),
        );
        const persisted = await configurations.findLatest(target);
        expect(persisted?.config.providers[0]?.gatewayBindingId).toBe(bx.id);
        expect(persisted?.config.providers[0]?.gatewayBindingId).toBe(bx.id);
        await expect(save(by.id, 2)).rejects.toThrow(
          "review_configuration_gateway_binding_unavailable",
        );
        await expect(
          saveReviewConfiguration(
            {
              target,
              expectedVersion: 2,
              ...systemPolicyWriteFixture(
                parseReviewConfigurationStrict({
                  ...config(bx.id),
                  providers: [
                    {
                      ...config(bx.id).providers[0],
                      gatewayProfileRef: "wrong-profile",
                    },
                  ],
                }),
                target,
              ),
            },
            { configurations },
          ),
        ).rejects.toThrow("review_configuration_gateway_profile_mismatch");

        // A rename changes presentation only. Epoch changes and pending state
        // deny the original pin, including at final locked admission.
        await db.providerAccountConnection.update({
          where: { id: source.id },
          data: { displayName: "Renamed", metadataRevision: { increment: 1 } },
        });
        expect(await live(pin)).toBe(true);
        await db.providerAccountConnection.update({
          where: { id: source.id },
          data: { state: "pending", metadataRevision: { increment: 1 } },
        });
        expect(await capture()).toBeNull();
        expect(await live(pin)).toBe(false);
        await expect(save(bx.id, 2)).rejects.toThrow(
          "review_configuration_gateway_binding_unavailable",
        );
        await db.providerAccountConnection.update({
          where: { id: source.id },
          data: {
            state: "active",
            authorizationEpochMirror: 8n,
            metadataRevision: { increment: 1 },
          },
        });
        expect(await live(pin)).toBe(false);
        expect(await matches(pin)).toBe(false);
        const freshPin = await capture();
        if (!freshPin || !freshPin.gateway || freshPin.snapshotVersion !== 3)
          throw new Error("fresh_personal_pin_missing");
        expect(freshPin.gateway.expectedAuthorizationEpoch).toBe(8);
        expect(await matches(freshPin)).toBe(true);

        // The final admission lock really covers the donor, not just the source.
        // NOWAIT from another connection detects a missing Member lock immediately.
        await db.$transaction(async (tx) => {
          await snapshots.lockGatewaySelection(tx, x, freshPin);
          await expect(
            observer.$transaction(
              (other) => other.$queryRaw`
            SELECT "id" FROM "WorkspaceMember" WHERE "id" = ${membership.id} FOR UPDATE NOWAIT`,
            ),
          ).rejects.toThrow(/could not obtain lock/);
          expect(
            await snapshots.capture(
              {
                identity: run,
                deadline: run.maxExpiresAt,
                producerRelease,
                modelTransport: "account_gateway",
              },
              tx,
            ),
          ).toEqual(freshPin);
        });

        // Real coordinated writer: an eligible owner->admin change is harmless;
        // removal retires only BX, while P/Y and independent org sources survive.
        await store.changeEligibility({
          actorUserId: admin,
          workspaceId: x,
          memberId: membership.id,
          userId: u,
          expectedRole: "admin",
          nextRole: "owner",
        });
        await store.changeEligibility({
          actorUserId: admin,
          workspaceId: x,
          memberId: membership.id,
          userId: u,
          expectedRole: "owner",
          nextRole: "admin",
        });
        expect(await live(freshPin)).toBe(true);
        const unrelated = await db.providerAccountConnection.create({
          data: {
            ownerWorkspaceId: x,
            gatewayAccountRef: `${prefix}-org-account`,
            profileRef: profile,
            displayName: "Independent organization",
            state: "active",
          },
        });
        const orgBinding = await db.workspaceAccountBinding.create({
          data: { workspaceId: x, connectionId: unrelated.id, state: "active" },
        });
        await store.changeEligibility({
          actorUserId: admin,
          workspaceId: x,
          memberId: membership.id,
          userId: u,
          expectedRole: "admin",
          nextRole: null,
        });
        expect(await live(freshPin)).toBe(false);
        expect(await capture()).toBeNull();
        await expect(save(bx.id, 2)).rejects.toThrow(
          "review_configuration_personal_actor_forbidden",
        );
        for (const [workspaceId, bindingId] of [
          [p, bp.id],
          [y.id, by.id],
          [x, orgBinding.id],
        ]) {
          const selected = selectBinding(
            workspaceId!,
            bindingId!,
            await accounts.findBinding({
              workspaceId: workspaceId!,
              bindingId: bindingId!,
            }),
          );
          expect(selected.bindingId).toBe(bindingId);
        }
        const retired = await db.workspaceAccountBinding.findUniqueOrThrow({
          where: { id: bx.id },
        });
        expect(retired.state).toBe("revoked");
        expect(retired.pendingFenceOperationId).not.toBeNull();
        await db.workspaceMember.create({
          data: { workspaceId: x, userId: u, role: "admin" },
        });
        // A fresh ID cannot be adopted by an old config or saved run. Test data
        // creates BX2 directly; explicit attach/ACK lifecycle belongs to C2's suite.
        const bx2 = await makeBinding(x);
        expect(await capture()).toBeNull();
        expect(await live(freshPin)).toBe(false);
        await expect(save(bx.id, 2)).rejects.toThrow(
          "review_configuration_gateway_binding_unavailable",
        );
        // The donor, an admin of X again, registers the BX2 provider first;
        // the save then selects that stored profile.
        const { profile: bx2Profile } = await createWorkspaceProviderProfile(
          {
            workspaceId: x,
            actor: { userId: u, auditActor: `user:${u}` },
            credential: { kind: "gateway_binding", bindingId: bx2.id },
            model: "mimo-v2-pro",
          },
          {
            profiles: new PrismaWorkspaceProviderProfileRepository(db, {
              operatorWorkspaceId: undefined,
              personalAccountsEnabled: true,
            }),
          },
        );
        const bx2Policy = systemPolicyWriteFixture(
          config(bx2.id),
          target,
        ).policy;
        expect(
          (
            await saveReviewConfiguration(
              {
                target,
                expectedVersion: 2,
                policy: {
                  ...bx2Policy,
                  providers: bx2Policy.providers!.map((selection) => ({
                    ...selection,
                    profileId: bx2Profile.id,
                  })),
                },
              },
              { configurations },
            )
          ).version,
        ).toBe(3);
        const bx2Pin = await capture();
        expect(bx2Pin?.gateway?.bindingId).toBe(bx2.id);
        expect(await live(freshPin)).toBe(false);
        await expect(save(bx2.id, 2)).rejects.toThrow(
          "review_configuration_write_conflict",
        );
        // The legacy pool switch has no verified saving User.id. Even with
        // consumption enabled it must leave a mixed personal config unchanged.
        await configurations.saveNextVersion({
          target,
          expectedVersion: 3,
          ...systemPolicyWriteFixture(
            parseReviewConfigurationStrict({
              ...config(bx2.id),
              execution: {
                ...workspacePolicyFixture.execution,
                providerLimit: 2,
                providerMaxParallel: 2,
              },
              providers: [
                ...config(bx2.id).providers,
                {
                  ...workspaceProviderFixture,
                  authMode: "codex_subscription_oauth_rotating",
                },
              ],
            }),
            target,
          ),
        });
        const oldGate =
          process.env.REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED;
        const switchPool = () =>
          db.$transaction(
            (transaction) =>
              switchRepositoryConfigurationAuthMode({
                transaction,
                workspaceId: x,
                repositoryId,
                authMode: "codex_subscription_oauth_hosted_pool",
              }),
            { isolationLevel: "Serializable" },
          );
        try {
          process.env.REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED = "0";
          await expect(switchPool()).rejects.toThrow(
            "review_configuration_gateway_binding_unavailable",
          );
          process.env.REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED = "1";
          await expect(switchPool()).rejects.toThrow(
            "review_configuration_personal_actor_forbidden",
          );
          const mixed = await configurations.findLatest(target);
          expect(mixed?.version).toBe(4);
          expect(mixed?.config.providers[0]?.gatewayBindingId).toBe(bx2.id);
          expect(mixed?.config.providers[1]?.authMode).toBe(
            "codex_subscription_oauth_rotating",
          );
        } finally {
          if (oldGate === undefined)
            delete process.env.REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED;
          else
            process.env.REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED =
              oldGate;
        }
      } finally {
        // Retained source/grant/config evidence lives until this disposable
        // cluster is removed by the qualifier, not through weakened SQL guards.
        await observer.$disconnect();
        await harness.close();
      }
    }, 120_000);
  },
);
