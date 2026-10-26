import {
  lifecycleVerificationContract,
  lifecycleVerificationDescriptorDigest,
  reviewModelDispatchContract,
} from "@reviewrouter/shared";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../domain/review-run-control-types";
import { parseReviewRunRuntimeSnapshot } from "../domain/review-run-runtime-snapshot";

const snapshot = {
  snapshotVersion: 3,
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
describe("private runtime snapshot v3 codec", () => {
  it("preserves historical capture bytes and captures only an exact optional extension", () => {
    const legacy = parseReviewRunRuntimeSnapshot(canonicalJson(snapshot));
    expect(Object.hasOwn(legacy!, "prDescriptionCapability")).toBe(false);
    expect(
      createHash("sha256").update(canonicalJson(legacy)).digest("hex"),
    ).toBe("5e08ee1f44ee0f0c7737d77e5c4ebe51534314e1d0d65f22286d2e370905616b");
    const current = {
      ...snapshot,
      prDescriptionCapability: {
        extensionId: "pr-description.v1",
        canonicalizerDigest: "e".repeat(64),
      },
    };
    expect(parseReviewRunRuntimeSnapshot(canonicalJson(current))).toEqual(
      current,
    );
    expect(() =>
      parseReviewRunRuntimeSnapshot(
        canonicalJson({ ...current, prDescriptionCapability: null }),
      ),
    ).toThrow();
  });

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

describe("original Hosted grant snapshot identity", () => {
  const hosted = {
    grantId: "original-grant",
    invocationId: "original-invocation",
    poolId: "original-pool",
    repositoryBindingId: "original-binding",
    activeAccountId: "original-account",
    reviewRequestId: "original-review-request",
    providerInvocationKey: "a".repeat(64),
    policyFingerprint: "b".repeat(64),
    model: "gpt-5.5",
    expiresAt: "2026-10-15T00:01:00.000Z",
    bindingRevision: 7,
    runtimeConfigVersion: 7,
    authzEpoch: "2",
    runtimeAuthzEpoch: "3",
  };
  const current = {
    ...snapshot,
    agent: { ...snapshot.agent, modelTransports: ["provider_api"] },
    configurationCanonicalJson: canonicalJson({
      schemaVersion: 3,
      providers: [
        {
          authMode: "codex_subscription_oauth_hosted_pool",
          model: hosted.model,
        },
      ],
    }),
    hosted,
    modelDispatchCapability: {
      extensionId: reviewModelDispatchContract.extensionId,
      version: 2,
      transport: "hosted_pool",
      wireProtocol: "codex-responses",
      outputTokenLimit: "terminal_acceptance",
      routeIdentityHash: "c".repeat(64),
      providerIndex: 0,
      model: hosted.model,
      deadline: snapshot.deadline,
      maxRequests: 8,
      maxConcurrentRequests: 1,
      maxRequestBytes: 65536,
      maxResponseBytes: 32768,
      maxOutputTokens: 4096,
    },
  };
  it("retains the original nonsecret grant and exact account with completion reserve", () => {
    expect(parseReviewRunRuntimeSnapshot(canonicalJson(current))).toEqual(
      current,
    );
    expect(
      parseReviewRunRuntimeSnapshot(canonicalJson(snapshot)),
    ).not.toHaveProperty("hosted");
  });
  it("rejects absent, incompatible, expired-reserve, or token-bearing selections", () => {
    for (const change of [
      { hosted: undefined },
      { hosted: { ...hosted, grant: "secret" } },
      { hosted: { ...hosted, model: "different-model" } },
      { hosted: { ...hosted, expiresAt: "2026-10-15T00:00:59.999Z" } },
      { hosted: { ...hosted, authzEpoch: "0" } },
      { hosted: { ...hosted, runtimeAuthzEpoch: "01" } },
      { hosted: { ...hosted, bindingRevision: Number.MAX_SAFE_INTEGER + 1 } },
      {
        modelDispatchCapability: {
          ...current.modelDispatchCapability,
          transport: "runner_local_responses",
        },
      },
      { modelDispatchCapability: undefined },
    ])
      expect(() =>
        parseReviewRunRuntimeSnapshot(canonicalJson({ ...current, ...change })),
      ).toThrow();
  });
});

describe("lifecycle verifier captured authority", () => {
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
      requests: 9,
      concurrency: 1,
      requestBytes: 98304,
      outputBytes: 32768,
      tokens: 4096,
    },
  };
  const capability = {
    extensionId: "lifecycle-verification.v1",
    descriptorDigest: lifecycleVerificationDescriptorDigest,
    executor: "rr_bounded_lifecycle_verifier.v1",
    modelTransport: "account_gateway",
    providerIndex: 0,
    providerKind: "codex",
    model: "saved-model",
    maxDispatches: 2,
    maxPromptBytes: 98304,
    maxResponseBytes: 32768,
    maxOutputTokens: 4096,
    deadlineMs: 60000,
    attemptBudget: 1,
  };
  const current = {
    ...snapshot,
    gateway,
    configurationCanonicalJson: canonicalJson({
      schemaVersion: 3,
      providers: [{ authMode: "codex_account_gateway", model: "saved-model" }],
    }),
    lifecycleVerificationCapability: capability,
  };
  it("binds canonical descriptor bytes, selected model and the original aggregate grant", () => {
    expect(
      `sha256:${createHash("sha256").update(canonicalJson(lifecycleVerificationContract)).digest("hex")}`,
    ).toBe(lifecycleVerificationDescriptorDigest);
    const parsed = parseReviewRunRuntimeSnapshot(canonicalJson(current));
    expect(parsed?.lifecycleVerificationCapability).toEqual(capability);
    expect(parsed?.gateway?.limits.requests).toBe(9);
  });
  it("rejects enabled capability forgery rather than dropping it", () => {
    for (const change of [
      { descriptorDigest: `sha256:${"a".repeat(64)}` },
      { model: "other-model" },
      { providerKind: "ocr" },
      { providerIndex: 1 },
      { maxOutputTokens: 4097 },
      { maxPromptBytes: 98305 },
      { attemptBudget: 2 },
      { maxDispatches: 3 },
      { deadlineMs: 60001 },
      { maxOutputTokens: 1023 },
      { tools: true },
    ])
      expect(() =>
        parseReviewRunRuntimeSnapshot(
          canonicalJson({
            ...current,
            lifecycleVerificationCapability: { ...capability, ...change },
          }),
        ),
      ).toThrow();
    expect(() =>
      parseReviewRunRuntimeSnapshot(
        canonicalJson({ ...current, gateway: null }),
      ),
    ).toThrow();
  });
  it("keeps optional configuration failure explicit without fabricating authority", () => {
    const unavailable = {
      ...snapshot,
      lifecycleVerificationUnavailableReason:
        "verification_configuration_invalid",
    };
    expect(parseReviewRunRuntimeSnapshot(canonicalJson(unavailable))).toEqual(
      unavailable,
    );
    expect(() =>
      parseReviewRunRuntimeSnapshot(
        canonicalJson({
          ...current,
          lifecycleVerificationUnavailableReason: "verification_unavailable",
        }),
      ),
    ).toThrow();
  });
});
