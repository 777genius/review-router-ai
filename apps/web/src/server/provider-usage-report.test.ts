import { describe, it, expect, vi } from "vitest";
vi.mock("./dashboard-mutations", () => ({
  getDashboardSignedInActor: vi.fn(),
}));
vi.mock("./prisma", () => ({ getPrisma: vi.fn() }));
import { usageReportQuery } from "./provider-usage-report";
describe("usage report request bounds", () => {
  it("defaults to UTC 30 days and constrains members to their actor", () => {
    const q = usageReportQuery(
      "w",
      "actor",
      "member",
      {},
      new Date("2026-10-21T12:00:00Z"),
    );
    expect(q.from.toISOString()).toBe("2026-09-21T12:00:00.000Z");
    expect(q.actorId).toBe("actor");
    expect(q.limit).toBe(100);
  });
  it.each([
    { from: "invalid" },
    { from: "2026-02-30", to: "2026-03-02" },
    { from: "2026-10-21T24:00:00Z", to: "2026-10-23" },
    { from: "2024-01-01", to: "2026-01-01" },
    { from: "2026-10-21", to: "2026-10-20" },
    { route: "forged" },
  ])("rejects malformed or unbounded filters %s", (filters) =>
    expect(() =>
      usageReportQuery("w", "actor", "member", filters as never),
    ).toThrow("usage_invalid_report_query"),
  );
});
