# One-shot TEST handoff

This is the checked-in delivery of the qualified rr290 operator for the existing
disposable `777genius/reviewrouter-e2e-prod-20260529-000305` repository, workflow
285170467 and PR 4. It does not operate on arbitrary customer projects.

The caller reviews and prepares one nonsecret plan before execution. One process
then owns READY, authenticated assignment, observe, mint, Compose, the
nonconnecting readiness probe and the sole owner invocation. Observe is awaited
immediately before mint without a model/tool handoff between them. The full native
inventory travels directly from the pinned read-only SQL to the pinned mint
command; it must never be printed or routed through this coordinator.

Read-only assignment polling pins the expected run ID and waits through runner
queues without inventing a queue expiry. Once the exact transfer STEP starts,
its original `started_at + 120s` deadline governs every remaining phase.
Mint's approval expiry is checked against the original 900s maximum. The API's
10s timeout and native freshness guards remain owned by the existing commands.

The plan is trusted operator configuration, not an untrusted API request. Its
command argv, native paths, immutable intent, expected run/head/STEP and owner
hash require independent review and fresh prerequisites before use. No launch
plan or production command preset is committed here. A malformed preparation,
failed phase or uncertain receipt stops the chain without retry or reconnect.
Readiness must terminate successfully before the owner is invoked.

After any consumed operation, retain its state and receipts. Never rerun this
entrypoint to replay READY, reobserve, remint, reset or refund an old operation,
including terminal UNKNOWN outcomes. This source delivery and its offline tests
do not grant authority for a paid call or a new production operation.

The synthetic contract runs with `pnpm hosted-pool:test-handoff:contract` and is
also part of Quality Gates. It checks exact ordering, stdin transport, phase
failure containment, mint receipt bounds, pinned run identity and a queue longer
than 120s without real GitHub, DB, provider or agent-runtime calls. The original
qualified sources were rr290 SHA-256 `bd5eb5d18fa55568b1113d3399a0d9a1e93b93396596b35a96364b904932e9ad`
and test `76d2091b1ab469a40f07896c0bf1e8e2362ba71a2918522ff7fadb251a87ef3f`.
Formatting and the portable typecheck configuration are repository delivery
changes; operational semantics are preserved.

Repository review additionally found that a missing owner executable could fail
only after consuming the earlier phases. CLI preparation now validates every
owner field before resolving its pin or making any GitHub call. An isolated CLI
fixture with a local fake `gh` proves that malformed owner input makes zero
GitHub commands; no real credentials, network or operation are available to it.
