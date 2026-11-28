import { describe, expect, it, vi } from "vitest";
import { PrismaInstallationSyncStatusReader } from "../infrastructure/outbox/prisma-installation-sync-status-reader";
import { OutboxInstallationSyncRequester } from "../infrastructure/outbox/outbox-installation-sync-requester";

describe("PrismaInstallationSyncStatusReader", () => {
  it("reads the newest scan request each installation's requester wrote", async () => {
    const requestedAt = new Date("2026-11-17T12:00:00.000Z");
    const queryRaw = vi
      .fn()
      .mockResolvedValue([
        { installationId: "101", status: "processing", createdAt: requestedAt },
      ]);
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
      $queryRaw: queryRaw,
    } as never).latestByInstallation(["101", "202", "101"]);

    const written = (enqueue.mock.calls[0] as unknown[])[0] as {
      type: string;
      version: number;
      aggregateId: string;
    };
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(queryRaw).toHaveBeenCalledWith(
      expect.any(Array),
      ["101", "202"],
      [written.aggregateId, "github-installation:202"],
    );
    const template = queryRaw.mock.calls[0]![0] as readonly string[];
    expect(template.join("")).toContain(`event."type" = '${written.type}'`);
    expect(template.join("")).toContain(`event."version" = ${written.version}`);
    expect([...latest]).toEqual([
      ["101", { status: "processing", requestedAt }],
    ]);
  });

  it("does not issue a query for an empty authorized installation set", async () => {
    const queryRaw = vi.fn();
    const reader = new PrismaInstallationSyncStatusReader({
      $queryRaw: queryRaw,
    } as never);
    await expect(reader.latestByInstallation([])).resolves.toEqual(new Map());
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
