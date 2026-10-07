import { randomUUID } from "node:crypto";
import { App } from "@octokit/app";
import type { PrismaClient } from "@prisma/client";
import {
  runPublicationIntent,
  type PublicationCheckGateway,
} from "@reviewrouter/features-sdk-growth-authority";
import { SdkGrowthPublicationOutboxBridge } from "@reviewrouter/features-sdk-growth-authority/infrastructure/outbox";
import { PrismaSdkGrowthPublicationEffect } from "@reviewrouter/features-sdk-growth-authority/infrastructure/publication";
import {
  PrismaOutboxEventRepository,
  type OutboxHandler,
} from "@reviewrouter/features-outbox";
import { SdkGrowthCheckGateway } from "./sdk-growth-check-gateway.js";
import {
  SdkGrowthPublicationRuntime,
  type SdkGrowthClaimedEvent,
} from "./sdk-growth-publication-runtime.js";

export const sdkGrowthPublicationEnabledEnv =
  "REVIEW_ROUTER_SDK_GROWTH_AUTHORITY_ENABLED";
export const sdkGrowthPublicationTakeoverEnabledEnv =
  "REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED";

export type SdkGrowthPublicationFeature = Readonly<{
  enabled: boolean;
  handlers: readonly OutboxHandler[];
  runMaintenance(): Promise<Readonly<{ linked: number; failed: number }>>;
}>;

/** Production-only composition. Policy and state transitions remain in the
 * SDK-growth feature; this edge wires Prisma, the existing outbox and GitHub. */
export function createSdkGrowthPublicationFeature(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly prisma: PrismaClient;
  readonly githubAppId?: string;
  readonly githubPrivateKey?: string;
}): SdkGrowthPublicationFeature {
  if (input.env[sdkGrowthPublicationEnabledEnv] !== "1") {
    return {
      enabled: false,
      handlers: [],
      runMaintenance: async () => ({ linked: 0, failed: 0 }),
    };
  }
  if (input.env[sdkGrowthPublicationTakeoverEnabledEnv] !== "1") {
    throw new Error("sdk_growth_publication_requires_fenced_outbox_takeover");
  }
  const appId = input.githubAppId?.trim();
  const privateKey = input.githubPrivateKey?.trim();
  if (!appId || !privateKey)
    throw new Error("sdk_growth_publication_github_app_credentials_missing");

  const effects = new PrismaSdkGrowthPublicationEffect(input.prisma);
  const outbox = new PrismaOutboxEventRepository(input.prisma);
  const links = new SdkGrowthPublicationOutboxBridge(
    effects,
    {
      enqueue: (event) => outbox.enqueue(event),
      findStatusByIdempotencyKey: (key) =>
        outbox.findStatusByIdempotencyKey(key),
    },
    async (tenantId) => tenantId,
  );
  const app = new App({ appId, privateKey });
  const application = {
    async run(command: {
      readonly intentId: string;
      readonly claim: {
        readonly eventId: string;
        readonly claimId: string;
        readonly claimVersion: bigint;
        readonly claimOwnerHash: string;
      };
      readonly signal: AbortSignal;
    }) {
      const publication = await effects.load(command.intentId);
      if (!publication) return "missing" as const;
      const octokit = await app.getInstallationOctokit(
        Number(publication.check.installationId),
      );
      const gateway = new SdkGrowthCheckGateway(
        octokit as unknown as ConstructorParameters<
          typeof SdkGrowthCheckGateway
        >[0],
        publication.check,
      ) as PublicationCheckGateway;
      return runPublicationIntent({
        ...command,
        effects,
        gateway,
        newAttemptId: randomUUID,
      });
    },
  };
  const runtime = new SdkGrowthPublicationRuntime(application, links);
  const handler: OutboxHandler = {
    ...runtime.handlerDefinition,
    handle: (event) =>
      runtime.handle(
        event as unknown as SdkGrowthClaimedEvent,
        new AbortController().signal,
      ),
  };
  return {
    enabled: true,
    handlers: [handler],
    runMaintenance: () => runtime.recoverUnqueued(100),
  };
}
