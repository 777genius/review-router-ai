# Companion Gateway refusal diagnostics

- Task ID: `2026-11-01-companion-gateway-refusal-diagnostics`
- Goal: preserve safe, specific SDK refusal evidence for companion and ordinary
  requests whose callers otherwise lose the internal refusal details.
- Affected services: API; deploy with the coherent application fleet.
- Implementation: [PR #772](https://github.com/777genius/review-router-ai/pull/772) (includes the source prepared in #775),
  source `4cc7ae2e215ec9fe10f7d05d44dcac9ea72aff4b`.
- Dependencies: ordinary coherent release; the same PR includes strict client-side
  release verification.
- Last updated: `2026-11-01`.

## Environment status

| Environment | Status     | Actual application revision                | Evidence / next step                                                                                       |
| ----------- | ---------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| staging     | `pending`  | Not selected for this task                 | Owner selected direct production delivery in the source session.                                           |
| production  | `deployed` | `e7f2e600acc896448b91ea0a9985c6e766a3c95b` | Fleet, worker privileges and readiness pass; fresh two-reviewer Gateway/MCP acceptance and cleanup passed. |

## Failure and evidence

[Live review attempt 10](https://github.com/777genius/rr-selfhost-direct-v2-e2e-20260730t120036z/actions/runs/40800168729/attempts/10)
failed at 2026-11-01 10:57 UTC. Native preparation applied, then the execution
closed with request count zero. The request has no native row and no native
failure log. This does not constitute a contractual non-entry receipt; retain
the dispatch's `effect_unknown` state. The relay discarded the SDK diagnostic.

A single subsequent supported metadata read returned an OpenRouter catalog
snapshot in 102 ms. Both GPT-4.1 and the actual default Nemotron model were
included. The saved GPT-4.1 configuration has no reasoning effort; offline
validation of the shipped OCR request shape succeeds. Neither finding proves
the historical rejection cause.

## Ordered rollout

1. Build the locally verified exact source. The owner explicitly authorized
   fast production delivery without waiting for CI; ordinary PR merge still
   requires exact-head CI. Preserve concurrent application fixes and live settings. No migration, new environment
   variable, catalog promotion or Gateway restart is required by this change.
2. Follow [the release process](../operations/07-environments-and-release-management.md)
   and `deploy/hetzner/release.sh`; preserve the post-ACL worker grant.
3. Verify exact fleet revisions, real worker database privileges and readiness.
4. Observe a separately authorized fresh test-repository review. Inspect the
   closed JSON diagnostic on failure. Do not replay the uncertain native request
   from attempt 10 or relabel its historical effect as unpaid.

## Verification and rollback

The full real-loopback relay suite passed 76 tests. Serialization, throwing-sink
and local-authority phase cases passed. Two ordinary 403/503 cases also verify
the original SDK error, unchanged public response and exactly one native POST.
Companion and ordinary failures use one closed-field diagnostic helper. API typecheck, formatting and diff checks passed. No raw error,
message, headers, bodies, token or opaque upstream reference is logged.
Settlement, one-request budgeting and cancellation remain unchanged. Rollback
uses the preserved previous application containers; no schema rollback is needed.

## Related production repairs during continuation

- All 31 historical permission-denied installation sync events left by the
  previous recovery were preserved, requeued and processed successfully.
  Worker privilege verification then passed all six checks; `/ready` returned 200.
- At 11:07:20 UTC, two stale loopback Caddy upstreams in
  `/etc/caddy/projects/review-router.caddy` were changed from port 13195 to 14171.
  Complete disk configuration matched live before the change; full validation,
  reload and disk/live comparison succeeded. The loopback catalog route now
  returns unauthenticated 401, with zero Gateway restarts. This is a real separate
  repair, not evidence of the cause of attempt 10.
- Protected Caddy recovery receipt:
  `/srv/platform/projects/review-router/releases/caddy-loopback-gateway-20261101T110720Z/receipt.json`.
  Original source SHA256 `d822e9af7d442ede1e3bc3f0bfb7fe76c1b61496fcc9d64a92ba9e4dc419b302`;
  replacement `d9c2b23948ab235828031e77f5533617ab47fdd6f0ad2398a7059465d4c42467`.
- [platform-infra #488](https://github.com/777genius/platform-infra/pull/488)
  merged at `953cd67bfe29d86be9cef800c59915a082058e02`: new activation packets,
  the Caddy example and runbook use the production `.org` origin. Historical
  staged packets and their hash-bound receipts were preserved.
- [Issue #761](https://github.com/777genius/review-router-ai/issues/761) remains
  the canonical ACL/activation routine and INSERT-guard follow-up. The ordinary
  Hetzner deployment path applies and now verifies the narrow worker grant.

## Additional continuation checks

- The signed-in organization Statistics page was verified at 11:36 UTC: two
  distinct pull requests, three completed reviews and zero issue facts, matching
  the database. The report renders; a direct seven-day URL also selects the
  expected period. This is frontend evidence, not just an owner SQL count.
- Legacy `reviewrouter-codex.yml` was disabled through the supported Actions
  workflow-state API in both `agent-teams-ai/.github` (workflow 325491799) and
  `agent-teams-ai/engineering-foundation` (325491577). Readback is
  `disabled_manually`; their modern `reviewrouter-review.yml` callers remain
  `active`. Existing source bytes, exact Action pins, interaction workflows and
  required checks were preserved. Deleting the files requires a separate owning
  contract migration: both repositories currently enforce their presence.
- Companion failure diagnostics now distinguish session validation, local
  authority, local forward validation, SDK request, post-request authority and
  stream wrapping. A real loopback case confirms local authority refusal makes
  zero native POSTs while retaining the consumed reservation and unknown effect.

## Applied application rollout

- Fast build finished at 12:30:36 UTC, exit 0 (320 seconds). Image
  `sha256:ed5398998d720a85ef6259e42679b791ea3aed29b399c0bba12c2dc6d9dd2b0b`
  carries exact application source `6e900a26ff0e98b91c70287196dbde876e8cc48e`.
- Plan-only exposed the release script looking for the private scan network at
  the API. The API correctly has only the platform network. The script now
  selects the scan container's single private network; its actual Python body
  passes eleven topology cases and fails normal topology before the fix.
  This external operator-script fix is `d41d7e6dc`; no app rebuild was needed.
- Preserved plan and application receipt:
  `/srv/platform/projects/review-router/releases/fleet-overlay-6e900a26-u20Qv6n8`.
  Cutover applied after the OCR owner released its window and confirmed no
  running/planned executions or active leases, with allocation cleanup complete.
  Retained authorizations were preserved.
- All four roles report the full requested source, running with zero restarts.
  The actual worker connection passes six privileges and `/ready` returns 200.
  Gateway remains active with zero restarts. No migrations, ACL changes, Gateway
  restart, producer change or MCP policy changes occurred in this rollout.
- New container IDs: API `9be662825782`, worker `e9d8c4f5a2a5`,
  scan `9cdfd83dd6e5`, web `4cb28a2bc179`. Previous fleet is retained for rollback.
- Post-cutover signed-in UI check at 12:40 UTC: organization Statistics renders
  the seven-day period, two reviewed PRs, three reviews and zero caught issues;
  no alert is present.

## Intermediate memory/diagnostics union

- Source `14bead9640d0b4e6c6741aa5645c2a6c160fdd2f` merges this PR head
  `c47d28882` with [PR #776](https://github.com/777genius/review-router-ai/pull/776)
  source `0cdb162855ffbc363df6357462849bdfa9c35bc6`. The latter repairs the shared
  V4 memory authorizer and has independent PostgreSQL17, strict TypeScript7 and
  scoped lint evidence. Production files merge without conflicts; the index
  preserves both records. Both PRs retain their own CI and merge flow.
- Build finished 12:50:11 UTC, exit 0 in 283 seconds; image
  `sha256:21dc5822d2bee10fd2bc6903d3243aadd7bf05712041292f4d575d089ee983a6`.
- Union protected controller/receipt:
  `/srv/platform/projects/review-router/releases/fleet-overlay-14bead96-7G4aXMdJ`.
  All four roles report exact union revision, running with zero restarts; actual
  worker passes six privileges and `/ready` returns 200. Gateway is active with
  zero restarts. No migration, ACL, producer or MCP policy change occurred.
- Union IDs: API `88b30ac0871f`, worker `6754a0745272`, scan `0953424250e2`,
  web `f25f454a9b80`. Previous `6e900a26f` fleet is retained for rollback.
  Both owners confirmed no active owned requests before cutover. One shared
  fresh canary will verify OCR and memory together; historical unknown requests
  remain unchanged.

## Current fleet and availability recovery

- The memory owner subsequently deployed source
  `e7f2e600acc896448b91ea0a9985c6e766a3c95b`, whose direct parent is the union
  `14bead9640d0b4e6c6741aa5645c2a6c160fdd2f`. Image:
  `sha256:7cee23648d3fb708fdf63f99fa0578e8d5726a512b06a5bbc992cdcf4cb6ec8a`.
  This retains the application diagnostics and adds local receipt preflight for
  run authorization. Independent release verification passed: all four roles
  at this exact source, running with zero restarts, all six real worker privilege
  checks and readiness HTTP 200. Private Gateway access without credentials
  returns the expected HTTP 401.
- At 13:45 UTC the host exhausted service-available disk space. PostgreSQL logs
  explicitly record ENOSPC; the existing Gateway and its PostgreSQL17 container
  stopped. This later evidence does not establish the cause of earlier
  `effect_unknown` failures.
- Only three finished build source extractions owned by this continuation were
  removed; source archives, logs, image IDs and rollback artifacts were retained.
  Selective daemon cache GC then removed 19 individually verified private,
  immutable, unused regular cache records. No image, container or volume
  identities changed during that GC. Docker reported 1.462 GB reclaimed; net
  filesystem availability increased by 1,365,262,336 bytes. Concurrent activity
  had already restored other space, so the total recovery is not attributed to
  this cleanup. Final service-available space was 11,519,590,400 bytes.
- Durable selective-GC plan and receipt:
  `/srv/platform/projects/review-router/releases/selective-cache-gc-20261101-dll_hf9p/`.
  The memory owner started the existing PostgreSQL17 container and the same old
  Gateway unit after storage recovered. Existing database files, configuration,
  native binary and wrapper source were preserved; there was no database
  initialization, migration, key rotation or foreign authorization cleanup.
- Gateway retained wrapper source `3a838c8d8531b6ae04446e6191c35b6549694a6a`
  and native binary SHA256
  `2339a4d30d2c319b3618fd0756fdd79bb841c091ad2dd17b1728c79cabed589e`.
  The restored service is active with zero automatic restarts. This recovery is
  distinct from the earlier application cutovers, which did not restart it.

## Fresh functional acceptance

- [Run 41318061244](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/41318061244)
  on the current fleet completed both required OCR reviewers using GPT-6.1.
  Coverage is 2/2; each isolated Cloudflare, Firecrawl and DeepWiki invocation
  succeeded for both reviewers: six real MCP successes, zero failed attempts
  and zero builtin fallbacks.
- One accepted finding was published by `review-router-ai[bot]`: review
  `5728711263`, inline comment `4436133109`, summary `6559604798`. The workflow's
  red conclusion is the intentional `review_merge_gate_failed` result for the
  deliberately faulty TTL fixture; provider execution and publication succeeded.
- Cleanup was accepted at 15:00:56 UTC: disposable PR 132 closed with original
  body, original singleton GPT-6.1 policy restored, all seven MCP connections
  off, definitions/secrets/profiles unchanged, no running executions, active
  leases or pending allocation cleanup. Terminal authorizations were preserved.
- This establishes Gateway/MCP review acceptance, not delivery of memory to both
  reviewers. Memory acceptance remains owned by PR #776 and its follow-ups.
  Historical unknown effects were neither replayed nor relabeled.
- Optional bounded native failure diagnostics were merged separately in
  [account-gateway #95](https://github.com/agent-teams-ai/account-gateway/pull/95)
  as `a717bfe50e46d01092eb380582c83d82c261b58c`, after all 20 executable CI
  checks passed. The exact-installed-source candidate remains staged only;
  neither it nor current Gateway main was deployed. Successful acceptance needs
  no additional Gateway restart or V3 cleanup.
