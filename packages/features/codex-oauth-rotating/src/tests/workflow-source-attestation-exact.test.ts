import { describe, expect, it } from "vitest";
import {
  allocateVersionedProviderSecretNamespace,
  assertActiveVersionedSecretWorkflowAttestation,
  assertTrustedCanonicalVersionedWorkflow,
  CodexRotatingReviewActionV2Mode,
  CodexRotatingT0WorkflowSchemaVersion,
  createVersionedSecretWorkflowSourceAttestation,
  isClientTriggeredT0WorkflowSchemaVersion,
  isTrustedDefaultBranchTriggeredCodexWorkflowSchemaVersion,
  isVersionedSecretNamespaceCodexWorkflowSchemaVersion,
  readCanonicalCodexRotatingT0WorkflowSourceMetadata,
  readCanonicalIsolatedQualityWorkflowSourceMetadata,
  renderCodexRotatingAdvisoryWorkflow,
  renderCanonicalCodexRotatingT0WorkflowV4,
  renderCanonicalCodexRotatingT0WorkflowV5,
  scanCodexRotatingAdvisoryWorkflow,
  serializeVersionedProviderSecretNamespaceMetadata,
  WorkflowSourceTrust,
} from "../index.js";

const namespace = allocateVersionedProviderSecretNamespace({
  scope: {
    repositoryId: "123456",
    providerInstanceId: "codex-rotating:123456",
  },
  epoch: 1n,
  randomBytes: () => Buffer.alloc(16, 1),
});
const evidence = {
  repositoryId: "123456",
  workflowPath: ".github/workflows/reviewrouter-codex.yml",
  workflowSourceCommitSha: "a".repeat(40),
  workflowSourceBlobSha: "b".repeat(40),
  workflowSourceSha256: "c".repeat(64),
  workflowSemanticSha256: "d".repeat(64),
  workflowSchemaVersion: 5,
  sourceTrust: WorkflowSourceTrust.TrustedDefaultBranchRevision,
  secretNamespace: namespace,
} as const;

describe("exact active workflow attestation", () => {
  it("attests the authoritative isolated workflow as dispatch-only schema V5", () => {
    const workflow = `name: ReviewRouter Codex OAuth [namespace=sns_e9c2956ba412321fa27816e6cee3bd06;epoch=2;secret=REVIEWROUTER_CODEX_AUTH_JSON_R1228051727_P01cfca27f31e5f85_E2_e9c2956ba412321fa27816e6cee3bd06]

run-name: ReviewRouter review \${{ inputs.review_request_id }}

on:
  workflow_dispatch:
    inputs:
      review_request_id:
        required: true
        type: string
      pr_number:
        required: true
        type: string
      review_head_sha:
        required: true
        type: string

permissions: {}

jobs:
  quality-preflight:
    if: \${{ github.event_name == 'workflow_dispatch' && github.repository_id == '1228051727' && github.ref == 'refs/heads/main' && github.event.repository.default_branch == 'main' && vars.REVIEW_ROUTER_REVIEW_DRAFTS != 'true' && inputs.review_request_id != '' }}
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      contents: read
      pull-requests: read
    steps:
      - name: Verify isolated draft revision
        shell: bash
        env:
          GH_TOKEN: \${{ github.token }}
          GH_REPO: \${{ github.repository }}
          PR_NUMBER: \${{ inputs.pr_number }}
          REVIEW_HEAD_SHA: \${{ inputs.review_head_sha }}
          REVIEW_DRAFTS: \${{ vars.REVIEW_ROUTER_REVIEW_DRAFTS }}
        run: |
          set -euo pipefail
          [[ "$PR_NUMBER" =~ ^[1-9][0-9]*$ ]]
          [[ "$REVIEW_HEAD_SHA" =~ ^[a-fA-F0-9]{40}$ ]]
          [[ "\${REVIEW_DRAFTS,,}" != true ]]
          gh api "repos/$GH_REPO" --jq '.id == 1228051727 and .default_branch == "main"' | grep -qx true
          gh api "repos/$GH_REPO/pulls/$PR_NUMBER" | jq -e --arg sha "$REVIEW_HEAD_SHA" --arg number "$PR_NUMBER" '
            (.number | tostring) == $number and
            .state == "open" and .draft == true and
            .user.type == "User" and
            .head.repo.id == 1228051727 and .base.repo.id == 1228051727 and
            .head.sha == $sha' > /dev/null
  codex-review:
    name: codex-review
    needs: quality-preflight
    if: \${{ github.event_name == 'workflow_dispatch' && inputs.review_request_id != '' && inputs.pr_number != '' && inputs.review_head_sha != '' }}
    concurrency:
      group: reviewrouter-codex-oauth-\${{ github.repository_id }}-codex-rotating-1228051727
      cancel-in-progress: false
    permissions:
      contents: read
      pull-requests: read
      id-token: write
    uses: 777genius/review-router/.github/workflows/reviewrouter-t0-reusable.yml@bc3925e88470bf36d914d8d7ede74994455b69c8
    with:
      runtime_ref: "bc3925e88470bf36d914d8d7ede74994455b69c8"
      api_url: "https://mag-terminology-easter-email.trycloudflare.com"
      runtime_config_mode: oidc
      pr_number: \${{ inputs.pr_number }}
      review_head_sha: \${{ inputs.review_head_sha }}
      provider_instance_id: "codex-rotating:1228051727"
      workflow_schema_version: 5
      max_changed_lines: \${{ vars.REVIEW_ROUTER_MAX_CHANGED_LINES }}
      review_timeout_minutes: \${{ fromJSON(vars.REVIEW_ROUTER_TIMEOUT_MINUTES || '60') }}
    secrets:
      CODEX_AUTH_JSON: \${{ secrets.REVIEWROUTER_CODEX_AUTH_JSON_R1228051727_P01cfca27f31e5f85_E2_e9c2956ba412321fa27816e6cee3bd06 }}
`;

    expect(workflow).toContain("  workflow_dispatch:");
    expect(workflow).not.toContain("  pull_request_target:");
    expect(
      readCanonicalIsolatedQualityWorkflowSourceMetadata(workflow),
    ).toMatchObject({
      providerInstanceId: "codex-rotating:1228051727",
      workflowSchemaVersion: 5,
    });
    const current =
      readCanonicalIsolatedQualityWorkflowSourceMetadata(
        workflow,
      ).secretNamespace!;
    const next = allocateVersionedProviderSecretNamespace({
      scope: current.scope,
      epoch: current.epoch + 1n,
      randomBytes: () => Buffer.alloc(16, 7),
    });
    const rotated = workflow
      .replace(
        serializeVersionedProviderSecretNamespaceMetadata(current),
        serializeVersionedProviderSecretNamespaceMetadata(next),
      )
      .replaceAll(current.name, next.name);
    expect(
      readCanonicalIsolatedQualityWorkflowSourceMetadata(rotated),
    ).toMatchObject({ secretNamespace: next });
    expect(() =>
      readCanonicalIsolatedQualityWorkflowSourceMetadata(
        workflow.replace("  workflow_dispatch:", "  pull_request_target:"),
      ),
    ).toThrow("codex_rotating_t0_workflow_source_not_canonical");
    expect(() =>
      readCanonicalIsolatedQualityWorkflowSourceMetadata(
        workflow.replace(
          `secrets.${current.name}`,
          "secrets.REVIEWROUTER_CODEX_AUTH_JSON_R1228051727_P01cfca27f31e5f85_E3_07070707070707070707070707070707",
        ),
      ),
    ).toThrow("codex_rotating_t0_workflow_source_not_canonical");
  });

  it("binds blob, content, semantic, repository, trust, revision and namespace", () => {
    const assert = (
      attestation: Parameters<
        typeof createVersionedSecretWorkflowSourceAttestation
      >[0] = evidence,
    ) =>
      assertActiveVersionedSecretWorkflowAttestation({
        attestation:
          createVersionedSecretWorkflowSourceAttestation(attestation),
        repositoryId: evidence.repositoryId,
        workflowPath: evidence.workflowPath,
        workflowSourceCommitSha: evidence.workflowSourceCommitSha,
        activeSecretNamespace: namespace,
        expectedWorkflowSource: evidence,
      });
    expect(() => assert()).not.toThrow();
    expect(() =>
      assert({ ...evidence, workflowSourceBlobSha: "e".repeat(40) }),
    ).toThrow("workflow_source_attestation_blob_mismatch");
    expect(() =>
      assert({ ...evidence, workflowSourceSha256: "e".repeat(64) }),
    ).toThrow("workflow_source_attestation_content_digest_mismatch");
    expect(() =>
      assert({ ...evidence, workflowSemanticSha256: "e".repeat(64) }),
    ).toThrow("workflow_source_attestation_semantic_digest_mismatch");
    expect(() => assert({ ...evidence, repositoryId: "654321" })).toThrow(
      "workflow_source_attestation_repository_mismatch",
    );
    expect(() =>
      assert({
        ...evidence,
        sourceTrust: WorkflowSourceTrust.MutableOrUntrusted,
      }),
    ).toThrow("workflow_source_attestation_untrusted");
    expect(() => assert({ ...evidence, workflowSchemaVersion: 3 })).toThrow(
      "workflow_source_attestation_schema_version_invalid",
    );
  });

  it("accepts an exact unchanged workflow at a newer current default-branch revision", () => {
    expect(() =>
      assertActiveVersionedSecretWorkflowAttestation({
        attestation: createVersionedSecretWorkflowSourceAttestation({
          ...evidence,
          workflowSourceCommitSha: "e".repeat(40),
        }),
        repositoryId: evidence.repositoryId,
        workflowPath: evidence.workflowPath,
        workflowSourceCommitSha: "e".repeat(40),
        activeSecretNamespace: namespace,
        expectedWorkflowSource: evidence,
      }),
    ).not.toThrow();
  });

  it("accepts an exact canonical branch mirror anchored to the active default workflow", () => {
    expect(() =>
      assertActiveVersionedSecretWorkflowAttestation({
        attestation: createVersionedSecretWorkflowSourceAttestation({
          ...evidence,
          workflowSourceCommitSha: "e".repeat(40),
          sourceTrust: WorkflowSourceTrust.TrustedCanonicalBranchMirrorRevision,
        }),
        repositoryId: evidence.repositoryId,
        workflowPath: evidence.workflowPath,
        workflowSourceCommitSha: "e".repeat(40),
        activeSecretNamespace: namespace,
        expectedWorkflowSource: evidence,
      }),
    ).not.toThrow();

    expect(() =>
      assertActiveVersionedSecretWorkflowAttestation({
        attestation: createVersionedSecretWorkflowSourceAttestation({
          ...evidence,
          workflowSourceCommitSha: "e".repeat(40),
          workflowSourceSha256: "f".repeat(64),
          sourceTrust: WorkflowSourceTrust.TrustedCanonicalBranchMirrorRevision,
        }),
        repositoryId: evidence.repositoryId,
        workflowPath: evidence.workflowPath,
        workflowSourceCommitSha: "e".repeat(40),
        activeSecretNamespace: namespace,
        expectedWorkflowSource: evidence,
      }),
    ).toThrow("workflow_source_attestation_content_digest_mismatch");
  });

  it("trusts only configured repository, full-SHA action, API and canonical V4 namespace", () => {
    const actionRef =
      "777genius/review-router@0123456789abcdef0123456789abcdef01234567";
    const apiUrl = "https://api.reviewrouter.site";
    const workflow = renderCanonicalCodexRotatingT0WorkflowV4({
      actionRef,
      apiUrl,
      providerInstanceId: "codex-rotating:123456",
      refreshScheduleCron: null,
      activeSecretNamespace: namespace,
    });
    expect(workflow).toContain("  pull_request_target:");
    expect(workflow).not.toContain("  pull_request:");
    const metadata =
      readCanonicalCodexRotatingT0WorkflowSourceMetadata(workflow);
    const trusted = {
      metadata,
      observedRepositoryId: "123456",
      observedRepositoryFullName: "777genius/example",
      expectedRepositoryId: "123456",
      expectedRepositoryFullName: "777genius/example",
      trustedActionRefs: [actionRef],
      expectedApiUrl: apiUrl,
      expectedProviderInstanceId: "codex-rotating:123456",
      expectedSecretNamespace: namespace,
      expectedWorkflowSchemaVersion:
        CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV4,
    } as const;
    expect(() =>
      assertTrustedCanonicalVersionedWorkflow(trusted),
    ).not.toThrow();
    expect(() =>
      assertTrustedCanonicalVersionedWorkflow({
        ...trusted,
        expectedWorkflowSchemaVersion:
          CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV5,
      }),
    ).toThrow("codex_rotating_workflow_schema_version_mismatch");
    expect(() =>
      assertTrustedCanonicalVersionedWorkflow({
        ...trusted,
        trustedActionRefs: [actionRef.toUpperCase()],
      }),
    ).not.toThrow();
    expect(() =>
      assertTrustedCanonicalVersionedWorkflow({
        ...trusted,
        trustedActionRefs: [
          "attacker/runtime@0123456789abcdef0123456789abcdef01234567",
        ],
      }),
    ).toThrow("codex_rotating_workflow_action_ref_not_trusted");
    expect(() =>
      assertTrustedCanonicalVersionedWorkflow({
        ...trusted,
        expectedApiUrl: "https://attacker.invalid",
      }),
    ).toThrow("codex_rotating_workflow_api_url_not_trusted");
    expect(() =>
      assertTrustedCanonicalVersionedWorkflow({
        ...trusted,
        observedRepositoryId: "999999",
      }),
    ).toThrow("codex_rotating_workflow_repository_identity_mismatch");
  });

  it("renders and attests canonical V5 with the V4 byte shape and trusted namespace semantics", () => {
    const actionRef =
      "777genius/review-router@0123456789abcdef0123456789abcdef01234567";
    const commonInput = {
      actionRef,
      apiUrl: "https://api.reviewrouter.site",
      providerInstanceId: "codex-rotating:123456",
      refreshScheduleCron: "17 */6 * * *",
      activeSecretNamespace: namespace,
      claudeCodeOAuthTokenSecret: true,
      openRouterApiKeySecret: true,
    } as const;
    const workflowV4 = renderCanonicalCodexRotatingT0WorkflowV4(commonInput);
    const workflowV5 = renderCanonicalCodexRotatingT0WorkflowV5(commonInput);

    expect(
      workflowV5
        .replaceAll("workflow_schema_version: 5", "workflow_schema_version: 4")
        .replaceAll(
          'workflow-schema-version: "5"',
          'workflow-schema-version: "4"',
        ),
    ).toBe(workflowV4);
    expect(workflowV5).toContain("  pull_request_target:");
    expect(workflowV5).not.toContain("  pull_request:");
    expect(scanCodexRotatingAdvisoryWorkflow(workflowV5)).toEqual({
      valid: true,
      errors: [],
    });

    const renderedWorkflow = renderCodexRotatingAdvisoryWorkflow({
      ...commonInput,
      workflowSchemaVersion:
        CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV5,
      reviewActionV2Mode: CodexRotatingReviewActionV2Mode.T0,
    });
    expect(renderedWorkflow).toBe(workflowV5);

    const metadata =
      readCanonicalCodexRotatingT0WorkflowSourceMetadata(workflowV5);
    expect(metadata).toMatchObject({
      workflowSchemaVersion: 5,
      secretNamespace: namespace,
    });
    expect(
      isClientTriggeredT0WorkflowSchemaVersion(metadata.workflowSchemaVersion),
    ).toBe(true);
    expect(
      isVersionedSecretNamespaceCodexWorkflowSchemaVersion(
        metadata.workflowSchemaVersion,
      ),
    ).toBe(true);
    expect(
      isTrustedDefaultBranchTriggeredCodexWorkflowSchemaVersion(
        metadata.workflowSchemaVersion,
      ),
    ).toBe(true);
    expect(() =>
      assertTrustedCanonicalVersionedWorkflow({
        metadata,
        observedRepositoryId: "123456",
        observedRepositoryFullName: "777genius/example",
        expectedRepositoryId: "123456",
        expectedRepositoryFullName: "777genius/example",
        trustedActionRefs: [actionRef],
        expectedApiUrl: commonInput.apiUrl,
        expectedProviderInstanceId: commonInput.providerInstanceId,
        expectedSecretNamespace: namespace,
        expectedWorkflowSchemaVersion:
          CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV5,
      }),
    ).not.toThrow();

    expect(() =>
      assertTrustedCanonicalVersionedWorkflow({
        metadata,
        observedRepositoryId: "123456",
        observedRepositoryFullName: "777genius/example",
        expectedRepositoryId: "123456",
        expectedRepositoryFullName: "777genius/example",
        trustedActionRefs: [actionRef],
        expectedApiUrl: commonInput.apiUrl,
        expectedProviderInstanceId: commonInput.providerInstanceId,
        expectedSecretNamespace: namespace,
        expectedWorkflowSchemaVersion:
          CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV4,
      }),
    ).toThrow("codex_rotating_workflow_schema_version_mismatch");

    expect(() =>
      readCanonicalCodexRotatingT0WorkflowSourceMetadata(
        workflowV5.replace(
          "      runtime_config_mode: oidc",
          "      runtime_config_mode: unsafe",
        ),
      ),
    ).toThrow("codex_rotating_t0_workflow_source_not_canonical");
  });
});
