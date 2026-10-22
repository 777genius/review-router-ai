import type { PrismaClient } from "@reviewrouter/platform-db";
import { createProviderUsageApi } from "./provider-usage-routes";
import { createProviderUsageActionSessionIssuer } from "./provider-usage-action-session";
import { createProviderUsageBootstrapIssuer } from "./provider-usage-bootstrap";
import { createProviderUsageRunCompletion } from "./provider-usage-run-completion";
import { createProviderUsageGatewayReconciliation } from "./provider-usage-gateway-reconciliation";
import { ProviderUsageArtifactReader } from "./provider-usage-artifact-recovery";
import { createProviderUsageArtifactRecovery } from "./provider-usage-artifact-recovery-store";
/** Existing Action Session routes also run on deployments without the v2 execution API. */
export function createProviderUsageSessionComposition(input: {
  prisma: PrismaClient;
  appId: string;
  privateKey: string;
  env: Readonly<Record<string, string | undefined>>;
}) {
  const { prisma, appId, privateKey, env } = input;
  const credentials = { appId, privateKey };
  const providerUsage = createProviderUsageApi({
    prisma,
    resolveRunClosedAt: createProviderUsageRunCompletion(credentials),
  });
  return {
    providerUsage,
    providerUsageActionSession: createProviderUsageActionSessionIssuer({
      prisma,
      api: providerUsage,
      ...credentials,
    }),
    providerUsageBootstrap: createProviderUsageBootstrapIssuer({
      prisma,
      api: providerUsage,
      ...credentials,
    }),
    providerUsageNative: createProviderUsageGatewayReconciliation(prisma, env),
    providerUsageRecovery: createProviderUsageArtifactRecovery({
      prisma,
      api: providerUsage,
      reader: new ProviderUsageArtifactReader(credentials),
    }),
  };
}
