import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CurrentPublicationLifecycleStatus,
  LiveReviewPublicationLifecycleStatus,
  ReviewPublicationLifecycleObservationVersion,
  ResolvePersistedPublicationLifecycle,
  reviewPublicationAttemptId,
  type CurrentPublicationLifecycleFacts,
  type ResolutionHistory,
  type ReviewPublicationAttemptView,
  type ReviewPublicationPermitIdentity,
} from "../index";

const now = new Date("2026-07-23T12:00:00.000Z");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const permit: ReviewPublicationPermitIdentity = {
  workspaceId: "workspace-1",
  repositoryConnectionId: "repository-1",
  scmRepositoryIdentityId: "scm-1",
  pullRequestNumber: 42,
  executionId: "execution-1",
  generation: 1n,
  authorizationId: "authorization-1",
  producerReleaseId: "release-1",
  reviewedHeadSha: "a".repeat(40),
  reviewRevisionHash: hash("revision"),
  projectionHash: hash("projection"),
  lifecycleStateHash: hash("lifecycle"),
  commandLedgerWatermark: 2n,
  permitEpoch: 1n,
  publicationSafetyDecisionHash: hash("safety"),
  publicationNotAfter: new Date(now.getTime() + 60_000),
};
const target = {
  targetId: "target-1",
  threadId: "thread-1",
  markerFingerprint: `rrl_${"a".repeat(32)}`,
  threadStateHash: hash("thread"),
  isResolved: false,
  parentOwnedByIntegration: true,
  hasRelevantInteractionAfterParent: false,
  parentCreatedAt: now,
  lastRelevantChangeAt: now,
};
const clearHistory: ResolutionHistory = {
  threadId: target.threadId,
  version: 1,
  historyCut: {
    activatedAt: "2026-07-23T11:00:00.000Z",
    activationVersion: 1,
    writerDigest: hash("writer"),
  },
  confirmed: null,
  pending: [],
};
const foreignOperation = {
  sourceKind: "canonical_operation" as const,
  operationId: "foreign-operation",
  publicationAttemptId: "foreign-attempt",
  executionId: "foreign-execution",
  generation: "1",
  reviewedHeadSha: permit.reviewedHeadSha,
  bodyHash: hash("foreign-body"),
};

describe("persisted publication lifecycle authority", () => {
  it.each([
    [
      "no prior operation",
      [clearHistory],
      CurrentPublicationLifecycleStatus.Current,
    ],
    ["missing thread history", [], CurrentPublicationLifecycleStatus.Changed],
    [
      "missing activation",
      [{ ...clearHistory, historyCut: null }],
      CurrentPublicationLifecycleStatus.Unavailable,
    ],
    [
      "foreign pending operation",
      [
        {
          ...clearHistory,
          pending: [
            {
              ...foreignOperation,
              state: "may_have_started",
              enteredAt: now.toISOString(),
            },
          ],
        },
      ],
      CurrentPublicationLifecycleStatus.Changed,
    ],
    [
      "confirmed resolve followed by reopen",
      [
        {
          ...clearHistory,
          confirmed: {
            ...foreignOperation,
            effectId: "effect-1",
            observedAt: now.toISOString(),
          },
        },
      ],
      CurrentPublicationLifecycleStatus.Changed,
    ],
  ] as const)(
    "classifies %s without treating an absent first publication as an error",
    async (_name, histories, status) => {
      const resolver = fixture({ histories });
      await expect(resolver.resolve(permit)).resolves.toMatchObject({ status });
    },
  );

  it("keeps a failed history read unavailable and legacy admission independent of history", async () => {
    const read = vi.fn(async (): Promise<readonly ResolutionHistory[]> => {
      throw new Error("history_store_unavailable");
    });
    const required = fixture({ read });
    await expect(required.resolve(permit)).resolves.toMatchObject({
      status: CurrentPublicationLifecycleStatus.Unavailable,
    });
    read.mockClear();
    const legacy = fixture({
      read,
      facts: {
        ...facts(),
        authorization: { createdAt: now, requiresResolutionHistory: false },
      },
    });
    await expect(legacy.resolve(permit)).resolves.toMatchObject({
      status: CurrentPublicationLifecycleStatus.Current,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects mismatched execution, artifact and persisted attempt identities before reading history", async () => {
    const original = facts();
    const view = {
      attempt: {
        publicationAttemptId: reviewPublicationAttemptId({
          ...original.artifact,
          digestUtf8: hash,
        }),
        permit,
        operations: [],
      },
    } as unknown as ReviewPublicationAttemptView;
    const mutations = [
      { facts: { ...original, execution: null }, view },
      {
        facts: {
          ...original,
          execution: { ...original.execution!, executionId: "other" },
        },
        view,
      },
      {
        facts: {
          ...original,
          execution: { ...original.execution!, generation: 2n },
        },
        view,
      },
      {
        facts: {
          ...original,
          execution: {
            ...original.execution!,
            reviewedHeadSha: "b".repeat(40),
          },
        },
        view,
      },
      {
        facts: {
          ...original,
          execution: {
            ...original.execution!,
            reviewRevisionHash: hash("other"),
          },
        },
        view,
      },
      ...[
        { executionId: "other" },
        { generation: 2n },
        { projectionHash: hash("other") },
        { reviewedHeadSha: "b".repeat(40) },
        { reviewRevisionHash: hash("other") },
      ].map((changed) => ({
        facts: original,
        view: {
          ...view,
          attempt: { ...view.attempt, permit: { ...permit, ...changed } },
        },
      })),
    ];
    for (const mutation of mutations) {
      const read = vi.fn(async () => [clearHistory]);
      await expect(
        fixture({ ...mutation, read }).resolve(permit),
      ).resolves.toMatchObject({
        status: CurrentPublicationLifecycleStatus.Unavailable,
      });
      expect(read).not.toHaveBeenCalled();
    }
  });

  it("keeps the aggregate changed when one of multiple unchanged targets has foreign pending history", async () => {
    const second = { ...target, targetId: "target-2", threadId: "thread-2" };
    const resolver = fixture({
      facts: facts([target, second]),
      targets: [target, second],
      histories: [
        clearHistory,
        {
          ...clearHistory,
          threadId: second.threadId,
          pending: [
            {
              ...foreignOperation,
              state: "effect_unknown",
              enteredAt: now.toISOString(),
            },
          ],
        },
      ],
    });
    await expect(resolver.resolve(permit)).resolves.toMatchObject({
      status: CurrentPublicationLifecycleStatus.Changed,
    });
  });
});

function facts(targets = [target]): CurrentPublicationLifecycleFacts {
  return {
    execution: {
      executionId: permit.executionId,
      generation: permit.generation,
      reviewedHeadSha: permit.reviewedHeadSha,
      reviewRevisionHash: permit.reviewRevisionHash,
    },
    artifact: {
      artifactId: "artifact-1",
      executionId: permit.executionId,
      generation: permit.generation,
      reviewedHeadSha: permit.reviewedHeadSha,
      reviewRevisionHash: permit.reviewRevisionHash,
      projectionHash: permit.projectionHash,
      lifecycleStateHash: permit.lifecycleStateHash,
      commandLedgerWatermark: permit.commandLedgerWatermark,
      publicationPermit: permit,
      projectionEnvelopeJson: JSON.stringify({
        publishing: {
          lifecycleObservationVersion:
            ReviewPublicationLifecycleObservationVersion.ThreadStateV1,
          lifecycle: targets.map((item) => ({
            targetId: item.targetId,
            threadId: item.threadId,
            mutationEligible: true,
            markerFingerprint: item.markerFingerprint,
            threadStateHash: item.threadStateHash,
          })),
        },
      }),
    },
    authorization: { createdAt: now, requiresResolutionHistory: true },
  };
}

function fixture(
  input: {
    facts?: CurrentPublicationLifecycleFacts;
    view?: ReviewPublicationAttemptView;
    histories?: readonly ResolutionHistory[];
    read?: () => Promise<readonly ResolutionHistory[]>;
    targets?: readonly (typeof target)[];
  } = {},
) {
  return new ResolvePersistedPublicationLifecycle({
    facts: { readCurrent: async () => input.facts ?? facts() },
    live: {
      resolve: async () => ({
        status: LiveReviewPublicationLifecycleStatus.Available,
        reviewedHeadSha: permit.reviewedHeadSha,
        commandLedgerWatermark: permit.commandLedgerWatermark,
        targets: input.targets ?? [target],
      }),
    },
    publications: { findByPermitIdentity: async () => input.view ?? null },
    resolutionHistory: {
      read: input.read ?? (async () => input.histories ?? [clearHistory]),
    },
    digestUtf8: hash,
  });
}
