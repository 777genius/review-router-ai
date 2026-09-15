import {
  allocateVersionedProviderSecretNamespace,
  createVersionedSecretWorkflowSourceAttestation,
  WorkflowSourceTrust,
} from "@reviewrouter/features-codex-oauth-rotating";
import { describe, expect, it, vi } from "vitest";
import {
  assertCodexRotatingWorkflowReplacementTransition,
  reattestCodexRotatingWorkflow,
} from "../index";

const namespace = allocateVersionedProviderSecretNamespace({
  scope: {
    repositoryId: "1228051727",
    providerInstanceId: "codex-rotating:1228051727",
  },
  epoch: 2n,
  randomBytes: () => new Uint8Array(16).fill(0x22),
});
const target = {
  claimId: "claim_1",
  attemptId: "attempt_1",
  expectedGenerationHash: "9".repeat(64),
  repositoryId: "1228051727",
  repositoryFullName: "777genius/review-router-saas-e2e",
  workflowPath: ".github/workflows/reviewrouter-codex.yml",
  namespace,
} as const;

const attestation = (schema: 4 | 5, marker: string, commitMarker = marker) =>
  createVersionedSecretWorkflowSourceAttestation({
    repositoryId: target.repositoryId,
    workflowPath: target.workflowPath,
    workflowSourceCommitSha: commitMarker.repeat(40),
    workflowSourceBlobSha: marker.repeat(40),
    workflowSourceSha256: marker.repeat(64),
    workflowSemanticSha256: marker.repeat(64),
    workflowSchemaVersion: schema,
    sourceTrust: WorkflowSourceTrust.TrustedDefaultBranchRevision,
    secretNamespace: namespace,
  });

const sourceIdentity = (headCommitSha: string) => ({
  repositoryId: target.repositoryId,
  repositoryFullName: "777genius/review-router-saas-e2e",
  defaultBranch: "main",
  headCommitSha,
});

describe("reattestCodexRotatingWorkflow", () => {
  it("replaces changed V5 bytes only for the isolated repository path", async () => {
    const qualityTarget = {
      ...target,
      workflowPath: ".github/workflows/reviewrouter-quality-stand.yml",
    } as const;
    const qualityAttestation = (marker: string) =>
      createVersionedSecretWorkflowSourceAttestation({
        ...attestation(5, marker),
        workflowPath: qualityTarget.workflowPath,
      });
    const current = attestation(5, "4");
    const replacement = qualityAttestation("5");
    const replaceActiveWorkflowSource = vi.fn().mockResolvedValue({
      status: "active" as const,
    });

    expect(() =>
      assertCodexRotatingWorkflowReplacementTransition({
        current,
        replacement,
        compatibilityWindowSeconds: 0,
        repositoryFullName: qualityTarget.repositoryFullName,
      }),
    ).not.toThrow();
    expect(() =>
      assertCodexRotatingWorkflowReplacementTransition({
        current,
        replacement,
        compatibilityWindowSeconds: 0,
        repositoryFullName: "attacker/renamed",
      }),
    ).toThrow("codex_rotating_workflow_reattestation_transition_invalid");

    await expect(
      reattestCodexRotatingWorkflow(qualityTarget, {
        currentWorkflowAttestation: {
          readActiveWorkflowAttestation: vi.fn().mockResolvedValue(current),
        },
        defaultWorkflowSource: {
          readDefaultSourceIdentity: vi
            .fn()
            .mockResolvedValue(
              sourceIdentity(replacement.workflowSourceCommitSha),
            ),
          readVerifiedWorkflowAt: vi.fn().mockResolvedValue(replacement),
        },
        workflowReattestation: {
          validateActiveWorkflowSource: vi.fn(),
          replaceActiveWorkflowSource,
        },
      }),
    ).resolves.toMatchObject({ status: "reattested" });
    expect(replaceActiveWorkflowSource).toHaveBeenCalledWith({
      target: qualityTarget,
      expectedCurrent: current,
      replacement,
      compatibilityWindowSeconds: 0,
    });
  });

  it("rejects an isolated V5 transition after the observed full name changes", async () => {
    const qualityTarget = {
      ...target,
      workflowPath: ".github/workflows/reviewrouter-quality-stand.yml",
    } as const;
    const replacement = createVersionedSecretWorkflowSourceAttestation({
      ...attestation(5, "5"),
      workflowPath: qualityTarget.workflowPath,
    });
    const readVerifiedWorkflowAt = vi.fn().mockResolvedValue(replacement);
    const replaceActiveWorkflowSource = vi.fn();

    await expect(
      reattestCodexRotatingWorkflow(qualityTarget, {
        currentWorkflowAttestation: {
          readActiveWorkflowAttestation: vi.fn(),
        },
        defaultWorkflowSource: {
          readDefaultSourceIdentity: vi.fn().mockResolvedValue({
            ...sourceIdentity(replacement.workflowSourceCommitSha),
            repositoryFullName: "attacker/renamed",
          }),
          readVerifiedWorkflowAt,
        },
        workflowReattestation: {
          validateActiveWorkflowSource: vi.fn(),
          replaceActiveWorkflowSource,
        },
      }),
    ).rejects.toThrow("codex_rotating_workflow_repository_identity_changed");
    expect(readVerifiedWorkflowAt).not.toHaveBeenCalled();
    expect(replaceActiveWorkflowSource).not.toHaveBeenCalled();
  });

  it("rejects changed V5 bytes on the normal managed path", async () => {
    await expect(
      reattestCodexRotatingWorkflow(target, {
        currentWorkflowAttestation: {
          readActiveWorkflowAttestation: vi
            .fn()
            .mockResolvedValue(attestation(5, "4")),
        },
        defaultWorkflowSource: {
          readDefaultSourceIdentity: vi
            .fn()
            .mockResolvedValue(sourceIdentity("5".repeat(40))),
          readVerifiedWorkflowAt: vi
            .fn()
            .mockResolvedValue(attestation(5, "5")),
        },
        workflowReattestation: {
          validateActiveWorkflowSource: vi.fn(),
          replaceActiveWorkflowSource: vi.fn(),
        },
      }),
    ).rejects.toThrow(
      "codex_rotating_workflow_reattestation_transition_invalid",
    );
  });

  it("owns the exact V4-to-V5 evidence policy and transactional transition", async () => {
    const current = attestation(4, "4");
    const replacement = attestation(5, "5");
    const replaceActiveWorkflowSource = vi
      .fn()
      .mockResolvedValue({ status: "active" as const });
    const readVerifiedWorkflowAt = vi.fn(async ({ expectedSchemaVersion }) =>
      expectedSchemaVersion === 5 ? replacement : current,
    );
    const readDefaultSourceIdentity = vi
      .fn()
      .mockResolvedValue(sourceIdentity(replacement.workflowSourceCommitSha));

    await expect(
      reattestCodexRotatingWorkflow(target, {
        currentWorkflowAttestation: {
          readActiveWorkflowAttestation: vi.fn().mockResolvedValue(current),
        },
        defaultWorkflowSource: {
          readDefaultSourceIdentity,
          readVerifiedWorkflowAt,
        },
        workflowReattestation: {
          validateActiveWorkflowSource: vi.fn(),
          replaceActiveWorkflowSource,
        },
      }),
    ).resolves.toEqual({
      status: "reattested",
      workflowSourceCommitSha: replacement.workflowSourceCommitSha,
    });
    expect(readVerifiedWorkflowAt).toHaveBeenNthCalledWith(1, {
      commitSha: replacement.workflowSourceCommitSha,
      expectedSchemaVersion: 5,
    });
    expect(readVerifiedWorkflowAt).toHaveBeenNthCalledWith(2, {
      commitSha: current.workflowSourceCommitSha,
      expectedSchemaVersion: 4,
    });
    expect(readDefaultSourceIdentity).toHaveBeenCalledTimes(2);
    expect(replaceActiveWorkflowSource).toHaveBeenCalledWith({
      target,
      expectedCurrent: current,
      replacement,
      compatibilityWindowSeconds: 90_000,
    });
  });

  it("preserves same-byte V5 admission across an unrelated default-head commit", async () => {
    const current = attestation(5, "5", "4");
    const replacement = attestation(5, "5", "6");
    const replaceActiveWorkflowSource = vi.fn();
    const validateActiveWorkflowSource = vi
      .fn()
      .mockResolvedValue({ status: "active" as const });
    const readDefaultSourceIdentity = vi
      .fn()
      .mockResolvedValue(sourceIdentity(replacement.workflowSourceCommitSha));

    await expect(
      reattestCodexRotatingWorkflow(target, {
        currentWorkflowAttestation: {
          readActiveWorkflowAttestation: vi.fn().mockResolvedValue(current),
        },
        defaultWorkflowSource: {
          readDefaultSourceIdentity,
          readVerifiedWorkflowAt: vi.fn().mockResolvedValue(replacement),
        },
        workflowReattestation: {
          validateActiveWorkflowSource,
          replaceActiveWorkflowSource,
        },
      }),
    ).resolves.toEqual({
      status: "already_active",
      workflowSourceCommitSha: replacement.workflowSourceCommitSha,
    });
    expect(replaceActiveWorkflowSource).not.toHaveBeenCalled();
    expect(validateActiveWorkflowSource).toHaveBeenCalledWith({
      target,
      expectedCurrent: current,
      verifiedActive: replacement,
    });
  });

  it("re-reads identity immediately before returning already active", async () => {
    const current = attestation(5, "5", "4");
    const replacement = attestation(5, "5", "6");
    const initial = sourceIdentity(replacement.workflowSourceCommitSha);

    await expect(
      reattestCodexRotatingWorkflow(target, {
        currentWorkflowAttestation: {
          readActiveWorkflowAttestation: vi.fn().mockResolvedValue(current),
        },
        defaultWorkflowSource: {
          readDefaultSourceIdentity: vi
            .fn()
            .mockResolvedValueOnce(initial)
            .mockResolvedValueOnce({
              ...initial,
              repositoryFullName: "attacker/renamed",
            }),
          readVerifiedWorkflowAt: vi.fn().mockResolvedValue(replacement),
        },
        workflowReattestation: {
          validateActiveWorkflowSource: vi.fn(),
          replaceActiveWorkflowSource: vi.fn(),
        },
      }),
    ).rejects.toThrow("codex_rotating_workflow_repository_identity_changed");
  });

  it("rejects a previous blob that does not reproduce durable V4 evidence", async () => {
    const current = attestation(4, "4");
    const replacement = attestation(5, "5");
    const changedPrevious = attestation(4, "3", "4");
    const replaceActiveWorkflowSource = vi.fn();

    await expect(
      reattestCodexRotatingWorkflow(target, {
        currentWorkflowAttestation: {
          readActiveWorkflowAttestation: vi.fn().mockResolvedValue(current),
        },
        defaultWorkflowSource: {
          readDefaultSourceIdentity: vi
            .fn()
            .mockResolvedValue(
              sourceIdentity(replacement.workflowSourceCommitSha),
            ),
          readVerifiedWorkflowAt: vi
            .fn()
            .mockResolvedValueOnce(replacement)
            .mockResolvedValueOnce(changedPrevious),
        },
        workflowReattestation: {
          validateActiveWorkflowSource: vi.fn(),
          replaceActiveWorkflowSource,
        },
      }),
    ).rejects.toThrow("codex_rotating_workflow_previous_attestation_mismatch");
    expect(replaceActiveWorkflowSource).not.toHaveBeenCalled();
  });

  it("rejects a default-head race before persistence", async () => {
    const current = attestation(4, "4");
    const replacement = attestation(5, "5");
    const replaceActiveWorkflowSource = vi.fn();

    await expect(
      reattestCodexRotatingWorkflow(target, {
        currentWorkflowAttestation: {
          readActiveWorkflowAttestation: vi.fn().mockResolvedValue(current),
        },
        defaultWorkflowSource: {
          readDefaultSourceIdentity: vi
            .fn()
            .mockResolvedValueOnce(
              sourceIdentity(replacement.workflowSourceCommitSha),
            )
            .mockResolvedValueOnce(sourceIdentity("6".repeat(40))),
          readVerifiedWorkflowAt: vi
            .fn()
            .mockResolvedValueOnce(replacement)
            .mockResolvedValueOnce(current),
        },
        workflowReattestation: {
          validateActiveWorkflowSource: vi.fn(),
          replaceActiveWorkflowSource,
        },
      }),
    ).rejects.toThrow("codex_rotating_workflow_default_head_changed");
    expect(replaceActiveWorkflowSource).not.toHaveBeenCalled();
  });

  it.each([
    ["repository id", { repositoryId: "1228051728" }],
    ["repository full name", { repositoryFullName: "attacker/renamed" }],
    ["default branch", { defaultBranch: "trunk" }],
  ])("rejects a %s race immediately before CAS", async (_name, change) => {
    const current = attestation(4, "4");
    const replacement = attestation(5, "5");
    const initial = sourceIdentity(replacement.workflowSourceCommitSha);
    const replaceActiveWorkflowSource = vi.fn();

    await expect(
      reattestCodexRotatingWorkflow(target, {
        currentWorkflowAttestation: {
          readActiveWorkflowAttestation: vi.fn().mockResolvedValue(current),
        },
        defaultWorkflowSource: {
          readDefaultSourceIdentity: vi
            .fn()
            .mockResolvedValueOnce(initial)
            .mockResolvedValueOnce({ ...initial, ...change }),
          readVerifiedWorkflowAt: vi
            .fn()
            .mockResolvedValueOnce(replacement)
            .mockResolvedValueOnce(current),
        },
        workflowReattestation: {
          validateActiveWorkflowSource: vi.fn(),
          replaceActiveWorkflowSource,
        },
      }),
    ).rejects.toThrow("codex_rotating_workflow_repository_identity_changed");
    expect(replaceActiveWorkflowSource).not.toHaveBeenCalled();
  });
});
