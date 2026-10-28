import { describe, expect, it } from "vitest";
import {
  dashboardUntrustedWorkflowPathFromError,
  safeDashboardErrorCode,
} from "./dashboard-error-codes";

describe("safeDashboardErrorCode", () => {
  it.each([
    ["github_api_error:403", "github_operation_forbidden"],
    ["github_api_error:404", "github_operation_not_found"],
    ["github_api_error:409", "github_operation_conflict"],
    ["github_api_error:422", "github_validation_failed"],
    ["github_api_error:503", "github_service_unavailable"],
    ["github_api_error:418", "github_operation_failed"],
  ])("maps stored GitHub API summary %s to %s", (message, expectedCode) => {
    expect(safeDashboardErrorCode(new Error(message))).toBe(expectedCode);
  });

  it.each([
    [403, "github_operation_forbidden"],
    [404, "github_operation_not_found"],
    [409, "github_operation_conflict"],
    [422, "github_validation_failed"],
    [502, "github_service_unavailable"],
  ])("maps live GitHub HTTP status %s to %s", (status, expectedCode) => {
    const error = Object.assign(new Error("GitHub request failed"), { status });

    expect(safeDashboardErrorCode(error)).toBe(expectedCode);
  });

  it("keeps existing safe dashboard codes unchanged", () => {
    expect(safeDashboardErrorCode(new Error("setup_pr_branch_deleted"))).toBe(
      "setup_pr_branch_deleted",
    );
    expect(
      safeDashboardErrorCode(new Error("setup_pr_wrong_base_branch")),
    ).toBe("setup_pr_wrong_base_branch");
    expect(
      safeDashboardErrorCode(new Error("codex_rotating_not_enabled")),
    ).toBe("codex_rotating_not_enabled");
    expect(
      safeDashboardErrorCode(
        new Error("codex_rotating_repository_scope_required"),
      ),
    ).toBe("codex_rotating_repository_scope_required");
    expect(
      safeDashboardErrorCode(
        new Error("codex_rotating_single_provider_required"),
      ),
    ).toBe("codex_rotating_single_provider_required");
    expect(
      safeDashboardErrorCode(
        new Error("codex_rotating_provider_instance_required"),
      ),
    ).toBe("codex_rotating_provider_instance_required");
    expect(
      safeDashboardErrorCode(new Error("codex_legacy_auth_requires_reconnect")),
    ).toBe("codex_legacy_auth_requires_reconnect");
    for (const code of [
      "account_gateway_workflow_options_not_supported",
      "gateway_review_reasoning_effort_unsupported",
      "codex_rotating_workflow_reattestation_stale",
      "codex_rotating_workflow_reattestation_invalid",
      "codex_rotating_workflow_reattestation_forbidden",
    ]) {
      expect(safeDashboardErrorCode(new Error(code))).toBe(code);
    }
    expect(
      safeDashboardErrorCode(new Error("hosted_pool_device_login_in_flight")),
    ).toBe("hosted_pool_device_login_in_flight");
    expect(
      safeDashboardErrorCode(
        new Error("hosted_pool_device_login_artifact_invalid"),
      ),
    ).toBe("hosted_pool_device_login_artifact_invalid");
    expect(
      safeDashboardErrorCode(new Error("hosted_codex_auth_json_invalid")),
    ).toBe("hosted_codex_auth_json_invalid");
    expect(
      safeDashboardErrorCode(
        new Error("hosted_account_subject_already_enrolled"),
      ),
    ).toBe("hosted_account_subject_already_enrolled");
    expect(safeDashboardErrorCode(new Error("rate_limit_exceeded:setup"))).toBe(
      "rate_limited",
    );
  });

  it.each([
    "codex_rotating_action_ref_invalid",
    "codex_rotating_action_ref_must_be_full_sha",
    "codex_rotating_conflict_review_unsupported",
  ])(
    "maps Codex deployment setup error %s to server_misconfigured",
    (message) => {
      expect(safeDashboardErrorCode(new Error(message))).toBe(
        "server_misconfigured",
      );
    },
  );
});

// Legacy policy failures must survive transport normalization for actionable recovery.
describe("policy readiness errors", () => {
  it.each([
    "review_policy_resave_required",
    "review_provider_selection_required",
  ])("preserves %s", (code) => {
    expect(safeDashboardErrorCode(new Error(code))).toBe(code);
  });
  it("removes untrusted workflow paths from the public code", () => {
    expect(
      safeDashboardErrorCode(
        new Error(
          "workflow_delete_untrusted:.github/workflows/reviewrouter-codex.yml",
        ),
      ),
    ).toBe("workflow_delete_untrusted");
  });
});

// A code with shipped guidance must reach that guidance instead of the generic notice.
describe("codes with dedicated dashboard copy", () => {
  it.each([
    "gateway_repository_identity_missing",
    "gateway_review_v2_provisioning_failed",
    "gateway_review_v2_dispatch_unavailable",
    "mutation_authority_unavailable",
    "dashboard_action_stale",
  ])("preserves %s", (code) => {
    expect(safeDashboardErrorCode(new Error(code))).toBe(code);
  });

  it.each([
    "no_such_code_at_all",
    "github_operation_failed",
    "Prisma client failed on table ReviewExecutionV2",
    "secret_token_abc123xyz",
  ])("collapses unrecognized message %s", (message) => {
    expect(safeDashboardErrorCode(new Error(message))).toBe(
      "github_operation_failed",
    );
  });
});

// Removing the file by hand is the documented recovery, so the audit trail has to
// say which file, without letting an arbitrary message path through.
describe("dashboardUntrustedWorkflowPathFromError", () => {
  it.each([
    ".github/workflows/reviewrouter-codex.yml",
    ".github/workflows/reviewrouter.yml",
    ".github/workflows/reviewrouter-interaction.yml",
  ])("keeps the ReviewRouter workflow path %s", (path) => {
    expect(
      dashboardUntrustedWorkflowPathFromError(
        new Error(`workflow_delete_untrusted:${path}`),
      ),
    ).toBe(path);
  });

  it.each([
    "../../etc/passwd",
    ".github/workflows/../../secrets.yml",
    "/etc/passwd",
    ".github/workflows/x.yml?token=secret",
    "",
  ])("drops %s as an untrusted path", (path) => {
    expect(
      dashboardUntrustedWorkflowPathFromError(
        new Error(`workflow_delete_untrusted:${path}`),
      ),
    ).toBeNull();
  });

  it("returns nothing for unrelated errors", () => {
    expect(
      dashboardUntrustedWorkflowPathFromError(
        new Error("setup_pr_branch_deleted"),
      ),
    ).toBeNull();
    expect(dashboardUntrustedWorkflowPathFromError("not-an-error")).toBeNull();
  });
});

it.each([
  "provider_api_direct_requires_single_provider",
  "provider_api_fast_mode_unsupported",
  "provider_api_reasoning_effort_unsupported",
])("preserves the actionable direct-provider correction code %s", (reason) => {
  expect(safeDashboardErrorCode(new Error(reason))).toBe(reason);
});
