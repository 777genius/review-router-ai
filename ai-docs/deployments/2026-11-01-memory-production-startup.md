# Memory production startup and selected-account inference

- Goal: enable approved memory on Hetzner and provide a reproducible self-hosted
  installation, then route conversational extraction through the same authorized
  Account Gateway selection as repository reviews.
- Host: `prod-hel1-01`, SSH alias `workers-fsn1-01-jump`, machine ID
  `b28fc7b17042414386eb9b114046e50c`.
- Existing production source: `d5f16400e610e6fe9151c23da39868825d332711`.

| Environment | Status        | Actual version                                  | Remaining work                                                                                                                                |
| ----------- | ------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| production  | `in_progress` | Existing source above; no native memory backend | Qualify/install native backend, connect fleet, exercise real authorized lifecycle and recall. Qualify selected-account extraction separately. |
| self-hosted | `pending`     | New bootstrap under local verification          | Linux installation and real-model lifecycle verification.                                                                                     |

## Confirmed incident

Read-only production inspection on 2026-11-01 found no Hindsight containers or
images and no `REVIEW_ROUTER_MEMORY_*` configuration on web, API or worker.
All three application containers run the existing source above. Provider parsing
therefore selects `disabled`; the dashboard disables Add memory. This is missing
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
models and evidence remain intact. No existing application container or canonical
runtime configuration has changed yet.

The separate Gateway source checkpoint passed API TypeScript 7 and 58 affected conversation cases
(9 new PostgreSQL preview checks, 17 policy, 8 inference and 24 finite-path).
The preview suite includes source suppression, suppression/relearn and deletion
during grant preparation. Self-hosted tooling passed strict TypeScript 7,
ESLint and six contract checks; the fleet overlay passed nine checks. Gateway SDK
build and 75 upstream SDK checks passed. These counts describe separate source
boundaries, not production end-to-end completion.

Four active legacy memory rows remain untouched. Their repository is the existing
disposable `777genius/review-router-saas-e2e`; there are zero current-provider
entries, commands or automatic sources before activation. No legacy customer
knowledge was silently imported or deleted.

This task is not marked deployed. Source CI, coherent activation, actual model
and authenticated UI/App lifecycle checks still need evidence.
