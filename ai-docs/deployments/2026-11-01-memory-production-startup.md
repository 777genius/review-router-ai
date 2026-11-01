# Memory production startup and selected-account inference

- Goal: enable approved memory on Hetzner and provide a reproducible self-hosted
  installation, then route conversational extraction through the same authorized
  Account Gateway selection as repository reviews.
- Host: `prod-hel1-01`, SSH alias `workers-fsn1-01-jump`, machine ID
  `b28fc7b17042414386eb9b114046e50c`.
- Incident application source: `d5f16400e610e6fe9151c23da39868825d332711`.

| Environment | Status        | Actual version                                                                     | Remaining work                                                                                                                               |
| ----------- | ------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| production  | `in_progress` | Shared `e7f2e600acc896448b91ea0a9985c6e766a3c95b`; qualified native backend active | UI save/edit/readback and retrieval passed; actual review-context delivery, physical cleanup and selected-account extraction remain pending. |
| self-hosted | `pending`     | Bootstrap PR #773 merged; Linux startup verified                                   | Self-hosted installation/update and environment acceptance remain pending.                                                                   |

## Confirmed incident

Read-only production inspection on 2026-11-01 found no Hindsight containers or
images and no `REVIEW_ROUTER_MEMORY_*` configuration on web, API or worker.
At that inspection, all three application containers ran the incident source above.
Provider parsing selected `disabled`; the dashboard disabled Add memory. This is missing
infrastructure/configuration, rather than a disabled workspace default.

The self-hosted Compose stack likewise contains only Router PostgreSQL, migration,
web, API and worker services. Blank memory settings do not provision a backend.

## Delivery boundaries

Use the existing [native qualification and cleanup profile](../../deploy/hindsight/README.md)
and [release process](../operations/07-environments-and-release-management.md).
The new [bootstrap](../../deploy/hindsight/BOOTSTRAP.md) uses standalone locked
Docker, a dedicated PG17/pgvector database, fresh provenance before writers,
private ingress and independent cleanup credentials. Do not attach native writers
to a Compose reconciler or reuse Router's database.

Ordinary approved chunk storage uses native `LLM_PROVIDER=none`, observations and
automatic consolidation disabled, and local embedding/reranking models. This
requires no operator's paid inference account. Conversational extraction must
instead preserve the repository's selected Gateway account, model, ownership,
source-current and paid-dispatch fences. A global native user credential cannot
substitute for that authority. The new Gateway `/llm` is a TypeScript SDK entry,
not an OpenAI-compatible native inference endpoint.

## Ordered verification

1. Record the actual qualified derivative and PG17 image identities; run the
   existing native image/API/worker/provenance/Forget qualification.
2. Prove the bootstrap on a disposable Linux deployment with actual local models.
3. Install the same exact native profile privately on production. Keep existing
   source generations and any legacy cleanup obligations intact.
4. Connect web/API/worker coherently through the existing fleet overlay after
   checking exact source compatibility. Preserve old containers for rollback.
5. In disposable authorized scopes, verify save, worker settlement, persisted
   readback, edit, cross-scope denial, review-bundle recall and physical Forget.
6. Qualify the selected-account extraction path with actual Gateway models and
   the existing conversation evaluation and installed-App workflow requirements.
   Deterministic fixtures do not establish model quality or production activation.

## Retry and rollback

Reconcile retained bootstrap state and exact native operation IDs before retrying.
Do not replay an ambiguous inference or native mutation under a new identity.
For an application/configuration failure restore the preserved fleet snapshot;
keep native volumes, provenance and cleanup evidence. Pause new memory use while
retaining provider configuration for authorized cleanup. Never erase partial
state or swap generations to manufacture a successful installation.

## Evidence

Native qualification passed once with 32 checkpoints on the exact derivative
`sha256:4e1778a36f989ab9e9b6fc8612298b5c1207da123dafc2bb0952da723a1fe3b9`
and PG17/pgvector
`sha256:7d0a41464797aeb9862dfdc0bbf1526b82cfd324cdd8036df19e3545f4a9ccb8`.
The separate bootstrap smoke passed actual API/worker/PG17 startup with
`LLM_PROVIDER=none`, chunk save/readback/recall and exact-ID idempotent reapply.
Its inference was deterministic; real-model quality was not claimed.

The exact derivative was transferred to production without a rebuild. The
temporary source-restricted WireGuard transfer rule and one-shot image listener
were removed afterward. Pinned multilingual local models were downloaded into
`/srv/platform/projects/review-router/memory-inputs-20261101/models`.
An isolated actual-local-model lifecycle check passed: English and Russian
save/readback/recall, with first/warm recall at 70/29 ms and 31/31 ms respectively.
The test containers and two test volumes were removed under the shared lock;
models and evidence remain intact.

Production ordinary memory was activated on the **unchanged** application image
`sha256:f1f9cc0ff9b808047f8e994512ba258ec4bfc18d5e746d23f78cec85b3c93edf`.
The fleet overlay added the same private provider settings to web/API/worker,
retaining the old four containers for rollback. The native deployment is
`reviewrouter-memory-prod-v1`, with its shared lock and signing material in
`/srv/platform/projects/review-router/memory-operator-v1`. The source-restricted
UFW ingress rule admits port 8888 only from the existing Router Docker bridge.
Web and API readiness checks returned 200; native API is reachable from the actual web
container. No application schema migration or new application image was applied.

Authenticated production UI save, worker publication and reload/readback passed
in the existing disposable repository. Cross-workspace selection denied access
and did not reveal the test rule. Selected-account conversational learning remains unactivated and requires its
separate source/runtime qualification; ordinary configured memory does not imply
automatic conversation activation.

The separate Gateway source checkpoint passed API TypeScript 7 and 58 affected conversation cases
(9 new PostgreSQL preview checks, 17 policy, 8 inference and 24 finite-path).
The preview suite includes source suppression, suppression/relearn and deletion
during grant preparation. Self-hosted tooling passed strict TypeScript 7,
ESLint and six contract checks; the fleet overlay passed nine checks. Gateway SDK
build and 75 upstream SDK checks passed. These counts describe separate source
boundaries, not production end-to-end completion.

Four active legacy memory rows remain untouched. Their repository is the existing
disposable `777genius/review-router-saas-e2e`; there were zero current-provider
entries, commands or automatic sources before activation. No legacy customer
knowledge was silently imported or deleted.

The real installed-App review on disposable
`777genius/rr-codex-rotating-e2e#134` completed in run `41302865788`, but its
Action logged `memory unavailable` and every invocation used
`memoryBundleHash=none`. No knowledge-bundle receipt was persisted. This is a
failed review-memory E2E, despite successful manual storage. The V4 multi-reviewer
authorizer requires a reviewer ID, while the run-wide memory caller supplied
none; the resulting denial precedes retrieval. A dedicated run-level adapter must
retain every captured reviewer's strict account checks before this can pass.

A separate single real Gateway `/llm` call completed through the selected
repository primary account and model `gpt-6.1-sol`. Its exclusive task identity
was `rr-memory-source-qualification-20261101-selected-user-1`, attempt 1,
execution `6fe84e89-fe1f-4b7b-ac05-996c02723c6e`, with closed cleanup and
109 input/141 output tokens. This proves live selected-account SDK routing only;
it does not qualify conversational extraction or activate its new capability.

This task is not complete. Actual admitted review-context delivery, physical
Forget, final follow-up source CI/delivery and the installed-App selected-account
conversation lifecycle still need evidence.

## Coordinated application fix, 2026-11-01

The shared diagnostics/memory release installed source
`14bead9640d0b4e6c6741aa5645c2a6c160fdd2f`, combining
[diagnostics PR #772](https://github.com/777genius/review-router-ai/pull/772)
and [memory authorization PR #776](https://github.com/777genius/review-router-ai/pull/776).
The exact image is
`sha256:21dc5822d2bee10fd2bc6903d3243aadd7bf05712041292f4d575d089ee983a6`.
Build finished at 2026-11-01 12:50:11 UTC. Root independently read all four running
container revisions/image IDs with restart count0 and API readiness200 after
installation. The protected rollout custody is
`/srv/platform/projects/review-router/releases/fleet-overlay-14bead96-7G4aXMdJ`.
The preceding `6e900` diagnostic rollout and the original `d5f16400` memory-env
activation are historical; neither is the current application baseline.

No migration, ACL, producer, Gateway, MCP or memory-policy change accompanied
this coordinated application replacement. Native memory state remains separate.
One common fresh canary will verify actual review memory; no independent
memory-only swap or duplicate model run is authorized by this record.

The native derivative's signed base is
`sha256:cdfeb26e92ad33d54a8a7e4cfe6e67b55d619f25ea5f5bba0a3281d701a82b36`.
Qualification custody on production is
`/srv/platform/projects/review-router/memory-inputs-20261101/qualification/evidence.json`;
bootstrap custody is
`/srv/platform/projects/review-router/memory-operator-v1/bootstrap-state.json`.
Secret-free retained evidence archives are under the task worktree's
`tmp/native-qualification-20261101/`; their hashes remain recorded by the operator.

## Current shared application and acceptance

The current shared application source is
`e7f2e600acc896448b91ea0a9985c6e766a3c95b`, whose parent is the coordinated
`14bead9640d0b4e6c6741aa5645c2a6c160fdd2f` release above. Its image is
`sha256:7cee23648d3fb708fdf63f99fa0578e8d5726a512b06a5bbc992cdcf4cb6ec8a`.
Cutover was recorded at `2026-11-01T13:38:30Z`; all four roles reported the exact
source, running with zero restarts, worker privileges passed all six checks and
API readiness returned 200. Protected custody:
`/srv/platform/projects/review-router/releases/fleet-overlay-e7f2e600-QWzrdEu2`.
The earlier application revisions are historical, not the current baseline.
See the companion [Gateway diagnostics record](2026-11-01-companion-gateway-refusal-diagnostics.md).

[Shared acceptance run 41318061244](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/41318061244)
passed the MCP/model acceptance with two reviewers. This does not confirm memory
context delivery. Two retrieval receipts included the task's own approved entry.
The first planned invocation logged `memoryBundleHash=9b8708d84ae2`, but its later
actual invocation and the second reviewer's invocation logged `memoryBundleHash=none`.
The silent later-admission refusal and the 30-second snapshot lifetime were
investigated as separate admission/lifetime issues. Retrieval success and a
planned bundle hash cannot establish delivery in an actual reviewer manifest.

The lifetime follow-up is source-only: PR #776 source `3aa0cc338` and checkpoint
`5149761f7` in the integration branch. CI and actual application delivery/acceptance
remain pending; neither source checkpoint changes the deployed `e7f2e600` baseline.
The [authorization record](2026-11-01-memory-review-authorization.md) tracks that gap.

The acceptance fixture was restored to repository ReviewConfiguration
`latestVersion=85` and workspace `latestVersion=21`, with seven MCP connections
disabled and the original singleton reviewer restored. Disposable PR #132 is
closed. These are fixture cleanup results, not completion of physical Forget for
the two task memory entries; retain them until the required memory acceptance and
authorized signed cleanup finish.

## Storage incident and recovery boundary

About 13 GiB of free root-filesystem space was insufficient for the application
build. The resulting ENOSPC affected the main application PostgreSQL and Gateway
PostgreSQL. The observed incident window was `13:45:21`–`13:45:49 UTC` on Nov 1.
The earlier `13:07 UTC` historical failure has an **unknown cause**; do not assign
this later ENOSPC diagnosis to that event.

Recovery used ordinary starts of the same existing PostgreSQL clusters. No
cluster reset or version upgrade was performed. The `rrdeploy` identity performed
zero starts. Gateway PID `2098517` has `NRestarts=0` since `14:38:55 UTC`, and API
readiness returned 200 after recovery. Preserve the existing clusters and recovery
evidence when assessing further build capacity or retries.

[Gateway PR #95](https://github.com/agent-teams-ai/account-gateway/pull/95) merged at
`a717bfe50e46d01092eb380582c83d82c261b58c`, but it is **not installed**. The installed Gateway source tree remains
`admission-diag-3a838c8-3f163627-20261029`; its full source commit is not reconciled.
The actual `serve` artifact SHA256 is
`f42b85e420ef1a8f1b661dd93f12b56d6cc4cf31105c5cb3159adb0fd86f552e`.
This is an executable digest, not a source or unit-fragment digest. The shared
application rollout and database recovery do not deliver the optional Gateway update.

Bootstrap [PR #773](https://github.com/777genius/review-router-ai/pull/773) merged at
`1d09ef2a3a770fc93c329ad57dd57efaab1efb22` after required and native CI passed,
preserving the `555ddc759` cleanup-repair ancestry. This is source delivery.
Self-hosted environment installation/acceptance and automatic conversational
learning qualification remain pending.
