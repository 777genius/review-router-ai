import type { OutboxEventRepositoryPort } from "@reviewrouter/features-outbox";
import type {
  InstallationSyncRequest,
  InstallationSyncRequestPort,
} from "../../application/ports/installation-sync-request-port";

/** The outbox contract of a repository scan request, shared by writer and readers. */
export const installationSyncRequestedEvent = {
  type: "installation.sync_requested",
  version: 1,
} as const;

export function installationSyncAggregateId(
  githubInstallationId: string,
): string {
  return `github-installation:${githubInstallationId}`;
}

export class OutboxInstallationSyncRequester implements InstallationSyncRequestPort {
  constructor(private readonly outbox: OutboxEventRepositoryPort) {}

  async requestInstallationSync(
    input: InstallationSyncRequest,
  ): Promise<{ readonly created: boolean }> {
    return this.outbox.enqueue({
      ...installationSyncRequestedEvent,
      idempotencyKey: `installation:${input.githubInstallationId}:sync:${input.deliveryId}`,
      aggregateId: installationSyncAggregateId(input.githubInstallationId),
      payload: {
        installationId: input.githubInstallationId,
        reason: input.reason,
      },
      maxAttempts: 5,
      occurredAt: input.occurredAt,
    });
  }
}
