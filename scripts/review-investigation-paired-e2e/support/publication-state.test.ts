import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../../packages/platform/db/src/index.js";
import { ReviewCompletionSafeReason } from "../../../packages/features/review-processes/src/domain/review-completion-process.js";
import { readPublicationState } from "./publication-state.js";

type Query = {
  readonly where: unknown;
  readonly select: Record<string, boolean>;
  readonly take: number;
};

function stateFixture() {
  const delegate = () => ({
    findMany: vi
      .fn<(query: Query) => Promise<Record<string, unknown>[]>>()
      .mockResolvedValue([]),
  });
  const models = {
    reviewExecutionV2: delegate(),
    reviewPublicationAttemptV2: delegate(),
    reviewCompletionProcess: delegate(),
    reviewPublicationClaimTermV2: delegate(),
    reviewPublicationOperationV2: delegate(),
  };
  const transaction = vi.fn(
    async (read: (reader: typeof models) => Promise<unknown>) => read(models),
  );
  // The test implements only the delegates exercised by this read boundary.
  const prisma = { $transaction: transaction } as unknown as Pick<
    PrismaClient,
    "$transaction"
  >;
  return { models, transaction, prisma };
}

describe("publication state diagnostics", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("bounds an unresponsive transaction at two seconds", async () => {
    const fixture = stateFixture();
    fixture.transaction.mockImplementation(() => new Promise<never>(() => {}));
    let settled = false;
    const pending = readPublicationState(fixture.prisma, "authorization-2");
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ unavailable: "deadline" });
    expect(fixture.transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 500,
      timeout: 1_000,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("redacts a private query failure and clears its timer", async () => {
    const fixture = stateFixture();
    fixture.models.reviewExecutionV2.findMany.mockRejectedValue(
      new Error("Bearer private-token; private database query payload"),
    );

    await expect(
      readPublicationState(fixture.prisma, "authorization-2"),
    ).resolves.toEqual({ unavailable: "query_failed" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds reads and sanitizes persisted codes", async () => {
    const fixture = stateFixture();
    const privateCode = "private-token-and-query-body";
    const executions = [
      { executionId: "execution-1", state: "completed" },
      { executionId: "execution-2", state: "completed" },
    ];
    fixture.models.reviewExecutionV2.findMany.mockResolvedValue(executions);
    fixture.models.reviewPublicationAttemptV2.findMany.mockResolvedValue([
      { publicationAttemptId: "attempt-2", executionId: "execution-2" },
    ]);
    fixture.models.reviewCompletionProcess.findMany.mockResolvedValue([
      {
        executionId: "execution-1",
        lastSafeReason: ReviewCompletionSafeReason.PublicationPending,
      },
      { executionId: "execution-2", lastSafeReason: privateCode },
    ]);
    fixture.models.reviewPublicationOperationV2.findMany.mockResolvedValue(
      [
        "publication_begin_stale_claim",
        "publication_claim_owned_elsewhere",
        "publication_executor_unexpected_failure",
        privateCode,
        null,
      ].map((lastErrorCode) => ({
        publicationAttemptId: "attempt-2",
        lastErrorCode,
      })),
    );

    const state = await readPublicationState(fixture.prisma, "authorization-2");
    if ("unavailable" in state) throw new Error("state_diagnostic_unavailable");
    expect(state.executions).toEqual(executions);
    expect(state.completions.map((entry) => entry.lastSafeReason)).toEqual([
      ReviewCompletionSafeReason.PublicationPending,
      "other",
    ]);
    expect(state.operations.map((entry) => entry.lastErrorCode)).toEqual([
      "publication_begin_stale_claim",
      "publication_claim_owned_elsewhere",
      "publication_executor_unexpected_failure",
      "other",
      null,
    ]);
    expect(JSON.stringify(state)).not.toContain(privateCode);

    const expectedQueries = [
      ["reviewExecutionV2", 2, { authorizationId: "authorization-2" }],
      ["reviewPublicationAttemptV2", 4, { authorizationId: "authorization-2" }],
      [
        "reviewCompletionProcess",
        2,
        { executionId: { in: ["execution-1", "execution-2"] } },
      ],
      [
        "reviewPublicationClaimTermV2",
        8,
        { publicationAttemptId: { in: ["attempt-2"] } },
      ],
      [
        "reviewPublicationOperationV2",
        32,
        { publicationAttemptId: { in: ["attempt-2"] } },
      ],
    ] as const;
    const allowedFields = new Set([
      "executionId",
      "state",
      "publicationAttemptId",
      "terminalOutcome",
      "publicationNotAfter",
      "attemptCount",
      "lastSafeReason",
      "nextActionAt",
      "claimUntil",
      "acquiredAt",
      "renewedAt",
      "expiresAt",
      "publicationKind",
      "chunkIndex",
      "retryCount",
      "lastErrorCode",
      "nextEligibleAt",
    ]);
    for (const [model, take, where] of expectedQueries) {
      const query = fixture.models[model].findMany.mock.calls[0]?.[0];
      expect(query).toMatchObject({ take, where });
      const selected = Object.keys(query?.select ?? {});
      expect(selected.length).toBeGreaterThan(0);
      expect(selected.every((key) => allowedFields.has(key))).toBe(true);
    }

    fixture.models.reviewCompletionProcess.findMany.mockResolvedValue([
      { executionId: "execution-2", lastSafeReason: null },
    ]);
    const withoutReason = await readPublicationState(
      fixture.prisma,
      "authorization-2",
    );
    if ("unavailable" in withoutReason)
      throw new Error("state_diagnostic_unavailable");
    expect(withoutReason.completions[0]?.lastSafeReason).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
