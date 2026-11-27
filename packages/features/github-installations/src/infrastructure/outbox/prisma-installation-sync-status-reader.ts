import type { PrismaClient } from "@prisma/client";
import type { OutboxEventStatus } from "@reviewrouter/features-outbox";
import { installationSyncAggregateId } from "./outbox-installation-sync-requester";

export type InstallationSyncRequestStatus = {
  readonly status: OutboxEventStatus;
  readonly requestedAt: Date;
};

/** Reads the newest repository scan request of each installation. */
export class PrismaInstallationSyncStatusReader {
  constructor(private readonly prisma: Pick<PrismaClient, "$queryRaw">) {}

  async latestByInstallation(
    githubInstallationIds: readonly string[],
  ): Promise<ReadonlyMap<string, InstallationSyncRequestStatus>> {
    const installationIds = [...new Set(githubInstallationIds)];
    if (installationIds.length === 0) return new Map();
    const aggregateIds = installationIds.map(installationSyncAggregateId);
    // Each authorized input owns one LIMIT. A global LIMIT or loading all
    // history and grouping in JavaScript loses either parents or scalability.
    // This v1 reader pins the event predicate so the partial index also works
    // with generic prepared plans; installation IDs remain bound parameters.
    const latest = await this.prisma.$queryRaw<
      readonly {
        installationId: string;
        status: OutboxEventStatus;
        createdAt: Date;
      }[]
    >`
      SELECT requested."installationId", latest."status", latest."createdAt"
      FROM unnest(${installationIds}::text[], ${aggregateIds}::text[])
        WITH ORDINALITY AS requested("installationId", "aggregateId", ordinal)
      JOIN LATERAL (
        SELECT event."status", event."createdAt"
        FROM "OutboxEvent" AS event
        WHERE event."type" = 'installation.sync_requested'
          AND event."version" = 1
          AND event."aggregateId" = requested."aggregateId"
        ORDER BY event."createdAt" DESC, event."id" DESC
        LIMIT 1
      ) AS latest ON true
      ORDER BY requested.ordinal
    `;
    return new Map(
      latest.map((event) => [
        event.installationId,
        { status: event.status, requestedAt: event.createdAt },
      ]),
    );
  }
}
