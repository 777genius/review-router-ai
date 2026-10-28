# Runbooks

## Review v2 Worker Recovery

Keep due and recovery schedulers disabled until the repository reaches the
approved rollout phase. Monitor the release-bound completion-process SLOs. A due
worker claims by ID/owner/`bigint` term; stale acknowledgement is ignored.
Recovery uses bounded keyset full passes over finalized artifacts and is
independent of outbox dead letters. `terminal_unknown` blocks snapshot advancement
until reconciliation or audited manual terminalization.
These runbooks are written for local/private beta. They must stay
metadata-only: do not paste provider secrets, raw webhook payloads, repository
code, pull request diffs, prompts, or model responses into tickets or logs.

## Private PostgreSQL 17 generation cutover

Use [the private-network PostgreSQL 17 cutover runbook](./14-private-network-postgresql-17-cutover.md)
for the side-by-side PG16 to PG17 copy, private JIT runner, ACL admission gate,
activation receipt, evidence, rehearsal, and rollback boundary. Release tags
and git flow remain governed by
[07-environments-and-release-management.md](./07-environments-and-release-management.md).

## App-First Repository E2E

Run this gate before every control plane organization rollout and after changes to the
GitHub App, workflow provisioning, rotating provider setup, Action runtime, or
control-plane Action ref. Use only a clearly disposable repository.

Before opening the review fixture PR, enroll that disposable repository with
the current App-first cohort and mutation-admission controls. Never bypass the
T0 authority gate by reverting the workflow to an earlier rotating schema.

```bash
REVIEW_ROUTER_RUN_SUBSCRIPTION_RUNTIME_LIVE_E2E=1 \
REVIEW_ROUTER_CODEX_ROTATING_E2E_OWNER=OWNER \
REVIEW_ROUTER_CODEX_ROTATING_E2E_REPO_NAME=rr-codex-rotating-e2e \
REVIEW_ROUTER_CODEX_ROTATING_E2E_ACTION_REF=OWNER/review-router@FULL_40_CHAR_SHA \
pnpm subscription-runtime:live-e2e
```

Create the disposable repository before either preflight or execution, then set
`REVIEW_ROUTER_CODEX_ROTATING_E2E_DISPOSABLE_REPOSITORY_ID` to the immutable
numeric ID returned by `gh api repos/OWNER/REPO --jq .id`. The read-only
`--check-only` preflight and live harness both resolve that same REST numeric ID
and reject a missing repository, a mismatch, or deletion and recreation under
the same name. A GraphQL node ID is not this identifier.

The production gate is complete only when all of these are proven:

1. the production GitHub App creates the setup PR
2. `.github/workflows/reviewrouter-codex.yml` is client-triggered T0 schema v4,
   calls the immutable `reviewrouter-t0-reusable.yml`, uses the
   repository-scoped `provider_instance_id`, OIDC `id-token: write`, and
   the exact active
   `REVIEWROUTER_CODEX_AUTH_JSON_R<repository-id>_P<provider-hash>_E<epoch>_<entropy>`
   versioned namespace
3. `.github/workflows/reviewrouter.yml`, `pull_request_target`, rotating schema
   v1/direct mode, direct `CODEX_AUTH_JSON`, and review publication through
   `github.token` are absent
4. two real pull requests complete rotating writeback without leaking auth or
   producing artifacts
5. every ReviewRouter advisory and inline finding has the exact author
   `${GITHUB_APP_SLUG}[bot]`; `github-actions[bot]` fails the gate
6. the actual check-run context is recorded before required checks are changed

Do not use `spike:github:fresh-repo:e2e` as control plane rollout evidence. It exercises
the historical direct workflow and cannot prove App-first publication identity.

If setup fails, verify App installation selection and accepted permissions,
then rerun repository sync. If review fails, inspect the safe Action summary,
the exact control-plane/Action ref match, provider generation, and App comment
token issuance. Never repair rotating OAuth by copying `CODEX_AUTH_JSON` or by
pinning a legacy Action release.

Delete a one-off disposable repository after the rollout batch. Reusable named
canaries may be retained only when their purpose and owner are recorded.

## GitHub Webhook Failing

Check:

1. webhook secret matches GitHub App settings
2. delivery exists in `GitHubWebhookDelivery`
3. signature verification error logs
4. event type supported
5. job enqueue result

## Setup PR Not Created

Check:

1. repo selected and installation active
2. GitHub App has contents/pull_requests permissions
3. default branch exists
4. existing setup PR already open
5. repo-level provisioning lock not stuck
6. `WorkflowProvisioning.errorSummary`

## Repo Missing From Dashboard

Check:

1. installation has access to repo
2. installation sync job ran
3. GitHub API rate limit
4. repository archived/deleted/renamed
5. workspace mapping correct

## Provider Setup Confusing

Check:

1. provider type selected in config
2. setup source shown correctly
3. docs link shown
4. workflow references expected secret names
5. fork PR warning shown for public repos

## Wrong Codex Setup PR Generated

Use this when a setup PR for a Codex repository creates
`.github/workflows/reviewrouter.yml` or references `CODEX_AUTH_JSON`.

Production Codex must always use the rotating workflow:

1. `.github/workflows/reviewrouter-codex.yml`
2. client-triggered T0 `workflow_schema_version: 4`
3. `CODEX_AUTH_JSON` sourced from the exact active versioned namespace named in
   the workflow, never the deprecated stable `REVIEWROUTER_CODEX_AUTH_JSON`
4. the configured `REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF` pinned to an exact
   40-character commit SHA

Do not merge a Codex setup PR that uses `REVIEW_AUTH_MODE=codex-oauth`,
`CODEX_AUTH_JSON`, `OPENAI_API_KEY`, `reviewrouter-reusable.yml`, or
`.github/workflows/reviewrouter.yml`. That is the legacy path and must be
regenerated after reconnecting the repository with Codex OAuth rotating.

Expected recovery:

1. close the bad setup PR or replace its branch with the rotating workflow
2. confirm repository config uses provider auth mode
   `codex_subscription_oauth_rotating`
3. rerun setup from the dashboard
4. run the local/prod smoke against the affected repo

Do not repair rotating Codex with a direct `gh secret set`. Use the generated
setup command or `scripts/reseed-codex-rotating-auth.sh`; only the fenced setup
flow may allocate, write, attest, and activate a never-reused versioned
namespace. A direct stable or versioned secret write is not activation proof.

### Recover a fetched setup with an unknown confirmation result

A setup manifest that reached `fetched` has a bounded 24-hour response-recovery
window independent of its short issue/fetch TTL. Issued-never-fetched manifests
still expire on the short TTL. Before dispatch authorization, the installer
atomically stages the exact compact payload and a 0600 repo-scoped journal,
fsyncs both files and their directory, and ReviewRouter transactionally admits
only safe payload metadata. Stable account identity is derived from provider
issuer, subject, and account id; the payload generation hash remains separate.
ReviewRouter never receives plaintext auth.

Successful prepare returns a server-generated `codex_claim_<UUIDv4>` claim id.
That value is the continuation bearer capability for dispatch, outcome, and
status: UUID v4 contributes 122 unpredictable bits after its fixed version and
variant bits. It is not derivable from the public repository id, provider id,
workflow namespace, or setup nonce. The durable claim binds it to the exact
repository, provider, manifest, recovery epoch, database witness, and current
provider mutation fence; those bindings are rechecked before every mutation.
Keep the claim id only in the installer’s 0600 journal. Never put it in a URL,
shell trace, command argument, support bundle, access log, or telemetry field,
and do not configure request-body logging for these endpoints. Status recovery
is `POST /api/codex-rotating/setup-status` with `{ "claimId": "..." }` in the
JSON body. Public repository/provider/setup-nonce metadata cannot continue a
claim. Treat any suspected claim-id disclosure as an abandoned setup and use
the acknowledged forced-recovery flow to retire its generation.

A repository operator with write, maintain, or admin access must reopen the
Codex provider setup in the dashboard, stop every prior installer and runtime
writer, read the warning, check the explicit acknowledgement, and choose
**Recover and issue forced reseed**. The equivalent authenticated CLI API is
`POST /api/codex-rotating/cli/setup-recovery` with the repository, a stable
operator-generated `recoveryRequestId`, and the exact acknowledgement
`all_prior_installers_and_writers_are_stopped`. A dropped fetch or prepare is
replayed without a PUT. Every dispatch attempt receives a never-reused
`REVIEWROUTER_CODEX_AUTH_JSON_R<repository-id>_P<provider-hash>_E<epoch>_<entropy>` name and issues at most one
GitHub PUT. A lost/unknown PUT response or crash after the durable dispatch
marker permanently retires that name and allocates another. A definite PUT
success followed by a lost confirmation is repaired only with status or the
same idempotent confirmation. Missing or tampered staged state after possible
dispatch fails closed; a fresh recovery epoch tombstones the old authorization
before allocating another namespace. Deletion never makes a name reusable.
Never infer an external PUT outcome from a timeout, elapsed grace period, or
absent response. A different request ID conflicts while recovery is active.
Activation occurs only after repository numeric identity, trusted default-branch
workflow commit, blob, byte digest, semantic digest, exact workflow path,
namespace id/name, and namespace epoch are attested.
Old queued namespace epochs fail preflight. The recovery ledger stores only
safe identifiers and metadata, never plaintext.

Dashboard forced recovery always requires a fresh live GitHub
repository-manager permission check, including for workspace admins; workspace
role alone never proves repository ownership. This admission check is
read-only with respect to the durable permission cache and completes before
the database recovery witness is admitted.

Token refreshes that change `iat`, `exp`, `jti`, access tokens, or refresh
tokens do not change account identity. If issuer, subject, or ChatGPT account
id changes, ordinary recovery fails closed with
`codex_rotating_account_switch_epoch_required`. An operator must explicitly
request an account-switch epoch through the CLI API with `accountSwitch: true`
and acknowledgement
`all_prior_installers_and_writers_are_stopped_and_account_switch_is_intended`.
That authority is bound to the resulting recovery request, mutation epoch, and
manifest; it is not inferred from a normal forced reseed.

After a database restore or writer promotion, the same forced-reseed endpoint
is also the only admitted W1-to-W2 witness transition. Automatic runtime and
ordinary setup remain blocked on W1 evidence after processes restart with W2.
The acknowledged recovery tombstones every live W1 namespace and unresolved
attempt under the provider fence without changing historical fingerprints;
the next setup allocates a fresh namespace carrying W2. Runtime is not restored
until that W2 namespace is definitely activated. Any partial/mixed retirement
returns a safe conflict and allocates no namespace; never use direct SQL to
rewrite fingerprints or bindings.

Do not use setup recovery for `codex_rotating_identity_quarantined`. Authorized
operators can inspect safe quarantine details through
`GET /api/dashboard/codex-rotating/setup-recovery?workspaceId=...&repositoryId=...`.
Repair the repository/provider binding through the identity migration operator
lane; recovery deliberately cannot rewrite the provider's immutable workspace,
repository, canonical provider ID, auth mode, or secret name.

If a live smoke fails with a provider usage-limit or capacity error, do not
rewrite the GitHub secret manually. Reseed through the generated command using a
known non-limited Codex session, then rerun the smoke. Quota-limited sessions
are an account-capacity condition and should not be diagnosed as an OAuth
generation-contract failure.

If a rotating run instead reports `refresh token was already used`:

1. Run the repository helper without `--reuse-current-auth` and complete its
   fresh browser or device login:

   ```bash
   bash scripts/reseed-codex-rotating-auth.sh --repo OWNER/REPOSITORY
   ```

2. Verify that the rotating secret metadata has a new update time without
   reading or printing its value:

   ```bash
   gh secret list --repo OWNER/REPOSITORY --json name,updatedAt \
     --jq '.[] | select(.name == "REVIEWROUTER_CODEX_AUTH_JSON")'
   ```

3. Treat an already running or completed attempt as immutable. If its pull
   request still has the same head SHA, retry only its failed jobs explicitly:

   ```bash
   gh run rerun RUN_ID --repo OWNER/REPOSITORY --failed
   ```

   If the head moved, rely on the new pull request event instead. Do not rerun
   stale work against a different revision.

4. Check the workflow's pinned ReviewRouter Action SHA separately. Reseeding
   changes rotating auth, not the workflow runtime version.

### Activate a merged rotating workflow

Reseeding confirms a secret candidate, but it does not attest workflow bytes
that have not yet landed on the repository's default branch. After a setup or
reseed changes the namespace metadata in the workflow, merge that workflow to
the default branch and activate the confirmed namespace before rerunning a pull
request review:

```bash
set -euo pipefail
github_token="$(gh auth token)"
curl --fail-with-body --silent --show-error \
  --request POST \
  --header "Authorization: Bearer $github_token" \
  --header 'Content-Type: application/json' \
  --data '{"repository":"OWNER/REPOSITORY"}' \
  https://reviewrouter.org/api/codex-rotating/cli/workflow-activate
unset github_token
```

The endpoint authorizes the caller against the target repository, reads the
exact workflow from the current default-branch head through the GitHub App, and
atomically binds its source attestation to the confirmed namespace. A successful
response is `activated` or `already_active` and includes the namespace epoch and
default-branch commit SHA. It never reads or rewrites the Codex auth payload.

Do not activate from a pull request branch, and do not rerun a historical
workflow revision after activation. Historical runs remain bound to their
original `workflow_sha` and may correctly fail with `workflow_schema_mismatch`.
Trigger a new pull request event so the run uses the attested default-branch
workflow. A fresh run that reports `action_repository_mismatch` after reseed is
usually missing this activation step; it is not a reason to write the rotating
secret directly.

## Codex Rotating Action Ref Mismatch

Use this when a GitHub Actions run fails with `action_repository_mismatch`,
`codex_rotating_workflow_action_ref_mismatch`, or a safe error that says the
workflow/action repository does not match the selected repository.

Why it happens:

1. Codex OAuth rotating workflows must match the exact
   `REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF`; they never inherit the general
   `REVIEW_ROUTER_ACTION_REF=@main` channel.
2. The control plane API validates the workflow source at GitHub's `workflow_sha` before
   issuing checkout, comment, or secret writeback tokens.
3. The workflow file and Render config can diverge if a rollback or smoke ref is
   applied only on one side.
4. The correct behavior is fail closed. Fix the configured action ref instead
   of bypassing owner, provider, or schema checks.

Normal recovery is a phased exact-SHA configuration change, not a mutable ref
sync. First expand `REVIEW_ROUTER_CODEX_ROTATING_ALLOWED_ACTION_REFS` to trust
both old A and new B on every web/API instance and wait for all deploys. Only
then set `REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF` to B for new setup
candidates. Keep active namespaces pinned to A until their queued/in-progress
runs and mutation leases drain; migrate them through a fresh fenced setup.

Post-sync verification:

```bash
curl -fsS https://api.reviewrouter.org/health
curl -fsS -o /dev/null -w '%{http_code}\n' https://reviewrouter.org
pnpm ops:sync-action-ref --dry-run --no-deploy
```

The final general-ref dry-run does not prove rotating convergence. Inspect the
rotating primary and overlap on every writer without printing unrelated secret
values.

Rollback:

1. If B is bad, retain both A and B in rotating trust and restore A as the
   rotating primary for new candidates.
2. Do not rewrite existing namespace attestations as a rollback shortcut.
3. Remove B or A only after repeated inventory proves no active namespace,
   queued/in-progress workflow, or unexpired lease still references it.

Do not store provider auth JSON, API keys, PR diffs, prompts, or model output in
Render env while debugging. Never print
`REVIEW_ROUTER_DATABASE_RECOVERY_WITNESS`; compare only its fingerprint through
the supported readiness/recovery flow.

## Rotate GitHub App Private Key

Steps:

1. create new private key in GitHub App settings
2. update deployment secret
3. deploy/restart API/worker
4. verify installation token minting
5. revoke old private key
6. record audit/ops event

## Outbox Dead Letter Or Stuck Processing

Check:

1. dashboard `Operational queue` section for the workspace
2. `OutboxEvent.status`, `lastErrorCode`, and `safeLastErrorSummary`
3. worker logs for redacted safe error summaries
4. GitHub App permissions or external state if the error is permission-related
5. whether the worker is running with at least one registered handler

Recovery:

1. fix the underlying cause first
2. for `dead_letter`, click `Retry` in dashboard or call the maintenance use case
3. for stale `processing`, let worker recovery requeue it after `REVIEW_ROUTER_OUTBOX_PROCESSING_STALE_MS`
4. run the worker and verify the event reaches `processed`
5. check audit for `outbox.retry_requested` when manual retry was used

Do not manually edit payload JSON in production. If payload migration is needed,
ship an explicit versioned migration or a new handler version.

## Memory Provider Operational Checks

Use this after changing memory authority, provider delivery, review admission,
dashboard actions, export, retention or cleanup. Follow
[ADR-031](../decisions/031-complete-memory-provider.md) and the
[accepted replacement plan](../plans/2026-10-23-hindsight-memory-replacement.md).
The former Prisma content/search engine and its standalone flow spike have been
removed. V1 Action memory routes return `410 memory_protocol_retired`; their
historical smoke is not a qualification path for the replacement.

### Current verification map

| Layer                                      | Existing entrypoint                                                                                                                                                                                                                                                                                           | What it proves and its limit                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Policy, source authority and API contracts | `packages/features/memory/src/tests/`, `packages/features/memory/src/infrastructure/prisma/prisma-memory-knowledge-access.test.ts`, `apps/api/src/review-memory-runtime.test.ts`, `apps/api/src/action-memory-v2-routes.independent.test.ts`, `apps/api/src/action-memory-command-replay.independent.test.ts` | Approved source boundaries, stable actor/scope checks, command replay, bodyless receipts and disabled behavior. Contract fixtures do not prove a deployed provider or live GitHub permissions.                                                                                   |
| Application PostgreSQL authority           | `.github/workflows/memory-projections.yml`: Memory authority and delivery PostgreSQL contracts                                                                                                                                                                                                                | Real durable admission, command recovery, ordered delivery, maintenance transport drain, receipt verification, and transactional review lease admission/races. This job requires all four PostgreSQL suites with zero skipped tests. Provider effects are declared fixtures.     |
| Native Hindsight lifecycle                 | `.github/workflows/hindsight-memory-qualification.yml`; [native operator guide](../../deploy/hindsight/README.md)                                                                                                                                                                                             | Exact source/SDK and hardened image, real API, two workers and PG17; native retry identity, failure/privacy sinks and physical cleanup before/after restart. Inference is deterministic and Router maintenance attestation is synthetic.                                         |
| Paired Action / HTTP / PostgreSQL          | `.github/workflows/ci.yml`: Source and Certification Checks, Paired Review Action memory HTTP and PostgreSQL proof; [paired guide](../../scripts/memory-e2e/README.md)                                                                                                                                        | Actual immutable Action source, memory capture/Codex prepare, TCP HTTP, Prisma lease admission, lost ACK identity, uncharged stale-input rejection and memory-free retry/evidence commit. Provider and inference are deterministic; the test driver invokes fallback explicitly. |
| Rendered management UI                     | `.github/workflows/memory-projections.yml`: Memory rendered UI desktop narrow and keyboard; `scripts/memory-ui-e2e/browser-qualify.ts`                                                                                                                                                                        | Actual rendered desktop/narrow/keyboard interactions using synthetic HTTP fixtures. Screen/cache tests cover admitted-forget redaction and late-read cancellation; browser fixtures do not establish authorization, persistence or native deletion.                              |

For fast source/contract checks, use existing files rather than a retired spike:

```bash
pnpm exec vitest run \
  packages/features/memory/src/tests/memory-knowledge.test.ts \
  packages/features/memory/src/tests/memory-policy-config.test.ts \
  packages/features/memory/src/infrastructure/prisma/prisma-memory-knowledge-access.test.ts \
  apps/api/src/review-memory-runtime.test.ts \
  apps/api/src/action-memory-v2-routes.independent.test.ts \
  apps/api/src/action-memory-command-replay.independent.test.ts
pnpm architecture:check
```

The PostgreSQL and paired suites are opt-in. A passing run with skipped database
tests is not evidence: use the workflows' required environment, disposable
database preparation and zero-skip assertions. The authority job uses its own
historical-catalog fixture path; the paired proof requires a separate database
with the full current catalog. Its harness truncates review data. See the paired
guide before running it locally; never point these suites at shared or production
data.

Record the candidate SHA, paired Action SHA, immutable native image inputs and
completed evidence artifacts. The current security map is
[Memory provider security verification](../security/balanced-memory-beta-security-matrix.md).
Passing one layer does not satisfy the others. Production activation separately
requires the plan's selected-model/egress/corpus qualification, capacity and
restore/deletion-fence evidence, live T0/source-authority proof, and explicit
legacy-data/cleanup-debt disposition. Unit tests, deterministic inference and the
historical smoke below do not establish those gates.

### Emergency disable and recovery

1. Set `REVIEW_ROUTER_MEMORY_ENABLED=0` on every API, worker and web writer/reader,
   then restart those processes. This flag takes precedence over
   `REVIEW_ROUTER_DISABLE_MEMORY`; do not leave a conflicting explicit enable.
2. Verify new review bundles are memory-free, new memory writes are disabled,
   and ordinary reviews continue. Keep the current provider configuration,
   generation and credentials available for authorized management/export and
   revocation/forget coordination; changing the provider to `disabled` is a
   different operation and removes provider body access.
3. Inspect command IDs, revisions, safe states and counts. Preserve
   `unknown`/`cleanup_pending` operations and their deletion obligations;
   timeouts, cancelled native requests and expired delivery envelopes do not
   establish non-execution or completed cleanup.
4. Re-enable only after the relevant candidate checks above, the accepted
   cutover gates and an authorized production smoke have been reviewed. Do not
   restore the retired V1 protocol or custom engine as a fallback.

If memory bundle requests fail, reviews continue without memory. Check current
review authorization, workspace/repository source access, policy, maintenance
pause, generation and provider readiness. There is no Prisma text/search fallback.
Use safe command status and worker diagnostics; never paste memory bodies,
source comments, code, diffs, prompts, model output or credentials into tickets.

If an authorized export is incomplete or too large, preserve its omission/error
result and the existing bounds. Current text comes from the provider and is
rechecked against current authority; delivery envelopes are not an export source.
Retained settled inactive entries may be exported, while forgotten or unsettled
bodies remain fenced. A larger export needs a separately approved bounded
delivery path rather than an increased synchronous response limit.

### Deletion requests

1. Submit an authorized Forget through the current management/command path.
   Durable admission immediately fences new reviews and body-bearing
   management/export reads; distinguish a confirmed command from an unconfirmed
   transport failure.
2. Track the same command ID and scope. An admitted Forget remains
   `cleanup_pending` until exact physical-cleanup proof is verified. Dashboard
   redaction and exclusion from new reviews are not physical deletion receipts.
3. Follow [the native operator guide](../../deploy/hindsight/README.md) and the
   current Router maintenance/operator routes: pause and drain admitted
   transports, stop every native executor and verify database sessions closed,
   inventory and clean source/history/operation payloads, restart, verify absence,
   and settle the signed proof against the current generation and pause epoch.
4. Preserve unresolved older writes and remote cleanup debt. Automatic expiry
   revokes eligibility; generic terminal-row pruning cannot establish physical
   forget or silently discard these obligations.

### Historical legacy smoke evidence — 2026-05-16

The previous custom-engine release recorded a successful live GitHub smoke in
the existing disposable repository. These records preserve that release's
history; they do not qualify ADR-031 or authorize running its removed commands.

- Disposable repo PR: <https://github.com/777genius/review-router-saas-e2e/pull/4>
- Marker: `rr-memory-smoke-1778965736933`
- Direct save run: <https://github.com/777genius/review-router-saas-e2e/actions/runs/25973002113>
- Natural-language suggestion run: <https://github.com/777genius/review-router-saas-e2e/actions/runs/25973014137>
- Suggestion confirmation run: <https://github.com/777genius/review-router-saas-e2e/actions/runs/25973027526>
- Forget/delete run: <https://github.com/777genius/review-router-saas-e2e/actions/runs/25973034902>

Any new live SCM smoke must use the current protocol in an existing disposable
repository and keep mutations/PR comments explicitly authorized. Historical
successful runs do not prove current deployment state.
