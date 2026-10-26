import { expect, it } from "vitest";
import {
  renderReviewRouterCaller,
  renderReviewRouterProviderApiCaller,
} from "@reviewrouter/protocol-review-workflow";
import { readManagedReviewRouterCallerSource } from "../domain/workflow-template";

const runtimeRef = "a".repeat(40);

it("separates the exact-pinned direct secret caller from the unchanged Gateway ABI", () => {
  const direct = renderReviewRouterProviderApiCaller({ runtimeRef });
  expect(readManagedReviewRouterCallerSource(direct)).toEqual({
    runtimeRef,
    controlPlaneUrl: "https://api.reviewrouter.org",
    modelTransport: "provider_api",
    providerApiAuthMode: "openrouter-api",
  });
  expect(direct).toContain(
    "OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}",
  );
  expect(direct).not.toContain("provider_instance_id");
  expect(direct).not.toContain("CODEX_AUTH_JSON");
  expect(
    readManagedReviewRouterCallerSource(renderReviewRouterCaller()),
  ).toEqual({
    runtimeRef: "workflow-v1",
    controlPlaneUrl: "https://api.reviewrouter.org",
    modelTransport: "account_gateway",
  });
});

it.each([
  [
    "provider_api_auth_mode: openrouter-api",
    "provider_api_auth_mode: openai-api",
  ],
  ["secrets.OPENROUTER_API_KEY", "secrets.OTHER_KEY"],
  [`runtime_ref: ${runtimeRef}`, `runtime_ref: ${"b".repeat(40)}`],
  ["runtime_config_mode: oidc", "runtime_config_mode: static"],
  ["review_action_lane: t0", "review_action_lane: legacy"],
  ["reviewrouter-execution-reusable.yml@", "reviewrouter-reusable.yml@"],
])(
  "rejects a changed direct credential or authority contract (%s)",
  (before, after) => {
    const source = renderReviewRouterProviderApiCaller({ runtimeRef });
    expect(() =>
      readManagedReviewRouterCallerSource(source.replace(before, after)),
    ).toThrow();
  },
);

it("does not install a floating direct runtime", () => {
  expect(() =>
    renderReviewRouterProviderApiCaller({ runtimeRef: "v1" }),
  ).toThrow();
});

it.each([
  ["openrouter-api", "OPENROUTER_API_KEY"],
  ["mimo-token-plan-api", "MIMO_TOKEN_PLAN_API_KEY"],
  ["kimi-code-api", "KIMI_CODE_API_KEY"],
] as const)(
  "canonical direct caller binds only the selected mode and fixed secret: %s",
  (providerApiAuthMode, secret) => {
    const source = renderReviewRouterProviderApiCaller({
      runtimeRef,
      providerApiAuthMode,
    });
    expect(readManagedReviewRouterCallerSource(source)).toMatchObject({
      providerApiAuthMode,
    });
    expect(source).toContain(`${secret}: $` + `{{ secrets.${secret} }}`);
    for (const other of [
      "OPENROUTER_API_KEY",
      "MIMO_TOKEN_PLAN_API_KEY",
      "KIMI_CODE_API_KEY",
    ].filter((key) => key !== secret))
      expect(source).not.toContain(other);
    const wrong = source.replace(`secrets.${secret}`, "secrets.FOREIGN_KEY");
    expect(() => readManagedReviewRouterCallerSource(wrong)).toThrow(
      "review_workflow_source_not_canonical",
    );
  },
);
