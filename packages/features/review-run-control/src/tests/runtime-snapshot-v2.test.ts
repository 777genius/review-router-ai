import { describe, expect, it } from "vitest";
import { canonicalJson } from "../domain/review-run-control-types";
import { parseReviewRunRuntimeSnapshot } from "../domain/review-run-runtime-snapshot";

const snapshot = {
  snapshotVersion: 2,
  configurationSource: "repository",
  configurationVersion: 7,
  workspaceConfigurationVersion: 2,
  repositoryConfigurationVersion: 7,
  effectivePolicyDigest: `sha256:${"a".repeat(64)}`,
  agent: {
    profileRef: "codex-default",
    agentKind: "codex",
    binarySha256: "a".repeat(64),
    packageVersion: "0.159.2",
    modelTransports: ["account_gateway"],
    contextGateway: true,
    cancellation: true,
  },
  agentProfileDigest: "d".repeat(64),
  producer: {
    producerReleaseId: "producer-1",
    actionCommitSha: "b".repeat(40),
    runtimeCommitSha: "c".repeat(40),
  },
  configurationCanonicalJson: canonicalJson({ schemaVersion: 3 }),
  deadline: "2026-10-15T00:00:00.000Z",
  gateway: null,
};
describe("private runtime snapshot v2 codec", () => {
  it("captures exact producer commits instead of a mutable channel hint", () => {
    expect(
      parseReviewRunRuntimeSnapshot(canonicalJson(snapshot))?.producer,
    ).toEqual(snapshot.producer);
    expect(() =>
      parseReviewRunRuntimeSnapshot(
        canonicalJson({
          ...snapshot,
          producer: { ...snapshot.producer, actionCommitSha: "workflow-v1" },
        }),
      ),
    ).toThrow();
    expect(() =>
      parseReviewRunRuntimeSnapshot(
        canonicalJson({
          ...snapshot,
          producer: { ...snapshot.producer, runtimeRef: "main" },
        }),
      ),
    ).toThrow();
  });
  it("requires explicit bounded allowance on every current gateway pin", () => {
    const gateway = {
      providerIndex: 0,
      bindingId: "binding",
      connectionId: "connection",
      bindingRevision: 1,
      policySubject: "binding",
      policyRevision: 1,
      permittedAccountRef: "account",
      profileRef: "profile",
      invocationId: "invocation",
      attemptId: "attempt",
      operationId: "operation",
      limits: {
        requests: 1,
        concurrency: 1,
        requestBytes: 1024,
        outputBytes: 2048,
        tokens: 100,
      },
    };
    expect(
      parseReviewRunRuntimeSnapshot(canonicalJson({ ...snapshot, gateway }))
        ?.gateway?.limits,
    ).toEqual(gateway.limits);
    const { limits, ...withoutLimits } = gateway;
    expect(() =>
      parseReviewRunRuntimeSnapshot(
        canonicalJson({ ...snapshot, gateway: withoutLimits }),
      ),
    ).toThrow();
    expect(() =>
      parseReviewRunRuntimeSnapshot(
        canonicalJson({
          ...snapshot,
          gateway: { ...gateway, limits: { ...limits, requests: 0 } },
        }),
      ),
    ).toThrow();
  });
  it("retains both policy revisions in the immutable admitted document", () => {
    expect(parseReviewRunRuntimeSnapshot(canonicalJson(snapshot))).toEqual(
      snapshot,
    );
  });
  it("rejects old snapshot and policy schemas", () => {
    expect(() =>
      parseReviewRunRuntimeSnapshot(
        canonicalJson({ ...snapshot, snapshotVersion: 1 }),
      ),
    ).toThrow();
    expect(() =>
      parseReviewRunRuntimeSnapshot(
        canonicalJson({
          ...snapshot,
          configurationCanonicalJson: canonicalJson({ schemaVersion: 2 }),
        }),
      ),
    ).toThrow();
  });
  it("rejects contradictory revision/source identities", () => {
    for (const change of [
      { configurationVersion: 6 },
      { workspaceConfigurationVersion: 0 },
      { repositoryConfigurationVersion: null },
      { configurationSource: "workspace" },
    ]) {
      expect(() =>
        parseReviewRunRuntimeSnapshot(
          canonicalJson({ ...snapshot, ...change }),
        ),
      ).toThrow();
    }
  });
  it("requires a bounded digest and canonical policy bytes", () => {
    expect(() =>
      parseReviewRunRuntimeSnapshot(
        canonicalJson({ ...snapshot, effectivePolicyDigest: "untrusted" }),
      ),
    ).toThrow();
    expect(() =>
      parseReviewRunRuntimeSnapshot(
        canonicalJson({
          ...snapshot,
          configurationCanonicalJson: '{ "schemaVersion": 3 }',
        }),
      ),
    ).toThrow();
  });
});
