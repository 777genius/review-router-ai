import type { PrismaClient } from "@prisma/client";
import {
  PrismaAuthorityProvisioning,
  PrismaCurrentAuthoritySnapshot,
} from "@reviewrouter/features-sdk-growth-authority/infrastructure/current-authority";
import type { TrustedAuthorityIngestion } from "@reviewrouter/features-sdk-growth-authority";

/** Internal composition only. The provisioning capability must remain with trusted
 * operators; request handlers receive only currentAuthority. No routes registered. */
export function composeSdkGrowthCurrentAuthority(
  prisma: PrismaClient,
  ingestion: TrustedAuthorityIngestion,
) {
  return {
    currentAuthority: new PrismaCurrentAuthoritySnapshot(prisma),
    provisioning: new PrismaAuthorityProvisioning(prisma, ingestion),
  };
}
