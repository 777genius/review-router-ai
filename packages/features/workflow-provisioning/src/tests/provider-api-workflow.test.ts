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
