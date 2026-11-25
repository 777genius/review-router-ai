import { expect, it } from "vitest";
import { renderReviewRouterClaudeSubscriptionCaller } from "@reviewrouter/protocol-review-workflow";
import {
  readManagedReviewRouterCallerSource,
  renderClaudeSubscriptionWorkflow,
} from "../domain/workflow-template";

const runtimeRef = "a".repeat(40);

it("binds native Claude to one repository token and one immutable runtime without API-key authority", () => {
  const caller = renderReviewRouterClaudeSubscriptionCaller({ runtimeRef });
  expect(readManagedReviewRouterCallerSource(caller)).toEqual({
    runtimeRef,
    controlPlaneUrl: "https://api.reviewrouter.org",
    modelTransport: "provider_api",
    subscriptionAuthMode: "claude-oauth",
  });
  expect(caller).toContain(
    "CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}",
  );
  expect(caller).not.toContain("provider_api_auth_mode");
  expect(caller).not.toContain("CODEX_AUTH_JSON");
  expect(caller).not.toContain("OPENROUTER_API_KEY");
  expect(
    renderClaudeSubscriptionWorkflow({
      actionRef: `777genius/review-router@${runtimeRef}`,
      apiUrl: "https://api.reviewrouter.org",
    }),
  ).toEqual({
    path: ".github/workflows/reviewrouter-review.yml",
    content: caller,
  });
});

it.each([
  [
    "subscription_auth_mode: claude-oauth",
    "provider_api_auth_mode: openrouter-api",
  ],
  [
    "subscription_auth_mode: claude-oauth",
    "subscription_auth_mode: claude-oauth\n      provider_api_auth_mode: openrouter-api",
  ],
  [
    "subscription_auth_mode: claude-oauth",
    "subscription_auth_mode: codex-oauth",
  ],
  ["secrets.CLAUDE_CODE_OAUTH_TOKEN", "secrets.OTHER_TOKEN"],
  [`runtime_ref: ${runtimeRef}`, `runtime_ref: ${"b".repeat(40)}`],
  ["runtime_config_mode: oidc", "runtime_config_mode: static"],
  ["review_action_lane: t0", "review_action_lane: legacy"],
  [
    "static_runtime_env_json: '{}'",
    'static_runtime_env_json: \'{"REVIEW_AUTH_MODE":"openrouter-api"}\'',
  ],
  [
    "      subscription_auth_mode:",
    "      provider_instance_id: codex-rotating:123\n      subscription_auth_mode:",
  ],
])(
  "rejects a mutated native authority or credential binding: %s",
  (before, after) => {
    const caller = renderReviewRouterClaudeSubscriptionCaller({ runtimeRef });
    expect(caller).toContain(before);
    expect(() =>
      readManagedReviewRouterCallerSource(caller.replace(before, after)),
    ).toThrow();
  },
);

it.each(["main", "v1", "workflow-v1", `another/repo@${runtimeRef}`])(
  "refuses a noncanonical native runtime %s",
  (value) => {
    expect(() =>
      renderReviewRouterClaudeSubscriptionCaller({ runtimeRef: value }),
    ).toThrow();
    expect(() =>
      renderClaudeSubscriptionWorkflow({
        actionRef: value,
        apiUrl: "https://api.reviewrouter.org",
      }),
    ).toThrow();
  },
);
