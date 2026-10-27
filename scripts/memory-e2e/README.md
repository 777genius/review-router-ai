# Paired Action memory admission proof

`paired-action-memory.pg.test.ts` runs the public Action source against the real
Fastify routes over a loopback TCP socket and a disposable PostgreSQL database.
It exercises Action memory capture, eligibility, Codex prompt preparation,
canonical invocation manifests, execution start, lease acquisition and evidence
commit through the actual Action HTTP client and Prisma adapters.

The provider reader supplies one explicitly approved synthetic statement.
Inference is a deterministic empty finding set, executed through the actual
Codex invocation adapter. This is a protocol, authority and retry proof; it is
not native Hindsight lifecycle qualification or selected-model quality evidence.

## Required environment

```sh
REVIEW_ROUTER_MEMORY_PAIRED_E2E=1 \
REVIEW_ROUTER_TEST_DATABASE_URL="$DISPOSABLE_PAIRED_DATABASE_URL" \
REVIEW_ROUTER_ACTION_SOURCE_DIR="$ABSOLUTE_PINNED_ACTION_CHECKOUT" \
  pnpm exec vitest run scripts/memory-e2e/paired-action-memory.pg.test.ts
```

The Action checkout must have its locked dependencies installed. CI must check
out an immutable Action commit; a branch name alone is insufficient. The suite
imports its actual source and uses its generated protocol client. The test
enables the client's explicit localhost HTTP option only for the loopback
listener it creates.

The database must be disposable, isolated from concurrently running suites,
and migrated to the full current catalog. The shared production Action E2E
harness truncates its review tables before and after the scenario. This is
destructive to that database. A historical through-79 database is insufficient.
Use the existing disposable full-catalog preflight, before-87 deployment,
verified handoff and final full deployment used by the source certification job;
do not use `db push` or weaken migration guards. The historical provider-79
handoff is a separate fixture path and cannot be substituted for the before-87
handoff.

Without the enable flag the suite is skipped. When enabled, missing database
or absolute Action source configuration fails immediately. CI must require a
passing suite with zero skipped tests, preserving its result artifact.

## Assertions

1. The Action captures memory over HTTP using a real authorization and receives
   a PostgreSQL receipt containing identity and hashes without the statement body.
   The actual Codex prompt contains the approved text and its manifest commits
   to the exact snapshot hash.
2. The first real lease commits, but the test discards the HTTP acknowledgement
   before the Action receives it. Durable retirement intent then revokes the
   statement. Repeating the identical acquire command restores the exact original
   lease and attempt, with one lease row and no second budget charge.
3. A new acquire command carrying the old manifest returns `input_stale` before
   charging an attempt. The next attempt ordinal stays unchanged and no lease
   is added. The database clock read after rejection proves the receipt has not
   expired, so expiry cannot mask a missing retirement fence.
4. The test driver calls the actual Action session's `discard` method and
   invocation adapter to rebuild the prompt and manifest at that same remaining
   ordinal. The new manifest has no memory hash and a different invocation key.
   A new real lease succeeds; memory was captured only once.
5. The actual invocation adapter performs exactly one deterministic inference,
   using the memory-free prompt. The Action commits the resulting evidence over
   HTTP and its payload hash matches the persisted PostgreSQL observation.

The restored first lease is released without inference: restoring an already
committed grant after a lost acknowledgement does not authorize a new inference
with freshly revoked input. Production orchestration's restored execution rules
are covered separately by the paired Action's production-runner regressions.
This test orders retirement before the stale acquire; concurrent retirement and
acquire races remain the responsibility of the separate PostgreSQL race suites.

## CI integration

Run this suite after the existing source-certification job has prepared its full
disposable database and immutable paired Action checkout. Set the three required
variables above, use a dedicated paired database if other suites can overlap,
and include this exact file in the job's required-suite/zero-skip assertion.
Keep the existing four historical/authority PostgreSQL suites and native Docker
qualification independent: this suite adds cross-repository HTTP coverage.
