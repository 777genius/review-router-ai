import { describe, expect, it, vi } from "vitest";
import { PrismaInstallationSyncStatusReader } from "../infrastructure/outbox/prisma-installation-sync-status-reader";
import { OutboxInstallationSyncRequester } from "../infrastructure/outbox/outbox-installation-sync-requester";

describe("PrismaInstallationSyncStatusReader", () => {
  it("reads the newest scan request each installation's requester wrote", async () => {
    const requestedAt = new Date("2026-11-17T12:00:00.000Z");
    const findFirst = vi.fn(
      async (query: { where: { aggregateId: string } }) =>
        query.where.aggregateId === "github-installation:101"
          ? { status: "processing", createdAt: requestedAt }
          : null,
    );
    const enqueue = vi.fn(async () => ({ created: true }));
    await new OutboxInstallationSyncRequester({
      enqueue,
    } as never).requestInstallationSync({
      githubInstallationId: "101",
      deliveryId: "delivery-1",
      reason: "manual_dashboard_sync",
      occurredAt: requestedAt,
    });

    const latest = await new PrismaInstallationSyncStatusReader({
      outboxEvent: { findFirst },
    } as never).latestByInstallation(["101", "202", "101"]);

    const written = (enqueue.mock.calls[0] as unknown[])[0] as {
      type: string;
      version: number;
      aggregateId: string;
    };
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        type: written.type,
        version: written.version,
        aggregateId: written.aggregateId,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { status: true, createdAt: true },
    });
    expect([...latest]).toEqual([
      ["101", { status: "processing", requestedAt }],
    ]);
  });
});
