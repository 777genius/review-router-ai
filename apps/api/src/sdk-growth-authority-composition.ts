import type { PrismaClient } from "@prisma/client";
import {
  PrismaAuthorityProvisioning,
  PrismaCurrentAuthoritySnapshot,
} from "@reviewrouter/features-sdk-growth-authority/infrastructure/current-authority";
import { PrismaEfAuthorityDecisionTransaction } from "@reviewrouter/features-sdk-growth-authority/infrastructure/custody";
import {
  EfAuthorityService,
  PinnedEfAuthorityCodecV1,
  type EfAuthorityCodecPort,
  type TrustedAuthorityIngestion,
} from "@reviewrouter/features-sdk-growth-authority";
import {
  JoseGitHubActionsOidcTokenVerifier,
  PrismaActionControlPlaneRepository,
  PrismaActionOidcReplayNonceStore,
  type ActionControlPlaneRepositoryPort,
  type ActionOidcReplayNonceStorePort,
  type GitHubActionsOidcTokenVerifierPort,
} from "@reviewrouter/features-action-control-plane";
import {
  SdkGrowthOidcAuthentication,
  type RegisterSdkGrowthAuthorityRoutesDependencies,
  type SdkGrowthExecutionResolverPort,
} from "./sdk-growth-authority-routes.js";
import {
  PrismaSdkGrowthVerifierEvidenceSource,
  SdkGrowthVerifierCustody,
  type SdkGrowthVerifierEvidenceSourcePort,
} from "./sdk-growth-verifier-custody.js";
import { OctokitSdkGrowthExecutionResolver } from "./github/octokit-sdk-growth-execution-resolver.js";

/** Internal composition only. The provisioning capability must remain with trusted
 * operators; request handlers receive only currentAuthority. */
export function composeSdkGrowthCurrentAuthority(
  prisma: PrismaClient,
  ingestion: TrustedAuthorityIngestion,
) {
  return {
    currentAuthority: new PrismaCurrentAuthoritySnapshot(prisma),
    provisioning: new PrismaAuthorityProvisioning(prisma, ingestion),
  };
}

export interface ComposeSdkGrowthAuthorityRoutesInput {
  readonly prisma: PrismaClient;
  readonly codec: EfAuthorityCodecPort;
  readonly oidcVerifier: GitHubActionsOidcTokenVerifierPort;
  readonly repositories: ActionControlPlaneRepositoryPort;
  readonly replayNonces: ActionOidcReplayNonceStorePort;
  readonly executions: SdkGrowthExecutionResolverPort;
  readonly verifierEvidence: SdkGrowthVerifierEvidenceSourcePort;
  readonly audience: string;
  readonly ttlMs?: number;
}

/** Production composition keeps HTTP/JOSE/Prisma outside the application core.
 * The codec and verifier source are explicit because the successor EF wire
 * contract is not frozen at this base. */
export function composeSdkGrowthAuthorityRoutes(
  input: ComposeSdkGrowthAuthorityRoutesInput,
): RegisterSdkGrowthAuthorityRoutesDependencies {
  const publication = {
    async enqueue() {
      throw new Error("sdk_growth_publication_lane_not_composed");
    },
  };
  return {
    authentication: new SdkGrowthOidcAuthentication(
      input.oidcVerifier,
      input.repositories,
      input.replayNonces,
      input.executions,
      input.audience,
    ),
    service: new EfAuthorityService(
      new PrismaEfAuthorityDecisionTransaction(
        input.prisma,
        { now: Date.now },
        publication,
        input.ttlMs,
      ),
      input.codec,
      new SdkGrowthVerifierCustody(input.verifierEvidence),
    ),
  };
}

/** Concrete production wiring. Activation is explicit in app composition; all
 * identity/evidence reads are server-side and the codec is pinned to bridge v1. */
export function composeProductionSdkGrowthAuthorityRoutes(input: {
  readonly prisma: PrismaClient;
  readonly audience: string;
  readonly githubAppId: string;
  readonly githubAppPrivateKey: string;
}): RegisterSdkGrowthAuthorityRoutesDependencies {
  return composeSdkGrowthAuthorityRoutes({
    prisma: input.prisma,
    codec: new PinnedEfAuthorityCodecV1(),
    oidcVerifier: new JoseGitHubActionsOidcTokenVerifier(),
    repositories: new PrismaActionControlPlaneRepository(input.prisma),
    replayNonces: new PrismaActionOidcReplayNonceStore(input.prisma),
    executions: new OctokitSdkGrowthExecutionResolver({
      appId: input.githubAppId,
      privateKey: input.githubAppPrivateKey,
    }),
    verifierEvidence: new PrismaSdkGrowthVerifierEvidenceSource(input.prisma),
    audience: input.audience,
  });
}
