import { createHash, randomUUID } from "node:crypto";
import { UsageError } from "@reviewrouter/features-provider-usage";
import type { PrismaClient } from "@reviewrouter/platform-db";
import { createConsumerControlClient } from "@agent-teams/account-gateway/http";
import {
  PrismaUsageAttributionReader,
  PrismaUsageReconciliation,
} from "@reviewrouter/features-provider-usage/composition";
import { createGatewayUsageSource } from "./provider-usage-gateway-source";
import {
  quarantineGatewayObservation,
  replayGatewayQuarantine,
} from "./provider-usage-quarantine";
/** Maintenance remains active for retention even on deployments with direct-only producers. */
export function createProviderUsageGatewayReconciliation(
  prisma: PrismaClient,
  env: Readonly<Record<string, string | undefined>>,
) {
  const origin =
    env.REVIEW_ROUTER_ACCOUNT_GATEWAY_CONTROL_ORIGIN ??
    env.REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN;
  const token = env.REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER;
  const reconciliation = new PrismaUsageReconciliation(prisma);
  const activation = new Date();
  const owner = randomUUID();
  let afterWorkspace = "";
  const deployment = origin
    ? "gateway/" +
      createHash("sha256").update(origin).digest("hex").slice(0, 24)
    : null;
  const client =
    origin && token && env.REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY
      ? createConsumerControlClient({
          role: "consumer-control",
          origin,
          token,
          timeoutMs: 10_000,
          responseBytes: 1024 * 1024,
        })
      : null;
  return {
    async runBatch() {
      await reconciliation.prune(new Date());
      if (!client || !deployment) return { status: "native_unavailable" };
      await replayGatewayQuarantine(prisma, deployment);
      let scopes = await prisma.$queryRaw<
        { workspaceId: string }[]
      >`SELECT DISTINCT "workspaceId" FROM "UsageCall" WHERE "route"='gateway' AND "workspaceId">${afterWorkspace} ORDER BY "workspaceId" ASC LIMIT 10`;
      if (!scopes.length && afterWorkspace) {
        afterWorkspace = "";
        scopes = await prisma.$queryRaw<
          { workspaceId: string }[]
        >`SELECT DISTINCT "workspaceId" FROM "UsageCall" WHERE "route"='gateway' AND "workspaceId">${afterWorkspace} ORDER BY "workspaceId" ASC LIMIT 10`;
      }
      afterWorkspace = scopes.at(-1)?.workspaceId ?? "";
      return Promise.allSettled(
        scopes.map(async (scope) => {
          const sourceInstance = deployment + "/" + scope.workspaceId;
          const lease = await reconciliation.claim({
            sourceInstance,
            workspaceId: scope.workspaceId,
            owner,
            now: new Date(),
            leaseMs: 60_000,
            coveredFrom: activation,
          });
          if (!lease)
            return { workspaceId: scope.workspaceId, status: "not_due" };
          const source = createGatewayUsageSource({
            workspaceId: scope.workspaceId,
            sourceInstance,
            client,
            attribution: new PrismaUsageAttributionReader(prisma),
            quarantine: (observation, reason) =>
              quarantineGatewayObservation(
                prisma,
                deployment,
                observation,
                reason,
              ),
          });
          try {
            const page = await source.listUsage({
              afterCursor: lease.cursor,
              limit: 100,
              highWaterMark: lease.highWaterMark,
            });
            await reconciliation.commitPage(lease, page, {
              workspaceId: scope.workspaceId,
              invocationId: "native-reconciliation",
              source: "native",
              now: new Date(),
              replayUntil: new Date(Date.now() + 60_000),
            });
            return { workspaceId: scope.workspaceId, status: "accepted" };
          } catch (error) {
            await reconciliation.fail(lease, {
              code:
                error instanceof UsageError
                  ? error.code
                  : "native_source_unavailable",
              now: new Date(),
            });
            return { workspaceId: scope.workspaceId, status: "retry_pending" };
          }
        }),
      );
    },
  };
}
