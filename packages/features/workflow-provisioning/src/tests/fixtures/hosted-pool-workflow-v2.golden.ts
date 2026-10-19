export const hostedPoolWorkflowV2GoldenOptions = {
  actionRef: "777genius/review-router@0123456789abcdef0123456789abcdef01234567",
  apiUrl: "https://api.reviewrouter.org",
  providerInstanceId: "hosted-pool:repository:123456",
  bindingId: "hosted-binding-1",
  bindingRevision: 7,
} as const;

export const hostedPoolWorkflowV2Golden = `name: ReviewRouter Hosted Codex

run-name: \${{ format('ReviewRouter hosted review PR {0} at {1}', github.event.pull_request.number, github.event.pull_request.head.sha) }}

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review, converted_to_draft]

permissions: {}

jobs:
  codex-review:
    name: codex-review
    if: \${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.type != 'Bot' && (github.event.pull_request.draft == false || vars.REVIEW_ROUTER_REVIEW_DRAFTS == 'true') }}
    permissions:
      contents: read
      pull-requests: read
      id-token: write
    uses: 777genius/review-router/.github/workflows/reviewrouter-t0-reusable.yml@0123456789abcdef0123456789abcdef01234567
    with:
      runtime_ref: "0123456789abcdef0123456789abcdef01234567"
      api_url: "https://api.reviewrouter.org"
      runtime_config_mode: oidc
      pr_number: \${{ format('{0}', github.event.pull_request.number) }}
      review_head_sha: \${{ github.event.pull_request.head.sha }}
      provider_instance_id: "hosted-pool:repository:123456"
      workflow_schema_version: 2
      max_changed_lines: \${{ vars.REVIEW_ROUTER_MAX_CHANGED_LINES }}
      review_timeout_minutes: \${{ fromJSON(vars.REVIEW_ROUTER_TIMEOUT_MINUTES || '60') }}
      codex_session_mode: codex_subscription_oauth_hosted_pool
      session_binding_id: "hosted-binding-1"
      session_binding_version: 7
`;

export const hostedPoolWorkflowV2GoldenSha256 =
  "fbac7410228c1115b17e179a44e168c7df00d463dfe5f046cdec12bab81e9704";
