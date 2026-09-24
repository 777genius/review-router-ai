import type { PrismaClient } from "@prisma/client";
import type { KeyObject } from "node:crypto";
import {
  PrismaAuthorityProvisioning,
  PrismaCurrentAuthoritySnapshot,
} from "@reviewrouter/features-sdk-growth-authority/infrastructure/current-authority";
import {
  PrismaEfAuthorityDecisionTransaction,
  PrismaSdkGrowthPublicationIdentitySource,
} from "@reviewrouter/features-sdk-growth-authority/infrastructure/custody";
import {
  EfAuthorityService,
  PinnedEfAuthorityCodecV1,
  ServerSideTrustedAuthorityIngestion,
  SdkGrowthVerifierAuthorityPolicy,
  type EfAuthorityCodecPort,
  type TrustedAuthorityAuthenticatorPort,
  type TrustedAuthoritySourcePort,
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
  PrismaSdkGrowthVerifierEvidenceCustody,
  SdkGrowthVerifierCustody,
  type SdkGrowthVerifierProducerAuthenticatorPort,
  type SdkGrowthVerifierEvidenceSourcePort,
} from "./sdk-growth-verifier-custody.js";
import { OctokitSdkGrowthExecutionResolver } from "./github/octokit-sdk-growth-execution-resolver.js";
import {
  JoseSdkGrowthVerifierProducerAuthenticator,
  PrismaSdkGrowthVerifierAssignmentStore,
  SdkGrowthVerifierCredentialIssuer,
} from "./sdk-growth-verifier-producer-identity.js";

/** Internal composition only. The provisioning capability must remain with trusted
 * operators; request handlers receive only currentAuthority. */
export function composeSdkGrowthCurrentAuthority(
  prisma: PrismaClient,
  authority: {
    readonly authenticator: TrustedAuthorityAuthenticatorPort;
    readonly source: TrustedAuthoritySourcePort;
  },
) {
  const ingestion = new ServerSideTrustedAuthorityIngestion(
    authority.authenticator,
    authority.source,
  );
  return {
    currentAuthority: new PrismaCurrentAuthoritySnapshot(prisma),
    provisioning: new PrismaAuthorityProvisioning(prisma, ingestion),
  };
}

/** Verifier process composition. The authenticator must be backed by a
 * protected workload identity and must not accept the candidate Actions OIDC
 * credential used by the public authority routes. */
export function composeSdkGrowthVerifierProducerCustody(
  prisma: PrismaClient,
  authenticator: SdkGrowthVerifierProducerAuthenticatorPort,
) {
  return new PrismaSdkGrowthVerifierEvidenceCustody(
    prisma,
    authenticator,
    new SdkGrowthVerifierAuthorityPolicy(),
  );
}

/** Isolated verifier-process composition. Production activation remains off;
 * no candidate route or API startup path calls this function. The runtime's
 * DB role needs assignment SELECT but must not have assignment write grants. */
export function composeProtectedSdkGrowthVerifierProducer(input: {
  readonly enabled: boolean;
  readonly prisma: PrismaClient;
  readonly credentialPublicKey?: KeyObject;
}) {
  if (!input.enabled) return null;
  if (!input.credentialPublicKey)
    throw new Error("sdk_growth_verifier_key_required");
  const assignments = new PrismaSdkGrowthVerifierAssignmentStore(input.prisma);
  return composeSdkGrowthVerifierProducerCustody(
    input.prisma,
    new JoseSdkGrowthVerifierProducerAuthenticator(
      assignments,
      input.credentialPublicKey,
    ),
  );
}

/** Separate protected scheduler composition; deploy with assignment INSERT and
 * revocation UPDATE grants, without verifier custody INSERT grants. */
export function composeProtectedSdkGrowthVerifierScheduler(input: {
  readonly enabled: boolean;
  readonly prisma: PrismaClient;
  readonly credentialPrivateKey?: KeyObject;
}) {
  if (!input.enabled) return null;
  if (!input.credentialPrivateKey)
    throw new Error("sdk_growth_verifier_key_required");
  const assignments = new PrismaSdkGrowthVerifierAssignmentStore(input.prisma);
  return {
    assignments,
    credentials: new SdkGrowthVerifierCredentialIssuer(
      assignments,
      input.credentialPrivateKey,
    ),
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
  readonly githubAppId: string;
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
        new PrismaSdkGrowthPublicationIdentitySource(input.githubAppId),
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
    verifierEvidence: new PrismaSdkGrowthVerifierEvidenceSource(
      input.prisma,
      new SdkGrowthVerifierAuthorityPolicy(),
    ),
    audience: input.audience,
    githubAppId: input.githubAppId,
  });
}
