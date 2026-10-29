import { describe, expect, it } from "vitest";
import {
  assertCodexRuntimeMigrationSourceProof,
  codexRuntimeMigrationAudience,
  codexRuntimeMigrationBindingSchema,
  codexRuntimeMigrationReusableWorkflowPath,
  codexRuntimeMigrationWorkflowPath,
  codexRotatingSetupPayloadClaimSchema,
  codexRotatingSetupPayloadClaimsMatch,
} from "@reviewrouter/features-provider-setup";
import type { GitHubActionsOidcClaims } from "@reviewrouter/features-action-control-plane/oidc";
import { assertCodexRuntimeMigrationOidc } from "./codex-runtime-migration-exchange";
import { assertOriginalCodexRuntimeMigrationSource } from "./codex-runtime-migration-source";
import {
  codexRuntimeMigrationFixture,
  digest,
} from "./test-support/codex-runtime-migration-fixture";

describe("credential-preserving runtime migration", () => {
  it("qualifies a canonical bootstrap without changing old workflow or namespace", async () => {
    const f = codexRuntimeMigrationFixture();
    const binding = await f.capture();
    expect(binding.source.namespaceId).toBe(f.namespace.namespaceId);
    expect(binding.targetActionRef).toBe(f.targetActionRef);
    expect(f.writes).toEqual([]);
    expect(binding.ingress).toHaveLength(1);
    expect(
      codexRuntimeMigrationBindingSchema.safeParse({
        ...binding,
        targetActionRef: binding.source.actionRef,
      }).success,
    ).toBe(false);
  });
  it("reads exact state after lost disable acknowledgement, without repeating the mutation", async () => {
    const f = codexRuntimeMigrationFixture();
    const binding = await f.capture();
    f.faults.loseDisableAck = true;
    await f.github.disableIngress(binding);
    await f.github.assertDrained(binding);
    await f.github.disableIngress(binding);
    expect(f.writes).toHaveLength(1);
  });
  it("keeps the boundary closed when disable is not observable", async () => {
    const f = codexRuntimeMigrationFixture();
    const binding = await f.capture();
    f.faults.loseDisableAck = true;
    f.faults.ignoreDisable = true;
    await expect(f.github.disableIngress(binding)).rejects.toThrow(
      "disable_unconfirmed",
    );
    expect(f.writes).toHaveLength(1);
  });
  it.each(["queued", "in_progress", "waiting", "unexpected_status"])(
    "does not infer drain from %s",
    async (status) => {
      const f = codexRuntimeMigrationFixture();
      const binding = await f.capture();
      f.runs.set(
        100,
        Array.from({ length: 101 }, (_, i) =>
          f.oldRun(i + 1, i === 100 ? status : "completed"),
        ),
      );
      await f.github.disableIngress(binding);
      await expect(f.github.assertDrained(binding)).rejects.toThrow(
        "runs_not_drained",
      );
    },
  );
  it("rejects a truncated inventory and changed source without allocating setup", async () => {
    const f = codexRuntimeMigrationFixture();
    const binding = await f.capture();
    await f.github.disableIngress(binding);
    f.faults.incompletePage = true;
    await expect(f.github.assertDrained(binding)).rejects.toThrow(
      "inventory_incomplete",
    );
    f.faults.incompletePage = false;
    f.faults.changedHead = true;
    await expect(f.github.assertDrained(binding)).rejects.toThrow(
      "source_changed",
    );
  });
  it("does not omit a committed interaction workflow that is not indexed yet", async () => {
    const f = codexRuntimeMigrationFixture();
    f.files.set(
      ".github/workflows/reviewrouter-interaction.yml",
      "name: not indexed\n",
    );
    await expect(f.capture()).rejects.toThrow("inventory_incomplete");
  });
  it.each([true, false])(
    "lost dispatch acknowledgement uses readback only (observed=%s)",
    async (observed) => {
      const f = codexRuntimeMigrationFixture();
      const binding = await f.capture();
      await f.github.disableIngress(binding);
      f.faults.loseDispatchAck = true;
      f.faults.createDispatchedRun = observed;
      const first = await f.github.dispatch(binding, "fresh");
      const restored = await f.github.dispatch(binding, "readback_only");
      expect(first.status).toBe(observed ? "observed" : "dispatch_unconfirmed");
      expect(restored).toEqual(first);
      const dispatches = f.writes.filter((write) =>
        write.path.endsWith("/dispatches"),
      );
      expect(dispatches).toHaveLength(1);
      expect(dispatches[0]!.body).toEqual({
        ref: "main",
        inputs: { migration_id: f.migrationId },
      });
      expect(JSON.stringify(dispatches)).not.toContain("setupNonce");
    },
  );
  it("requires source cleanup and exact B before re-enabling, reconciles a lost enable ACK", async () => {
    const f = codexRuntimeMigrationFixture();
    const binding = await f.capture();
    await f.github.disableIngress(binding);
    const target = f.renderReview(true);
    const input = {
      binding,
      reviewSourceSha256: digest(target),
      interactionSources: [],
    };
    await expect(f.github.enableActivatedIngress(input)).rejects.toThrow(
      "cleanup_required",
    );
    f.files.delete(codexRuntimeMigrationWorkflowPath);
    await expect(f.github.enableActivatedIngress(input)).rejects.toThrow(
      "source_changed",
    );
    f.files.set(f.source.workflowPath, target);
    f.faults.loseEnableAck = true;
    await f.github.enableActivatedIngress(input);
    await f.github.enableActivatedIngress(input);
    expect(
      f.writes.filter((write) => write.path.endsWith("/enable")),
    ).toHaveLength(1);
  });
  it("binds OIDC to exact repository, default source, reusable B and first run attempt", async () => {
    const f = codexRuntimeMigrationFixture();
    const binding = await f.capture();
    const claims: GitHubActionsOidcClaims = {
      iss: "https://token.actions.githubusercontent.com",
      aud: codexRuntimeMigrationAudience,
      repository: f.repositoryFullName,
      repository_id: f.repositoryId,
      repository_owner: "777genius",
      actor: "fixture",
      event_name: "workflow_dispatch",
      ref: "refs/heads/main",
      sub: `repo:${f.repositoryFullName}:ref:refs/heads/main`,
      workflow_ref: `${f.repositoryFullName}/${codexRuntimeMigrationWorkflowPath}@refs/heads/main`,
      workflow_sha: f.head,
      job_workflow_ref: `${codexRuntimeMigrationReusableWorkflowPath}@${"b".repeat(40)}`,
      job_workflow_sha: "b".repeat(40),
      runner_environment: "github-hosted",
      run_id: "500",
      run_attempt: "1",
    };
    const check = (value: GitHubActionsOidcClaims) =>
      assertCodexRuntimeMigrationOidc({
        claims: value,
        repositoryId: f.repositoryId,
        repositoryFullName: f.repositoryFullName,
        binding,
      });
    expect(() => check(claims)).not.toThrow();
    for (const mutation of [
      { repository_id: "2" },
      { ref: "refs/heads/other" },
      { workflow_sha: "f".repeat(40) },
      { job_workflow_ref: `${codexRuntimeMigrationReusableWorkflowPath}@main` },
      { run_attempt: "2" },
      { runner_environment: "self-hosted" },
    ]) {
      expect(() => check({ ...claims, ...mutation })).toThrow(
        "runner_mismatch",
      );
    }
  });
  it("checks original hash domain separately and accepts equal parsed source-proof replays", async () => {
    const f = codexRuntimeMigrationFixture();
    const binding = await f.capture();
    const proof = {
      namespaceId: binding.source.namespaceId,
      namespaceEpoch: binding.source.namespaceEpoch,
      canonicalizationVersion: 1 as const,
      generationHash: binding.source.generationHash,
      accountIdentityHash: binding.source.accountIdentityHash,
    };
    const args = {
      binding,
      sourceProof: proof,
      generationHash: proof.generationHash,
      accountIdentityHash: proof.accountIdentityHash,
      generationHashSalt: binding.source.generationHashSalt,
      accountFingerprintSalt: binding.source.accountFingerprintSalt,
    };
    expect(() => assertCodexRuntimeMigrationSourceProof(args)).not.toThrow();
    for (const mutation of [
      { generationHash: "x".repeat(43) },
      { accountIdentityHash: "y".repeat(43) },
      { generationHashSalt: "z".repeat(43) },
      { sourceProof: { ...proof, namespaceEpoch: "4" } },
    ]) {
      expect(() =>
        assertCodexRuntimeMigrationSourceProof({ ...args, ...mutation }),
      ).toThrow("source_mismatch");
    }
    const claim = {
      payloadVersion: 2,
      canonicalizationVersion: 1,
      operationId: f.migrationId,
      repositoryId: f.repositoryId,
      providerInstanceId: f.providerInstanceId,
      setupNonce: "stp:11111111-1111-4111-8111-111111111111",
      manifestDigest: "d".repeat(64),
      recoveryEpoch: "9",
      generationHash: proof.generationHash,
      accountIdentityHash: proof.accountIdentityHash,
      accountIdentityAlgorithm: "provider_issuer_subject_account_v1",
      authByteSize: 200,
      installerVersion: "test-v1",
      installerDigest: "e".repeat(64),
      runtimeMigrationSource: proof,
    };
    const left = codexRotatingSetupPayloadClaimSchema.parse(claim);
    const right = codexRotatingSetupPayloadClaimSchema.parse(claim);
    expect(left.runtimeMigrationSource).not.toBe(right.runtimeMigrationSource);
    expect(codexRotatingSetupPayloadClaimsMatch(left, right)).toBe(true);
    expect(
      codexRotatingSetupPayloadClaimsMatch(left, {
        ...right,
        runtimeMigrationSource: { ...proof, namespaceEpoch: "4" },
      }),
    ).toBe(false);
  });
  it("server source validation rejects stale generations, another account, lease or setup epoch", async () => {
    const f = codexRuntimeMigrationFixture();
    const binding = await f.capture();
    const s = binding.source;
    const original = {
      id: "provider_row",
      activeLeaseId: null,
      latestGeneration: s.generation,
      latestGenerationHash: s.generationHash,
      activeAccountIdentityHash: s.accountIdentityHash,
      generationHashSalt: s.generationHashSalt,
      accountFingerprintSalt: s.accountFingerprintSalt,
      activeSecretNamespaceId: s.namespaceId,
      activeSecretNamespaceEpoch: 3n,
      activeSecretNamespaceName: s.secretName,
      mutationOwner: "setup",
      mutationOwnerId: f.migrationId,
      mutationEpoch: 9n,
      state: "setup_pending",
      activeSecretNamespace: {
        id: s.namespaceId,
        namespaceEpoch: 3n,
        secretName: s.secretName,
        providerInstanceRowId: "provider_row",
        githubRepositoryId: f.repositoryId,
        attestedRepositoryId: f.repositoryId,
        status: "active",
        permanentlyRetired: false,
        workflowPath: s.workflowPath,
        workflowSourceCommitSha: s.workflowSourceCommitSha,
        workflowSourceBlobSha: s.workflowSourceBlobSha,
        workflowSourceSha256: s.workflowSourceSha256,
        workflowSemanticSha256: s.workflowSemanticSha256,
        workflowSchemaVersion: 5,
        workflowSourceTrust: "trusted_default_branch_revision",
      },
    };
    const check = (provider: typeof original) =>
      assertOriginalCodexRuntimeMigrationSource({
        tx: {
          codexOAuthProviderInstance: { findUnique: async () => provider },
        } as never,
        providerInstanceRowId: "provider_row",
        githubRepositoryId: f.repositoryId,
        binding,
        stage: "setup",
      });
    await expect(check(original)).resolves.toBeUndefined();
    for (const change of [
      { latestGeneration: 6 },
      { latestGenerationHash: "other" },
      { activeAccountIdentityHash: "other" },
      { mutationEpoch: 10n },
      { activeLeaseId: "lease" },
      { mutationOwnerId: "other" },
    ]) {
      await expect(
        check({ ...original, ...change } as typeof original),
      ).rejects.toThrow("source_mismatch");
    }
  });
});
