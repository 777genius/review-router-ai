import { afterEach, describe, expect, it, vi } from "vitest";
import { StatisticsSeverity } from "@reviewrouter/features-review-statistics";
import {
  fetchStatisticsIssues,
  fetchStatisticsReport,
  statisticsReportKey,
  StatisticsRequestError,
} from "./statistics-api";
afterEach(() => vi.unstubAllGlobals());
describe("Statistics browser adapter", () => {
  it("sends only workspace filters, uses no-store and forwards cancellation", async () => {
    const fetch = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            scope: { actorId: "actor-a", workspaceId: "workspace-a" },
            report: {},
            page: { items: [], nextCursor: null },
          }),
          {
            headers: { "content-type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await fetchStatisticsReport(
      "workspace-a",
      { days: 7, severity: StatisticsSeverity.Major },
      signal,
      "actor-a",
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/dashboard/review-statistics?workspaceId=workspace-a&days=7&severity=major",
      { signal, cache: "no-store" },
    );
    await fetchStatisticsIssues(
      "workspace-a",
      {
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-23T12:00:00.000Z",
        severity: "all",
        repositoryId: "repo-a",
        cursor: "a+b/c",
      },
      signal,
      "actor-a",
    );
    const url = new URL(
      fetch.mock.calls[1]![0] as string,
      "https://local.invalid",
    );
    expect(url.searchParams.get("cursor")).toBe("a+b/c");
    expect(url.searchParams.has("actorId")).toBe(false);
  });
  it("preserves HTTP auth status for whole-feature revocation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
    );
    await expect(
      fetchStatisticsReport(
        "workspace-a",
        { days: 30, severity: "all" },
        new AbortController().signal,
        "actor-a",
      ),
    ).rejects.toMatchObject({ status: 403, name: "StatisticsRequestError" });
    expect(new StatisticsRequestError(401).status).toBe(401);
  });
  it.each(["report", "issues"])(
    "rejects mismatched authenticated200 scope for %s before returning data",
    async (kind) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              scope: { actorId: "other-actor", workspaceId: "workspace-a" },
              report: { secret: true },
              page: { items: [] },
            }),
          ),
        ),
      );
      const signal = new AbortController().signal;
      const promise =
        kind === "report"
          ? fetchStatisticsReport(
              "workspace-a",
              { days: 30, severity: "all" },
              signal,
              "actor-a",
            )
          : fetchStatisticsIssues(
              "workspace-a",
              {
                from: "2026-10-01T00:00:00.000Z",
                to: "2026-10-23T12:00:00.000Z",
                severity: "all",
              },
              signal,
              "actor-a",
            );
      await expect(promise).rejects.toMatchObject({ status: 409 });
    },
  );
  it.each([null, {}, { scope: null }])(
    "rejects an unverifiable200 envelope %j",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockImplementation(async () => new Response(JSON.stringify(body))),
      );
      const signal = new AbortController().signal;
      await expect(
        fetchStatisticsReport(
          "workspace-a",
          { days: 30, severity: "all" },
          signal,
          "actor-a",
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        fetchStatisticsIssues(
          "workspace-a",
          {
            from: "2026-10-01T00:00:00.000Z",
            to: "2026-10-23T12:00:00.000Z",
            severity: "all",
          },
          signal,
          "actor-a",
        ),
      ).rejects.toMatchObject({ status: 409 });
    },
  );
  it("partitions actor and authorized seed even inside the same workspace", () => {
    const filter = { days: 30 as const, severity: "all" as const };
    expect(
      statisticsReportKey("actor-a", "workspace", "seed-a", filter),
    ).not.toEqual(
      statisticsReportKey("actor-b", "workspace", "seed-a", filter),
    );
    expect(
      statisticsReportKey("actor-a", "workspace", "seed-a", filter),
    ).not.toEqual(
      statisticsReportKey("actor-a", "workspace", "seed-b", filter),
    );
  });
});
