# Reviewer-v4 MCP boundary qualification

- Task ID: `2026-11-01-reviewer-v4-mcp`.
- Goal: prove actual public MCP execution by two captured OCR reviewers, then
  restore the test repository's original GPT-6.1 configuration.
- Source/test implementation: `a09c682144bd2fedb6e11348a78a093d5525451d`,
  [PR777](https://github.com/777genius/review-router-ai/pull/777).
- Dependencies: installed [multi-reviewer](2026-10-29-gateway-multi-reviewers.md)
  and [unified OCR](2026-10-29-unified-ocr.md) contracts. This qualifies the
  two-reviewer MCP slice, not their complete feature matrix.
- Last updated: `2026-11-01`.

## Environment status

| Environment                  | Status     | Actual version                               | Evidence / remaining work                                                                                              |
| ---------------------------- | ---------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| staging                      | `pending`  | Not exercised                                | No staging rollout in this task.                                                                                       |
| production acceptance canary | `deployed` | RR `e7f2e600`; approved Action224 `72634bbc` | Run41318061244:2/2 required OCR reviewers, six real successful MCP calls, App publication, final cleanup85.            |
| API defensive error mapping  | `pending`  | Source/test `a09c68214`; not deployed        | PR777 awaits required CI and its ordinary code rollout. The live positive path does not imply this correction shipped. |

## Source correction and regression scope

The context-tools routes resolve the explicit captured OCR reviewer for a v4
snapshot and retain that selector through the final authority check. Invalid,
missing, non-OCR or revoked authority must never receive credential/issue
payloads; changing the captured snapshot after preparation withholds delivery.

A permissive injected authorization port exposed an unknown-reviewer lookup
exception mapping to retryable503. Validate captured membership before lookup
and return403 at this defensive route boundary. The normal production
composition already refuses unknown reviewers with inactive410. This regression
is not an observed production503 or evidence of a credential leak; it does not
explain the separate SDK upstream failures below.

Focused qualification passed: **15 route tests** (nine new v4 and six existing
v3), strict native TypeScript7.0.2 for the API project, and scoped native
lint/format checks. Fixtures pass the normal strict snapshot parser. Injected
allocation/revocation refusals prove withholding at the HTTP boundary; they do
not independently qualify every actual PostgreSQL allocation failure path.
The live result below supplies the real positive multi-reviewer path.

The owner explicitly authorized this task's existing pinned TypeScript5/6 CI
on November1. That task-specific exception resolves the earlier compiler
execution blocker without claiming full TS7 ecosystem compatibility or changing
required checks. New source retains its independent strict native TS7 checks.

## Accepted live result

[Run41318061244](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/41318061244)
was one fresh App-first request on existing disposable PR132 after actual
capacity and service recovery. No old unknown model request was replayed.
Terminal metadata was verified at `2026-11-01T14:57:44.095Z`; the successful
broker-log verification receipt was recorded at `2026-11-01T14:57:47.682Z`.
The neutral caller and approved producer remained unchanged:

- Caller commit: `584ff4766d07494f8c81152bdbc94231ac2a9687`.
- Review head: `5c3f05a94d1df6d199e216da5d364e717d47d9ab`.
- RR source: `e7f2e600acc896448b91ea0a9985c6e766a3c95b`.
- RR image: `sha256:7cee23648d3fb708fdf63f99fa0578e8d5726a512b06a5bbc992cdcf4cb6ec8a`.
- Action224: `72634bbcb75a8cc11bc03457ee6d45543a1b459c`.
- Gateway retained installed source3a838c8 and its existing configuration;
  Native and SDK were not upgraded for this canary.

Real admission captured snapshot4, repository83/workspace21, two required
`gpt-6.1-sol` high reviewers, OCR4 (`1.13.1-rr.5`) and OCR5
(`1.13.1-rr.6`). Both share one finite allocation
`rr-allocation-c284c805272e7b56df59ca0171ce72a842f0a37bc1cb1803ada92a1ec11f33a2`,
with requests640/concurrency1/tokens32768 on the original binding/epoch1.
Reviewer parallelism2 does not manufacture an allowance per reviewer.
The captured context plan is
`sha256:87bb64d85357581c95e394e5e72034603b7d8d4662db3e6bdf9092ce53c4aad1`.

Two isolated broker receipts each recorded exactly these successful calls:

| Public MCP tool                              | Broker A | Broker B | Failed calls |
| -------------------------------------------- | -------- | -------- | ------------ |
| Cloudflare `search_cloudflare_documentation` | 1        | 1        | 0            |
| Firecrawl `firecrawl_scrape`                 | 1        | 1        | 0            |
| DeepWiki `read_wiki_structure`               | 1        | 1        | 0            |

Both brokers reported `nativeConnected:true`, calls3 and `hadFailure:false`.
The issue builtin was selected to force real credential preparation, but was
not called. All three live MCP connections are anonymous; this does not claim
nonempty external API-key or OAuth delivery. The route tests separately cover
a nonempty secret payload.

Required coverage is **2/2**, exhausted0, execution `completed`. Each required
finding slot has its own accepted observation, joined to its captured reviewer
by the exact vote identity hash. Broker receipts themselves lack reviewer IDs:
per-broker identity attribution is established by isolated child-session
composition plus the captured/accepted slot mapping, not a fabricated direct
log field. Individual credentials HTTP200 status is not directly logged;
successful preparation is a source prerequisite of these builtin-enabled OCR
sessions. Optional PR-description work was cancelled and is outside this
acceptance claim.

Artifact `1f2e9ea7c9428b24344698575d6c4599ad3cb33eb328bf6c79bd1133b02e5cf4`
has completed coverage and one consolidated correctness finding.
[Review5728711263](https://github.com/777genius/rr-codex-rotating-e2e/pull/132#pullrequestreview-5728711263),
[inline4436133109](https://github.com/777genius/rr-codex-rotating-e2e/pull/132#discussion_r4436133109)
and [summary6559604798](https://github.com/777genius/rr-codex-rotating-e2e/pull/132#issuecomment-6559604798)
were independently checked as authored by `review-router-ai[bot]`.
Publication terminal outcome is `succeeded`; one aggregate review was submitted.

The workflow's failure is the **expected `review_merge_gate_failed`** for the
intentional TTL defect in `src/worker-cache.mts`. The fixed-code-only log
projection confirmed that code; no provider/tool failure or exhausted required
work is reported. The fixture was not fixed or merged.

## Earlier failures and infrastructure recovery

Preserve the unsuccessful runs rather than relabelling them successful:

| Run                                                                                        | Actual outcome                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [41296357068](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/41296357068) | Initial authorize403 `review_request_intent_required`; no authorization/execution. Normal worker superseded the intent. Its deadline followed the refusal, so expiry was not established. |
| [41297298465](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/41297298465) | OCR4/OCR5 admitted; two connected brokers, zero MCP calls, required0/2.                                                                                                                   |
| [41302520797](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/41302520797) | OCR2 made all three successful public MCP calls; OCR3 exhausted its slot. Partial coverage does not establish two-reviewer acceptance.                                                    |
| [41309265172](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/41309265172) | Union14bead OCR4/OCR5 admitted; required0/2 and zero MCP calls. SDK logged upstream_failure503/effect_unknown, followed by forbidden403/not_dispatched.                                   |

The historical13:07 upstream failure's precise native cause was not safely
retained. Missing native rows are not proof of no provider entry; unknown
effects were not replayed. The later Gateway/PostgreSQL crash at13:45 was
separately confirmed by12 ENOSPC log events. Those later facts do not establish
the historical request's cause.

The owning deployment workstream recovered service capacity with bounded
selective disposable-cache cleanup. Image/container/volume inventory was
unchanged. The memory workstream started the same existing PG17 container and
same Gateway unit after its crash, preserving data and configuration. Sourcee7
retains the preceding relay diagnostics and adds only the memory preflight
correction over union14bead. All eight normal configuration-write composition
modules remained byte-identical. A pre-issue tuple guard caught the source
replacement before any setup effect; the current baseline was then reconciled.

[Public diagnostic PR363](https://github.com/777genius/review-router/pull/363)
passed exact-head CI and was merged as `ec741bf191da38187cfa119a053e7e0c25abbe22`.
It was not released, registered or promoted into this live producer. Gateway
logger candidate26904/[PR95](https://github.com/agent-teams-ai/account-gateway/pull/95)
remained staged and unapplied. No optional Gateway restart or foreign V3 cleanup
was needed to pass this acceptance. No new flag, migration, Native/SDK/Caddy
upgrade or mutable-tag bypass was introduced.

## Final cleanup and remaining delivery

Our shared allocation cleanup completed at14:56:54.053Z. Normal CAS-protected
settings cleanup completed at15:00:56Z: repository85/workspace21, the original
singleton GPT-6.1 sparse policy, SHA
`111b9ebb62ac99438668fad01c0eba1a2aa98b089188abc10709c7319129fa59`,
no context selection, and all seven MCP connections disabled. Only the canary
revisions advanced to Cloudflare10/Firecrawl14/DeepWiki18; definitions, secret
presence, every provider profile and the four other connections were preserved.
PR132 is closed and its original body restored.

Active leases and running executions were zero. Exactly two retained completed
v4 authorizations remain: this run's6e166a5a and the memory workstream's96b4651d.
Each has one completed execution and one cleaned allocation. They were not
revoked merely to obtain an artificial zero-active-authorization count.

Live MCP acceptance is complete. PR777's defensive API patch still awaits its
required CI/ordinary rollout; it is not claimed deployed. Follow the
[release source of truth](../operations/07-environments-and-release-management.md)
and applicable [deployment registry](README.md) entries for that code delivery.
Sanitized source reviews, qualification and actual setup/admission/terminal/
cleanup receipts are retained under `tmp/reviewer-v4-mcp/`; durable run and
publication links above identify the accepted result.
