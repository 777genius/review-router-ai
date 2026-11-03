# Review Configuration Operator CLI

Use the operator CLI to inspect or pin a repository's review reasoning effort
without opening the ReviewRouter dashboard or signing in to GitHub.

## Security Boundary

The CLI calls the ReviewRouter API over HTTPS. It does not use GitHub OAuth,
GitHub cookies, Prisma, or direct database access.

- The server stores only
  `REVIEW_ROUTER_REVIEW_CONFIG_OPERATOR_CREDENTIAL_SHA256`.
- The plaintext credential stays in a local mode-`0600` profile.
- The CLI rejects non-regular profiles or profiles readable by group/others on
  POSIX systems.
- The credential is bound to the API URL in that profile.
- Redirects, URL credentials, query strings, fragments, non-root base paths,
  and non-HTTPS remote URLs are rejected.
- The credential is never accepted as a command-line argument.
- Failed authentication performs only a local digest comparison and terminates
  before repository lookup, rate-limit persistence, or audit persistence.
- Authenticated reads and writes have global and per-repository limits and are
  audited without credential values.
- Only selected, non-archived repositories with an active provider
  installation can be changed.

Volumetric unauthenticated traffic belongs at the deployment ingress. Do not add
one shared anonymous application bucket: an external caller could exhaust it and
lock out the legitimate operator.

Do not reuse `REVIEW_ROUTER_REVIEW_V2_OPERATOR_CREDENTIAL`. That credential can
control Review v2 rollout and emergency mutation authority and intentionally has
a separate trust boundary.

## Build And Install

From a trusted ReviewRouter checkout:

```bash
npm install --global pnpm@10.33.0
pnpm install --frozen-lockfile
pnpm reviewrouter:install
~/.local/bin/reviewrouter --help
```

Add `$HOME/.local/bin` to `PATH` once if it is not already there. The installer
does not depend on pnpm's global-bin configuration and prints the exact
installed path. It creates a content-addressed standalone bundle under
`${XDG_DATA_HOME:-$HOME/.local/share}/reviewrouter` and atomically replaces the
launcher, so later checkout changes or removal do not alter the installed CLI.
The thin client does not load the server environment or connect to Postgres.

## Create A Host-Bound Profile

Generate a dedicated credential once:

```bash
set -euo pipefail
umask 077
profile_dir="${XDG_CONFIG_HOME:-$HOME/.config}/reviewrouter"
profile_path="$profile_dir/operator.json"
api_url="https://api.reviewrouter.example.com"
credential="$(openssl rand -base64 48 | tr -d '\n')"
mkdir -p "$profile_dir"
printf '%s\n' "$credential" |
  jq -Rn --arg apiUrl "$api_url" \
    'input as $credential | {apiUrl: $apiUrl, credential: $credential}' \
    > "$profile_path"
chmod 600 "$profile_path"
printf %s "$credential" | openssl dgst -sha256 -r | awk '{print $1}'
unset credential
```

Store only the printed digest in the API service as:

```text
REVIEW_ROUTER_REVIEW_CONFIG_OPERATOR_CREDENTIAL_SHA256=<sha256>
```

Restart or redeploy the API after setting it. Do not persist the plaintext value
in server configuration, Compose `.env`, CI/GitHub secrets, or shell history.

For isolated client-side automation, a secret manager may inject the plaintext
credential ephemerally as
`REVIEW_ROUTER_REVIEW_CONFIG_OPERATOR_CREDENTIAL`. An explicit
`REVIEW_ROUTER_API_URL` is also required; there is no implicit hosted URL.

## Commands

### Confirm an already installed Gateway caller

The same genuine config-operator profile can confirm an existing canonical
Gateway caller only when the API also has an explicit repository-scoped grant:

```text
reviewrouter repositories confirm-installed --workspace WORKSPACE_ID --repo OWNER/REPO --confirm OWNER/REPO
```

Configure `REVIEW_ROUTER_WORKFLOW_PROVISIONING_OPERATOR_GRANTS_JSON` on the API
as a strict JSON array, for example:

```json
[
  {
    "operatorId": "reviewrouter-operator",
    "permission": "confirm_installed_gateway_workflow",
    "ownerGitHubUserId": "12345",
    "workspaceId": "WORKSPACE_ID",
    "repositoryIds": ["REPOSITORY_ID"]
  }
]
```

This is a permission manifest, not a credential or feature flag. Without it the
new route is unavailable; the existing credential alone does not grant this
operation. Each entry admits at most 16 exact repository IDs, and at most 16
entries are allowed. Unknown fields, wildcard/empty scopes, duplicate repository
selectors and noncanonical numeric owner IDs reject. Existing config operations
are unchanged. Activate only the approved owner/workspace/repository grant.

The API resolves that GitHub owner to the real app user and checks current owner
membership or the actual personal-workspace owner plus `workflow_provisioning`
entitlement. Admin membership alone does not authorize this operation. The audit
actor remains the operator; the delegated owner is metadata, never a forged login.
The application rechecks authority, immutable setup/policy/account/SCM binding
versions and pinned live caller facts before its operational phases.

Only a selected, unarchived GitHub repository with an existing canonical Gateway
caller is eligible. Other transports, legacy callers, incompatible authority or
explicitly disabled safety policies remain blocked. The command creates no PR,
commit, caller, workflow dispatch or model request, and changes no provider policy.
It can enroll the five missing repository safety policies and confirm the normal
mutation/setup authority, retaining a durable pre-effect attempt audit. A partial
result must be reconciled through the same command and original application
state; it is never proof of no effects. Ready is returned only after confirmation
and readiness readback. `WorkflowProvisioning.status` is authoritative; this
operation does not promise a write to the legacy repository `setupStatus` column.

Responses contain selected nonsecret confirmation facts. Blocked/conflict results
and HTTP failures exit nonzero. No V2 operator credential, Web secret copy, direct
SQL/grant/migration, NextAuth session or execution capability is involved.

Read the effective repository, workspace, or global-default result:

```bash
reviewrouter config get --repo 777genius/agent-teams-ai
```

Pin a repository-specific effort:

```bash
reviewrouter config set \
  --repo 777genius/agent-teams-ai \
  --effort xhigh \
  --reason "pin reviewer policy"
```

Allowed effort values are `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`.
`--reason` is stored in sanitized audit metadata; when omitted it uses the
stable `operator_cli_config_set` reason.

If the same repository exists in multiple workspaces, qualify it by workspace
ID or slug:

```bash
reviewrouter config set \
  --repo Padelapp-Club/monorepository \
  --workspace padelapp \
  --effort high
```

For GitLab or GitHub Enterprise repositories with the same full name, add the
SCM host explicitly:

```bash
reviewrouter config get \
  --repo group/project \
  --provider gitlab \
  --source-base-url https://gitlab.example.com
```

Use a non-default profile explicitly when operating another control plane:

```bash
reviewrouter config get \
  --repo OWNER/REPOSITORY \
  --profile ~/.config/reviewrouter/staging-operator.json
```

`config set` updates the complete repository configuration snapshot and is
idempotent when that explicit snapshot already has the requested effort. It
changes only the first Codex-backed provider selected by the runtime and leaves
all other provider rows untouched. A repository-level pin intentionally stops
inheriting later workspace/default effort changes.

## Error Contract

The CLI prints stable, sanitized error codes:

- `unauthorized` - profile and server digest do not match.
- `repository_not_found` - no active selected repository matches.
- `repository_ambiguous` - add `--workspace`.
- `rate_limited` - wait for the operator window to reset.
- `review_provider_not_found` - the effective config has no Codex-backed provider.
- `invalid_request` - command input is outside the API contract.

API responses use `Cache-Control: no-store`. Server logs and audit metadata must
never contain the Authorization header or profile contents.
