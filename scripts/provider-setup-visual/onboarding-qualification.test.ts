import { describe, expect, it } from "vitest";
import {
  ONBOARDING_REQUIRED_SHOTS,
  onboardingQualificationProblems,
} from "./onboarding-qualification.js";

function completeRun() {
  const source = {
    revision: "a".repeat(40),
    tree: "b".repeat(40),
    sourceDeltaSha256: "c".repeat(64),
    untrackedPaths: [],
  };
  return {
    flows: Object.entries(ONBOARDING_REQUIRED_SHOTS).map(([flow, shots]) => ({
      flow,
      status: "pass",
      checks: [{ pass: true }],
      screenshots: shots.map(
        (shot, index) => `flows/${flow}--${index}-${shot}.png`,
      ),
      pageErrors: [] as string[],
    })),
    unavailableScreenshots: [] as string[],
    network: { githubUnhandled: [] as string[], blocked: [] as string[] },
    sourceBefore: source,
    sourceAfter: { ...source },
  };
}

describe("bounded onboarding qualification", () => {
  it("accepts the complete explicit boundary with unchanged source", () => {
    expect(onboardingQualificationProblems(completeRun())).toEqual([]);
  });
  it("rejects an empty or skipped acceptance set", () => {
    const run = completeRun();
    expect(onboardingQualificationProblems({ ...run, flows: [] })).toHaveLength(
      3,
    );
    run.flows[0]!.status = "skipped";
    expect(onboardingQualificationProblems(run)).toContain(
      "flow-step3-create-attach: skipped",
    );
  });
  it("does not accept pass when the browser crashed or no check executed", () => {
    const run = completeRun();
    run.flows[0]!.pageErrors.push("render failed");
    run.flows[1]!.checks = [];
    expect(onboardingQualificationProblems(run)).toHaveLength(2);
  });
  it("requires the actual screenshot files and every declared UI state", () => {
    const run = completeRun();
    run.flows[2]!.screenshots.pop();
    run.unavailableScreenshots.push(run.flows[0]!.screenshots[0]!);
    expect(onboardingQualificationProblems(run)).toHaveLength(2);
  });
  it("rejects source drift and an unexpected network request", () => {
    const run = completeRun();
    run.sourceAfter.sourceDeltaSha256 = "d".repeat(64);
    run.network.githubUnhandled.push("GET https://api.github.com/unhandled");
    expect(onboardingQualificationProblems(run)).toHaveLength(2);
  });
});
