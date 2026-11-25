import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@reviewrouter/platform-db";
import type { ProviderUsageApi } from "./provider-usage-routes.js";
import { ProviderUsageArtifactReader } from "./provider-usage-artifact-recovery.js";

/** Durable lease prevents replicas repeatedly downloading the same run artifact. */
export function createProviderUsageArtifactRecovery(input: {
  prisma: PrismaClient;
  api: Pick<ProviderUsageApi, "recover" | "verifyArtifactForDeletion">;
  reader: Pick<ProviderUsageArtifactReader, "read" | "remove">;
}) {
  return {
    async runBatch() {
      await cleanupArtifacts(input);
      const now = new Date();
      const candidates = await input.prisma.providerUsageGrant.findMany({
        where: {
          revokedAt: null,
          recoveredAt: null,
          expiresAt: { gt: now },
          AND: [
            {
              OR: [
                { recoveryClaimUntil: null },
                { recoveryClaimUntil: { lt: now } },
              ],
            },
            {
              OR: [
                { recoveryNextAttemptAt: null },
                { recoveryNextAttemptAt: { lte: now } },
              ],
            },
          ],
        },
        orderBy: { issuedAt: "asc" },
        take: 10,
      });
      let recovered = 0;
      for (const grant of candidates) {
        const claim = randomUUID();
        const claimed = await input.prisma.providerUsageGrant.updateMany({
          where: {
            id: grant.id,
            revokedAt: null,
            recoveredAt: null,
            OR: [
              { recoveryClaimUntil: null },
              { recoveryClaimUntil: { lt: now } },
            ],
          },
          data: {
            recoveryClaimToken: claim,
            recoveryClaimUntil: new Date(Date.now() + 120000),
            recoveryNextAttemptAt: new Date(Date.now() + 300000),
          },
        });
        if (claimed.count !== 1) continue;
        let imported = false;
        try {
          const workspace = await input.prisma.workspace.findUnique({
            where: { id: grant.workspaceId },
            select: { deletionState: true },
          });
          if (!workspace || workspace.deletionState !== "active") {
            await input.prisma.providerUsageGrant.updateMany({
              where: { workspaceId: grant.workspaceId, revokedAt: null },
              data: { revokedAt: new Date() },
            });
            continue;
          }
          let installationId = grant.githubInstallationId;
          let repositoryFullName = grant.repositoryFullName;
          if (!grant.bootstrapScope && !grant.actionSessionScope) {
            const auth = await input.prisma.reviewRunAuthorization.findUnique({
              where: { authorizationId: grant.authorizationId },
            });
            if (
              !auth ||
              auth.workspaceId !== grant.workspaceId ||
              auth.sourceRunId !== grant.runId ||
              Number(auth.sourceRunAttempt) !== grant.runAttempt ||
              auth.workflowIdentityHash !== grant.workflowIdentity ||
              auth.oidcReplayKeyHash !== grant.jobIdentity
            )
              continue;
            const repository =
              await input.prisma.repositoryConnection.findFirst({
                where: {
                  id: auth.repositoryConnectionId,
                  workspaceId: grant.workspaceId,
                },
                include: { installation: true },
              });
            if (
              !repository?.installation ||
              String(repository.githubRepositoryId) !== grant.repositoryId ||
              repository.installation.status !== "active"
            )
              continue;
            installationId = String(
              repository.installation.githubInstallationId,
            );
            repositoryFullName = repository.fullName;
          }
          if (!installationId || !repositoryFullName) continue;
          const artifact = await input.reader.read({
            installationId,
            repositoryFullName,
            repositoryId: grant.repositoryId,
            runId: grant.runId,
            runAttempt: grant.runAttempt,
            invocationId: grant.invocationId,
          });
          if (!artifact) continue;
          // Recheck the lease before accepting. recover independently checks current
          // deletion/revocation/window and the registered ephemeral signature.
          const fence = await input.prisma.providerUsageGrant.count({
            where: {
              id: grant.id,
              recoveryClaimToken: claim,
              recoveryClaimUntil: { gt: new Date() },
              revokedAt: null,
            },
          });
          if (fence !== 1) continue;
          await input.api.recover(artifact.body, {
            repositoryId: grant.repositoryId,
            runId: grant.runId,
            runAttempt: grant.runAttempt,
            artifactName: artifact.artifactName,
          });
          imported = true;
          recovered++;
        } catch {
          /* Safe retry; no provider operation or review publication is performed. */
        } finally {
          await input.prisma.providerUsageGrant.updateMany({
            where: { id: grant.id, recoveryClaimToken: claim },
            data: {
              recoveryClaimToken: null,
              recoveryClaimUntil: null,
              ...(imported ? { recoveredAt: new Date() } : {}),
            },
          });
        }
      }
      return { examined: candidates.length, recovered };
    },
  };
}

async function cleanupArtifacts(input: {
  prisma: PrismaClient;
  api: Pick<ProviderUsageApi, "verifyArtifactForDeletion">;
  reader: Pick<ProviderUsageArtifactReader, "read" | "remove">;
}) {
  const now = new Date();
  const grants = await input.prisma.providerUsageGrant.findMany({
    where: {
      revokedAt: { not: null },
      artifactDeletedAt: null,
      githubInstallationId: { not: null },
      repositoryFullName: { not: null },
      AND: [
        {
          OR: [
            { recoveryClaimUntil: null },
            { recoveryClaimUntil: { lt: now } },
          ],
        },
        {
          OR: [
            { recoveryNextAttemptAt: null },
            { recoveryNextAttemptAt: { lte: now } },
          ],
        },
      ],
    },
    orderBy: { issuedAt: "asc" },
    take: 10,
  });
  for (const grant of grants) {
    const workspace = await input.prisma.workspace.findUnique({
      where: { id: grant.workspaceId },
      select: { deletionState: true },
    });
    if (workspace?.deletionState === "active") continue;
    const claim = randomUUID();
    const claimed = await input.prisma.providerUsageGrant.updateMany({
      where: {
        id: grant.id,
        artifactDeletedAt: null,
        OR: [{ recoveryClaimUntil: null }, { recoveryClaimUntil: { lt: now } }],
      },
      data: {
        recoveryClaimToken: claim,
        recoveryClaimUntil: new Date(Date.now() + 120000),
        recoveryNextAttemptAt: new Date(Date.now() + 300000),
      },
    });
    if (claimed.count !== 1) continue;
    let deleted = false;
    try {
      const target = {
        installationId: grant.githubInstallationId!,
        repositoryId: grant.repositoryId,
        repositoryFullName: grant.repositoryFullName!,
        runId: grant.runId,
        runAttempt: grant.runAttempt,
        invocationId: grant.invocationId,
      };
      const artifact = await input.reader.read(target, true);
      if (artifact) {
        await input.api.verifyArtifactForDeletion(artifact.body, {
          grantId: grant.id,
          repositoryId: grant.repositoryId,
          runId: grant.runId,
          runAttempt: grant.runAttempt,
          artifactName: artifact.artifactName,
        });
        if (
          (await input.prisma.providerUsageGrant.count({
            where: {
              id: grant.id,
              recoveryClaimToken: claim,
              recoveryClaimUntil: { gt: new Date() },
            },
          })) !== 1
        )
          continue;
        await input.reader.remove(target, artifact.artifactId);
      }
      deleted = true;
    } catch {
      /* Durable retry; never delete a name collision with an invalid signature. */
    } finally {
      await input.prisma.providerUsageGrant.updateMany({
        where: { id: grant.id, recoveryClaimToken: claim },
        data: {
          recoveryClaimToken: null,
          recoveryClaimUntil: null,
          ...(deleted ? { artifactDeletedAt: new Date() } : {}),
        },
      });
    }
  }
}
