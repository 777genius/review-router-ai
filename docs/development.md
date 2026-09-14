# Development and checks

Use Node.js 24 (the CI version), the pnpm version pinned in `package.json`,
and a local PostgreSQL server with `psql` available. Docker Compose is needed
for the disposable self-hosted E2E.

## Local setup

```bash
corepack enable
pnpm local:bootstrap
pnpm dev
```

Bootstrap installs dependencies, prepares `.env.local`, generates Prisma, and
migrates the dev and test databases. Configure your local database URLs and
GitHub App using the [local setup checklist](../ai-docs/LOCAL_SETUP_CHECKLIST.md).
Full readiness needs real configuration; example placeholders are not credentials.

## Checks

```bash
pnpm beta:check
pnpm build
pnpm runtime:smoke
```

For documentation-only edits, check formatting, relative links and
`git diff --check`. Runtime builds are not needed.

Disposable self-hosted verification:

```bash
pnpm self-hosted:check:smoke
pnpm self-hosted:e2e
```

Hosted configuration and public API checks:

```bash
REVIEW_ROUTER_HOSTED_ENV_FILE=/path/to/configured.env pnpm hosted:check
REVIEW_ROUTER_API_URL=https://api.reviewrouter.site pnpm hosted:api-demo:check
```

Include database checks with
`REVIEW_ROUTER_BETA_CHECK_DB_E2E=1 pnpm beta:check`. Run `pnpm protocol:check`
separately to verify the protocol contract.

## Live GitHub verification

Run live checks only against explicitly disposable test repositories and test
identities. Never use a customer repository for smoke tests.

Real GitHub smoke helpers require a disposable GitHub App installation and
selected test repository:

```bash
REVIEW_ROUTER_TARGET_REPO=owner/repo \
  node scripts/run-with-env.mjs pnpm spike:repo-health:e2e
```

App-first Codex rotating live E2E in a disposable repository:

```bash
REVIEW_ROUTER_RUN_SUBSCRIPTION_RUNTIME_LIVE_E2E=1 \
REVIEW_ROUTER_CODEX_ROTATING_E2E_OWNER=owner \
REVIEW_ROUTER_CODEX_ROTATING_E2E_REPO_NAME=rr-codex-rotating-e2e \
REVIEW_ROUTER_CODEX_ROTATING_E2E_DISPOSABLE_REPOSITORY_ID=123456789 \
REVIEW_ROUTER_CODEX_ROTATING_E2E_ACTION_REF=owner/review-router@FULL_40_CHAR_SHA \
pnpm subscription-runtime:live-e2e
```

Before the run, create the private disposable repository, install the configured
GitHub App on it, record its immutable numeric GitHub repository ID, and pin
that ID with `REVIEW_ROUTER_CODEX_ROTATING_E2E_DISPOSABLE_REPOSITORY_ID`.
`--check-only` verifies the pinned owner, name, ID, App installation, and other
prerequisites without mutating the repository. The live harness neither creates
an absent repository nor chooses a replacement repository.

Reuse that pinned disposable repository for the coherent smoke-test batch.
Create another only when isolation is required, record why it exists, and pin
its own numeric ID before use. The harness does not delete repositories; after
the batch, remove the disposable repository manually (or retain the named test
repository deliberately for the next batch).

This gate verifies the rotating workflow, real writeback, and the exact GitHub
App comment author. The historical `spike:github:fresh-repo:e2e` direct workflow
is not valid SaaS rollout evidence.

The same real GitHub smokes can be included in `beta:check`:

```bash
REVIEW_ROUTER_BETA_CHECK_REAL_GITHUB=codex-rotating pnpm beta:check
```

The historical fresh-repository E2E may create GitHub repositories and does not
delete them automatically. It is not the App-first live E2E or rollout proof.

## Architecture and contribution

Feature packages follow Clean Architecture:

```text
domain <- application <- interface/adapters
application -> ports <- infrastructure
```

The web dashboard composes features at the edge. Domain/application packages do
not import Prisma, Octokit, Fastify, tRPC, Next.js, or Auth.js directly.

Start with the [contributor guide](../ai-docs/AGENT_START_HERE.md) and
[implementation playbook](../ai-docs/IMPLEMENTATION_PLAYBOOK.md).
The [release and git flow guide](../ai-docs/operations/07-environments-and-release-management.md)
is the source of truth for releases, deployments and tags.
