export { managedCodexWorkflowPath } from "@reviewrouter/shared";
import {
  managedCodexWorkflowPath,
  reviewRouterWorkflowPath,
} from "@reviewrouter/shared";
export {
  parseReviewAgentProfiles,
  type ReviewAgentProfile,
} from "@reviewrouter/shared";
export const legacyReviewRouterWorkflowPath =
  ".github/workflows/reviewrouter.yml";
export const managedInteractionWorkflowPath =
  ".github/workflows/reviewrouter-interaction.yml";

export const managedReviewRouterWorkflowPaths = [
  reviewRouterWorkflowPath,
  legacyReviewRouterWorkflowPath,
  managedCodexWorkflowPath,
  managedInteractionWorkflowPath,
] as const;
/** Stable installation ABI; executable identity is verified separately through OIDC. */
export const reviewRouterWorkflowContract = Object.freeze({
  major: 1,
  callerPath: reviewRouterWorkflowPath,
  runtimeRepository: "777genius/review-router",
  runtimePath: ".github/workflows/reviewrouter-runtime.yml",
  channel: "workflow-v1",
  controlPlaneUrl: "https://api.reviewrouter.site",
  requiredInputs: Object.freeze([
    "review_request_id",
    "pr_number",
    "review_head_sha",
  ] as const),
  permissions: Object.freeze({
    contents: "read",
    "pull-requests": "read",
    "id-token": "write",
  }),
});

export const reviewRouterRuntimeWorkflowRefPattern = new RegExp(
  `^${`${reviewRouterWorkflowContract.runtimeRepository}/${reviewRouterWorkflowContract.runtimePath}@`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([a-f0-9]{40}|refs/tags/${reviewRouterWorkflowContract.channel})$`,
  "i",
);

/** Only installation choices belong here; agent/provider policy stays server-owned. */
export function renderReviewRouterCaller(
  options: {
    readonly controlPlaneUrl?: string;
    readonly runtimeRef?: string;
  } = {},
): string {
  const ref = options.runtimeRef ?? reviewRouterWorkflowContract.channel;
  if (
    ref !== reviewRouterWorkflowContract.channel &&
    !/^[a-f0-9]{40}$/.test(ref)
  ) {
    throw new Error("review_workflow_runtime_ref_invalid");
  }
  const url = new URL(
    options.controlPlaneUrl ?? reviewRouterWorkflowContract.controlPlaneUrl,
  );
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("review_workflow_control_plane_url_invalid");
  }
  const origin = url.origin;
  const inputs = reviewRouterWorkflowContract.requiredInputs;
  return `name: ReviewRouter
run-name: \${{ format('ReviewRouter review {0}', inputs.review_request_id) }}
on:
  workflow_dispatch:
    inputs:
${inputs.map((name) => `      ${name}: { required: true, type: string }`).join("\n")}
permissions: {}
jobs:
  review:
    if: \${{ inputs.review_request_id != '' && inputs.pr_number != '' && inputs.review_head_sha != '' }}
    concurrency:
      group: reviewrouter-request-\${{ github.repository_id }}-\${{ inputs.review_request_id }}
      cancel-in-progress: false
    permissions:
${Object.entries(reviewRouterWorkflowContract.permissions)
  .map(([name, value]) => `      ${name}: ${value}`)
  .join("\n")}
    uses: ${reviewRouterWorkflowContract.runtimeRepository}/${reviewRouterWorkflowContract.runtimePath}@${ref}
    with:
${inputs.map((name) => `      ${name}: \${{ inputs.${name} }}`).join("\n")}${origin !== reviewRouterWorkflowContract.controlPlaneUrl ? `\n      control_plane_url: ${JSON.stringify(origin)}` : ""}
`;
}
