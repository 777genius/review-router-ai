import { describe, expect, it } from "vitest";
import { normalizeSkillScanReport } from "../domain/skill-scan-report.js";
import { scanProfile, nativeReport } from "./skill-catalog-fixtures.js";
import { capturedNativeSkillSpectorReports } from "./skillspector-native-report-fixtures.js";

describe("SkillSpector import policy", () => {
  it.each(["clear", "warnings", "blocked", "ai"] as const)(
    "classifies captured native %s output",
    (kind) => {
      expect(
        normalizeSkillScanReport(
          capturedNativeSkillSpectorReports[kind],
          scanProfile(kind === "ai" ? "ai" : "static"),
        ).verdict,
      ).toBe(kind === "ai" ? "clear" : kind);
    },
  );
  it("accepts complete static coverage with expected semantic exclusions", () => {
    const report = nativeReport();
    report.analysis_completeness.analyzer_statuses = [
      {
        analyzer_id: "semantic_security_discovery",
        status: "disabled",
        reason_code: "disabled_by_configuration",
      },
    ];
    expect(normalizeSkillScanReport(report, scanProfile())).toEqual({
      verdict: "clear",
      findings: [],
      reportedUsage: null,
    });
  });
  it("retains bounded native AI counters separately from reserved quota", () => {
    expect(
      normalizeSkillScanReport(
        capturedNativeSkillSpectorReports.ai,
        scanProfile("ai"),
      ).reportedUsage,
    ).toEqual({
      callsAttempted: 3,
      callsSucceeded: 3,
      inputTokens: 300,
      outputTokens: 30,
      totalTokens: 330,
    });
    const incomplete = nativeReport("ai");
    incomplete.metadata.llm_calls_succeeded = 1;
    expect(
      normalizeSkillScanReport(incomplete, scanProfile("ai")),
    ).toMatchObject({
      verdict: "incomplete",
      reportedUsage: {
        callsAttempted: 3,
        callsSucceeded: 1,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      },
    });
  });
  it.each([
    { usage: [] },
    {
      usage: [
        { prompt_tokens: -1, completion_tokens: "10", total_tokens: null },
      ],
    },
    {
      usage: [
        {
          prompt_tokens: Number.MAX_SAFE_INTEGER,
          completion_tokens: Number.MAX_SAFE_INTEGER,
          total_tokens: Number.MAX_SAFE_INTEGER,
        },
        { prompt_tokens: 1, completion_tokens: 1, total_tokens: 1 },
      ],
    },
    {
      usage: Array.from({ length: 65 }, () => ({
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
      })),
    },
  ])(
    "records missing or invalid provider usage as unknown, never zero %#",
    ({ usage }) => {
      const report = nativeReport("ai");
      report.metadata.inference_usage = usage;
      expect(normalizeSkillScanReport(report, scanProfile("ai"))).toMatchObject(
        {
          verdict: "clear",
          reportedUsage: {
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
          },
        },
      );
    },
  );
  it("blocks a high issue even when the aggregate score and recommendation are low", () => {
    const report = nativeReport();
    report.risk_assessment.max_issue_severity = "HIGH";
    report.issues = [
      {
        severity: "HIGH",
        explanation: "Sends credentials to an external service.",
        remediation: "Remove credential collection.",
        location: { start_line: 3 },
      },
    ];
    expect(normalizeSkillScanReport(report, scanProfile())).toMatchObject({
      verdict: "blocked",
      findings: [{ severity: "high", line: 3 }],
    });
  });
  it.each(["LOW", "MEDIUM"])(
    "requires acknowledgment for a complete %s issue",
    (severity) => {
      const report = nativeReport();
      report.issues = [
        { severity, explanation: "Review the requested access.", location: {} },
      ];
      expect(normalizeSkillScanReport(report, scanProfile()).verdict).toBe(
        "warnings",
      );
    },
  );
  it("does not allow an inconsistent low recommendation to hide a blocking score", () => {
    const report = nativeReport();
    report.risk_assessment.score = 60;
    expect(normalizeSkillScanReport(report, scanProfile()).verdict).toBe(
      "blocked",
    );
  });
  it.each([
    (r: ReturnType<typeof nativeReport>) => {
      delete (r as Partial<typeof r>).analysis_completeness;
    },
    (r: ReturnType<typeof nativeReport>) => {
      r.analysis_completeness.is_complete = false;
    },
    (r: ReturnType<typeof nativeReport>) => {
      r.execution_successful = false;
    },
    (r: ReturnType<typeof nativeReport>) => {
      r.metadata.skillspector_version = "2.12.0";
    },
    (r: ReturnType<typeof nativeReport>) => {
      r.issues = [{ severity: "UNKNOWN", explanation: "Unknown severity" }];
    },
    (r: ReturnType<typeof nativeReport>) => {
      r.issues = Array.from({ length: 201 }, () => ({
        severity: "LOW",
        explanation: "x",
      }));
    },
  ])("fails closed for malformed or incomplete report %#", (mutate) => {
    const report = nativeReport();
    mutate(report);
    expect(normalizeSkillScanReport(report, scanProfile()).verdict).toBe(
      "incomplete",
    );
  });
  it("requires actual complete model participation for AI, but permits unknown token usage", () => {
    const profile = scanProfile("ai"),
      report = nativeReport("ai");
    expect(normalizeSkillScanReport(report, profile).verdict).toBe("clear");
    report.metadata.llm_calls_succeeded = 0;
    expect(normalizeSkillScanReport(report, profile).verdict).toBe(
      "incomplete",
    );
    expect(normalizeSkillScanReport(nativeReport(), profile).verdict).toBe(
      "incomplete",
    );
    const degraded = nativeReport("ai");
    degraded.metadata.llm_degraded = true;
    expect(normalizeSkillScanReport(degraded, profile).verdict).toBe(
      "incomplete",
    );
    const overBudget = nativeReport("ai");
    overBudget.metadata.llm_calls_attempted = 5;
    overBudget.metadata.llm_calls_succeeded = 5;
    expect(normalizeSkillScanReport(overBudget, profile).verdict).toBe(
      "incomplete",
    );
  });
  it("bounds display fields and removes control and bidi characters", () => {
    const report = nativeReport();
    report.issues = [
      {
        severity: "LOW",
        explanation: "\u202e\u0001" + "x".repeat(5000),
        remediation: "y".repeat(3000),
        location: { start_line: -2 },
      },
    ];
    const finding = normalizeSkillScanReport(report, scanProfile())
      .findings[0]!;
    expect(finding.explanation).toHaveLength(1200);
    expect(finding.remediation).toHaveLength(800);
    expect(finding.line).toBeNull();
    expect(finding.explanation).not.toMatch(/[\u202e\u0001]/);
  });
});
