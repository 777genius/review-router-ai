import { describe, expect, it } from "vitest";
import {
  actionConflictReviewRuntimeConfigSchema as legacySchema,
  conflictReviewAdvisoryStatusContext as legacyStatusContext,
  conflictReviewSummaryMaxBytes as legacySummaryLimit,
} from "../domain/action-control-plane.js";
import {
  actionConflictReviewRuntimeConfigSchema as publishedSchema,
  conflictReviewAdvisoryStatusContext as publishedStatusContext,
  conflictReviewSummaryMaxBytes as publishedSummaryLimit,
} from "../conflict-runtime-contract.js";

describe("conflict runtime published domain contract", () => {
  it("preserves the existing Action v1 schema and constants by reference", () => {
    expect(publishedSchema).toBe(legacySchema);
    expect(publishedStatusContext).toBe(legacyStatusContext);
    expect(publishedSummaryLimit).toBe(legacySummaryLimit);
  });

  it("preserves the exact bounded conflict-review validation contract", () => {
    const headSha = "a".repeat(40);
    const baseSha = "b".repeat(40);
    const valid = {
      protocolVersion: 1,
      reviewKind: "conflict-head",
      dispatchId: "cr_123e4567-e89b-12d3-a456-426614174000",
      pullRequestNumber: 7,
      headSha,
      baseRef: "main",
      baseSha,
      checkout: {
        mode: "exact_head_sha",
        headSha,
        baseRef: "main",
        baseSha,
        persistCredentials: false,
      },
      diff: {
        mode: "expected_base_to_head",
        headSha,
        baseSha,
        maxFiles: 100,
        maxBytes: 256 * 1024,
        maxPatchBytesPerFile: 48 * 1024,
      },
      posting: {
        mode: "disabled",
        reason: "posting_proxy_not_enabled",
      },
    };
    expect(publishedSchema.safeParse(valid).success).toBe(true);
    expect(
      publishedSchema.safeParse({
        ...valid,
        checkout: { ...valid.checkout, persistCredentials: true },
      }).success,
    ).toBe(false);
    expect(
      publishedSchema.safeParse({
        ...valid,
        posting: { ...valid.posting, unexpectedProviderToken: "secret" },
      }).success,
    ).toBe(false);
  });
});
