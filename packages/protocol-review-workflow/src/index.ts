export { managedCodexWorkflowPath } from "@reviewrouter/shared";
import {
  managedCodexWorkflowPath,
  reviewRouterWorkflowPath,
  providerApiCheckoutCompanionContract,
  providerApiDescriptors,
  isProviderApiAuthMode,
  type ProviderApiAuthMode,
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
  controlPlaneUrl: "https://api.reviewrouter.org",
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

export type ReviewRouterMcpSecrets = Readonly<Record<string, string>>;
const mcpSecretNamePattern = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Named values only: never serializes the GitHub secrets context itself. */
export function renderMcpSecretsExpression(
  binding: ReviewRouterMcpSecrets,
): string | undefined {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw new Error("review_workflow_mcp_secrets_invalid");
  }
  const entries = Object.entries(binding).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  if (
    entries.some(
      ([logical, secret]) =>
        !mcpSecretNamePattern.test(logical) ||
        typeof secret !== "string" ||
        !mcpSecretNamePattern.test(secret),
    )
  ) {
    throw new Error("review_workflow_mcp_secrets_invalid");
  }
  if (!entries.length) return undefined;
  const template =
    "{{" +
    entries.map(([logical], index) => `"${logical}":{${index}}`).join(",") +
    "}}";
  return (
    "${{ format('" +
    template +
    "', " +
    entries.map(([, secret]) => `toJSON(secrets.${secret})`).join(", ") +
    ") }}"
  );
}

/** Accepts exactly the renderer's canonical expression grammar. */
export function readMcpSecretsExpression(
  value: unknown,
): ReviewRouterMcpSecrets {
  const fail = (): never => {
    throw new Error("review_workflow_mcp_secrets_invalid");
  };
  if (typeof value !== "string") return fail();
  const expression = /^\$\{\{ format\('\{\{(.+)\}\}', (.+)\) \}\}$/.exec(value);
  if (!expression) return fail();
  const fields = expression[1]!.split(",");
  const args = expression[2]!.split(", ");
  if (fields.length !== args.length) return fail();
  const binding: Record<string, string> = {};
  for (let index = 0; index < fields.length; index++) {
    const field = /^"([A-Z][A-Z0-9_]{0,63})":\{([0-9]+)\}$/.exec(
      fields[index]!,
    );
    const arg = /^toJSON\(secrets\.([A-Z][A-Z0-9_]{0,63})\)$/.exec(
      args[index]!,
    );
    if (!field || !arg || field[2] !== String(index)) return fail();
    binding[field[1]!] = arg[1]!;
  }
  if (renderMcpSecretsExpression(binding) !== value) return fail();
  return binding;
}

/**
 * Only installation choices belong here; agent/provider policy stays server-owned.
 * Installed callers are verified against this template. Within workflow-v1,
 * preserve its document semantics or accept the previous template explicitly;
 * otherwise introduce a new workflow ABI major and an installation update.
 */
export function renderReviewRouterCaller(
  options: {
    readonly controlPlaneUrl?: string;
    readonly runtimeRef?: string;
    readonly mcpSecrets?: ReviewRouterMcpSecrets;
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
  const mcpSecrets =
    options.mcpSecrets === undefined
      ? undefined
      : renderMcpSecretsExpression(options.mcpSecrets);
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
${inputs.map((name) => `      ${name}: \${{ inputs.${name} }}`).join("\n")}${origin !== reviewRouterWorkflowContract.controlPlaneUrl ? `\n      control_plane_url: ${JSON.stringify(origin)}` : ""}${mcpSecrets ? `\n    secrets:\n      mcp_secrets_json: ${mcpSecrets}` : ""}
`;
}

/** Exact-pinned native provider API variant; the Gateway ABI above stays intact. */
export function renderReviewRouterProviderApiCaller(options: {
  readonly controlPlaneUrl?: string;
  readonly runtimeRef: string;
  readonly providerApiAuthMode?: ProviderApiAuthMode;
}): string {
  if (!/^[a-f0-9]{40}$/.test(options.runtimeRef))
    throw new Error("review_workflow_runtime_ref_invalid");
  const mode =
    options.providerApiAuthMode ??
    providerApiCheckoutCompanionContract.providerApiAuthMode;
  if (!isProviderApiAuthMode(mode))
    throw new Error("provider_api_mode_invalid");
  const descriptor = providerApiDescriptors[mode];
  const caller = renderReviewRouterCaller(options);
  return (
    caller.replace(
      `${reviewRouterWorkflowContract.runtimePath}@${options.runtimeRef}`,
      `.github/workflows/reviewrouter-execution-reusable.yml@${options.runtimeRef}`,
    ) +
    `      runtime_ref: ${options.runtimeRef}
      runtime_config_mode: oidc
      review_action_lane: t0
      api_url: ${JSON.stringify(new URL(options.controlPlaneUrl ?? reviewRouterWorkflowContract.controlPlaneUrl).origin)}
      static_runtime_env_json: '{}'
      review_timeout_minutes: 240
      max_changed_lines: '0'
      workflow_schema_version: ${providerApiCheckoutCompanionContract.workflowSchemaVersion}
      provider_api_auth_mode: ${mode}
    secrets:
      ${descriptor.secretName}: \${{ secrets.${descriptor.secretName} }}
`
  );
}
