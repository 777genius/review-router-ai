import { describe, it, expect } from "vitest";
import {
  StatisticsSeverity,
  ReviewStatisticsSettlementState,
  StatisticsValidationError,
} from "../domain/statistics";
import {
  normalizeStatisticsEvent,
  parseReviewStatisticsSettledEvent,
  statisticsPeriod,
  statisticsDate,
  validateStatisticsFilter,
} from "../domain/statistics-policy";
import { statisticsEventHash } from "../infrastructure/statistics-hash";
import { event } from "./fixture";
describe("statistics counting policy", () => {
  it("normalizes compact text and issue order, preserving all 2000 accepted identities", () => {
    const normalized = normalizeStatisticsEvent(
      event({
        issues: [
          {
            lineageId: "z",
            severity: StatisticsSeverity.Unknown,
            title: "\n ",
          },
          {
            lineageId: "a",
            severity: StatisticsSeverity.Minor,
            title: "x".repeat(300),
          },
        ],
      }),
    );
    expect(normalized.issues.map((i) => i.lineageId)).toEqual(["a", "z"]);
    expect(normalized.issues[0]?.title.length).toBe(240);
    expect(normalized.issues[1]?.title).toBe("Reported issue");
    expect(
      normalizeStatisticsEvent(
        event({
          issues: Array.from({ length: 2000 }, (_, i) => ({
            lineageId: String(i),
            severity: StatisticsSeverity.Unknown,
            title: "",
          })),
        }),
      ).issues,
    ).toHaveLength(2000);
    expect(
      normalizeStatisticsEvent(event({ executionId: "x".repeat(256) }))
        .executionId,
    ).toHaveLength(256);
  });
  it("canonical hashes ignore delivery order but detect immutable settlement changes", () => {
    const a = event({
      issues: [
        { lineageId: "b", severity: StatisticsSeverity.Minor, title: "B" },
        { lineageId: "a", severity: StatisticsSeverity.Major, title: "A" },
      ],
    });
    expect(statisticsEventHash(normalizeStatisticsEvent(a))).toBe(
      statisticsEventHash(
        normalizeStatisticsEvent({ ...a, issues: [...a.issues].reverse() }),
      ),
    );
    expect(statisticsEventHash(normalizeStatisticsEvent(a))).not.toBe(
      statisticsEventHash(
        normalizeStatisticsEvent({ ...a, publicationAttemptId: "other" }),
      ),
    );
  });
  it("rejects duplicate lineages, invalid identities/outcomes and oversized sets without truncation", () => {
    for (const value of [
      null,
      {},
      event({ state: "partial" as ReviewStatisticsSettlementState }),
      event({ executionId: "x".repeat(257) }),
      event({ issues: [...event().issues, ...event().issues] }),
      event({
        issues: Array.from({ length: 2001 }, (_, i) => ({
          lineageId: String(i),
          severity: StatisticsSeverity.Unknown,
          title: "",
        })),
      }),
    ])
      expect(() => parseReviewStatisticsSettledEvent(value)).toThrow(
        StatisticsValidationError,
      );
    expect(() => statisticsDate("2026-02-30T00:00:00.000Z")).toThrow(
      StatisticsValidationError,
    );
    expect(() =>
      validateStatisticsFilter({ days: 31 as 30, severity: "all" }),
    ).toThrow(StatisticsValidationError);
  });
  it("includes a partial current UTC day and compares equal elapsed time shifted by preset", () => {
    expect(
      statisticsPeriod(7, new Date("2026-10-23T12:30:00.000Z")),
    ).toMatchObject({
      from: "2026-10-17T00:00:00.000Z",
      to: "2026-10-23T12:30:00.000Z",
      previousFrom: "2026-10-10T00:00:00.000Z",
      previousTo: "2026-10-16T12:30:00.000Z",
    });
    expect(statisticsPeriod(7, new Date("2026-10-24T00:00:00.000Z")).from).toBe(
      "2026-10-18T00:00:00.000Z",
    );
  });
});
