# Implementation slice: inline `/rr fixed`

Paired Action Draft PR: https://github.com/777genius/review-router/pull/373.

## Boundary

Only same-repo, App-verified ReviewRouter findings in the existing managed Conversation Gateway. Use existing single source-revision claim, policy capture, model invocation, and publication receipt. Pure domain verifies one model verdict against GitHub's current immutable HEAD source, with literal cited line. Results: **fixed** (high confidence, evidence), **still present** (high confidence, evidence), or **cannot verify** (no evidence/stale/unsupported). Never auto-close thread or mutate repo/memory. No new queue or schema migration.

## Implementation

- Exact `/rr fixed` source-intent parser; direct comment only, no code blocks or partial prefixes. Classify answer_only before memory context learning.
- GitHub source port: fetch one bounded target text file from currently verified HEAD (no checkout, no extra instructions from review text); ensure reserved finding marker, authenticated App author, selected maintainer, exact source revision, repository identity, no fork, no sensitive file. Use protected GitHub App client.
- Reuse the existing conversation inference and idempotent publication; deterministic result validation checks current file path/blob SHA, line/evidence quoted, provider outcome, source currentness and high confidence. Otherwise cannot verify.
- Bounded separate command tests and real PostgreSQL/Gateway finite-path E2E with no memory updates and one model call. No new general AI engine.

## Stop conditions and risk

If existing selected-account qualified flow cannot safely access source/current snapshot, never claim `fixed`. Do not treat a deleted line/file or successful CI as proof. Do not add additional work queues, provider stacks or migrations. Release and pin changes require separate stable qualification. Keep manual LOC ~550–1,100, generated integrity files excluded.
