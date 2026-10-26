import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import { canonicalJson } from "@reviewrouter/features-review-run-control";
import {
  workspacePolicyFixture,
  workspaceProviderFixture,
} from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import {
  captureOriginalHostedReviewBinding,
  confirmOriginalHostedReviewBinding,
  confirmOriginalHostedReviewBindingForCompletion,
  type HostedReviewBindingReader,
} from "./review-run-hosted-binding";
import { hostedGrantAuthorityIdentity } from "./prisma-hosted-codex-grant-admission";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function fixture() {
  const now = new Date("2026-10-26T00:00:00.000Z");
  const revision = {
    workspaceId: "workspace",
    repositoryConnectionId: "repository",
    scmRepositoryIdentityId: "scm-repository",
    pullRequestNumber: 7,
    baseSha: "a".repeat(40),
    mergeBaseSha: "b".repeat(40),
    headSha: "c".repeat(40),
  };
  const identity = {
    ...revision,
    reviewRevisionHash: hash(canonicalJson(revision)),
    sourceRunId: "12345",
    sourceRunAttempt: "1",
  };
  const configuration = parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers: [
      {
        ...workspaceProviderFixture,
        authMode: "codex_subscription_oauth_hosted_pool",
      },
    ],
  });
  const binding = {
    id: "binding",
    workspaceId: "workspace",
    poolId: "pool",
    repositoryConnectionId: "repository",
    status: "active",
    revision: 3n,
    workflowPath: ".github/workflows/reviewrouter-codex.yml",
    workflowActionRef: `777genius/review-router@${"d".repeat(40)}`,
    workflowSourceCommitSha: "e".repeat(40),
    workflowSourceBlobSha: "f".repeat(40),
    workflowSourceSha256: "1".repeat(64),
    workflowSemanticSha256: "2".repeat(64),
    workflowSourceTrust: "trusted_default_branch_revision",
    attestedGithubRepositoryId: 456n,
    attestedBindingRevision: 3n,
    pool: { status: "active", authzEpoch: 5n },
    repository: {
      id: "repository",
      workspaceId: "workspace",
      provider: "github",
      githubRepositoryId: 456n,
      scmRepositoryIdentityId: "scm-repository",
      selected: true,
      archived: false,
      visibility: "private",
      installation: { status: "active" },
    },
  };
  // This exact property order is the pre-unification grant issuer contract.
  const facts = {
    workspaceId: identity.workspaceId,
    repositoryId: identity.repositoryConnectionId,
    reviewRequestId: "original-review-request",
    pullRequestNumber: identity.pullRequestNumber,
    reviewHeadSha: identity.headSha,
    reviewRevisionHash: identity.reviewRevisionHash,
    runtimeConfigVersion: 4,
    provider: configuration.providers[0]!,
    bindingId: binding.id,
    bindingRevision: 3,
    authzEpoch: "5",
    runtimeAuthzEpoch: "7",
    workflowSourceSha256: binding.workflowSourceSha256,
  };
  const grant = {
    id: "original-grant",
    invocationId: "original-invocation",
    authorityKind: "v1_comment",
    policyVersion: "hosted-codex-v1",
    workspaceId: identity.workspaceId,
    repositoryConnectionId: identity.repositoryConnectionId,
    poolId: "pool",
    repositoryBindingId: binding.id,
    bindingRevision: 3n,
    reviewRequestId: facts.reviewRequestId,
    providerInvocationKey: hash(JSON.stringify(facts)),
    policyFingerprint: hash(
      JSON.stringify({ version: "hosted-codex-v1", ...facts }),
    ),
    model: facts.provider.model,
    runtimeConfigVersion: 4,
    runId: identity.sourceRunId,
    runAttempt: 1,
    activeAccountId: "primary-account",
    authzEpoch: 5n,
    runtimeAuthzEpoch: 7n,
    status: "issued",
    revokedAt: null as Date | null,
    expiresAt: new Date(now.getTime() + 600_000),
    account: {
      id: "primary-account",
      workspaceId: "workspace",
      poolId: "pool",
      state: "healthy",
      cooldownUntil: null as Date | null,
      activeGeneration: 1n as bigint | null,
    },
    binding,
  };
  const intent = {
    ...identity,
    requestId: facts.reviewRequestId,
    admissionState: "admitted",
    state: "awaiting_authorization",
  };
  const gate = { status: "active", authzEpoch: 7n };
  const grants = [grant];
  const reader = {
    hostedCodexInvocationGrant: { findMany: vi.fn(async () => grants) },
    hostedCodexRuntimeGate: { findUnique: vi.fn(async () => gate) },
    reviewRequestedIntent: { findUnique: vi.fn(async () => intent) },
  };
  const input = {
    reader: reader as unknown as HostedReviewBindingReader,
    identity,
    configuration,
    configurationVersion: 4,
    now,
  };
  return { input, reader, facts, grant, grants, intent, gate, binding };
}
type Fixture = ReturnType<typeof fixture>;

describe("original Hosted review grant binding", () => {
  it("captures only the original admitted grant and preserves the legacy authority fingerprints", async () => {
    const f = fixture();
    expect(hostedGrantAuthorityIdentity(f.facts)).toEqual({
      providerInvocationKey: f.grant.providerInvocationKey,
      policyFingerprint: f.grant.policyFingerprint,
    });
    const captured = await captureOriginalHostedReviewBinding(f.input);
    expect(captured).toEqual({
      grantId: f.grant.id,
      invocationId: f.grant.invocationId,
      poolId: f.grant.poolId,
      repositoryBindingId: f.binding.id,
      bindingRevision: 3,
      activeAccountId: f.grant.activeAccountId,
      reviewRequestId: f.intent.requestId,
      providerInvocationKey: f.grant.providerInvocationKey,
      policyFingerprint: f.grant.policyFingerprint,
      model: f.grant.model,
      runtimeConfigVersion: 4,
      authzEpoch: "5",
      runtimeAuthzEpoch: "7",
      expiresAt: f.grant.expiresAt.toISOString(),
    });
    expect(f.reader.hostedCodexInvocationGrant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: "workspace",
          repositoryConnectionId: "repository",
          runId: "12345",
          runAttempt: 1,
          authorityKind: "v1_comment",
        },
        take: 2,
      }),
    );
    expect(f.reader.reviewRequestedIntent.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requestId: "original-review-request" },
      }),
    );
    await expect(
      confirmOriginalHostedReviewBinding({ ...f.input, original: captured! }),
    ).resolves.toBe(true);
  });

  it("rejects missing and ambiguous grants instead of picking the newest or creating another", async () => {
    const missing = fixture();
    missing.grants.splice(0);
    await expect(
      captureOriginalHostedReviewBinding(missing.input),
    ).resolves.toBeNull();
    expect(
      missing.reader.reviewRequestedIntent.findUnique,
    ).not.toHaveBeenCalled();
    const ambiguous = fixture();
    ambiguous.grants.push({ ...ambiguous.grant, id: "another-grant" });
    await expect(
      captureOriginalHostedReviewBinding(ambiguous.input),
    ).resolves.toBeNull();
  });

  const mutations: [string, (f: Fixture) => void][] = [
    [
      "expired grant",
      (f) => {
        f.grant.expiresAt = f.input.now;
      },
    ],
    [
      "revoked grant",
      (f) => {
        f.grant.revokedAt = f.input.now;
      },
    ],
    [
      "exhausted grant",
      (f) => {
        f.grant.status = "exhausted";
      },
    ],
    [
      "different grant authority",
      (f) => {
        f.grant.authorityKind = "v4_relay_turn";
      },
    ],
    [
      "different workspace",
      (f) => {
        f.grant.workspaceId = "another-workspace";
      },
    ],
    [
      "different run attempt",
      (f) => {
        f.grant.runAttempt = 2;
      },
    ],
    [
      "closed runtime",
      (f) => {
        f.gate.status = "closed";
      },
    ],
    [
      "new runtime epoch",
      (f) => {
        f.gate.authzEpoch++;
      },
    ],
    [
      "new pool epoch",
      (f) => {
        f.binding.pool.authzEpoch++;
      },
    ],
    [
      "paused pool",
      (f) => {
        f.binding.pool.status = "paused";
      },
    ],
    [
      "changed binding",
      (f) => {
        f.binding.revision++;
      },
    ],
    [
      "stale workflow attestation",
      (f) => {
        f.binding.attestedBindingRevision = 2n;
      },
    ],
    [
      "archived repository",
      (f) => {
        f.binding.repository.archived = true;
      },
    ],
    [
      "changed SCM identity",
      (f) => {
        f.binding.repository.scmRepositoryIdentityId = "other-scm";
      },
    ],
    [
      "disabled installation",
      (f) => {
        f.binding.repository.installation.status = "suspended";
      },
    ],
    [
      "unadmitted intent",
      (f) => {
        f.intent.admissionState = "rejected";
      },
    ],
    [
      "superseded intent",
      (f) => {
        f.intent.state = "superseded";
      },
    ],
    [
      "different pull request",
      (f) => {
        f.intent.pullRequestNumber++;
      },
    ],
    [
      "different base",
      (f) => {
        f.intent.baseSha = "f".repeat(40);
      },
    ],
    [
      "different merge base",
      (f) => {
        f.intent.mergeBaseSha = "f".repeat(40);
      },
    ],
    [
      "different head",
      (f) => {
        f.intent.headSha = "f".repeat(40);
      },
    ],
    [
      "different revision",
      (f) => {
        f.intent.reviewRevisionHash = "f".repeat(64);
      },
    ],
    [
      "different intent attempt",
      (f) => {
        f.intent.sourceRunAttempt = "2";
      },
    ],
    [
      "different model",
      (f) => {
        f.grant.model = "gpt-other";
      },
    ],
    [
      "different policy fingerprint",
      (f) => {
        f.grant.policyFingerprint = "f".repeat(64);
      },
    ],
    [
      "missing account generation",
      (f) => {
        f.grant.account.activeGeneration = null;
      },
    ],
    [
      "paused account",
      (f) => {
        f.grant.account.state = "paused";
      },
    ],
    [
      "future account cooldown",
      (f) => {
        f.grant.account.state = "cooldown";
        f.grant.account.cooldownUntil = new Date(f.input.now.getTime() + 1000);
      },
    ],
  ];
  it.each(mutations)("denies fresh work with %s", async (_name, mutate) => {
    const f = fixture();
    mutate(f);
    await expect(
      captureOriginalHostedReviewBinding(f.input),
    ).resolves.toBeNull();
  });

  it("allows completion after the final original request without authorizing more work", async () => {
    const f = fixture();
    const original = (await captureOriginalHostedReviewBinding(f.input))!;
    await expect(
      confirmOriginalHostedReviewBindingForCompletion({ ...f.input, original }),
    ).resolves.toBe(true);
    f.grant.status = "exhausted";
    await expect(
      captureOriginalHostedReviewBinding(f.input),
    ).resolves.toBeNull();
    await expect(
      confirmOriginalHostedReviewBinding({ ...f.input, original }),
    ).resolves.toBe(false);
    await expect(
      confirmOriginalHostedReviewBindingForCompletion({ ...f.input, original }),
    ).resolves.toBe(true);
  });

  it.each(mutations.filter(([name]) => name !== "exhausted grant"))(
    "does not weaken original completion authority for %s",
    async (_name, mutate) => {
      const f = fixture();
      const original = (await captureOriginalHostedReviewBinding(f.input))!;
      f.grant.status = "exhausted";
      mutate(f);
      await expect(
        confirmOriginalHostedReviewBindingForCompletion({ ...f.input, original }),
      ).resolves.toBe(false);
    },
  );

  it("rejects policy changes even when a repository's inherited configuration version/model stay the same", async () => {
    const f = fixture();
    f.input.configuration = parseReviewConfigurationStrict({
      ...f.input.configuration,
      providers: [
        { ...f.input.configuration.providers[0], reasoningEffort: "low" },
      ],
    });
    await expect(
      captureOriginalHostedReviewBinding(f.input),
    ).resolves.toBeNull();
  });

  it("never recaptures an account switch or extended grant expiry as the original selection", async () => {
    const f = fixture();
    const original = (await captureOriginalHostedReviewBinding(f.input))!;
    f.grant.activeAccountId = "backup-account";
    f.grant.account.id = "backup-account";
    await expect(
      confirmOriginalHostedReviewBinding({ ...f.input, original }),
    ).resolves.toBe(false);
    f.grant.activeAccountId = original.activeAccountId;
    f.grant.account.id = original.activeAccountId;
    f.grant.expiresAt = new Date(f.grant.expiresAt.getTime() + 60_000);
    await expect(
      confirmOriginalHostedReviewBinding({ ...f.input, original }),
    ).resolves.toBe(false);
  });

  it("allows credential refresh within the same original account without selecting a replacement", async () => {
    const f = fixture();
    const original = (await captureOriginalHostedReviewBinding(f.input))!;
    f.grant.account.activeGeneration = 2n;
    await expect(
      confirmOriginalHostedReviewBinding({ ...f.input, original }),
    ).resolves.toBe(true);
  });
});
