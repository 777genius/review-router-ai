# ReviewRouter Self-Hosted Control Plane

This runs the ReviewRouter control plane on your own host for repositories on
github.com. Customer code review still runs inside the customer's GitHub
Actions workflow. The self-hosted server stores metadata, configuration,
webhook state, sessions, outbox jobs, and health data in Postgres.

## Agent-first installation (default)

A coding agent with shell access to a Linux x64 host can run setup without
interactive prompts. Prepare Docker Compose v2, Git, curl, Node.js 24.21+ or
26.10+, and two public DNS names (web and `api.<web hostname>`) first:

```bash
bash -c 'installer=$(mktemp) && curl -fsSL https://raw.githubusercontent.com/777genius/review-router-ai/main/scripts/install-self-hosted.sh -o "$installer" && bash "$installer" "$@"; result=$?; rm -f "$installer"; exit "$result"' -- \
  --web-url https://review.example.com \
  --repo OWNER/REPOSITORY
```

The API URL defaults to `https://api.review.example.com` for this example.
The script returns a JSON state and safe next-step arguments on stdout.
If an approval is needed, let the agent carry out the allowed preparation and
request GitHub App/provider authorization or workflow PR approval from the
authorized user. Resume from the saved checkout; private credentials and
versions are preserved. Passing `--interactive` opts in to manual prompts.
`--status` prints the saved status without touching services.

Prepare two public DNS names, Docker Compose v2, Git and a supported Node.js
release. The installer configures services, private credentials, default
Memory and HTTPS. It does **not** claim a completed review until a genuine
provider run and GitHub App-authored comments have been observed in a test PR.

See the [guided installation steps](../../docs/operations/review-router-self-hosted-end-to-end.md#guided-installation)
for exact prerequisites, the SSH callback tunnel, options and resume behavior.
The sections below are the detailed manual configuration and operations reference.

This guide does not cover GitHub Enterprise Server, air-gapped deployments, or
cloud review execution.

## How the pieces fit

ReviewRouter is made of parts that run in different places. This guide covers
the control plane, the GitHub App, and the direct T0 settings for the review
runtime. The account gateway is a separate service that this guide does not set
up.

| Part            | Where it runs                                 | What it does                                                                              | Covered here                            |
| --------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------- |
| Control plane   | Your host, this Compose stack                 | Dashboard, GitHub webhooks, review state, configuration                                   | Yes, sections 1 and 4-7                 |
| GitHub App      | GitHub, owned by you                          | Gives the control plane access to your repositories and webhooks                          | Yes, section 2                          |
| Review runtime  | The customer's GitHub Actions workflow        | Runs the review on each pull request with the provider key                                | Partly: direct T0 settings in section 3 |
| Account gateway | A separate service, not in this Compose stack | Signs in subscription accounts (for example Codex device login) and routes calls for them | No, see below                           |

## Check database access after a deploy

The default Compose stack connects as one database user, so every query is
allowed. If you give the app, worker and web separate database roles, a missing
grant does not show up in tests or at startup. It shows up later as events that
fail with `permission denied` until they are dead lettered, for example
repository sync or statistics. After each deploy run this with the worker DATABASE_URL
(the supported policies are the dedicated `reviewrouter_worker` role and the
default shared Compose role `reviewrouter`):

```bash
DATABASE_URL=... node scripts/check-runtime-db-privileges.mjs
```

It checks the privileges the worker is known to need and lists outbox dead
letters from the last 7 days that failed with a permission error. It exits with
1 if it finds a problem.

## Account gateway (not in this stack)

The account gateway holds credentials for subscription accounts and executes
provider calls for them. The ReviewRouter API and dashboard use it for account
sign-in, account limits, and gateway-routed execution.

- Source: <https://github.com/agent-teams-ai/account-gateway> (public).
- Integration: ReviewRouter consumes a pinned Account Gateway SDK archive; see
  [SDK provenance](../../vendor/account-gateway/llm-sdk-provenance.json). The
  gateway remains a separately provisioned service.
- This Compose stack does not start or configure it. Gateway-routed execution
  stays off unless `REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_ENABLED=1` and
  `REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY` are set. The web and API need
  further `REVIEW_ROUTER_ACCOUNT_GATEWAY_*` settings that this guide does not
  document; set any of them only if you run a gateway yourself.
- Gateway account sign-in requires that separate service. The guided install
  uses the repository's GitHub Secrets provider setup; its first live review
  still needs to be verified as described in the end-to-end guide.

## Services

### Complete memory provider

The guided installer and standalone memory command below build and qualify the
pinned private Hindsight backend, download pinned multilingual local models,
start its database/API/worker and configure the shared env automatically. The native services run
separately from Compose, preserving the existing physical-Forget cleanup profile.
Ordinary approved memory uses local embeddings and reranking with no generative
account. Normal setup also consumes a qualified conversation capability when the
release includes the source-owned artifact described below. It never creates that
qualification from installed models or configuration.
See the [memory startup reference](../hindsight/BOOTSTRAP.md) for recovery.

The Compose stack starts:

```text
postgres - ReviewRouter metadata database
migrate  - one-shot Prisma plus Review v2 migration/backfill job
web      - Next.js dashboard and Auth.js routes
api      - Fastify API, GitHub webhooks, action OIDC/config endpoints
worker   - outbox, repository sync, and maintenance jobs
```

The same Docker image is used for `web`, `api`, `worker`, and `migrate`.
The image keeps the Prisma CLI and PostgreSQL client available so self-hosted
upgrades can run schema migrations and the Review v2 backfill without a
separate tool container.

## Prerequisites

- Docker with Compose v2.
- Public DNS for the web and API hosts.
- Inbound ports 80 and 443 for bundled Caddy, or existing HTTPS termination in
  front of the exposed web/API ports.
- A GitHub App owned by the operator of this self-hosted instance.
- Outbound access from the host to `github.com`, `api.github.com`, and GitHub
  OIDC/JWKS endpoints.

Recommended versions in this stack:

- Node.js 26.11.1 for the app image.
- PostgreSQL 18 for the bundled local database.

The bundled PostgreSQL 18 service mounts the named volume at
`/var/lib/postgresql`, not `/var/lib/postgresql/data`. Keep that path when
customizing Compose; PostgreSQL 18 stores major-version-specific data
directories under the parent path.

## 1. Prepare Env

```bash
cp deploy/self-hosted/.env.example deploy/self-hosted/.env
```

Generate a URL-safe PostgreSQL password, then generate every other secret
independently:

```bash
openssl rand -hex 32
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 32
```

Use those values for:

```text
AUTH_SECRET
REVIEW_ROUTER_ACTION_SESSION_SECRET
REVIEW_ROUTER_TOKEN_ENCRYPTION_KEY
GITHUB_WEBHOOK_SECRET
POSTGRES_PASSWORD
```

Keep `DATABASE_URL` in sync with `POSTGRES_PASSWORD`.
Use the secret manager's cryptographic generator to create
`REVIEW_ROUTER_DATABASE_RECOVERY_WITNESS` directly as at least 32 random bytes
encoded as unpadded base64url. Store it as one shared runtime value used by
every web/API writer; never include it in terminal output, logs, or support
output.

Set `REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF` to an exact 40-character Action
SHA independently of the general Action ref. During A -> B, trust both exact
SHAs first, use B only for new setup candidates, and keep existing active
namespaces pinned to A until a fenced drain and fresh namespace activation.

## 2. Create GitHub App

Create a GitHub App for the self-hosted instance and configure:

```text
Callback URL:  https://<web-host>/api/auth/callback/github
Setup URL:     https://<web-host>/setup
Webhook URL:   https://<api-host>/webhooks/github
```

Set these env vars from the App settings:

```text
GITHUB_APP_ID
GITHUB_APP_CLIENT_ID
GITHUB_APP_CLIENT_SECRET
GITHUB_APP_SLUG
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY
GITHUB_WEBHOOK_SECRET
```

`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` should match the App client ID
and secret. For `GITHUB_APP_PRIVATE_KEY`, paste the PEM into the env file with
escaped newlines (`\n`).

Choose the narrowest GitHub App permission profile that matches how the
self-hosted instance will operate:

```text
review-only    Direct customer-managed PR workflows. No server-side dispatch,
               setup PRs, workflow edits, or secret provisioning.
managed-review Durable ReviewRouter workflow_dispatch and exact-run
               cancellation. Workflows and provider secrets are managed outside
               ReviewRouter.
provisioning   Dashboard setup PRs, workflow file updates, and GitHub Actions
               secret provisioning.
org-ruleset    provisioning plus organization ruleset administration.
```

The manual examples below use `review-only` with a manually installed workflow.
The guided installer defaults to `provisioning` so the dashboard can create
setup PRs. Both use client-triggered Direct V2. Use `managed-review` only for
a separate server-dispatched mode.

Create a manifest with the matching profile:

```bash
pnpm github-app:create -- \
  --permission-profile review-only \
  --web-url https://reviewrouter.example.com \
  --api-url https://api.reviewrouter.example.com \
  --name "ReviewRouter Self-Hosted"
```

Set the same profile in `.env`:

```text
REVIEW_ROUTER_GITHUB_APP_PERMISSION_PROFILE=review-only
```

`review-only` requires:

```text
Actions: read
Checks: write
Contents: read
Pull requests: write
Issues: write
Commit statuses: write
Metadata: read
```

`managed-review` adds:

```text
Actions: write
```

`provisioning` adds:

```text
Contents: write
Workflows: write
Secrets: write
Organization secrets: read
Organization plan: read
```

`org-ruleset` adds:

```text
Organization administration: write
```

Webhook events are also profile-based. `review-only` requires:

```text
Check run
Issue comment
Pull request
Repository
Status
Workflow run
```

`managed-review`, `provisioning`, and `org-ruleset` also require:

```text
Workflow job
Push
```

GitHub App installation lifecycle events are delivered by GitHub Apps by
default; do not add `installation` or `installation_repositories` to the
manifest manually.

Enable redirect after installation updates so users return to the dashboard.

## 3. Configure Direct T0

Self-hosted direct T0 is client-triggered. Readiness requires both explicit
opt-ins and rejects any server-side intent or dispatch enablement:

```text
REVIEW_ROUTER_REVIEW_V2_DIRECT_INITIALIZATION_ENABLED=1
REVIEW_ROUTER_REVIEW_V2_WORKFLOW_PROVISIONING_MODE=client_triggered_t0
REVIEW_ROUTER_REVIEW_V2_RUN_CONTROL_ENABLED=1
REVIEW_ROUTER_REVIEW_V2_WORKER_ENABLED=1
REVIEW_ROUTER_REVIEW_V2_INTENT_INGRESS_ENABLED=0
REVIEW_ROUTER_REVIEW_V2_INTENT_ADMISSION_REQUIRED=0
REVIEW_ROUTER_REVIEW_V2_WORKFLOW_DISPATCH_READY=0
REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED=1
```

In `client_triggered_t0`, the customer workflow starts the review. ReviewRouter
must not ingest a server-owned intent or dispatch a second workflow. The
`review-only` GitHub App profile is valid for this mode; use a broader profile
only when its separate management features are required.

The canonical client-triggered workflow is schema 2. It runs only for same-repo
`pull_request` events, uses the exact pull-request head SHA and number, grants
only `contents: read`, `pull-requests: read`, and `id-token: write`, and pins the
reusable workflow to the full Action commit. Direct initialization rejects any
other executable workflow inventory.

For Codex through GitHub Secrets, keep the template's setup issuance and new-work
admission controls closed until an exact repository is selected. The guided
installer configures that selection before provider onboarding. For manual
installation, follow [Connect a Repository](../../docs/operations/review-router-self-hosted-end-to-end.md#9-connect-a-repository)
to set both controls, apply the configuration and complete the provider setup.

Pin `REVIEW_ROUTER_ACTION_REF` to the exact 40-character Action commit. Populate
the authorization, Review V2 capability, and investigation lease capability key
rings, producer release attestations, provider vote lanes, context keys, and
operator credential hash declared in `.env.example`. Generate independent
32-byte base64 secrets for each signing or context key. Never reuse the general
Review V2 capability key for investigation leases:

```bash
openssl rand -base64 32
```

The signing key-ring JSON shape is:

```json
[{ "keyId": "self-hosted-v1", "secretBase64": "...", "verifyUntil": null }]
```

The context replay key-ring JSON shape is:

```json
[{ "keyId": "context-v1", "secretBase64": "..." }]
```

Build producer attestations and provider vote lanes from the validated release
bundle. Do not invent release digests. The attestation `actionCommitSha` must
match `REVIEW_ROUTER_ACTION_REF`.

An Action release may advertise `review_investigation_v1` only when its
attestation also contains the exact generated compatibility profile:

```json
{
  "reviewInvestigationCapability": "review_investigation_v1",
  "reviewInvestigationCoverageProfileHash": "<generated SHA-256>",
  "reviewInvestigationPolicyHash": "<generated SHA-256>"
}
```

All three fields are optional as a group and mandatory as a group. A partial
profile, an unregistered hash, or a release without the matching Context Gateway
artifact fails closed and keeps the Action on the legacy review path. Copy these
hashes from the validated Action release artifact; do not calculate or edit them
by hand.

Store only the SHA-256 of the Review v2 operator credential in the shared env:

```bash
printf %s "$REVIEW_ROUTER_REVIEW_V2_OPERATOR_CREDENTIAL" \
  | openssl dgst -sha256 -r | awk '{print $1}'
```

Keep the plaintext credential outside the Compose env and provide it only to an
operator command. The migration/backfill leaves the global Review v2 emergency
stop active. Follow the
[Review Action v2 cutover runbook](../../docs/operations/review-action-v2-cutover.md)
to stage and activate repositories after service health is proven.

## 4. Check Config

From the repository root:

```bash
pnpm self-hosted:check
```

Or point the checker at a different env file:

```bash
REVIEW_ROUTER_SELF_HOSTED_ENV_FILE=/path/to/reviewrouter.env pnpm self-hosted:check
```

The checker rejects local/non-HTTPS public URLs, missing GitHub App values,
placeholder secrets, provider credentials in server env, missing direct-T0
opt-ins, client-triggered/server-dispatched mode conflicts, unpinned action
refs, invalid key/config material, release-attestation mismatch, and
incompatible permission profiles.

Validate the Compose service contract separately when changing Docker or
service wiring:

```bash
pnpm self-hosted:compose:check
```

Run the complete disposable local E2E gate before a self-hosted release:

```bash
pnpm self-hosted:e2e
```

The E2E first runs the real native Memory installer against its private fresh
env, verifies completed-install reuse, and checks the installed provider settings
in Web, API and worker. It then exercises real save, read, recall, permission
denial and post-Forget exclusion. A pending physical cleanup remains pending;
full sandbox teardown is not an individual signed physical-Forget receipt.
The gate downloads the pinned native inputs and model weights, so allow the
same Linux x64 Docker prerequisites and disk space as first installation below.
Failed native state is retained for diagnosis and reconciliation.

The E2E command generates an isolated complete T0 env, builds and boots a fresh
Compose project on free localhost ports, verifies both migration layers and
exact health responses, runs the Review v2 and action OIDC harnesses inside the
container, checks logs for credential material, and removes its database and
volumes. It also runs legacy Review Action v2 and the deterministic fake-gateway
investigation flow against one investigation-capable producer release, verifies
the exact coverage/policy hashes, and proves that a changed release profile
fails before investigation state is written. Recording, shadow, and context
critic are enabled only inside this disposable run; production effects,
verified clean, and cross-revision replay remain disabled.

## 5. Start

On the Linux x64 Docker host, prepare default memory before the first Compose
startup. The command requires Node 24 or later, Git, Python 3, tar and outbound
HTTPS. Keep the real env file private:

```bash
chmod 600 deploy/self-hosted/.env
node deploy/self-hosted/setup-memory.ts "$PWD/deploy/self-hosted/.env"
```

This builds and runs the real native qualification, then downloads about 1 GB
of pinned multilingual model weights. Allow several minutes and space for the
native Docker images, private logs and models. It generates independent service
credentials, preserves a private env backup, and atomically adds the provider
settings without printing secrets. An explicit
`REVIEW_ROUTER_MEMORY_PROVIDER=disabled` is preserved and skips provisioning.
To put durable native state elsewhere, supply an absolute directory as the
second argument. An optional third argument separates heavy build/download
scratch work from durable models, evidence and runtime state. Completed phases
are reused; a partial native qualification or
installation is preserved for reconciliation rather than repeated blindly.

If a genuinely qualified release includes
`deploy/self-hosted/conversation-capability.json`, the same setup command validates
its strict v2 declaration against all four actual implementation/provenance files
in this checkout and the installed source stamp. It atomically installs the existing
qualification and matching immutable interaction-runtime pin together with the
provider settings. The generated standalone verifier uses the authoritative parser
and needs no host `node_modules`, extra package installation or provider credentials.
Normal repository setup and live source/account authority still apply; eligible new
repositories use their current selected primary review account and supported model,
without a per-repository operator qualification.

No genuine conversation capability artifact is supplied by this implementation.
Missing, invalid or mismatched release evidence leaves approved/manual memory
available and reports an explicit unqualified conversation status. Existing
qualification/pin assignments, including v1, partial or empty operator input, are
preserved for reconciliation. Provider opt-outs and service pauses suppress new
capability installation. A preserved v2 declaration with stale source hashes cannot
authorize automatic processing after an upgrade; the runtime checks its current
source stamp without overwriting the operator's env or disabling manual storage.
Do not create a placeholder artifact or infer qualification from a successful parser,
source-stamp check, native installation or synthetic fixture.

Then use the normal stack startup:

From `deploy/self-hosted`:

```bash
docker compose up -d --build
```

From the repository root:

```bash
docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/compose.yml \
  up -d --build
```

The `migrate` service runs Prisma migration deploy and then
`review-v2-migrate.mjs --apply`. The Review v2 migration is resumable and
idempotent; `web`, `api`, and `worker` start only after both layers succeed.
After the migration ledger records completion, normal restarts preserve the
current emergency-control state instead of requiring the global stop to be
re-enabled.
Prisma's `?schema=public` URL parameter is removed only for `psql`; other libpq
parameters such as `sslmode` are preserved.

Check status:

```bash
docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/compose.yml \
  ps
curl -fsS http://127.0.0.1:4000/health
curl -fsS http://127.0.0.1:3000/api/health
```

Your public reverse proxy should route:

```text
https://<web-host> -> 127.0.0.1:3000
https://<api-host> -> 127.0.0.1:4000
```

## 6. Operator CLI

Self-hosted admin commands must run inside the API container so they use the
same database, keys, GitHub App identity, and runtime contract as the service.
Keep the plaintext operator credential outside the shared env file, export it
only in the current operator shell, and define:

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

Run `rr_admin env-preflight` before a mutation.

## 7. Upgrade

Guided installations use a saved private env, a named Compose project and an
optional TLS overlay. Apply those same settings to the commands below, as
described in [Manual installation and operations](../../docs/operations/review-router-self-hosted-end-to-end.md#manual-installation-and-operations).
The installer resumes its recorded source revision and does not perform upgrades.

```bash
git fetch --tags origin
git checkout <reviewed-commit-or-release>
git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm self-hosted:check
docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/compose.yml \
  up -d --build
```

The migration job is idempotent and runs both Prisma and Review v2 migrations
before app services.

Migration v7 places every repository identity that already exists at upgrade
time behind a durable `v1_open` authority fence. This is intentionally
conservative: an existing repository is never inferred to be fresh-V2 merely
because its old activity is absent from current tables. Upgrade those
repositories through the normal drain/activate path. A repository onboarded
after v7 may use direct initialization only if the schema-2 inventory,
registered release, worker, safety policy, and no-legacy proof all pass:

```bash
rr_admin cohort stage \
  --repo OWNER/REPO \
  --confirm OWNER/REPO

rr_admin emergency global open \
  --confirm global

rr_admin mutation initialize-direct-v2 \
  --repo OWNER/REPO \
  --confirm OWNER/REPO
```

Legacy admission and direct initialization use the same repository-scoped
database lock. The first authority decision wins; a concurrent losing path
fails closed instead of opening both mutation lanes.

Migration intentionally leaves the global Review v2 emergency stop active.
Stage at least one repository before running `emergency global open`. The
global policies remain allowlisted, so opening the global control does not
enroll unstaged repositories. Restore the kill switch with:

```bash
rr_admin emergency global stop --confirm global
```

## Backups

Create a backup:

```bash
docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/compose.yml \
  exec postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > reviewrouter.dump
```

Restore into a stopped or fresh stack after creating the database:

```bash
docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/compose.yml \
  exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < reviewrouter.dump
```

## Scaling

The API and worker are stateless. Start with one instance each. Scale workers
only after the database has enough capacity:

```bash
docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/compose.yml \
  up -d --scale worker=2
```

Keep all services on the same git SHA/image tag.

## Security Notes

- Do not put `CODEX_AUTH_JSON`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`,
  `CLAUDE_CODE_OAUTH_TOKEN`, or model/provider credentials in this env file.
- Provider credentials belong in customer GitHub repo/org Actions secrets.
- Never replace `REVIEWROUTER_CODEX_AUTH_JSON` with a direct
  `gh secret set`. Rotating auth includes a generation handshake; bypassing it
  can make queued runs present an older generation. Use
  `scripts/reseed-codex-rotating-auth.sh` or the dashboard-generated reseed
  command.
- Point self-hosted CLI reseeds at this deployment explicitly. Without this
  override the script intentionally defaults to the hosted ReviewRouter:

  ```bash
  REVIEW_ROUTER_CODEX_RESEED_API_URL="$REVIEW_ROUTER_PUBLIC_WEB_URL/api/codex-rotating/cli/setup-command" \
    scripts/reseed-codex-rotating-auth.sh \
    --repo OWNER/REPOSITORY
  ```

- Keep Postgres bound to localhost unless you put it on a private network.
- Use HTTPS for public web/API URLs. Generated customer workflows depend on
  `REVIEW_ROUTER_PUBLIC_API_URL`.
- Do not add `pull_request_target` to generated customer workflows.

### Public runtime dependency

The subscription runtime is fetched over HTTPS from the public
[`777genius/ar`](https://github.com/777genius/ar) repository at the immutable
commit pinned in `package.json` and `pnpm-lock.yaml`. No GitHub token or SSH deploy
key is required for this dependency. `@777genius/subscription-runtime` is the
local dependency/import alias; the upstream package retains its own name.
