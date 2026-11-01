# Reviewer-v4 MCP boundary qualification

- Task ID: `2026-11-01-reviewer-v4-mcp`.
- Goal: prove that two captured OCR reviewers obtain their own authorized MCP
  access and actually use the selected public tools, preserving the existing
  GPT-6.1 test-repository configuration after cleanup.
- Affected targets: API context-tools routes, their regression tests, and one
  disposable GitHub review on the existing deployed Gateway caller.
- Implementation reference: branch `test/reviewer-v4-mcp-e2e`, source/test
  commit `a09c68214`. Source changes and live qualification are recorded
  separately below. The owner authorized the existing pinned CI toolchain for
  this task on November 1; new source retains its independent strict TS7 checks.
- Dependencies: the installed [multi-reviewer](2026-10-29-gateway-multi-reviewers.md)
  and [unified OCR](2026-10-29-unified-ocr.md) contracts. This slice does not claim
  their complete deployment acceptance matrix.
- Last updated: `2026-11-01`.

## Environment status

| Environment                  | Status    | Actual version                              | Evidence / remaining work                                                                              |
| ---------------------------- | --------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| staging                      | `pending` | Not exercised                               | No staging deployment in this task.                                                                    |
| production MCP qualification | `blocked` | API `d5f16400`, Action224 `72634bbc`        | Real v4 admission passed; both reviewer invocations failed and made zero MCP calls. Cleanup completed. |
| API defensive error mapping  | `pending` | Source/test commit `a09c68214`; not shipped | Owner authorized existing pinned CI for this task; normal PR qualification can proceed.                |

## Source behavior and regression scope

The context-tools route must resolve an explicit captured OCR reviewer for a v4
snapshot and use the same selector for the final authority check. Missing,
malformed, unknown and non-OCR selectors must never return credential or issue
payloads. Revocation or a changed snapshot after preparation must withhold the
prepared result. Existing v3 behavior remains covered.

A permissive injected authorization port exposed an unknown-reviewer lookup
exception mapping to retryable `503`. Validate captured membership before the
domain lookup so that this route-level denial is `403`. The normal production
authorization composition already maps an unknown reviewer/allocation to an
inactive `410`; the regression is not evidence of a production credential leak
or an observed production `503`.

Focused qualification passed: 15 route tests (six existing v3 and nine v4),
strict native TypeScript `7.0.2` for the owning API project, and scoped native
lint/format checks. The v4 fixtures pass the normal strict snapshot parser.
The mock authorization-refusal cases prove withholding at the HTTP boundary;
they do not independently qualify the actual PostgreSQL allocation adapter.

### Source delivery qualification

The [maintained Engineering Quality Standard](https://github.com/agent-teams-ai/.github/blob/main/docs/engineering-quality-standard.md#typescript-for-javascript-runtimes) forbids executing compiler/parser
implementations older than TypeScript `7.0.2`. Existing CI still initializes
`6.0.3`: even a Draft PR matching `apps/api/**` triggers P115's normal dependency
bootstrap, which can build the pinned AR dependency with TS6. Ready checks also
use TS6 through the root typecheck, architecture/test/build consumers and
`typescript-eslint@8.59.1` parser. The existing native pilots retain those
baseline gates. Do not disable checks or assume a warm cache avoids the issue.

The initial source delivery was paused before PR CI. That restriction was
subsequently resolved by the explicit task-specific owner exception below. The live installed
positive v4 path is independent of this defensive correction; do not describe
the correction as deployed on the basis of the live canary.

Continuation: the owner explicitly authorized existing TypeScript5/6 CI for
this task, avoiding an unrelated paired tooling migration. The normal PR/CI
route can now proceed; this exception does not change required checks, claim
TS7 ecosystem compatibility, or constitute deployment evidence. The owner also
requested the existing fast Hetzner deployment route without unnecessary
migrations or repeated checks; application delivery is coordinated with the
separate `rr: deploy` workstream.

## Live qualification

Use `777genius/rr-codex-rotating-e2e` PR132 and the existing GPT-6.1 profile.
Normal validation admits two distinct explicit OCR engines, `ocr-managed-v4`
and `ocr-managed-v5`, with parallelism two. Their common Gateway authority must
retain one finite shared allocation, not manufacture an allowance per reviewer.

Select Cloudflare documentation search, Firecrawl scrape and DeepWiki structure
from the existing disabled test connections. Include `github.issue.read` in the
captured builtin selection to force each OCR session through the actual v4
credentials API before model dispatch; anonymous MCP alone skips that API.
The requested tool activity remains three public MCP calls per reviewer. No
GitHub issue or new key/account is needed. Empty live credential maps are not
claimed as authenticated external-server key qualification; the v4 route tests
independently exercise a nonempty secret response.

Record one App-first trigger and parent authorization, snapshot4, both reviewer
IDs and exact engines, shared allocation, captured plan and producer, six actual
successful public-tool calls with reviewer attribution, coverage and one
aggregate App-authored publication. Synthetic model tests or the earlier
single-reviewer run `40791113369` cannot establish this live result.

### Actual result: qualification failed

Root issued one ordinary PR-body edit and reopening; no manual dispatch or
model replay. [Initial run `41296357068`](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/41296357068)
waited about eleven minutes for GitHub's runner and was refused at authorize
with `403/forbidden`, protocol issue `review_request_intent_required`.
It created no authorization or execution. Its deadline was `10:41:10Z`,
after the `10:22:40Z` refusal, so expiry is not established as the cause.
The normal worker superseded that intent and dispatched its linked child.

[Recovery run `41297298465`](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/41297298465)
passed real admission: snapshot4, repository74/workspace21, both required
`gpt-6.1-sol` reviewers and the exact OCR-v4/v5 binary identities above. Both
share allocation `rr-allocation-aaeedc5627d3a861342a5cc4fe0643da841ecce78c4085a3aee86fcdf8c05f2b`,
with finite requests640/concurrency1/tokens32768 and the original binding.
The captured plan was `sha256:a6abacc23702fcb223742468e13e6ce2814f4da4f8c858d4b67074e2de42879c`.

Observed broker receipts: two `nativeConnected: true`, both containing all
three selected MCP tools and the issue builtin, with **zero started,
succeeded or failed tool calls**. Both required finding slots exhausted
three attempts, each reporting only `retryable/provider_invocation_failed`.
Required coverage was 0/2; the final artifact was partial with zero findings.
The single aggregate [App-authored incomplete advisory](https://github.com/777genius/rr-codex-rotating-e2e/pull/132#issuecomment-6556791052)
published successfully and correctly stated that both providers failed.
This is not the expected intentional finding/merge-gate failure of a
successful canary, and does not qualify real MCP execution.

Broker logs lack reviewer IDs; captured vote hashes do identify the two work
slots, but direct per-reviewer tool-log attribution is not claimed. Successful
credential preparation is a source prerequisite of these builtin-enabled OCR
sessions; individual credentials HTTP200 telemetry is not directly observed.
No nonempty external-server secret delivery or upstream model-dispatch count
is inferred from these receipts. Existing sanitized relay diagnostics did not
identify the invocation cause. Preserve the failed attempts and diagnose the
normal provider/native failure before another live canary; do not weaken
authority, budgets or replay guards to obtain green coverage.

Root additionally confirmed the active ReviewRouter AccountGateway service from
the host's running-service inventory. Its configured journal output contained
zero rows for `10:31:30Z–10:35:10Z`; this does not establish absence of requests.
No execution bearer, service environment or provider stderr was extracted.
The next supported evidence step is to retain allowlisted OCR process/acceptance
and Gateway rejection codes through the owning runtime diagnostic path, qualify
that change and then run a fresh canary. Generic failures alone do not establish
a specific runtime correction or justify claiming the original gap closed.

## Cleanup and retry

After terminal reconciliation, close the fixture PR, restore its prior body,
remove only the canary context selection, restore the original singleton
GPT-6.1 selection and execution overrides through normal CAS-protected use cases,
and disable only the three test connections. Preserve workspace policy, provider
profiles, credentials, unrelated connections and existing execution evidence.
Verify the original sparse policy hash and zero target active authority/leases.

Actual cleanup completed at `2026-11-01T10:40:09Z`: repository76/workspace21,
original singleton GPT-6.1 policy SHA
`111b9ebb62ac99438668fad01c0eba1a2aa98b089188abc10709c7319129fa59`,
no context selection and all seven connections disabled. Only the three
canary revisions changed (Cloudflare6, Firecrawl10, DeepWiki14); definitions,
secret presence, all provider profiles and workspace policy stayed exact.
Target active authorizations, leases and executions were zero. The child
authorization was revoked, all seven leases released and the shared allocation
cleanup completed at `10:34:52.207Z`. PR132 is closed with its original body
restored. GPT-6.1 remains selected, as requested.

Never repeat an unknown model, dispatch, settings or publication effect. Read
back the original identity and complete only the missing supported phase. Keep
failed attempts and their actual reasons. No new feature flag, migration,
Gateway/native/SDK/Caddy restart or mutable-tag bypass is part of this canary.
Any application rollout follows the [release source of truth](../operations/07-environments-and-release-management.md)
and all applicable entries in the [deployment registry](README.md).

## Evidence

Focused tests, Root source review, compiler assessment, setup/cleanup and
sanitized live receipts are retained under `tmp/reviewer-v4-mcp/`. Durable run
and publication links above record the actual failed qualification. Source and
tests are preserved on `test/reviewer-v4-mcp-e2e`; no PR was opened because even
its Draft auto-workflow would execute the prohibited compiler. Neither the
source correction nor a successful live MCP canary is claimed as delivered.

## November 1 continuation

The OCR2/OCR3 differential [run41302520797](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/41302520797)
confirmed three successful real public MCP calls by OCR2. OCR3 exhausted its
required slot, so the run remains partial and does not establish two-reviewer
acceptance. Its authorization and shared allocation were closed and cleaned.
No old unknown model request was replayed.

The coordinated server baseline is union source
`14bead9640d0b4e6c6741aa5645c2a6c160fdd2f`, image
`sha256:21dc5822d2bee10fd2bc6903d3243aadd7bf05712041292f4d575d089ee983a6`.
It combines the owning workstreams' bounded relay diagnostics and shared-input
memory authorization correction. It does not contain this task's defensive API
patch. Gateway/native/SDK and approved Action224 `72634bbc` remain unchanged.

One normal repository assignment at13:00:50Z changed version78 to79, selecting
OCR4/OCR5 on the existing GPT-6.1 profile and keeping the same three selected
MCP connections. Workspace21, all seven connection definitions and secrets,
and provider profiles remained unchanged. Root reopened PR132 once for a fresh
canary after that actual server change. Final acceptance and cleanup are pending.
The exact retained terminal PR134 authorization belongs to the memory workstream;
its completed execution and cleaned allocations are preserved without revocation.
