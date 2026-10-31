import { describe, expect, it } from "vitest";
import {
  OutboxHandlerError,
  safeOutboxErrorSummary,
} from "../domain/outbox-event";
import { InMemoryOutboxEventRepository } from "../infrastructure/memory/in-memory-outbox-event-repository";
import { processOutboxBatch } from "../application/use-cases/process-outbox-batch";

const now = new Date("2026-10-31T10:00:00.000Z");

describe("outbox durable failure privacy", () => {
  it.each([
    new Error("github_pat_privateSuperSecret0123456"),
    new Error("https://example.com/api?access_token=top-secret"),
    new Error("postgresql://admin:password@localhost/data"),
    new Error("private customer repo payload for alice@example.test"),
    "opaque raw failure",
    { message: "glpat_token123456" },
  ])("does not persist generic exception messages", (error) => {
    expect(safeOutboxErrorSummary(error)).toEqual({
      code: "handler_error",
      summary: "outbox_handler_failure",
      retryable: true,
    });
  });

  it.each([true, false])(
    "retains explicitly typed handler retryable=%s without its message",
    (retryable) => {
      expect(
        safeOutboxErrorSummary(
          new OutboxHandlerError(
            "Authorization Bearer github_pat_private123",
            "review_v2_finalized_facts_unavailable",
            retryable,
          ),
        ),
      ).toEqual({
        code: "review_v2_finalized_facts_unavailable",
        summary: "outbox_application_failure",
        retryable,
      });
    },
  );

  it("does not copy arbitrary diagnostic strings through the error code", () => {
    expect(
      safeOutboxErrorSummary(
        new OutboxHandlerError(
          "private",
          "github_pat_Secret-With/Private?Token",
          false,
        ),
      ),
    ).toEqual({
      code: "handler_error",
      summary: "outbox_application_failure",
      retryable: false,
    });
  });

  it("redacts durable retry event facts without changing dispatch or retry semantics", async () => {
    const outbox = new InMemoryOutboxEventRepository();
    await outbox.enqueue({
      type: "secret.delivery",
      version: 1,
      idempotencyKey: "secret-delivery-one",
      workspaceId: "workspace_1",
      repositoryId: "repository_1",
      payload: { kind: "sanitized" },
      maxAttempts: 3,
      occurredAt: now,
    });
    const result = await processOutboxBatch(
      {
        ownerIdHash: "a".repeat(64),
        processingLeaseMs: 60_000,
        limit: 1,
        handlers: [
          {
            type: "secret.delivery",
            version: 1,
            async handle() {
              throw new Error("github_pat_PRIVATE0123456");
            },
          },
        ],
      },
      { outbox, clock: { now: () => now } },
    );
    expect(result.retried).toBe(1);
    const record = [...outbox.events.values()][0];
    expect(record).toMatchObject({
      lastErrorCode: "handler_error",
      safeLastErrorSummary: "outbox_handler_failure",
      status: "retry_wait",
    });
    expect(JSON.stringify(record)).not.toContain("github_pat_PRIVATE0123456");
  });
});
