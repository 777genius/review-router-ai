import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { registerReviewSnapshotReadV2Routes } from "../../packages/features/action-control-plane/src/v2/interface/index.js";
import {
  prepareReviewObservationPayload,
  reviewEvidencePayloadVersion,
  reviewReuseEligibilityPolicyVersion,
  ReviewFindingSeverity,
  ReviewLifecycleRevalidationVerdict,
  type ReviewObservationPayload,
} from "../../packages/features/review-evidence/src/index.js";
import { canonicalJson } from "../../packages/features/review-run-control/src/index.js";
import {
  canonicalizeReviewActionV2Request,
  ReviewActionV2OperationId,
  reviewActionV2PublishedProtocolVersion,
  reviewActionV2PublishedSchemaDigest,
  type ReviewEvidenceCommitRequest,
  type ReviewExecutionFinalizeRequest,
} from "../../packages/protocol-review-action-v2/src/index.js";
import {
  createReviewActionV2E2EHarness,
  resetReviewActionV2E2EDatabase,
  type ReviewActionV2E2EHarness,
  type ReviewActionV2E2EAuthorization,
} from "../review-action-v2-production-e2e/support/review-action-v2-e2e-harness.js";
import { createPairedResolutionWriterFixture } from "./support/resolution-writer-fixture.js";
import { installComparisonThreadBoundary } from "./support/review-banner-comparison-fixture.js";

const enabled =
  process.env.REVIEW_ROUTER_REVIEW_INVESTIGATION_PAIRED_E2E === "1";
const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const actionSourceDir = process.env.REVIEW_ROUTER_ACTION_SOURCE_DIR;
if (enabled && (!databaseUrl || !actionSourceDir)) {
  throw new Error("paired_comparison_database_and_action_source_required");
}
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const filePath = "src/review-file-000.ts";

// Local paired E2E: real Action factory/parser + authenticated SaaS routes + PG
// worker/receipts. Only provider observations and the configured GitHub App
// boundary are deterministic fixtures; this does not claim a remote GitHub run.
(enabled && databaseUrl && actionSourceDir ? it : it.skip)(
  "publishes first, pending, then receipt-confirmed updated reviews across three heads",
  async () => {
    await resetReviewActionV2E2EDatabase(databaseUrl!);
    const networkFetch = globalThis.fetch;
    const writer = await createPairedResolutionWriterFixture();
    const app = Fastify();
    let ownedFixture: ReviewActionV2E2EHarness | undefined;
    try {
      const fixture = await createReviewActionV2E2EHarness(databaseUrl!, {
        environmentOverrides: {
          ...writer.environment,
          REVIEW_ROUTER_REVIEW_V2_PROJECTION_POLICY_VERSION:
            "review-projection-policy.v6-comparison",
        },
      });
      ownedFixture = fixture;
      const githubFetch = globalThis.fetch;
      globalThis.fetch = (input, init) =>
        new URL(input instanceof Request ? input.url : String(input)).origin ===
        writer.environment.REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_URL
          ? networkFetch(input, init)
          : githubFetch(input, init);
      const threads = installComparisonThreadBoundary(fixture.fakeGitHub);
      await writer.bind(fixture.prisma);
      expect(await writer.activate(fixture)).toEqual({ status: "guarded" });
      vi.stubEnv("REVIEW_ROUTER_REVIEW_BANNER", "1");
      vi.stubEnv(
        "REVIEW_THREAD_LIFECYCLE_TRUSTED_AUTHORS",
        "reviewrouter-e2e[bot]",
      );
      await registerReviewSnapshotReadV2Routes(app, fixture.routes.snapshot);
      const load = (relative: string) =>
        import(pathToFileURL(path.join(actionSourceDir!, relative)).href);
      const [
        factory,
        adapter,
        client,
        defaults,
        coverage,
        github,
        inventory,
        ledger,
      ] = await Promise.all([
        load(
          "src/review-orchestration/infrastructure/production-review-projection.ts",
        ),
        load(
          "src/review-orchestration/infrastructure/review-action-v2-control-plane-adapter.ts",
        ),
        load("src/control-plane/review-action-v2-client.ts"),
        load("src/config/defaults.ts"),
        load("src/review-orchestration/domain/index.ts"),
        load("src/github/client.ts"),
        load(
          "src/review-orchestration/infrastructure/github-review-state-adapter.ts",
        ),
        load("src/github/ledger.ts"),
      ]);
      const controlPlane = new adapter.ReviewActionV2ControlPlaneAdapter(
        new client.ReviewActionV2Client({
          apiUrl: "https://paired.example",
          maxAttempts: 1,
          fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
            const request = new Request(input, init);
            const response = await app.inject({
              method: "POST",
              url: new URL(request.url).pathname,
              headers: Object.fromEntries(request.headers),
              payload: await request.text(),
            });
            return new Response(response.body, {
              status: response.statusCode,
              headers: { "content-type": "application/json" },
            });
          },
        }),
      );
      const githubClient = new github.GitHubClient("paired-read-token", {
        repository: "reviewrouter-e2e/disposable-review-v2",
      });
      const lifecycleInventory = new inventory.FreshGitHubLifecycleInventory(
        githubClient,
        new ledger.ReviewLedger(githubClient, undefined),
      );
      const summaries: string[] = [];
      let firstLineage = "";
      for (let index = 0; index < 3; index += 1) {
        fixture.setRevision({
          baseSha: "c".repeat(40),
          mergeBaseSha: "d".repeat(40),
          headSha: String(index + 1).repeat(40),
        });
        const authorization = await fixture.authorize({
          sourceRunAttempt: String(index + 1),
        });
        const nativeAuthorization = adapter.projectReviewRunAuthorization(
          authorization.result,
        );
        const baseline = await controlPlane.restoreComparisonBaseline({
          authorization: nativeAuthorization,
          reviewRevisionHash: authorization.reviewRevisionHash,
        });
        if (index === 0) {
          expect(baseline).toBeNull();
        } else {
          expect(baseline.sourceReviewedHeadSha).toBe(String(index).repeat(40));
          expect(
            baseline.priorLineageHints.find(
              (hint: { lineageId: string }) => hint.lineageId === firstLineage,
            ).active,
          ).toBe(true);
          expect(baseline.appliedResolutions).toHaveLength(index === 2 ? 1 : 0);
          if (index === 2) {
            // These identities/timestamps come from actual native mutation and
            // persisted successful receipt, never manufactured effect hashes.
            expect(threads.resolveCalls).toBe(1);
            expect(threads.isResolved).toBe(true);
            expect(baseline.appliedResolutions[0]).toMatchObject({
              lineageId: firstLineage,
              threadId: threads.threadId,
              markerFingerprint: firstLineage,
            });
          }
        }
        const prompt = await lifecycleInventory.loadForPrompt(
          42,
          fixture.fakeGitHub.revision.headSha,
        );
        const payload: ReviewObservationPayload = {
          payloadVersion: reviewEvidencePayloadVersion,
          normalizedFindings:
            index === 1
              ? []
              : [
                  finding(
                    index === 0 ? "Original unsafe return" : "New unsafe index",
                    index === 0 ? "a" : "b",
                  ),
                ],
          normalizedLifecycleRevalidations:
            index === 1
              ? [
                  {
                    targetId: prompt.inventory.targets[0].targetId,
                    fingerprint: firstLineage,
                    verdict: ReviewLifecycleRevalidationVerdict.Resolved,
                    confidence: 1,
                    evidence: [
                      {
                        path: filePath,
                        startLine: 1,
                        endLine: 1,
                        reason:
                          "Current code removes the unsafe return and validates the result.",
                      },
                    ],
                    rationale:
                      "The changed implementation removes the original failure.",
                  },
                ]
              : [],
          safeUsage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
        };
        const flow = await committedObservation(
          fixture,
          authorization,
          payload,
        );
        const observation =
          await fixture.prisma.reviewEvidenceObservation.findUniqueOrThrow({
            where: { observationId: flow.observationId },
          });
        const coverageManifest = coverage.createReviewPromptCoverageManifest({
          workSlotId: flow.workSlotId,
          reviewRevisionHash: flow.reviewRevisionHash,
          assignedPaths: [filePath],
          pathCoverage: [
            {
              path: filePath,
              kind: coverage.ReviewPromptPathCoverageKind.FullPatch,
              contentHash: hash("return changed();"),
            },
          ],
        });
        const projection = await factory
          .createProductionReviewProjectionBuilder({
            authorizationFacts: nativeAuthorization.facts,
            pr: {
              number: 42,
              title: "Synthetic paired review",
              body: "",
              author: "fixture",
              draft: false,
              labels: [],
              files: [
                {
                  filename: filePath,
                  status: "modified",
                  additions: 1,
                  deletions: 1,
                  changes: 2,
                  patch: "@@ -1 +1 @@\n-old();\n+return changed();",
                },
              ],
              diff: `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n+++ b/${filePath}\n@@ -1 +1 @@\n-old();\n+return changed();`,
              additions: 1,
              deletions: 1,
              baseSha: fixture.fakeGitHub.revision.baseSha,
              headSha: fixture.fakeGitHub.revision.headSha,
            },
            config: {
              ...defaults.DEFAULT_CONFIG,
              inlineMinSeverity: "critical",
            },
            protocolLimits: nativeAuthorization.limits,
            assignments: [
              {
                workSlotId: flow.workSlotId,
                taskKind: "finding_discovery",
                providerKind: "codex",
                required: true,
                filePaths: [filePath],
              },
            ],
            uncoveredPaths: [],
            uncoveredLifecycleTargetIds: [],
            lifecycleInventory,
          })
          .build({
            comparisonBaseline: baseline,
            acceptedEvidence: [
              {
                workSlotId: flow.workSlotId,
                coverageManifest,
                observation: {
                  observationId: observation.observationId,
                  eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
                  providerKind: "codex",
                  providerInvocationKey: flow.providerInvocationKey,
                  providerVoteIdentityHash:
                    observation.providerVoteIdentityHash,
                  payloadCanonicalJson: canonicalJson(observation.payloadJson),
                  payloadHash: observation.payloadHash,
                  byteCount: observation.byteCount,
                  findingCount: observation.findingCount,
                  actualModel: observation.actualModel,
                  qualityFlags: [],
                  transportAttemptCount: 1,
                  schemaValidated: true,
                  fullyConsumed: true,
                },
              },
            ],
            exhaustedWorkSlotIds: [],
            reviewRevisionHash: flow.reviewRevisionHash,
          });
        const envelope = JSON.parse(projection.projectionEnvelopeCanonicalJson);
        expect(envelope.coverage.state).toBe("complete");
        if (index === 0) {
          expect(envelope.publishing.summary.body).toContain("🟡 **1 major**");
          firstLineage = envelope.snapshot.lineageHints[0].lineageId;
        } else if (index === 1) {
          expect(envelope.publishing.summary.body).toContain(
            "0 new · 0 resolved · 0 confirmed open · 1 previous issue not verified",
          );
          expect(envelope.snapshot.lineageHints[0].active).toBe(true);
          expect(envelope.publishing.lifecycle).toEqual([
            expect.objectContaining({
              verdict: "resolved",
              mutationEligible: true,
            }),
          ]);
          expect(threads.isResolved).toBe(false);
        } else {
          expect(envelope.publishing.summary.body).toContain(
            "1 new · 1 resolved · 1 confirmed open",
          );
          expect(
            envelope.snapshot.lineageHints.find(
              (hint: { lineageId: string }) => hint.lineageId === firstLineage,
            ).active,
          ).toBe(false);
        }
        await fixture.releaseProviderLease(flow);
        const finalized = await finalizeProjection(fixture, flow, projection);
        expect(finalized.result.status).toBe("applied");
        await fixture.processFinalizedOutbox();
        try {
          await fixture.runWorkerUntilSettled();
        } catch (error) {
          const process =
            await fixture.prisma.reviewCompletionProcess.findUnique({
              where: { executionId: flow.executionId },
              select: { state: true, lastSafeReason: true, nextActionAt: true },
            });
          const operations =
            await fixture.prisma.reviewPublicationOperationV2.findMany({
              where: {
                publicationAttemptId:
                  (
                    await fixture.prisma.reviewPublicationAttemptV2.findFirst({
                      where: { executionId: flow.executionId },
                    })
                  )?.publicationAttemptId ?? "missing",
              },
              select: {
                publicationKind: true,
                state: true,
                lastErrorCode: true,
              },
            });
          throw new Error(
            `paired_comparison_worker_failed:${JSON.stringify({ index, process, operations, calls: fixture.fakeGitHub.calls.slice(-8) })}`,
            { cause: error },
          );
        }
        const attempt =
          await fixture.prisma.reviewPublicationAttemptV2.findFirstOrThrow({
            where: { executionId: flow.executionId },
          });
        expect(attempt.terminalOutcome).toBe("succeeded");
        // Native publication markers are revision-scoped. Preserve one managed
        // summary per revision and idempotency within that revision.
        expect(fixture.fakeGitHub.comments).toHaveLength(index + 1);
        const matching = fixture.fakeGitHub.comments.filter((comment) =>
          comment.body.includes(envelope.publishing.summary.marker),
        );
        expect(matching).toHaveLength(1);
        const comment = matching[0]!;
        await fixture.processFinalizedOutbox();
        await fixture.runWorkerUntilSettled();
        expect(fixture.fakeGitHub.comments).toHaveLength(index + 1);
        expect(comment.user.login).toBe("reviewrouter-e2e[bot]");
        expect(comment.body).toContain(envelope.publishing.summary.body);
        expect(comment.body).toContain("/review-banner/v1.svg?");
        expect(comment.body).toContain(
          index === 0 ? "variant=first" : "variant=update",
        );
        summaries.push(comment.body);
        if (index === 0) threads.observeActive(firstLineage, filePath);
      }
      expect(new Set(summaries).size).toBe(3);
      expect(threads.resolveCalls).toBe(1);
      expect(
        fixture.fakeGitHub.calls.some((call) =>
          call.pathname.includes("/access_tokens"),
        ),
      ).toBe(true);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await app.close();
      await writer.close();
      await ownedFixture?.close();
      await resetReviewActionV2E2EDatabase(databaseUrl!);
    }
  },
  90_000,
);

function finding(
  title: string,
  failureMode: string,
): ReviewObservationPayload["normalizedFindings"][number] {
  return {
    category: "correctness",
    normalizedFailureModeHash: failureMode.repeat(64),
    severity: ReviewFindingSeverity.Major,
    title,
    message:
      failureMode === "b"
        ? "A negative index writes to the prior row and corrupts stored data when the caller supplies -1."
        : `${title} permits an incorrect runtime result.`,
    evidence: [],
    path: filePath,
    startLine: null,
    endLine: null,
    placementConfidence: null,
    suggestion: null,
  };
}

async function committedObservation(
  fixture: ReviewActionV2E2EHarness,
  authorization: ReviewActionV2E2EAuthorization,
  payload: ReviewObservationPayload,
) {
  const prepared = prepareReviewObservationPayload(payload);
  const payloadCanonicalJson = canonicalJson(prepared.payload);
  const payloadHash = hash(prepared.canonicalBytes);
  const handler = fixture.routes.evidence.commit!;
  const commit = handler.execute.bind(handler);
  // Substitute deterministic provider bytes at the existing synthetic provider
  // boundary, before the real evidence handler validates and persists them.
  const spy = vi
    .spyOn(handler, "execute")
    .mockImplementation(async (request) => {
      const actual: ReviewEvidenceCommitRequest = {
        ...request,
        payloadCanonicalJson,
        payloadHash,
      };
      return commit({
        ...actual,
        requestBodyHash: hash(
          canonicalizeReviewActionV2Request(
            ReviewActionV2OperationId.ReviewEvidenceCommit,
            actual,
          ),
        ),
      });
    });
  try {
    const emptyFlow = await fixture.createCommittedFlow({
      authorization,
      attachSlotCount: 0,
    });
    const flow = {
      ...emptyFlow,
      payloadHash,
      byteCount: prepared.byteCount,
      findingCount: prepared.findingCount,
    };
    const attached = await fixture.attachCommittedObservation(flow);
    expect(attached.result.status).toBe("applied");
    return flow;
  } finally {
    spy.mockRestore();
  }
}

async function finalizeProjection(
  fixture: ReviewActionV2E2EHarness,
  flow: Awaited<ReturnType<typeof committedObservation>>,
  projection: {
    artifactId: string;
    artifactHash: string;
    projectionEnvelopeCanonicalJson: string;
    projectionHash: string;
    lifecycleStateHash: string;
    commandLedgerWatermark: string;
  },
) {
  const execution = await fixture.prisma.reviewExecutionV2.findUniqueOrThrow({
    where: { executionId: flow.executionId },
  });
  const stream = await fixture.prisma.reviewExecutionStreamV2.findFirstOrThrow({
    where: {
      workspaceId: fixture.workspaceId,
      repositoryConnectionId: fixture.repositoryConnectionId,
      scmRepositoryIdentityId: fixture.scmRepositoryIdentityId,
      pullRequestNumber: 42,
    },
  });
  const request: ReviewExecutionFinalizeRequest = {
    protocolVersion: reviewActionV2PublishedProtocolVersion,
    schemaDigest: reviewActionV2PublishedSchemaDigest,
    requestId: randomUUID(),
    authorizationToken: flow.authorizationToken,
    idempotencyKey: randomUUID(),
    requestBodyHash: "0".repeat(64),
    executionId: flow.executionId,
    expectedStreamVersion: stream.version.toString(),
    expectedExecutionVersion: execution.version.toString(),
    artifactId: projection.artifactId,
    artifactHash: projection.artifactHash,
    projectionEnvelopeVersion: 1,
    projectionEnvelopeCanonicalJson: projection.projectionEnvelopeCanonicalJson,
    projectionHash: projection.projectionHash,
    lifecycleStateHash: projection.lifecycleStateHash,
    commandLedgerWatermark: projection.commandLedgerWatermark,
    allowPartial: false,
  };
  return fixture.routes.execution.finalize!.execute({
    ...request,
    requestBodyHash: hash(
      canonicalizeReviewActionV2Request(
        ReviewActionV2OperationId.ReviewExecutionFinalize,
        request,
      ),
    ),
  });
}
