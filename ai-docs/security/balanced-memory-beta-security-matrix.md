# Memory Provider Security Verification

Updated: 2026-10-26.

This is the current verification map for
[ADR-031](../decisions/031-complete-memory-provider.md), which replaces the
Prisma-canonical content/search engine with a complete provider. Hindsight owns
current approved text and native processing; Router retains authority,
revisions, approval/revocation, ordered durable commands and bounded temporary
delivery envelopes. There is no writable Prisma content fallback.

The map names required checks; it is not a statement that the current candidate
or production activation has passed them. The
[accepted replacement plan](../plans/2026-10-23-hindsight-memory-replacement.md)
defines the remaining release and cutover gates. Keep exact candidate/Action/image
pins and completed artifacts with any qualification decision.

## Current Risk and Evidence Map

| Risk                                              | Required control                                                                                                                                                                                                                                              | Existing proof entrypoints                                                                                                                                                                                                                                  | Boundary                                                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection / raw source ingress             | Only approved distilled statements and permitted candidates enter memory; fixed server-owned retrieval text excludes client PR text. Memory cannot change source authority.                                                                                   | `packages/features/memory/src/tests/memory-knowledge.test.ts`; `apps/api/src/review-memory-runtime.test.ts`; `apps/api/src/action-memory-v2-routes.independent.test.ts`                                                                                     | Source/contract checks; they do not establish selected-model resistance or semantic quality.                                                                                                                |
| Excessive model agency / poisoning                | Model output cannot grant approval or management authority. Mutations bind stable actor/source identity, full command digest, expected revision and current scope policy.                                                                                     | `packages/features/memory/src/infrastructure/prisma/prisma-memory-knowledge-access.test.ts`; `apps/api/src/action-memory-v2-routes.independent.test.ts`; `apps/api/src/action-memory-command-replay.independent.test.ts`                                    | Permission/source peers in these tests are fixtures. Current live GitHub role/source behavior still needs the plan's disposable T0 proof.                                                                   |
| Cross-scope disclosure / unsafe native candidates | Server-selected scopes, current source checks and linked-evidence validation gate provider results and review receipts.                                                                                                                                       | `packages/features/memory/src/tests/memory-knowledge.test.ts`; `apps/api/src/review-memory-runtime.test.ts`; `apps/api/src/review-memory-admission.pg.test.ts`; native provider contracts                                                                   | Scope identifiers and native storage separation are checked independently. Native vector search is not authorization authority.                                                                             |
| Stale input / duplicate inference charge          | The transaction granting a new inference lease checks the exact bodyless receipt and current fences before consuming budget. Lost ACK retries restore the original identity; stale input retries use the same remaining ordinal without a new memory capture. | `apps/api/src/review-memory-admission.pg.test.ts`; `packages/features/review-executions/src/tests/prisma-review-execution-store-real.test.ts`; `scripts/memory-e2e/paired-action-memory.pg.test.ts`                                                         | Real PostgreSQL and paired TCP/Action proof; provider/inference are deterministic. The paired test driver invokes fallback explicitly; Action runner regressions cover its automatic loop.                  |
| Unknown or reordered provider writes              | Persist intent atomically, bind immutable approved delivery input and stable native UUID, serialize unresolved entry writes, keep urgent revocation fences, preserve unknown outcomes and cleanup debt.                                                       | `packages/features/memory/src/tests/memory-knowledge.pg.test.ts`; `apps/worker/src/memory-knowledge-worker.pg.test.ts`; `scripts/hindsight-e2e/provider-contract.test.ts`; native lifecycle workflow                                                        | Application PG tests use declared provider effects. Real native retry/failure behavior requires the separate Docker lifecycle artifact.                                                                     |
| Incomplete physical forget                        | Admission fences body-bearing reads immediately; completion requires scoped signed evidence of executor/session drain, complete source/history/payload cleanup and absence after restart.                                                                     | `packages/features/memory/src/tests/memory-knowledge.pg.test.ts`; `apps/api/src/memory-operator-routes.test.ts`; `scripts/hindsight-e2e/cleanup-receipt.test.ts`; `scripts/hindsight-e2e/operator-safety.test.ts`; native cleanup story                     | The native workflow's Router maintenance attestation is synthetic. Its real application transport barrier is proved by the PG suite. Neither UI redaction nor a cancelled request proves physical deletion. |
| Audit / diagnostics / credentials leak            | Router authority and ordinary diagnostics remain bodyless. Native logs, traces, audit/error sinks and database logging use the reviewed private profile. Delivery input is bounded and purged after qualified settlement.                                     | `apps/worker/src/memory-knowledge-worker.pg.test.ts`; `apps/api/src/review-memory-runtime.test.ts`; `scripts/hindsight-e2e/qualification.test.ts`; native lifecycle workflow                                                                                | Deterministic poison/echo failures test private sinks. Final deployed image/config and actual model egress need independent qualification.                                                                  |
| Kill switch / unavailable provider                | Service/workspace disable prevents new knowledge use and writes; ordinary review continues without memory. Authorized retained management/export and revocation/cleanup remain explicit operations.                                                           | `packages/features/memory/src/tests/memory-policy-config.test.ts`; `packages/features/memory/src/tests/memory-knowledge.test.ts`; `apps/api/src/review-memory-runtime.test.ts`; `packages/features/memory/src/composition/memory-knowledge-runtime.test.ts` | Disabling use differs from replacing provider composition with `disabled`. Operator guidance must preserve access needed to satisfy cleanup obligations.                                                    |
| Export privacy                                    | Read current provider text only after current authorization/revision checks; fence forgotten/unsettled bodies and report omissions/bounds. Delivery envelopes cannot supply current content.                                                                  | `packages/features/memory/src/tests/memory-knowledge.test.ts`; `apps/web/src/features/memory/adapters/memory-dashboard-controller.test.ts`                                                                                                                  | Authorized settled retained inactive text can be exported. This differs from the removed custom-engine export/prune semantics.                                                                              |
| UI stale-body restoration / misleading deletion   | Durable Forget admission redacts body/topics across exact-scope client caches after cancellation drains; failed refresh cannot restore a settled older read. Unconfirmed requests stay visibly uncertain.                                                     | `apps/web/src/features/memory/adapters/memory-dashboard-cache.test.ts`; screen/workspace tests; `scripts/memory-ui-e2e/browser-qualify.ts`                                                                                                                  | Browser HTTP fixtures prove rendered interaction only, not product authorization, persistence, native cleanup or model quality.                                                                             |

## Required Execution Layers

Use the commands and preparation in
[Memory provider operational checks](../operations/02-runbooks.md#memory-provider-operational-checks).
The former standalone custom-engine flow spike is removed; it is not a release
gate and must not be restored to make typechecking pass.

- `.github/workflows/memory-projections.yml` runs the real PostgreSQL authority,
  worker and lease suites with required-file and zero-skip checks, plus the
  independent rendered browser fixture job.
- `.github/workflows/hindsight-memory-qualification.yml` verifies exact upstream
  source/SDK/image inputs and executes the hardened native API, separate workers,
  PG17, failure/privacy and paused cleanup/restart stories. See
  [the native operator guide](../../deploy/hindsight/README.md).
- `.github/workflows/ci.yml`, Source and Certification Checks, runs the paired
  memory HTTP/PG proof against immutable Action source and requires its sole test
  to pass without skips. See [the paired guide](../../scripts/memory-e2e/README.md)
  for the full-catalog disposable database requirement and deterministic boundaries.
- Policy/API/cache unit tests and architecture/type/lint checks remain separate
  source gates. A skipped opt-in suite, source inspection or an unrelated past
  green run cannot stand in for candidate runtime evidence.

Production activation additionally requires selected-model/egress/corpus
thresholds, deployed immutable image/config checks, capacity and restore with
newer deletion fences, live current-protocol T0/source-authority evidence, and
explicit legacy-data and remote-cleanup-debt disposition. The approved plan,
not this evidence map, is the acceptance authority.

## Historical Custom-Engine Release Record — 2026-05-16

The previous version of this matrix recorded the then-current custom engine as
beta-ready after local, Action and live GitHub checks. That conclusion applied to
that implementation and protocol; it does not qualify the Hindsight replacement.
The historical architecture plans and Git history retain the original controls
and execution record.

The live smoke record used
[disposable PR4](https://github.com/777genius/review-router-saas-e2e/pull/4) and marker
`rr-memory-smoke-1778965736933`, with runs
[direct save](https://github.com/777genius/review-router-saas-e2e/actions/runs/25973002113),
[natural-language suggestion](https://github.com/777genius/review-router-saas-e2e/actions/runs/25973014137),
[suggestion confirmation](https://github.com/777genius/review-router-saas-e2e/actions/runs/25973027526)
and [forget/delete](https://github.com/777genius/review-router-saas-e2e/actions/runs/25973034902).
The former candidate/command endpoints and automation are retired. These links
preserve prior evidence rather than instructions to run a legacy smoke or a
claim about the current production deployment.
