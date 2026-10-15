import { describe, expect, it } from "vitest";
import {
  parseReviewRunRuntimeSnapshot,
  reviewRunGatewayEpochMatches,
} from "../domain/review-run-runtime-snapshot";
import { canonicalJson } from "../domain/review-run-control-types";

describe("review run control canonical JSON", () => {
  it("uses the generated protocol's locale-independent code-unit key order", () => {
    expect(
      canonicalJson({
        z: 5,
        "\ud83d\ude00": 7,
        _: 3,
        a: 4,
        Z: 2,
        A: 1,
        "\u00e4": 6,
      }),
    ).toBe('{"A":1,"Z":2,"_":3,"a":4,"z":5,"\u00e4":6,"\ud83d\ude00":7}');
  });
});

// RED: a later selected epoch silently replaces the original v2 authority, or
// malformed/legacy snapshots acquire v2 authority through a permissive parser.
describe("private runtime snapshot epoch pin", () => {
  const gateway = {
    providerIndex: 0,
    bindingId: "fixture-binding",
    connectionId: "fixture-source",
    bindingRevision: 1,
    policySubject: "fixture-binding",
    policyRevision: 2,
    permittedAccountRef: "fixture-account",
    profileRef: "fixture-profile",
    invocationId: "fixture-invocation",
    attemptId: "fixture-attempt",
    operationId: "fixture-operation",
    limits: {
      requests: 2,
      concurrency: 1,
      requestBytes: 1024,
      outputBytes: 2048,
      tokens: 128,
    },
  };
  const original = {
    snapshotVersion: 2,
    configurationSource: "repository",
    configurationVersion: 1,
    configurationCanonicalJson: "{}",
    deadline: "2099-01-01T00:00:00.000Z",
    gateway: { ...gateway, expectedAuthorizationEpoch: 7 },
  };
  it("retains an exact positive epoch and rejects replacement on selected readback", () => {
    const snapshot = parseReviewRunRuntimeSnapshot(canonicalJson(original))!;
    expect(snapshot).toEqual(original);
    expect(reviewRunGatewayEpochMatches(snapshot, 7)).toBe(true);
    expect(reviewRunGatewayEpochMatches(snapshot, 8)).toBe(false);
    expect(reviewRunGatewayEpochMatches(snapshot, 0)).toBe(false);
    expect(
      parseReviewRunRuntimeSnapshot(
        canonicalJson({
          ...original,
          gateway: {
            ...gateway,
            expectedAuthorizationEpoch: Number.MAX_SAFE_INTEGER,
          },
        }),
      )?.snapshotVersion,
    ).toBe(2);
  });
  it("rejects malformed, missing and cross-version pins without widening legacy authority", () => {
    for (const epoch of [
      undefined,
      null,
      "7",
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() =>
        parseReviewRunRuntimeSnapshot(
          canonicalJson({
            ...original,
            gateway: { ...gateway, expectedAuthorizationEpoch: epoch },
          }),
        ),
      ).toThrow("review_run_runtime_snapshot_invalid");
    }
    for (const patch of [
      { gateway: null },
      { gateway: { ...original.gateway, limits: undefined } },
      { snapshotVersion: 3 },
      { snapshotVersion: 1 }, // a v1 row cannot smuggle in the epoch field
    ])
      expect(() =>
        parseReviewRunRuntimeSnapshot(canonicalJson({ ...original, ...patch })),
      ).toThrow();
    const legacy = parseReviewRunRuntimeSnapshot(
      canonicalJson({ ...original, snapshotVersion: 1, gateway }),
    )!;
    expect(legacy.snapshotVersion).toBe(1);
    expect(reviewRunGatewayEpochMatches(legacy, 55)).toBe(true);
    expect(
      parseReviewRunRuntimeSnapshot(
        canonicalJson({ ...original, snapshotVersion: 1, gateway: null }),
      )?.gateway,
    ).toBeNull();
  });
});
