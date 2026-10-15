import { describe, expect, it } from "vitest";
import {
  parseReviewRunRuntimeSnapshot,
  reviewRunGatewayEpochMatches,
} from "../domain/review-run-runtime-snapshot";
import { canonicalJson } from "../domain/review-run-control-types";

const agent = {
  profileRef: "approved-toolchain",
  agentKind: "claude",
  binarySha256: "a".repeat(64),
  packageVersion: "1.2.3",
  modelTransports: ["account_gateway"],
  contextGateway: true,
  cancellation: true,
};
const authority = {
  version: 1,
  producer: {
    producerReleaseId: "approved-producer",
    actionCommitSha: "b".repeat(40),
    runtimeCommitSha: "c".repeat(40),
  },
  agent,
  // Wire shape only; registered roster membership/digest content belong to use.
  agentProfileDigest: "d".repeat(64),
};
const legacy = {
  snapshotVersion: 1,
  configurationSource: "repository",
  configurationVersion: 1,
  configurationCanonicalJson: "{}",
  deadline: "2099-01-01T00:00:00.000Z",
  gateway: null,
};
const gateway = {
  providerIndex: 0,
  bindingId: "binding",
  connectionId: "source",
  bindingRevision: 1,
  policySubject: "binding",
  policyRevision: 1,
  permittedAccountRef: "account",
  profileRef: "model-profile",
  invocationId: "invocation",
  attemptId: "attempt",
  operationId: "operation",
  expectedAuthorizationEpoch: 7,
  limits: {
    requests: 1,
    concurrency: 1,
    requestBytes: 1024,
    outputBytes: 1024,
    tokens: 128,
  },
};

describe("private producer-approved agent authority wire", () => {
  it("preserves historical bytes and decodes detached v1/v2 authority without weakening the H epoch", () => {
    for (const snapshot of [
      legacy,
      { ...legacy, snapshotVersion: 2, gateway },
    ]) {
      const bytes = canonicalJson(snapshot);
      const decoded = parseReviewRunRuntimeSnapshot(bytes)!;
      expect(canonicalJson(decoded)).toBe(bytes);
      expect(Object.hasOwn(decoded, "agentAuthority")).toBe(false);
      const input = { ...snapshot, agentAuthority: structuredClone(authority) };
      const extendedBytes = canonicalJson(input);
      const extended = parseReviewRunRuntimeSnapshot(extendedBytes)!;
      expect(canonicalJson(extended)).toBe(extendedBytes);
      input.agentAuthority.agent.modelTransports[0] = "provider_api";
      input.agentAuthority.producer.actionCommitSha = "e".repeat(40);
      expect(extended.agentAuthority).toEqual(authority);
      if (extended.snapshotVersion === 2) {
        expect(reviewRunGatewayEpochMatches(extended, 7)).toBe(true);
        expect(reviewRunGatewayEpochMatches(extended, 8)).toBe(false);
      }
    }
  });

  it("rejects partial, unknown, malformed and noncanonical extensions", () => {
    const without = (key: keyof typeof authority) =>
      Object.fromEntries(
        Object.entries(authority).filter(([name]) => name !== key),
      );
    for (const bad of [
      null,
      {},
      ...Object.keys(authority).map((key) =>
        without(key as keyof typeof authority),
      ),
      { ...authority, version: 2 },
      { ...authority, extra: true },
      { ...authority, producer: { ...authority.producer, extra: true } },
      {
        ...authority,
        producer: { ...authority.producer, producerReleaseId: "bad/id" },
      },
      {
        ...authority,
        producer: { ...authority.producer, actionCommitSha: "b".repeat(39) },
      },
      {
        ...authority,
        producer: { ...authority.producer, runtimeCommitSha: "C".repeat(40) },
      },
      { ...authority, agentProfileDigest: "d".repeat(63) },
      { ...authority, agentProfileDigest: "D".repeat(64) },
      { ...authority, agent: { ...agent, extra: true } },
      { ...authority, agent: { ...agent, agentKind: "unapproved" } },
      { ...authority, agent: { ...agent, binarySha256: "not-a-digest" } },
      { ...authority, agent: { ...agent, contextGateway: false } },
      { ...authority, agent: { ...agent, cancellation: false } },
      {
        ...authority,
        agent: {
          ...agent,
          modelTransports: ["account_gateway", "account_gateway"],
        },
      },
    ])
      expect(() =>
        parseReviewRunRuntimeSnapshot(
          canonicalJson({ ...legacy, agentAuthority: bad }),
        ),
      ).toThrow();
    expect(() =>
      parseReviewRunRuntimeSnapshot(
        JSON.stringify({ ...legacy, agentAuthority: authority }),
      ),
    ).toThrow();
    for (const patch of [
      { gateway: null },
      { gateway: { ...gateway, expectedAuthorizationEpoch: 0 } },
      { gateway: { ...gateway, limits: null } },
    ])
      expect(() =>
        parseReviewRunRuntimeSnapshot(
          canonicalJson({
            ...legacy,
            snapshotVersion: 2,
            agentAuthority: authority,
            ...patch,
          }),
        ),
      ).toThrow();
  });
});
