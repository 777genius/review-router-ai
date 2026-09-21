import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  AuthenticatedEfExecution,
  Completion,
} from "@reviewrouter/features-sdk-growth-authority";
import {
  SdkGrowthVerifierCustody,
  sdkGrowthVerifierExecutionId,
  type FinalizedVerifierReportRecord,
  type VerifierCustodyRecord,
} from "./sdk-growth-verifier-custody.js";

const execution: AuthenticatedEfExecution = {
  tenantId: "tenant",
  repositoryId: "repo",
  pullRequest: 42,
  githubRepositoryId: "123",
  installationId: "456",
  subject: "runner",
  runId: "789",
  runAttempt: "1",
  verifierRevision: "1".repeat(40),
  sourceCommit: "2".repeat(40),
  sourceTree: "3".repeat(40),
};
const report = Buffer.from("finalized-report");
const reportDigest =
  "sha256:" + createHash("sha256").update(report).digest("hex");
const digest = "sha256:" + "a".repeat(64);
const completion: Completion = {
  version: 1,
  grantId: "grant",
  fence: 1,
  binding: {
    repositoryId: "repo",
    pullRequest: 42,
    head: "2".repeat(40),
    base: "4".repeat(40),
    mergeBase: "5".repeat(40),
    verifierId: "verifier",
    verifierDigest: digest,
    policyDigest: digest,
    toolDigest: digest,
    artifactDigest: digest,
    lockDigest: digest,
    historyDigest: digest,
    scopeDigest: digest,
    scopes: ["public-api"],
  },
  coveredScopes: ["public-api"],
  coverage: "complete",
  outcome: "passed",
  reportDigest,
};
const evidence: VerifierCustodyRecord = {
  producer: "reviewrouter-verifier",
  candidateWritable: false,
  verifierRevision: execution.verifierRevision,
  sourceCommit: execution.sourceCommit,
  sourceTree: execution.sourceTree,
  candidateArchiveSha256: digest,
  candidateArchiveSha512Sri: "sha512-" + "a".repeat(88),
  releasedArchiveSha256: digest,
  releasedArchiveSha512Sri: "sha512-" + "b".repeat(88),
  toolArchiveSha256: digest,
  toolArchiveSha512Sri: "sha512-" + "c".repeat(88),
  installedDistributionDigest: digest,
  authorityBinding: completion.binding,
};
const finalized: FinalizedVerifierReportRecord = {
  producer: "reviewrouter-verifier",
  candidateWritable: false,
  repositoryId: execution.repositoryId,
  pullRequest: execution.pullRequest,
  runId: execution.runId,
  runAttempt: execution.runAttempt,
  verifierRevision: execution.verifierRevision,
  reportDigest,
  reportLength: report.byteLength,
  grantId: completion.grantId,
  outcome: "passed",
  coverage: "complete",
  coveredScopes: ["public-api"],
  phases: ["authority", "decision"],
  finalizedReport: report,
};
const reportDecision = {
  outcome: "passed" as const,
  coverage: "complete" as const,
  coveredScopes: ["public-api"],
  phases: ["authority", "decision"],
};

function custody(
  retainedEvidence: VerifierCustodyRecord | null = evidence,
  retainedReport: FinalizedVerifierReportRecord | null = finalized,
) {
  return new SdkGrowthVerifierCustody({
    async load() {
      return structuredClone(retainedEvidence);
    },
    async loadFinalizedReport() {
      return structuredClone(retainedReport);
    },
  });
}

describe("SDK verifier custody adapter", () => {
  it("derives distinct evidence identity for pull requests in one execution", () => {
    expect(sdkGrowthVerifierExecutionId(execution)).not.toBe(
      sdkGrowthVerifierExecutionId({ ...execution, pullRequest: 99 }),
    );
  });

  it("accepts verifier-owned archive and finalized report custody", async () => {
    await expect(custody().load(execution)).resolves.toEqual(evidence);
    await expect(
      custody().verifyFinalizedReport({
        execution,
        report,
        completion,
        reportDecision,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects candidate-writable archive and report evidence", async () => {
    await expect(
      custody({ ...evidence, candidateWritable: true } as never).load(
        execution,
      ),
    ).rejects.toMatchObject({ code: "owner-evidence" });
    await expect(
      custody(evidence, {
        ...finalized,
        candidateWritable: true,
      } as never).verifyFinalizedReport({
        execution,
        report,
        completion,
        reportDecision,
      }),
    ).rejects.toMatchObject({ code: "owner-evidence" });
  });

  it.each([
    { pullRequest: 99 },
    { runId: "wrong" },
    { runAttempt: "wrong" },
    { verifierRevision: "9".repeat(40) },
    { reportLength: report.byteLength + 1 },
    { grantId: "wrong" },
  ])("rejects mismatched finalized report custody %#", async (change) => {
    await expect(
      custody(evidence, { ...finalized, ...change }).verifyFinalizedReport({
        execution,
        report,
        completion,
        reportDecision,
      }),
    ).rejects.toMatchObject({ code: "owner-evidence" });
  });

  it.each([
    { outcome: "failed" as const },
    { coverage: "partial" as const },
    { coveredScopes: ["other"] },
    { phases: ["authority"] },
  ])(
    "rejects a caller decision that differs from the trusted report %#",
    async (change) => {
      await expect(
        custody().verifyFinalizedReport({
          execution,
          report,
          completion,
          reportDecision: { ...reportDecision, ...change },
        }),
      ).rejects.toMatchObject({ code: "owner-evidence" });
    },
  );
});
