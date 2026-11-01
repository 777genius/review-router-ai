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

| Environment | Status    | Actual application revision                | Evidence / next step                                                                 |
| ----------- | --------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| staging     | `pending` | Not selected for this task                 | Owner selected direct production delivery in the source session.                     |
| production  | `pending` | `d5f16400e610e6fe9151c23da39868825d332711` | Diagnostic source is tested, not installed; merge and perform ordinary code rollout. |

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
