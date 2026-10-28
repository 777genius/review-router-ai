# Release And Git Flow

This file is the source of truth for ReviewRouter git flow, deploy sequencing,
and release tags. Keep `README.md` and `AGENTS.md` as links to this
file instead of duplicating the process there.

## Repositories

ReviewRouter has two release-coupled repositories:

- `777genius/review-router` - customer GitHub Action and reusable workflow entrypoint.
- `777genius/review-router-ai` - self-hosted control plane and trusted conflict-runtime checkout.

Generated reusable workflows use the same ref for both layers:

```text
uses: 777genius/review-router/.github/workflows/reviewrouter-reusable.yml@v1
runtime_ref: v1
```

For conflict review, `runtime_ref` is also used to checkout
`777genius/review-router-ai`. That means compatible releases must keep the two
repos on matching exact tags, for example `v1.0.39` in both repositories.

## GitHub Repository Rename Operations

The control-plane repository rename changes `777genius/review-router-saas` to
`777genius/review-router-ai`. A GitHub rename retains the repository ID and
redirects old HTTPS and SSH clone URLs, but maintained references must use the
new slug. Update links and checkout URLs in both repositories, Render
source bindings, and local `origin` remotes. Verify seed and reseed URLs still
resolve through the unchanged public Action repository. The
customer Action repository remains `777genius/review-router`; its reusable
workflow references and immutable tags are unchanged. Do not recreate the old
slug or move immutable release tags.

The GHCR `review-router-saas-runtime` image namespace is a separate artifact
identity and remains unchanged for digest and policy compatibility. This
subsection records required operations and does not assert that rename cutover
is complete. When this repository is itself registered, verify that the
`repository.renamed` webhook updates its `RepositoryConnection.fullName` before
using OIDC flows. The lookup must retain the same numeric repository ID; do not
rename the public Action registration. Existing `-e2e` repository references,
historical release evidence, and old-layout paths in ADR mappings stay intact.

Inspect repository and environment variables for
`REVIEW_ROUTER_RELEASE_CONTROL_REPOSITORY`: any configured value must match the
new full name before running the private-network rollout. Image attestation
policies also bind the source repository name; retain historical attestations
as issued and generate fresh evidence for future releases.

## Channels

```text
main     - live Action channel, default for hosted beta setup PRs
v1       - stable moving major channel, conservative customer option
v1.0.x   - immutable exact release tag, conservative pinned customer option
workflow-v1 - compatible neutral Gateway caller ABI, independent of product semver
```

The neutral Gateway caller uses
`777genius/review-router/.github/workflows/reviewrouter-runtime.yml@workflow-v1`.
Compatible agent, model and runtime updates keep its inputs and permissions
unchanged. Product release does not move this workflow channel. Publish the exact
public release, deliver and activate the paired private runtime, and register the
verified exact producer before explicitly promoting the channel to that existing
immutable release tag. Promotion checks the existing workflow ABI and compares
the previous channel SHA before moving it; the signed actual executable SHA must
still be approved in the producer registry. Keep the previous approved producer
available for already admitted runs. A channel tag is never execution authority
by itself.

Installed callers must remain semantically compatible with the server template
throughout `workflow-v1`. A template change must continue accepting installed
documents or introduce a new workflow ABI major with an installation update.

The first pre-launch publication introduces an unused channel: keep known
installations stopped until the paired API/schema, producer registration and new
caller are ready. GitHub Secrets and Hosted Pool keep their existing entrypoints.
Breaking caller inputs or permissions require a new workflow ABI major; changing
the public repository or reusable workflow path requires an installation update.

Rules:

- Hosted beta customer workflows default to `main` so Action fixes ship without regenerating customer setup PRs.
- Never force-move immutable exact tags such as `v1.0.39`.
- Move `v1` only through the release workflows, except for a documented emergency rollback.
- Do not move `v1` for breaking workflow inputs, protocol breaks, or untested runtime changes.
- Release both repositories with the same exact version when generated workflows can use that ref in both places.
- Do not use the legacy local `pnpm release:sync-major` helper for normal releases.
- Hosted-pool control plane workflows are an exception to the mutable hosted-beta
  channel: they consume the exact public Action commit recorded with its
  immutable release tag and `dist/index.js` SHA-256. Before configuring control plane,
  run `pnpm hosted-pool:action-release:verify` against a clean checkout of that
  Action commit. The verifier requires `HEAD`, the tag's peeled commit, the
  control plane-consumed action ref, and the bundle digest to be one exact tuple.

## Daily Git Flow

Default flow:

```text
branch/worktree -> local checks -> commit -> PR -> CI -> merge to main -> deploy or release
```

Working rules:

- Use a separate branch or worktree for non-trivial changes.
- Keep commits focused and use conventional commit messages.
- Do not mix unrelated refactors into release or hotfix commits.
- Do not deploy on every small change. Batch coherent fixes, run checks, then deploy.
- Before deploy or release, verify the exact commit that will ship.
- If the tree is dirty with unrelated work, do not stage or revert it. Commit only the intended files.
- Prefer PRs into `main`. Direct pushes are only for an explicitly approved urgent operator action.

Recommended local checks before pushing control plane changes:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm runtime:smoke
git diff --check
```

For narrow documentation-only changes, `git diff --check` plus a targeted review
is acceptable. Use judgment, but do not skip relevant checks for runtime changes.

Recommended local checks before pushing Action runtime changes:

```bash
npm run typecheck
npm test -- --runInBand
npm run build
git diff --check
```

The Action repo commits bundled `dist/` output. If a change affects runtime
code, rebuild and commit the bundle.

For hosted beta `@main` customers, control plane action runtime changes must also be
synced into the public Action repo before they can be picked up by customer
workflows:

```bash
git -C ../review-router-action switch main
git -C ../review-router-action pull --ff-only origin main
pnpm action:artifact:check
pnpm action:sync-public-runtime -- --write
```

Then commit and push the resulting public Action repo changes to
`777genius/review-router@main`. Customer workflows using
`uses: 777genius/review-router@main` pick up that commit on their next run.

The `Sync Public Action Runtime` GitHub workflow performs this automatically
after a successful control plane `CI` run on `main`. It requires one cross-repository
credential because the default `GITHUB_TOKEN` is scoped to
`777genius/review-router-ai` and cannot push to `777genius/review-router`.

Preferred credential:

- `REVIEW_ROUTER_ACTION_SYNC_SSH_KEY`: a write deploy key scoped only to
  `777genius/review-router`.

Fallback credential:

- `REVIEW_ROUTER_ACTION_SYNC_TOKEN`: a fine-grained PAT or GitHub App token
  with `Contents: write` on `777genius/review-router` and permission to push
  `main`.

## Release Order

For a new public/stable runtime release:

```text
1. Release 777genius/review-router at v1.0.x
2. Pin REVIEW_ROUTER_PAIRED_ACTION_REF in control plane CI to that exact Action commit
3. Merge the pin and wait for control plane CI on the resulting exact commit
4. Release 777genius/review-router-ai at the same v1.0.x
5. Verify both v1 tags resolve to the new exact release commits
6. Activate the paired private runtime and verify the exact public producer is registered; align REVIEW_ROUTER_ACCOUNT_GATEWAY_ACTION_REF and REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF with the approved target producer before promotion
7. Explicitly promote workflow-v1 to the existing public exact release tag after its ABI check and previous-channel SHA comparison
8. Verify generated/setup PRs use their intended channel or exact pin
```

### Compatible Action-only hotfix on the installed private image

The accepted Action173/174 producer overlays on unchanged SaaS171 establish this
bounded alternative for compatible public runtime fixes. It does not publish a
same-version private release: for an Action180 hotfix on private179, private `v1`
and the private exact tag remain179. Consumers checking out both repositories by
one exact `runtime_ref` cannot use the unpaired180 tag.

Use this seam only when private code, image and database remain unchanged and the
installed backend accepts the unchanged workflow ABI, schema/canonicalizer,
capability/policy and immutable agent/runtime/protocol profiles. Any incompatibility
or required private change uses the normal paired Release Order above.

1. Accept the exact public commit, independent review, required CI, official exact
   release and canonical manifest/checker. Verify compatibility against the actual
   installed private source and retain its signed image/publication acceptance.
2. Through the existing reviewed producer-overlay operator, append only the actual
   approved producer to all role registries; retain every old row and profile.
   Preserve the private image, database, credentials, flags and admission limits.
3. Align the WEB Gateway Action ref and complete public seed/installer tuple with
   the rotating Action ref. Preserve overlap order and retain the previous primary
   for admitted runs; do not relabel the signed private release descriptor.
4. Verify backend health, unchanged image/configuration and exact registry/ref
   readback before the existing workflow ABI check and previous-SHA CAS promotion
   of `workflow-v1`. Record this as Action-only adoption, not a paired private release.

No review, CI, artifact-signature or runtime-admission gate is waived; no new
release automation or mutable-tag execution authority is introduced.

Why the Action repo goes first:

- control plane release workflow checks that the matching Action tag already exists.
- Customer workflows call the Action/reusable workflow first.
- Conflict runtime then checks out the control plane runtime using the same `runtime_ref`.

## Action Runtime Release

Repository: `777genius/review-router`.

Before running the workflow:

1. Pick the next exact version, for example `v1.0.40`.
2. Update:
   - `package.json` version to `1.0.40`
   - `package-lock.json` root versions to `1.0.40`
   - `scripts/install.sh` `LATEST_RELEASE_TAG` to `v1.0.40`
3. Rebuild committed bundles with `npm run build`.
4. Run relevant local checks.
5. Commit to `main`.
6. Wait for CI on `main` or let the release workflow run its own gates.

Run the GitHub Actions workflow:

```bash
gh workflow run release.yml \
  -R 777genius/review-router \
  --ref main \
  -f version=v1.0.40 \
  -f create_github_release=true
```

The Action `Release` workflow validates:

- the requested version is `vN.N.N`
- it is running on `main`
- local `HEAD` matches `origin/main`
- the exact tag is absent, or already points to the same control plane `HEAD` for a safe
  rerun
- the version is newer than the latest existing `v1.*.*` tag
- package metadata and installer fallback match the requested version
- dependencies install cleanly
- lint, typecheck, tests, and build pass
- committed release artifacts are clean after build

Only after those gates pass, it creates `v1.0.x`, force-moves `v1`, and creates
the GitHub Release. It leaves `workflow-v1` unchanged; that channel is promoted
separately after paired private activation and producer registration.

## Self-hosted Control Plane Runtime Release

Repository: `777genius/review-router-ai`.

### Release Authority schema ordering

When a candidate adds a migration under
`packages/platform/release-authority-db/migrations`, database authority moves
before code authority. After the exact protected `main` SHA passes the
`Dedicated Release Authority PG17 contract`, keep provider auto-deploy disabled
and run `.github/workflows/release-authority-migration.yml` at that SHA with
`operation=incremental-upgrade`. The protected
`production-release-authority-migration` environment is the sole production
holder of the restricted migration-issuer credential. The issuer can create a
short-lived, operation-bound login but cannot inherit database-owner authority
or mutate the authority catalog directly. A successful gate on
that exact SHA is required before deploying control, witness, or other code
whose readiness depends on the new authority catalog.

That environment must retain at least one required reviewer, prevent self
review, and allow only protected branches. The workflow verifies those settings
through the GitHub API in its repository-independent trust job and fails closed
before the issuer credential is available to any job.

Fresh provisioning is a different operation: use `operation=fresh-install`
only for a new database with no `release_authority` schema. Neither operation
falls back to the other. The normative setup, upgrade, failure, and recovery
procedure is in
[`docs/operations/private-pg17-release-rollout.md`](../../docs/operations/private-pg17-release-rollout.md).

Before running the workflow:

1. Merge the control plane/runtime commit to `main`.
2. Confirm the matching Action tag already exists, for example:

```bash
git ls-remote --tags https://github.com/777genius/review-router.git refs/tags/v1.0.40
```

3. Resolve that tag to its immutable Action commit and update
   `REVIEW_ROUTER_PAIRED_ACTION_REF` in `.github/workflows/ci.yml` through a PR.
4. Wait for the trusted `CI` workflow on the resulting exact `main` commit to
   pass. Its
   production gate must include both `Dedicated Release Authority PG17
contract` and `Full private PG16 to PG17 rehearsal` as successful jobs.
   Each job uploads its own exact-SHA evidence artifact.
   A manual CI dispatch that enables the authority contract must set
   `release_authority_contract_baseline_sha` to the previous protected `main`
   SHA; push CI derives the same fact from the protected push event. Its
   `paired-action-release-gate` artifact must name the same Action commit as the
   release tag.
5. Confirm the GitHub `production-release` environment exists, requires at
   least one reviewer, prevents self-review, and permits protected branches
   only. `main` itself must remain protected. These are external repository
   settings; the workflow audits them and fails closed but does not create or
   repair them. Store `SUBSCRIPTION_RUNTIME_DEPLOY_KEY_B64` there and, when the
   optional production Action-ref sync is used, store its scoped
   `RENDER_API_KEY` there as environment secrets rather than repository
   secrets.

Run the GitHub Actions workflow:

```bash
gh workflow run release.yml \
  -R 777genius/review-router-ai \
  --ref main \
  -f version=v1.0.40 \
  -f create_github_release=true
```

The control plane `Release` workflow validates:

- an inline, read-only bootstrap runs before checkout or repository code and
  proves that the dispatch workflow ref is `refs/heads/main`, the dispatch SHA
  is still current protected `main`, and `production-release` has the required
  reviewer and protected-branch policy
- the requested version is `vN.N.N`
- it is running on `main`
- local `HEAD` matches `origin/main`
- the exact tag does not already exist locally or remotely
- the version is newer than the latest existing `v1.*.*` tag
- the matching Action tag exists
- one successful trusted `CI` run exists for the exact control plane `HEAD`, and that
  exact run contains successful, non-skipped `Dedicated Release Authority PG17
contract` and `Full private PG16 to PG17 rehearsal` jobs
- the same exact CI run owns both unexpired, digest-addressed evidence
  artifacts; each artifact manifest binds the repository, commit, run ID, run
  attempt, exact job name, and SHA-derived artifact name
- when `sync_production_action_ref=true`, production Render credentials can
  dry-run the requested Action ref override
- one `linux/amd64` hosted runtime image containing web, API, and worker builds
  from the exact release commit and publishes to GHCR
- GHCR resolves the published image to an immutable OCI manifest digest; the
  workflow uploads `hosted-runtime-image-<version>` with the exact
  commit/image URL/digest tuple used by the Render deployment gate

The repository checkout uses only the SHA emitted by that bootstrap and never
persists checkout credentials. The write-capable release job cannot start
until the `production-release` environment gate is satisfied; package, OIDC,
tag, release, and Render credentials are introduced only after bootstrap.
Only after those gates pass, it creates `v1.0.x`, force-moves `v1`, and creates
the GitHub Release. Hosted beta production keeps `REVIEW_ROUTER_ACTION_REF` on
`777genius/review-router@main` by default. Normal release invocation:

```bash
gh workflow run release.yml \
  -R 777genius/review-router-ai \
  --ref main \
  -f version=v1.0.40 \
  -f create_github_release=true \
  -f sync_production_action_ref=false
```

If the workflow fails after publishing the exact tag, rerun with the same
version only when that exact tag already points to the same control plane `GITHUB_SHA`.
The workflow allows that recovery path and still fails closed if the tag points
anywhere else.

Set `sync_production_action_ref=true` only for a deliberate rollback or smoke
override.

The two PostgreSQL gates intentionally do not run for pull requests, including
fork pull requests. They run together on the trusted push to `main`, so an
ordinary low-risk PR does not duplicate the expensive real-PostgreSQL work.
They may also be run manually from `main`, but both workflow-dispatch inputs
must be enabled in the same run for that run to qualify. A successful CI run
that skipped either job is not release evidence. The release verifier also
fails closed for a stale commit, a job or artifact from another run, a failed
job, a missing artifact, an expired artifact, or artifact bytes whose provider
digest or exact manifest does not match.

If the trusted push run failed for infrastructure reasons, dispatch a new CI
run on the exact `main` commit with both PostgreSQL inputs enabled. Do not
bypass the verifier with a generic green CI run or locally created JSON. No
hosted or GitLab runtime image build, package publication, tag movement,
GitHub Release, or downstream production deploy may start until the verifier
accepts the exact run and both immutable artifacts. The `GitLab Runtime Image`
workflow applies the same gate before GHCR login or image construction for
both automatic `workflow_run` publication and manual dispatch.

## Post-Release Verification

Verify both stable tags:

```bash
git ls-remote --tags https://github.com/777genius/review-router.git refs/tags/v1 refs/tags/v1.0.40
git ls-remote --tags https://github.com/777genius/review-router-ai.git refs/tags/v1 refs/tags/v1.0.40
```

Expected:

- `777genius/review-router@v1` points to the Action `v1.0.x` commit.
- `777genius/review-router-ai@v1` points to the control-plane `v1.0.x` commit.
- both GitHub Releases exist and are not draft/prerelease.
- new setup PRs that use stable mode still generate `@v1` and `runtime_ref: v1`.
- exact pinned mode generates the new `v1.0.x`.

If production Render deploy is part of the batch, deploy after the control plane commit
has passed CI and after the relevant runtime release is validated. Check Render
logs after deploy for startup errors, webhook errors, and action session/config
errors.

## Production Action Ref Sync

General workflows and rotating Codex workflows use separate release contracts:

- `REVIEW_ROUTER_ACTION_REF` may remain
  `777genius/review-router@main` for the general workflow channel.
- `REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF` is mandatory and must be an exact
  `owner/repo@40-character-SHA`.
- `REVIEW_ROUTER_CODEX_ROTATING_ALLOWED_ACTION_REFS` is a bounded,
  same-repository list of old exact SHAs still needed by active namespaces or
  queued/in-progress runs. The primary SHA is trusted automatically.

Rotating T0 rendering, installer URLs, OIDC source verification, and runtime
writeback must never fall back to the mutable general channel. A workflow that
switches to an untrusted ref fails closed before receiving checkout, comment,
or writeback capability.

The general ref sync remains available for non-rotating workflows:

```bash
pnpm ops:sync-action-ref
```

By default, that command:

- writes `777genius/review-router@main`
- updates `REVIEW_ROUTER_ACTION_REF` on `reviewrouter-web`,
  `reviewrouter-api`, and `reviewrouter-worker`
- does not change the rotating primary or rotating overlap list
- triggers Render deploys for the three services

When `--action-ref 777genius/review-router@v1` or an exact tag such as
`@v1.0.40` is provided, the command writes that general hosted ref directly.

Useful variants:

```bash
pnpm ops:sync-action-ref --dry-run
pnpm ops:sync-action-ref --action-ref 777genius/review-router@main
pnpm ops:sync-action-ref --action-ref 777genius/review-router@<40-char-sha>
pnpm ops:sync-action-ref --no-deploy
pnpm ops:sync-action-ref --wait
pnpm ops:sync-action-ref --allowlist-window 3
```

Post-sync production checks:

```bash
curl -fsS https://api.reviewrouter.org/health
curl -fsS -o /dev/null -w '%{http_code}\n' https://reviewrouter.org
pnpm ops:sync-action-ref --dry-run --no-deploy
```

For a rotating A -> B release, use this fail-closed order:

1. Keep primary A and deploy a trusted overlap containing B to every web/API
   instance. Wait for all exact deployments to be live.
2. Change the rotating primary to B for new setup candidates while retaining A
   in the overlap. Update the installer descriptor as one release tuple at the
   same time: `REVIEW_ROUTER_CODEX_ROTATING_INSTALLER_VERSION`,
   `REVIEW_ROUTER_CODEX_ROTATING_INSTALLER_URL`, and
   `REVIEW_ROUTER_CODEX_ROTATING_INSTALLER_SHA256`. The immutable installer URL
   must contain B's exact Action SHA, even when the script digest did not change
   between releases. Deploy web, API, and worker only after every value in the
   tuple has been staged; a partial tuple intentionally blocks setup issuance.
3. Do not rewrite an active A namespace in place. Existing namespaces remain
   pinned to their already-attested Action SHA; migrate them only through a
   fenced drain and fresh setup/namespace activation.
4. Retain A while any repository namespace, queued/in-progress workflow, or
   unexpired mutation lease can reference it. Default-branch fast-forwards do
   not invalidate a queued workflow when its claimed revision remains a
   verified ancestor and its exact workflow attestation still matches.
5. Remove A only after two inventories show zero live references and the
   maximum queue/lease window has elapsed. Never prune by a fixed list length.

The current namespace schema stores one exact active workflow attestation.
Allowlisting A and B does not make an in-place A -> B rewrite safe: overwriting
the attestation strands queued A, while retaining it blocks B. Concurrent
in-place migration requires a future bounded attestation-history schema; until
then, drain and allocate a fresh namespace.

## Public API hostname convergence

When aligning web/API/worker public URLs to `https://api.reviewrouter.org`,
retain `https://api.reviewrouter.site` as a direct alias to the same backend.
Verify the shared reverse-proxy route before the configuration change; do not
replace it with a redirect that could drop authenticated requests. Source
verification accepts only this exact owned HTTPS origin pair; custom/self-hosted
origins retain exact matching. Existing canonical workflow bytes, namespaces,
signing keys, admitted tokens and captured runtime snapshots remain unchanged.
New callers use the canonical `.org` origin.

## Rollback

Rollback options, safest first:

1. Disable the risky feature flag or block the bad exact runtime version.
2. Roll back the control plane app deployment in Render if the deployed app is bad.
3. Publish a fixed `v1.0.x` release and move `v1` forward through the release workflows.
4. Emergency only: move `v1` back to the last known-good exact tag in both repos.

Emergency rollback is the only normal exception to "do not move `v1` manually".
If used, record the incident, the old and new SHAs, and follow up with a fixed
release workflow run. Never rewrite exact `v1.0.x` tags.

### API rollback protocol preflight

Rule: the control plane API may only be rolled back to a build that supports the
contract of the current `workflow-v1` channel **and** every still-active review
run. Before option 2 (or any API replacement) run the preflight from the target
build's exact release checkout or target image:

```bash
node dist/apps/api/src/review-action-v2-operator-cli.js \
  rollback protocol-preflight \
  --channel-manifest /path/to/workflow-v1-manifest.json
```

Inputs:

- **Target build descriptors** come from the build being rolled back to (the CLI
  runs inside that checkout/image and reads its own compiled schema slots) —
  never from the currently deployed production build.
- **Channel manifest** is the Action manifest at the exact SHA `workflow-v1`
  currently points to, read via Git
  (`git show <workflow-v1-sha>:src/control-plane/generated/review-action-v2/manifest.json`).
  The channel entry is resolved to `protocolVersion + schemaDigest +
canonicalizerDigest`.
- **Active runs inventory** comes from the existing operational records:
  active (non-expired) `ReviewRunAuthorization` rows and retained
  (`state=registered`) `ProducerRelease` rows, plus the configured producer
  release attestations env
  (`REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON`).

Outcomes:

| Result                                   | Meaning                                                                                                                                 | Action                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `rollback_protocol_preflight_passed`     | Target supports the whole required set                                                                                                  | Proceed with the rollback                |
| `rollback_protocol_preflight_rejected`   | Target lacks a required contract                                                                                                        | Stop before replacing the API            |
| `rollback_protocol_preflight_not_proven` | Inventory incomplete (missing channel manifest, unreadable attestations, attestation missing/ambiguous or disagreeing with a DB record) | Stop — a safe rollback is **not proven** |

If the inventory is incomplete, a safe rollback is not considered proven; do not
replace the API. On incompatibility or an unproven inventory, practical recovery
paths are: pick a different target build that supports the required set, or ship
a fixed release forward. The scheduled channel-protocol monitor
(`monitor-workflow-channel-protocol.yml`) reports any bypass of this procedure;
it never deploys or rolls back anything by itself.

Schema slots are additive: all compiled contracts stay in place, legacy slot bytes
are never regenerated or edited, and removing or replacing a slot requires a
separate check of all still-active consumers first. This deliberately restricts
the set of allowed rollbacks.

One schema can have multiple published canonicalizers. The approved Action171
contract (`32bb25… / 95a433…`) and the later legacy contract
(`32bb25… / 124087…`) remain distinct frozen contracts. Admission selects the
exact compiled contract through the verified producer Action SHA; schema equality
alone does not identify its canonicalizer. The authorization's internal
`review_action_v2` enum maps explicitly to published protocol version `2`.
Retirement of obsolete registered producers must preserve approved GitHub Secrets
and Hosted Pool pins, even when no run currently uses them.

### Coordinated Action/API emergency rollback

Rolling back the API to a build that does not support the current channel (for
example when the deployed API build is fundamentally bad and no compatible older
build exists) is an emergency procedure, separate from the normal rollback
above:

1. Stop new review runs (block the exact runtime version or disable the feature).
2. Drain in-flight runs to completion (or revoke their authorizations).
3. Roll `workflow-v1` back to a channel whose contract the target API supports,
   and verify the channel SHA after the move.
4. Only then replace the API deployment.

Record the incident, the old and new SHAs for both the channel and the API
deployment. Do not use this procedure to avoid the preflight in normal
rollbacks.

### Workflow channel rollback — 2026-10-15

Public release 177 (`175e3a1f86712373226e767561c3cd0d32066228`) moved
`workflow-v1` before producer adoption. A fresh production read showed registry
revision 18 approved producer 176 and did not approve 177. The release owner
restored only `workflow-v1` to `9428b431a4b6a3bb6dcdd789cde0cd67ed59dacb`
using a comparison against the observed 177 channel SHA and verified the result.
The immutable `v1.0.177` tag and product `v1` were unchanged. Promote the workflow
channel to 177 only after paired private activation and producer registration
revision 19 are verified. This recovery is not evidence of a successful 177 E2E.
The public rollback receipt is retained at
`tmp/shared-summary177/channel-rollback.actual.public.json` in the release owner's
workspace.

Helpful emergency checks:

```bash
git ls-remote --tags https://github.com/777genius/review-router.git refs/tags/v1 refs/tags/v1.0.39
git ls-remote --tags https://github.com/777genius/review-router-ai.git refs/tags/v1 refs/tags/v1.0.39
```

## Database Release Rule

Release order for database-backed changes:

```text
1. merge reviewed Prisma migration
2. run migrate deploy in staging
3. run staging smoke tests
4. deploy compatible app/worker code
5. run production migrate deploy
6. deploy production app/worker code
```

Do not deploy application code that depends on a schema change before
`migrate deploy` has succeeded in that environment.

### Workflow provisioning attempt cutover (000089 workflow guard through 000091)

This batch is a quiesced upgrade. Migration `000090` requires attempt identity
and removes the old `(repositoryId, branch)` writer key. Old provisioning and
installation inventory writers must never overlap the new schema or resume
after this cutover. The preceding
`000089_workflow_provisioning_writer_quiescence` migration fails closed while
a non-administrator runtime principal can connect and mutate either
`WorkflowProvisioning` or `RepositoryConnection`, or while such a session is
still connected. It also rejects direct invocation by the named runtime roles.

Use the existing runtime ACL gate to revoke CONNECT and writes from every
web/API/worker principal (including inherited and column grants). Runtime
credentials must be distinct from the reserved migration principal; services
must never use a superuser or migration credential. Stop and drain every old
web/API/worker process and installation-sync consumer before applying this
batch. The migration checks the database fence and sessions, not feature flags.
An active session must be drained even after CONNECT is revoked.

Keep the ACL gate closed through migrations 000090 and 000091 and deployment
of the exact new web/API/worker binaries. Only the existing release authority
may reopen it after fleet convergence. A partial migration or deployment stays
closed. Old-binary rollback is forbidden after 000090; restore the pre-upgrade
database with the fleet stopped, or fix forward under the closed gate.

The new migration bytes and post-manifest invalidate the previous activation
catalog capture. Its trust root is pending until fresh authenticated captures
and independent review prove the new catalog. Production remains HOLD; old
capture digests must never be relabeled as evidence for the new manifest.

### Provider registry cutover (000145 through 000146)

`000145_workspace_provider_profiles` adds provider profiles and schema 4
selections; `000146_drop_review_configuration_projection` then drops the
schema 1-3 projection columns of `ReviewConfigurationVersion` and the
`ReviewConfigurationVersionProvider` table. Binaries built before 000146 still
name those columns in every review configuration query, so they fail on the new
schema, and the dropped data cannot be recreated by a later migration. This is
a stopped-fleet upgrade, in this order, for every environment (developer
database, hosted beta, self-hosted, any other):

1. Take a `pg_dump` of the database and keep it until the new app is verified.
2. Stop every old web, API and worker process before `migrate deploy`, not just
   before the script. A deploy that migrates while the old fleet still serves
   (a pre-deploy migration hook, a compose `migrate` service started before the
   old `web`/`api`/`worker` containers are stopped) is not allowed here.
3. Run `migrate deploy`, then `pnpm provider-profiles:migrate --dry-run` and,
   after reading its report, `pnpm provider-profiles:migrate`. A schema 3 document the
   script leaves unconverted makes the new app fail closed with
   `resave_required` for that workspace or repository.
4. Start the new web, API and worker code.

Rolling back to an old binary after 000146 is forbidden. Restore the
`pg_dump` with the fleet stopped and start the old binaries against it, or fix
forward.

### Provider-scope concurrency bridge

Migration `000079_remove_account_wide_provider_lane_serialization` installs a
fail-closed database trigger while retaining the old global unique index. The
trigger preserves the old binary's global provider-vote read invariant during
migration-first and rolling application deploys. Applying the migration does
not remove the index or activate scoped concurrency; the post-drain activation
command performs both sides of that cutover under the fleet fence.

Use this order:

1. Apply migration 000079 while the activation control remains closed.
2. Deploy the new API and worker code to every replica.
3. Drain every old replica and old queued process that can acquire a provider
   execution lease.
4. Explicitly activate with
   `pnpm review-provider-scope-concurrency --activate --confirm-old-replicas-drained`.

Run every status, activation, close, and rollback-readiness command with the
restricted migration-operator database credential. API, web, and worker roles
have SELECT-only access to `ReviewProviderScopeConcurrencyControl` and cannot
perform the state transition.

Activation retains only a shared cutover fence; it does not impose an
account-wide lease limit, and inference leases do not use the bridge. For an
old-binary rollback, first run
`pnpm review-provider-scope-concurrency --close-for-rollback --confirm-no-old-replica-started`,
drain active duplicate vote lanes, and then require
`pnpm review-provider-scope-concurrency --verify-rollback-ready` to succeed
before starting any old replica. Starting an old binary before that verification
is forbidden because its global read can reject valid scoped rows.

## Environments

Use separate environments:

```text
local
staging
production
```

Recommended:

- separate GitHub Apps for staging and production
- separate webhook secrets
- separate databases
- separate OAuth app/client secrets if applicable
- staging uses test org/repos only

## Feature Flags

## Review Action v2 Release Order

Deploy the typed 426 bridge first. Then deploy additive migrations and disabled
control plane readers, export the generated contract to a public Action feature branch,
rebuild/commit `dist/index.js`, and register the exact final Action/runtime/schema
digests. For an allowlisted repository: preflight all decisions and credentials,
enter `v1_draining`, wait the release-bound drain window, prove no legacy/static
writer, then activate the new mutation epoch as the final command. Failure after
activation pauses v2 and reconciles effects; it never reopens v1. See
[ADR-028](../decisions/028-revision-aware-review-evidence.md).

### Durable T0 request ingress cutover

Use this order. Do not combine the steps into one blind configuration update:

1. Apply migration `000033_review_request_dispatch_lanes` while all new writers
   remain disabled. Its preflight must find no duplicate/expired active provider
   lane and no duplicate pending/source-run intent identity.
   Then apply `000034_review_request_dispatch_reconciliation`. Its preflight must
   find zero intents in legacy `dispatching`; if any exist, stop and reconcile
   them with the old runtime before retrying the migration. The migration smoke
   gate seeds one legacy `dispatching` intent in a disposable PostgreSQL database,
   requires this preflight failure, and verifies that enum, columns, types,
   indexes, and the fixture row are unchanged after transaction rollback.
2. Deploy the API, worker, and exact public Action commit with intent ingress and
   admission requirement disabled.
3. Install the generated T0 workflow pinned to that full Action SHA. Verify it has
   `workflow_dispatch`, `review_request_id`, `pr_number`, `review_head_sha`, the
   deterministic run name, and exact-head checkout. The interaction workflow may
   remain only when it uses OIDC and is pinned to the same immutable runtime SHA;
   a stale interaction runtime or a legacy review workflow blocks activation.
4. Register the immutable producer release/attestation and verify provider vote
   lane, signing key, GitHub App `actions: write` permission, installation
   approval, and workflow dispatch path.
5. Enable `REVIEW_ROUTER_REVIEW_V2_WORKER_ENABLED=1`, then
   `REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED=1`, and prove the worker handles
   both external and internal ingress event versions.
6. Set `REVIEW_ROUTER_REVIEW_V2_WORKFLOW_DISPATCH_READY=1` only after a disposable
   repository dispatch returns a run ID and exact head.
7. Enable `REVIEW_ROUTER_REVIEW_V2_INTENT_INGRESS_ENABLED=1`. The API must refuse
   startup unless steps 5 and 6 are already true.
8. After persisted intents dispatch and bind to OIDC runs correctly, enable
   `REVIEW_ROUTER_REVIEW_V2_INTENT_ADMISSION_REQUIRED=1` for the cohort.

Dispatch recovery is deliberately asymmetric:

- Persist `reconciling_dispatch` before the single GitHub workflow dispatch POST.
- A returned run ID binds the intent directly; a lost/unknown response is resolved
  only by bounded workflow-run lookup and never by repeating that POST.
- Retry with a new request identity only after a definite no-effect result and
  within `REVIEW_ROUTER_REVIEW_V2_INTENT_MAX_DISPATCH_ATTEMPTS`.
- Terminalize an unresolved dispatch or missing OIDC authorization at its
  persisted deadline, then release the PR lane. `DispatchOutcomeUnknown` and
  `AuthorizationDeadlineExceeded` also persist a cleanup event in that same
  transaction. An immediate cancellation failure cannot remove that obligation.
- Keep the dispatch resolution window shorter than the authorization window. The
  production defaults are 5 minutes and 30 minutes respectively, allowing normal
  hosted-runner queue delay without treating it as an unknown POST outcome.

### Superseded unadmitted Actions cleanup

Superseding a submitted, unadmitted request also writes
`review.requested_dispatch_cleanup@v1` in the same database transaction. The
worker resolves the original request identity, validates the current Actions
attempt and workflow path, requests cancellation, and marks the event processed
only after terminal readback. Admitted providers keep their existing drain
contract. Dispatch deadlines retain their original meaning; an absent lookup
never proves that an in-flight dispatch POST had no effect.

The same obligation covers submitted, unadmitted terminal requests with
`DispatchOutcomeUnknown` or `AuthorizationDeadlineExceeded`. It excludes proven
no-effect recovery, completed-run retries, and requests already linked to an
authorization or execution. Completed cleanup readback does not require the PR
to remain accessible. Replaying a terminal transition produced by this version
does not create a second event.

This change needs no schema or public Action upgrade. Deploy the API and worker
as one coherent batch, with a compatible worker available to consume cleanup.
Workers predating cleanup do not own the event type and leave it pending. The
previous supersession-only consumer knows the type but rejects terminal payloads:
upgrade the consumer before the terminal-event producer, or stop all previous
consumers during the coherent API/worker activation. Keep a compatible consumer
when rolling back the producer until the new terminal events are processed or
explicitly reconciled; do not roll it back onto pending terminal cleanup.
New workers register the event as known even when review processing is disabled.
Retry failures use the existing
bounded outbox backoff (20 attempts); exhaustion retains a dead letter and the
request for operator reconciliation. After confirming the exact request/run,
retry that dead letter through the existing outbox recovery flow. Never treat
an unresolved dead letter as successful cancellation or replay the dispatch POST.
Previously superseded or terminal requests have no new event retroactively;
reconcile those separately using their retained request/run identities.

Rollback before step 8 disables ingress first and drains persisted intents through
the still-enabled worker. After intent-required admission or v2 mutation authority
is active, pause the cohort and reconcile state; never route those runs back to an
unfenced legacy writer. A dead-lettered ingress event requires explicit recovery,
not replay through the same webhook idempotency key.

Critical flags:

```text
REVIEW_ROUTER_DISABLE_ACTION_CONTROL_PLANE
REVIEW_ROUTER_ALLOWED_ACTION_REFS
REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF
REVIEW_ROUTER_CODEX_ROTATING_ALLOWED_ACTION_REFS
REVIEW_ROUTER_DATABASE_RECOVERY_WITNESS
REVIEW_ROUTER_BLOCKED_ACTION_VERSIONS
REVIEW_ROUTER_HOSTED_MAX_CHANGED_LINES
REVIEW_ROUTER_ENABLE_WORKFLOW_PROVISIONING
REVIEW_ROUTER_DISABLE_WORKFLOW_PROVISIONING
REVIEW_ROUTER_ENABLE_DASHBOARD_MUTATIONS
REVIEW_ROUTER_ENABLE_CODEX_ROTATING_OAUTH
REVIEW_ROUTER_CODEX_ROTATING_NEW_WORK_ADMISSION_ENABLED
REVIEW_ROUTER_CODEX_ROTATING_SETUP_ISSUANCE_ENABLED
REVIEW_ROUTER_CODEX_ROTATING_OAUTH_REPOSITORIES
REVIEW_ROUTER_ENABLE_CONFLICT_REVIEW_FALLBACK
REVIEW_ROUTER_REVIEW_V2_WORKER_ENABLED
REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED
REVIEW_ROUTER_REVIEW_V2_WORKFLOW_DISPATCH_READY
REVIEW_ROUTER_REVIEW_V2_INTENT_INGRESS_ENABLED
REVIEW_ROUTER_REVIEW_V2_INTENT_ADMISSION_REQUIRED
REVIEW_ROUTER_REVIEW_V2_INTENT_DISPATCH_RESOLUTION_TIMEOUT_MS
REVIEW_ROUTER_REVIEW_V2_INTENT_AUTHORIZATION_TIMEOUT_MS
REVIEW_ROUTER_REVIEW_V2_INTENT_MAX_DISPATCH_ATTEMPTS
```

Flags must fail closed for security-sensitive features.

Hosted release convergence keeps all three rotating OAuth flags at exact `0`.
Setup issuance and new-work admission enable only on exact `1`. New-work also
requires a nonempty explicit repository cohort; an empty cohort never means
"all" while admission is enabled. Follow the fenced bridge/canary/widening
state machine in
[`08-codex-rotating-serialization-cutover.md`](./08-codex-rotating-serialization-cutover.md).

`REVIEW_ROUTER_BLOCKED_ACTION_VERSIONS` is a comma-separated exact-match
blocklist for known-bad installed Action versions, for example
`v1.0.0,main-bad-sha`. It should be used as an emergency stopgap and followed
by a fixed release or workflow update PR.

`REVIEW_ROUTER_HOSTED_MAX_CHANGED_LINES` is the positive-integer,
server-authoritative ceiling for an admitted review. It defaults to `250000`.
The API verifies exact pull-request facts and persists the admission decision
before issuing an OIDC nonce or provider lease. A repository-level
`REVIEW_ROUTER_MAX_CHANGED_LINES` may be stricter, but it cannot raise or
disable this hosted ceiling.

Action terminal outcomes must be user-readable in the PR and in the Actions
step summary. `skipped`, stale/superseded, partial, and provider-lane-busy
states should explain the human reason, whether a model call was started, and
whether the result is approval evidence. Service markers such as
`reviewrouter:summary:*` may exist only inside hidden HTML comments or protocol
payloads, never as visible PR text.

Token telemetry is metadata-only. Action logs may include provider name,
provider status, prompt token count, completion token count, and total token
count. Logs, comments, checks, health reports, and support diagnostics must not
include prompts, diffs, model responses, Codex auth JSON, refresh tokens, access
tokens, or provider secrets.

For rotating Codex OAuth, do not run `gh secret set
REVIEWROUTER_CODEX_AUTH_JSON` directly. That bypasses the generation contract
and can make queued workflows restore an older secret generation. Use
`scripts/reseed-codex-rotating-auth.sh` so the reseed follows the expected
rotating-auth write path.

`REVIEW_ROUTER_CODEX_ROTATING_ALLOWED_ACTION_REFS` is the comma-separated
full-SHA overlap used only for rotating namespace releases. It never authorizes
a branch/tag and never changes the exact Action SHA pinned in an active
namespace.
