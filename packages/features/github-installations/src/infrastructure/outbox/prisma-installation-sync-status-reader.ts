import type { PrismaClient } from "@prisma/client";
import type { OutboxEventStatus } from "@reviewrouter/features-outbox";
import {
  installationSyncAggregateId,
  installationSyncRequestedEvent,
} from "./outbox-installation-sync-requester";

export type InstallationSyncRequestStatus = {
  readonly status: OutboxEventStatus;
  readonly requestedAt: Date;
};

/** Reads the newest repository scan request of each installation. */
export class PrismaInstallationSyncStatusReader {
  constructor(private readonly prisma: Pick<PrismaClient, "outboxEvent">) {}

  async latestByInstallation(
    githubInstallationIds: readonly string[],
  ): Promise<ReadonlyMap<string, InstallationSyncRequestStatus>> {
    const latest = await Promise.all(
      [...new Set(githubInstallationIds)].map(async (githubInstallationId) => {
        const event = await this.prisma.outboxEvent.findFirst({
          where: {
            type: installationSyncRequestedEvent.type,
            version: installationSyncRequestedEvent.version,
            aggregateId: installationSyncAggregateId(githubInstallationId),
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { status: true, createdAt: true },
        });
        return event
          ? ([
              [
                githubInstallationId,
                { status: event.status, requestedAt: event.createdAt },
              ],
            ] as const)
          : [];
      }),
    );
    return new Map(latest.flat());
  }
}
