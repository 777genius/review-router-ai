import { expect, it } from "vitest";
import { createProviderUsage } from "../composition";
import { buildUsagePeriodReport } from "../application/report-usage";
import { fact } from "./fixture";
it("real assembly binds the store to ingest without owning borrowed resources", async () => {
  let writes = 0;
  let disposed = 0;
  const borrowed = {
    ingest: async () => {
      writes++;
      return { status: "accepted" as const, hash: "digest" };
    },
    shutdown: async () => {
      disposed++;
    },
  };
  const reports = {
    read: async () => [],
    report: async (q: Parameters<typeof buildUsagePeriodReport>[1]) =>
      buildUsagePeriodReport([], q),
  };
  const usage = await createProviderUsage({ store: borrowed, reports });
  expect(usage.source).toBeNull();
  expect(usage.reports).toBe(reports);
  await usage.ingestUsage.execute(fact(), {
    workspaceId: "workspace-1",
    invocationId: "invocation-1",
    source: "native",
    now: new Date("2026-10-21T12:00:00Z"),
    replayUntil: new Date("2026-11-01"),
  });
  expect(writes).toBe(1);
  await usage.shutdown();
  expect(disposed).toBe(0);
});
it("rejects a missing binding before store I/O", async () => {
  let writes = 0;
  await expect(
    createProviderUsage({
      store: {
        ingest: async () => {
          writes++;
          return { status: "accepted", hash: "x" };
        },
      },
      reports: undefined,
    } as never),
  ).rejects.toThrow("usage_composition_binding_invalid");
  expect(writes).toBe(0);
});

it("rejects a reader missing period reports before any adapter I/O", async () => {
  let calls = 0;
  await expect(
    createProviderUsage({
      store: {
        ingest: async () => {
          calls++;
          return { status: "accepted", hash: "x" };
        },
      },
      reports: {
        read: async () => {
          calls++;
          return [];
        },
      },
    } as never),
  ).rejects.toThrow("usage_composition_binding_invalid");
  expect(calls).toBe(0);
});
