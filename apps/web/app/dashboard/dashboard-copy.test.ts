import { describe, expect, it } from "vitest";
import {
  codexRotatingProviderStateCopy,
  dashboardErrorText,
} from "./dashboard-copy";

describe("dashboard Codex rotating OAuth copy", () => {
  it("maps beta recovery states to concrete operator actions", () => {
    expect(codexRotatingProviderStateCopy("permission_required")).toMatchObject(
      {
        tone: "danger",
        title: "GitHub App permission required",
      },
    );
    expect(dashboardErrorText("needs_reconnect")).toContain(
      "Rerun the rotating setup command",
    );
    expect(dashboardErrorText("needs_reconnect")).toContain("--force-reseed");
    expect(dashboardErrorText("unknown_auth_state")).toContain(
      "GitHub secret writeback was confirmed",
    );
    expect(dashboardErrorText("policy_blocked")).toContain(
      "private same-repository PRs",
    );
  });

  it("maps Codex setup PR errors to reconnect guidance", () => {
    expect(
      dashboardErrorText("codex_legacy_auth_requires_reconnect"),
    ).toContain("Reconnect Codex with the rotating setup command");
    expect(dashboardErrorText("codex_api_key_setup_disabled")).toContain(
      "Use Codex OAuth rotating",
    );
    expect(
      dashboardErrorText("codex_rotating_provider_instance_required"),
    ).toContain("Codex rotating setup is incomplete");
  });
});

it.each([
  ["gateway_review_v2_inventory_retry", "Wait a minute"],
  [
    "gateway_review_v2_workflow_incompatible",
    "base branches of open pull requests",
  ],
  ["gateway_review_v2_provisioning_failed", "safe server error code"],
  ["gateway_review_v2_release_untrusted", "release and its registration"],
  ["gateway_review_v2_dispatch_unavailable", "Actions write permission"],
  ["gateway_review_v2_proof_blocked", "repository enrollment"],
  ["gateway_review_v2_safety_blocked", "safety policy or an emergency stop"],
])("explains the next setup action for %s", (issue, guidance) => {
  const copy = dashboardErrorText(issue);
  expect(copy).toContain(guidance);
  expect(copy).not.toContain("GitHub operation failed");
  expect(copy).not.toMatch(/rerun|restart|replay/i);
});

it("quotes the safe code when a failure has no dedicated copy", () => {
  const copy = dashboardErrorText("unmapped_probe_code");

  expect(copy).toContain("unmapped_probe_code");
  expect(copy).toContain("Diagnostics");
});

it.each([
  ["account_gateway_workflow_options_not_supported", "reusable workflow style"],
  ["provider_api_direct_requires_single_provider", "one supported provider"],
  ["provider_api_fast_mode_unsupported", "Turn off Fast mode"],
  [
    "provider_api_reasoning_effort_unsupported",
    "Low, Medium, or High review depth",
  ],
  [
    "gateway_review_reasoning_effort_unsupported",
    "Choose a supported reasoning effort",
  ],
])("explains the configuration correction for %s", (issue, guidance) => {
  expect(dashboardErrorText(issue)).toContain(guidance);
});
