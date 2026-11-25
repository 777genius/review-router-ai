# Self-Hosted ReviewRouter End-to-End

This runbook takes an operator from a clean host to the first real ReviewRouter
review on github.com.

## Guided installation

### Before you start

- Use a Linux x64 server with Docker Compose v2, Git, curl and Node.js
  24.21+ (24.x) or 26.10+ (26.x), including npm. Default memory setup also uses
  Python 3 and tar. The installer uses the repository's pinned pnpm version.
- Point two public DNS names at the server, for example
  `reviewrouter.example.com` and `api.reviewrouter.example.com`. Their A/AAAA
  records must reach this host, with inbound ports 80 and 443 available for
  automatic HTTPS.
- Have a GitHub account that can create and install an App, a supported AI
  provider account and a disposable repository for the first review.

### Agent-first installation (default)

Run this command from an agent with shell access to the **Linux x64 server**.
No interactive terminal is required. Supply real, public DNS hostnames and a
repository you own (the values below are placeholders):

```bash
bash -c 'installer=$(mktemp) && curl -fsSL https://raw.githubusercontent.com/777genius/review-router-ai/main/scripts/install-self-hosted.sh -o "$installer" && bash "$installer" "$@"; result=$?; rm -f "$installer"; exit "$result"' -- \
  --web-url https://review.example.com \
  --repo OWNER/REPOSITORY
```

For production, **pin the control-plane source commit**, rather than deploying
the current moving `main` checkout. For example, on the same server:

```bash
SOURCE_SHA=PASTE_APPROVED_40_CHARACTER_COMMIT_SHA
git clone https://github.com/777genius/review-router-ai.git reviewrouter
git -C reviewrouter fetch origin "$SOURCE_SHA"
git -C reviewrouter checkout --detach "$SOURCE_SHA"
cd reviewrouter
bash scripts/install-self-hosted.sh \
  --web-url https://review.example.com \
  --api-url https://api.review.example.com \
  --repo OWNER/REPOSITORY
```

The first, shorter command above is for new evaluations that intentionally use
the current default branch. Without `--api-url`, the API domain defaults to
`https://api.<web hostname>`; both DNS names must already point to the server.
Both routes use the same agent-first JSON contract. Replace the example
domains and repository before starting.

The installer auto-generates private credentials, installs pinned dependencies,
prepares database roles and migrations, deploys Compose/Memory/HTTPS, verifies
server readiness and registers the exact Action release. By default it returns
**one JSON object on stdout** and progress on stderr. Every returned state is
explicit; a successful process exit with `approval_required` means the installer
is waiting for authorized action, **not** that the deployment is complete.

An agent should follow the `next` object and rerun `next.resume` from the saved
checkout (default `./reviewrouter`). `next.argv` is an argument array, never a
shell string to interpolate. Use `bash scripts/install-self-hosted.sh --status`
in that checkout to read the last private status without modifying services.
Keep the whole installation directory private and do not print its `.env`,
App profile, key material or provider credentials in chat logs.

| JSON state                         | Meaning / next step                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input_required`                   | Agent must supply the public dashboard URL; API URL defaults to `api.<dashboard hostname>`. Configure DNS first.                                                          |
| `approval_required` (`github_app`) | Run the provided manifest-helper command, obtain authorized GitHub browser approval, then resume. The helper keeps the App profile in a private directory.                |
| `approval_required` (`https`)      | Only with `--external-proxy`: set up HTTPS routing and resume with `--external-proxy-ready`; public TLS health is still checked. Bundled Caddy normally avoids this step. |
| `server_ready`                     | Services respond, but no repository has been selected. Resume with `--repo OWNER/REPOSITORY`.                                                                             |
| `repository_setup_required`        | Install App, connect provider in the dashboard and merge the generated workflow PR. Once these actions have actually happened, resume with `--repository-setup-complete`. |
| `verification_required`            | Review authority is initialized. Open a small disposable PR and confirm actual App-authored review plus a second-revision review. **No first review is claimed yet.**     |
| `failed`                           | Read stderr, correct the issue and resume at the pinned revision. The installer preserves private credentials and does not silently upgrade.                              |

With `--review-only`, no workflow setup PR is created. An authorized user must
install and verify the canonical workflow manually using the section below.

Agent mode deliberately does **not** auto-approve GitHub App permissions,
authorize an AI subscription, merge a workflow PR, change existing emergency
stops or claim review success without evidence. An agent with the appropriate
GitHub/browser permissions may guide these tasks, but must obtain any required
human authorization. For manual prompts, pass `--interactive` to the same
entrypoint. The manual wizard uses exactly the same installation state.

### Complete the browser steps

If you connect to the server over SSH, open a second terminal on your
**workstation** and keep this tunnel running during GitHub App creation:

```bash
ssh -N -L 45731:127.0.0.1:45731 user@server
```

The App creation helper uses a local callback on port 45731. Follow the browser
link printed by the installer. With an existing App profile, use
`--app-profile /secure/github-app.env` instead.

After the agent reports `repository_setup_required` (or when the interactive wizard prompts):

1. Install the App on the test repository using the printed GitHub link.
2. If the agent already supplied `--repo OWNER/REPOSITORY`, keep that selection;
   otherwise resume with `--repo OWNER/REPOSITORY`. The installer enables
   provider setup and review admission only for that repository.
3. Open the printed dashboard setup URL, sign in with GitHub and select the same
   repository. Choose **GitHub Secrets** for provider setup and follow the
   generated instructions.
4. Review and merge the generated workflow setup PR.
5. In agent mode, resume using the exact `next.resume` arguments (including
   `--repository-setup-complete`). In interactive mode, return to the installer
   and press Enter. It verifies setup and initializes review authority through
   the operator CLI.

The default App profile permits dashboard setup PRs. The installer does not
complete the provider's sign-in or merge a PR on your behalf. Omit `--repo` in
agent mode (or press Enter at the interactive repository prompt) to finish
server setup and connect a repository later.
This path uses credentials in GitHub Secrets. Account Gateway is a separately
provisioned service and is not installed by this wizard.

### Verify the first review

Open a small PR in the test repository and follow
[Prove the First Review](#11-prove-the-first-review). Service readiness and
repository activation are installation checks; the first live provider review
remains pending until that PR completes. Inspect the ReviewRouter check and
App-authored comments, then push another commit to verify the new revision.

### Options and resume

Pass options after the launcher command, or run `bash scripts/install-self-hosted.sh`
from its saved checkout:

| Option                                 | Purpose                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `--repo OWNER/REPOSITORY`              | Select the first repository before provider onboarding.                              |
| `--status`                             | Read the saved machine status without starting services.                             |
| `--interactive`                        | Opt in to prompts; the default mode is non-interactive JSON.                         |
| `--repository-setup-complete`          | Resume only after the App/provider/workflow approvals actually happened.             |
| `--external-proxy-ready`               | Resume external proxy setup after configuring public HTTPS routing.                  |
| `--app-profile /secure/github-app.env` | Import an existing GitHub App profile.                                               |
| `--directory /private/install`         | Select the private state directory; reuse it when resuming.                          |
| `--external-proxy`                     | Use an existing HTTPS reverse proxy instead of bundled Caddy.                        |
| `--without-memory`                     | Explicitly install without the Hindsight memory backend.                             |
| `--review-only`                        | Use the narrower App profile and install the canonical repository workflow manually. |

The first installation records its source revision and exact Action commit.
Resume from that saved checkout to reuse the same versions and existing
credentials. Configuration and secret files are private to the operator
(`0600`). Resume does not upgrade the installation; use the
[upgrade procedure](#12-operate-and-upgrade) for a deliberate version change.

The default checkout is `./reviewrouter`. Inside it, the installer saves
`installation.json`, `.env` and the operator credential under
`deploy/self-hosted/secrets/install`, unless you select `--directory`.

## Manual installation and operations

The sections below retain the detailed setup and recovery path. Guided
installation performs the service, release-registration and initial activation
steps for you. Use a disposable repository to verify either path before
connecting production repositories.

The manual examples use `deploy/self-hosted/.env` and the default Compose
project. For a guided installation, use the saved `.env`, set
`REVIEW_ROUTER_SELF_HOSTED_ENV_FILE` to that same absolute path, and pass
`--project-name reviewrouter-<installationId>` using the ID in
`installation.json`. Include `-f deploy/self-hosted/compose.tls.yml` when the
saved proxy mode is `caddy`. Preserve these choices for backups, operator
commands and upgrades so they address the existing services and volumes.

## Target Architecture

The self-hosted stack runs:

```text
web + api + worker + migrate + PostgreSQL
```

The target repository runs the public ReviewRouter Action in GitHub Actions.
The runner reads source code and invokes the provider. The control plane
receives identities, revision metadata, normalized review artifacts, and
publication state. Provider secrets and raw OAuth files stay in GitHub Actions
secrets.

This guide uses the recommended client-triggered Direct V2 path:

```text
pull_request event
  -> canonical schema-2 workflow
  -> GitHub OIDC
  -> self-hosted control plane authorization
  -> provider work on the GitHub runner
  -> revision-fenced publication
```

## 1. Prerequisites

Prepare:

- a Linux host with Docker and Docker Compose v2
- public HTTPS web and API names, for example
  `reviewrouter.example.com` and `api.reviewrouter.example.com`
- Node.js 24.21+ (24.x) or 26.10+ (26.x), npm, Git, `gh`, `curl`, and
  OpenSSL on the operator machine
- a GitHub organization or account that can create and install a GitHub App
- a disposable repository for the first live review
- an exact 40-character commit from the public
  [ReviewRouter Action](https://github.com/777genius/review-router)
- a maintainer-approved Review v2 release bundle for that exact Action commit

Commands marked **host** run on the self-hosted server. Commands marked
**workstation** run where the operator has a browser, `gh`, and Codex login.
Keeping two source checkouts is acceptable; deploy only the reviewed host
revision and transfer credentials through a secure channel.

On the **host**, clone and install:

```bash
git clone https://github.com/777genius/review-router-ai.git
cd review-router-ai
npm install --global pnpm@11.28.7
pnpm install --frozen-lockfile
cp deploy/self-hosted/.env.example deploy/self-hosted/.env
chmod 600 deploy/self-hosted/.env
```

Pin the control-plane source to a reviewed commit or release. Do not deploy an
unreviewed moving branch.

## 2. Configure DNS and TLS

Terminate HTTPS with Caddy, Nginx, Traefik, or a load balancer and route:

```text
https://reviewrouter.example.com     -> 127.0.0.1:3000
https://api.reviewrouter.example.com -> 127.0.0.1:4000
```

Keep the Compose ports and PostgreSQL bound to localhost unless they are on a
private network.

Set these values in `deploy/self-hosted/.env`:

```dotenv
REVIEW_ROUTER_WEB_URL=https://reviewrouter.example.com
REVIEW_ROUTER_API_URL=https://api.reviewrouter.example.com
REVIEW_ROUTER_PUBLIC_WEB_URL=https://reviewrouter.example.com
REVIEW_ROUTER_PUBLIC_API_URL=https://api.reviewrouter.example.com
NEXTAUTH_URL=https://reviewrouter.example.com
```

## 3. Create the GitHub App

On the **workstation**, generate a GitHub App manifest. Passing the public URLs
is mandatory; otherwise the helper defaults to the hosted ReviewRouter service:

```bash
pnpm github-app:create -- \
  --permission-profile review-only \
  --web-url https://reviewrouter.example.com \
  --api-url https://api.reviewrouter.example.com \
  --name "ReviewRouter Self-Hosted"
```

The manual flow uses the least-privilege `review-only` profile and requires a
manually installed canonical workflow. Guided installation defaults to
`provisioning` so the dashboard can create the setup PR. Use `managed-review`
only when server-side dispatch and cancellation are intentionally enabled in a
different deployment mode.

Configure the App:

```text
Callback URL: https://reviewrouter.example.com/api/auth/callback/github
Setup URL:    https://reviewrouter.example.com/setup
Webhook URL:  https://api.reviewrouter.example.com/webhooks/github
```

Enable redirect after installation updates. Install the App only on the
disposable repository at first.

Copy the App values into the env file:

```dotenv
GITHUB_APP_ID=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_SLUG=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_WEBHOOK_SECRET=
GITHUB_APP_PRIVATE_KEY=
REVIEW_ROUTER_GITHUB_APP_PERMISSION_PROFILE=review-only
```

`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` use the same values as the App
client ID and client secret. Encode private-key line breaks as `\n` in the env
file.

## 4. Configure Secrets and Direct V2

On the **host**, generate a URL-safe PostgreSQL password, then generate every
other secret independently. Never reuse one value for two purposes:

```bash
openssl rand -hex 32
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 32
```

At minimum, replace every placeholder for:

```text
POSTGRES_PASSWORD
AUTH_SECRET
REVIEW_ROUTER_ACTION_SESSION_SECRET
REVIEW_ROUTER_TOKEN_ENCRYPTION_KEY
GITHUB_WEBHOOK_SECRET
```

Keep `DATABASE_URL` synchronized with `POSTGRES_PASSWORD`.

Client-triggered Direct V2 must keep these authority flags together:

```dotenv
REVIEW_ROUTER_REVIEW_V2_DIRECT_INITIALIZATION_ENABLED=1
REVIEW_ROUTER_REVIEW_V2_WORKFLOW_PROVISIONING_MODE=client_triggered_t0
REVIEW_ROUTER_REVIEW_V2_RUN_CONTROL_ENABLED=1
REVIEW_ROUTER_REVIEW_V2_WORKER_ENABLED=1
REVIEW_ROUTER_REVIEW_V2_INTENT_INGRESS_ENABLED=0
REVIEW_ROUTER_REVIEW_V2_INTENT_ADMISSION_REQUIRED=0
REVIEW_ROUTER_REVIEW_V2_WORKFLOW_DISPATCH_READY=0
REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED=1
```

Do not enable server-side intent ingress or workflow dispatch in this mode. It
would create a second execution authority for the same review.

## 5. Bind an Exact Action Release

Set the exact public Action commit:

```dotenv
REVIEW_ROUTER_ACTION_REF=777genius/review-router@<40-character-commit>
```

A tag or branch is not accepted for Direct V2. The control plane also requires:

- independent authorization, Review V2 capability, and investigation lease
  capability signing key rings
- context session and replay keys
- a producer release attestation for the same Action commit
- a provider vote lane
- the SHA-256 of an operator credential

Generate and validate release material from the exact Action checkout:

```bash
pnpm protocol:release-manifest \
  --action-repo /path/to/review-router \
  --target-branch RELEASE_BRANCH \
  --expected-head ACTION_COMMIT_SHA \
  --output /secure/path/review-action-v2-release-manifest.json

pnpm protocol:release-manifest:check \
  --manifest /secure/path/review-action-v2-release-manifest.json \
  --action-repo /path/to/review-router
```

Populate the key rings, producer attestations, provider lanes, and context keys
using the exact shapes documented in
[`deploy/self-hosted/.env.example`](../../deploy/self-hosted/.env.example).
Do not invent release digests or copy the synthetic values from tests.

The guided installer generates and validates the release bundle from its pinned
Action checkout, then registers it during setup. For a fully manual installation,
use the maintainer-approved bundle for the same Action commit and retain its
validated manifest. Do not reconstruct artifact digests or substitute test
fixtures.

Create an operator credential, store only its hash in the shared env, and keep
the plaintext outside Compose:

```bash
export REVIEW_ROUTER_REVIEW_V2_OPERATOR_CREDENTIAL="$(openssl rand -base64 48)"
printf %s "$REVIEW_ROUTER_REVIEW_V2_OPERATOR_CREDENTIAL" \
  | openssl dgst -sha256 -r | awk '{print $1}'
```

Set the resulting hex digest as:

```dotenv
REVIEW_ROUTER_REVIEW_V2_OPERATOR_CREDENTIAL_SHA256=<sha256>
```

The detailed release bundle and activation contract is in the
[Review Action v2 cutover runbook](./review-action-v2-cutover.md).

## 6. Run Preflight and Disposable E2E

Validate the real env without printing secret values:

```bash
pnpm self-hosted:check
```

`self-hosted:check` already includes the Compose contract check. Use
`pnpm self-hosted:compose:check` alone only while editing Docker or Compose
wiring.

Before the first real deployment, run the isolated Compose proof:

```bash
pnpm self-hosted:e2e
```

The E2E creates its own synthetic environment and temporary Compose project. It
checks migrations, API/web health, OIDC, Review v2 contracts, secret redaction,
and cleanup. Passing it does not validate your real GitHub App, DNS, or provider
account; those are covered by the live canary below.

## 7. Start the Control Plane

Prepare ordinary memory on the Linux x64 Docker host before the first startup:

```bash
chmod 600 deploy/self-hosted/.env
node deploy/self-hosted/setup-memory.ts "$PWD/deploy/self-hosted/.env"
```

This builds and qualifies the private native backend, downloads pinned
multilingual local embedding/reranker models and merges generated provider
settings into the shared env without printing credentials. Allow several minutes
and image/model storage. It preserves an explicit
`REVIEW_ROUTER_MEMORY_PROVIDER=disabled` opt-out. See the
[memory startup reference](../../deploy/hindsight/BOOTSTRAP.md) for private state,
partial-install recovery and the separate conversational learning boundary.

```bash
docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/compose.yml \
  up -d --build
```

The `migrate` service applies Prisma and Review v2 migrations before web, API,
and worker start.

Verify local services:

```bash
docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/compose.yml \
  ps

curl -fsS http://127.0.0.1:4000/health
curl -fsS http://127.0.0.1:3000/api/health
```

Then verify the public HTTPS endpoints:

```bash
curl -fsS https://api.reviewrouter.example.com/health
curl -fsS https://reviewrouter.example.com/api/health
```

Do not continue while migrations, API readiness, public TLS routing, or the
worker container startup is unhealthy. The worker currently has no separate
Compose health endpoint; inspect its state and startup logs:

```bash
docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/compose.yml \
  ps worker

docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/compose.yml \
  logs --tail=100 worker
```

## 8. Register the Release

The validated release manifest proves the Action artifacts. The Review v2
release bundle also binds protocol limits, operational SLOs, owner references,
and runbook references. Build the bundle described in the
[cutover runbook](./review-action-v2-cutover.md) from the validated manifest,
then use the streaming helper below to write a private temporary file owned by
the API runtime user.

Operator commands must run against the Compose database and runtime env. Export
the plaintext credential only in the operator shell and use this helper:

```bash
export REVIEW_ROUTER_REVIEW_V2_OPERATOR_CREDENTIAL

rr_admin() {
  docker compose \
    --env-file deploy/self-hosted/.env \
    -f deploy/self-hosted/compose.yml \
    exec -T \
    -e REVIEW_ROUTER_REVIEW_V2_OPERATOR_CREDENTIAL \
    api pnpm review-v2:admin "$@"
}
```

Check the runtime env and register the release. The cleanup trap removes the
temporary bundle when registration finishes or fails:

```bash
(
  set -e
  rr_admin env-preflight
  release_bundle_path="$(docker compose \
    --env-file deploy/self-hosted/.env \
    -f deploy/self-hosted/compose.yml \
    exec -T api node deploy/self-hosted/install-bundle.ts \
    < /secure/path/review-v2-release-bundle.json)"
  trap 'docker compose \
    --env-file deploy/self-hosted/.env \
    -f deploy/self-hosted/compose.yml \
    exec -T api node deploy/self-hosted/install-bundle.ts \
    cleanup "$release_bundle_path"' EXIT
  rr_admin release register \
    --bundle "$release_bundle_path" \
    --confirm release
)
```

Do not run the admin CLI directly on the host unless the host process has the
same production `DATABASE_URL`, keys, GitHub App identity, and operator
credential as the Compose API.

## 9. Connect a Repository

1. Open the self-hosted web URL and sign in with GitHub.
2. Install the self-hosted GitHub App on the disposable repository.
3. Return to the setup flow and wait for repository sync.
4. Confirm the repository is selected, active, and reports a healthy App
   installation.

Before Codex provider onboarding, set the following in the server's saved
`.env`, replacing `OWNER/REPOSITORY` with that exact repository. The template
keeps setup issuance and new review admission closed until a repository is
explicitly selected:

```dotenv
REVIEW_ROUTER_ENABLE_CODEX_ROTATING_OAUTH=1
REVIEW_ROUTER_CODEX_ROTATING_OAUTH_REPOSITORIES=OWNER/REPOSITORY
REVIEW_ROUTER_CODEX_ROTATING_SETUP_ISSUANCE_ENABLED=1
REVIEW_ROUTER_CODEX_ROTATING_NEW_WORK_ADMISSION_ENABLED=1
```

Apply this configuration before requesting a setup command. With the manual
guide's default paths:

```bash
docker compose --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/compose.yml \
  up -d --no-build --wait web api worker
```

For an existing guided installation, preserve its saved env, project name and
TLS overlay as described above. The wizard performs this step for its first
selected repository; it does not widen an existing repository selection or
reopen an operator pause. Use the dashboard's **GitHub Secrets** provider setup
for this path.

On the **workstation**, point the Codex rotating OAuth reseed command at the
self-hosted web app:

```bash
REVIEW_ROUTER_CODEX_RESEED_API_URL="https://reviewrouter.example.com/api/codex-rotating/cli/setup-command" \
  scripts/reseed-codex-rotating-auth.sh \
  --repo OWNER/REPOSITORY
```

The command performs a repository-scoped GitHub permission check, starts an
isolated Codex login, and writes the confirmed rotating generation to the
repository secret. With the least-privilege `review-only` App profile it does
not write repository workflow files.

Never replace `REVIEWROUTER_CODEX_AUTH_JSON` with a direct `gh secret set`.
Rotating auth has a generation handshake. Bypassing it can make a queued run
present an older generation and be rejected.

Generate the canonical workflow from the same domain renderer used by
ReviewRouter. Run this from the ReviewRouter control-plane checkout on the
**workstation**, with a local checkout of the target repository:

```bash
export TARGET_REPO=OWNER/REPOSITORY
export TARGET_REPO_CHECKOUT=/path/to/target-repository
export REVIEW_ROUTER_ACTION_SHA=<40-character-commit>
export REVIEW_ROUTER_SELF_HOSTED_API_URL=https://api.reviewrouter.example.com
export TARGET_REPO_ID="$(gh api "repos/$TARGET_REPO" --jq .id)"

mkdir -p "$TARGET_REPO_CHECKOUT/.github/workflows"

pnpm tsx -e '
import { renderCanonicalCodexRotatingT0WorkflowV2 } from "./packages/features/codex-oauth-rotating/src/index.ts";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

process.stdout.write(renderCanonicalCodexRotatingT0WorkflowV2({
  actionRef: `777genius/review-router@${required("REVIEW_ROUTER_ACTION_SHA")}`,
  apiUrl: required("REVIEW_ROUTER_SELF_HOSTED_API_URL"),
  providerInstanceId: `codex-rotating:${required("TARGET_REPO_ID")}`,
  refreshScheduleCron: "17 */6 * * *",
  claudeCodeOAuthTokenSecret: false,
  openRouterApiKeySecret: false,
}));
' > "$TARGET_REPO_CHECKOUT/.github/workflows/reviewrouter-codex.yml"
```

Commit the workflow through a pull request. Do not write it directly to the
default branch. Operators using the broader `provisioning` profile may use the
dashboard setup PR instead, but the resulting file must be byte-compatible
with the canonical renderer.

Inspect `.github/workflows/reviewrouter-codex.yml` on the repository's default
branch and confirm:

- schema version is `2`
- the reusable workflow and runtime ref use the configured full Action SHA
- the API URL points to this self-hosted deployment
- the workflow uses `pull_request`, not `pull_request_target`
- permissions are limited to `contents: read`, `pull-requests: read`, and
  `id-token: write`

## 10. Initialize Review Authority

Migration leaves the global emergency stop active. For a repository first
onboarded after migration v7:

```bash
rr_admin cohort stage \
  --repo OWNER/REPOSITORY \
  --confirm OWNER/REPOSITORY

rr_admin emergency global open \
  --confirm global

rr_admin mutation initialize-direct-v2 \
  --repo OWNER/REPOSITORY \
  --confirm OWNER/REPOSITORY
```

`initialize-direct-v2` must reject a non-canonical workflow, an unregistered
Action SHA, missing worker/safety policy, or evidence of previous legacy
authority.

Do not use this command for a repository identity that existed during migration
v7. Existing identities are deliberately fenced as `v1_open` and require the
drain/activate sequence in the
[cutover runbook](./review-action-v2-cutover.md).

## 11. Prove the First Review

Open a small pull request in the disposable repository and confirm:

- exactly one ReviewRouter workflow starts for the head SHA
- OIDC admission succeeds before provider work
- the provider runs only on the GitHub Actions runner
- the ReviewRouter check reaches a terminal state
- summary and inline findings refer to the current revision
- API and worker logs contain safe codes, not auth or provider secrets

Push one additional commit and verify the previous revision cannot publish as
fresh output for the new head. Completed evidence may be reused only when the
attested compatibility policy accepts it.

Treat provider quota exhaustion and auth revocation as different failures. A
quota-limited account does not prove the ReviewRouter auth contract is broken.

## 12. Operate and Upgrade

For guided installations, apply the saved env, Compose project and proxy
settings described under [Manual installation and operations](#manual-installation-and-operations)
to every command below. The installer itself resumes only its recorded source
revision; it is not an upgrade command.

Create a database backup before every upgrade:

```bash
docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/compose.yml \
  exec postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > reviewrouter.dump
```

Upgrade one reviewed revision at a time:

```bash
git fetch --tags origin
git checkout <reviewed-commit-or-release>
pnpm install --frozen-lockfile
pnpm self-hosted:check
docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/compose.yml \
  up -d --build
```

All services must run the same commit. The migration step is idempotent and
must finish before application services become healthy.

Emergency stop:

```bash
rr_admin emergency global stop --confirm global
```

Pause one repository when publication is ambiguous:

```bash
rr_admin mutation pause \
  --repo OWNER/REPOSITORY \
  --confirm OWNER/REPOSITORY
```

Do not delete or rewrite authority rows to recover a repository.

## Definition of Done

- `pnpm self-hosted:check` passes against the production env
- `pnpm self-hosted:e2e` passes on the release source
- web, API, migration, and PostgreSQL are healthy; worker is running without
  startup failures
- public HTTPS endpoints and GitHub webhooks work
- GitHub App permissions match the configured profile
- the repository workflow is canonical schema 2 at the exact Action SHA
- rotating auth was installed through the reseed flow
- repository authority is initialized through the correct path
- a disposable PR and a follow-up revision both complete correctly
- backups and emergency stop have been exercised

For configuration details, failure codes, scaling, restore, and security notes,
use the [self-hosted deployment reference](../../deploy/self-hosted/README.md).
