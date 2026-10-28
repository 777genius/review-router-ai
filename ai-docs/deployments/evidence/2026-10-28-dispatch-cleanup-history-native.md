# Dispatch cleanup with active review history: isolated native evidence

The isolated TEST seam passed under source
`2b54edf2bfabac25f5343d65bd66e100e57d88b7`, including actual main
`f2f7ae327b764cb1a484e4ef804e2014f2f44d47`.
This records TEST qualification; production deployment and final CI remain pending.

[Machine-readable evidence](./2026-10-28-dispatch-cleanup-history-native.json)
contains exact artifact hashes and counts.

## Source and test boundary

- Native run: [40758960764](https://github.com/777genius/TEST-ci-cancellation-20261026/actions/runs/40758960764),
  existing disposable repository, PR 1, controlled workflow source
  `61f6bdfa6f49dd981b9172a8272789f73606a32e`.
- Compiled manifest SHA-256:
  `512ee870c8370490e339da9d3154413f21a59f9bd5b013f488df6d13870a3192`;
  219 inputs, 81 tracked inputs, four outputs, 2,771,732 output bytes.
- Owned loopback PostgreSQL 17.11, 155 migrations, latest
  `000151_review_history`, current generated Prisma client. Original proof
  databases were preserved. An initial migration preflight timed out before
  Prisma; after terminal process/154-schema/zero-unfinished checks, one approved
  normal retry applied migration 151. No timeout or schema gate was weakened.
- Public history composition was activated. Actual writer callbacks matched
  production wiring; the actual Prisma outbox processor registered both source
  cleanup and history projector handlers. This does not claim full worker startup
  or production handler-map introspection.

## Observed result

| Assertion                                            | Result                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| Real dispatch / cancellation / worker discovery      | 1 / 1 / 1                                                        |
| First global queue batch                             | 5 claimed: 4 history ACKs, 1 cleanup retry                       |
| Reopened queue                                       | 1 retry, then 1 cleanup ACK                                      |
| Total queue work                                     | 7 claims, 5 processed, 2 retries, 0 dead letters, 0 stale claims |
| Replay / remaining owned obligations                 | 0 / 0                                                            |
| Intent version before / after durable target binding | 4 / 5                                                            |
| Original cleanup payload target                      | NULL / NULL, unchanged after binding and ACK                     |
| History                                              | 4 facts; terminal cursor version 4; Unconfirmed projection       |
| Binding and public history                           | No new public fact; actual writer deduplicated unchanged facts   |
| Physical native job                                  | 1 cancelled job record; runner ID 0; no runner name; no steps    |

The persisted binding was checked through a separate database client before
known-run inspection/cancellation. The first cancellation failed before HTTP;
the reopened queue used the persisted target without another discovery. Native
run/jobs were terminal before the cleanup ACK. The original payload stayed
immutable, and all history events were processed through the real projector.

The three controlled seams were a lost real Accepted response, an Inconclusive
recovery lookup at the actual database deadline, and the first cleanup
cancellation throwing before HTTP. A one-dispatch journal prevented resubmission.
Normal `gh` authentication was injected through the guarded TEST transport;
GitHub App/OIDC authentication was not qualified.

## Focused checks and retained evidence

Local checks passed: activated-history atomic rollback/binding test (1), closest
current-schema Prisma cases (4), cleanup/dispatcher tests (46), worker and feature
typechecks, strict native-helper typecheck, and focused lint/format checks. The
new PostgreSQL host test uses an explicit local opt-in URL; this is not a claim
that official CI enabled that optional test.

Raw receipt SHA-256:
`f385e18578933af4a1c42b461119a9076819c6d0a0647fa7348dfda7fe8cd1fe`.
Raw receipt, compiled manifest, fresh SQL readback, jobs, execution log, migration
failure/retry logs, and confirmed zero-client PostgreSQL shutdown are retained in
`tmp/TEST-sticky-history-20261028/`; their hashes are listed in the JSON evidence.
The launch budget was 72,652,328 additional bytes against 3,308,498,944 available
bytes. The process exited successfully, and PostgreSQL was stopped afterward.

This run proves queued-run cancellation with active history capture. It does not
prove running-job shutdown, production effects, provider execution, admission,
publication, final PR/main gates, or rollout completion. Earlier source/native
captures remain historical; they were not relabeled or replayed.

## Subsequent source compatibility

Protected main `5551a572fce38aaa3453bbef1ff9af79d3c293de` was integrated
after this execution. Its eleven changed paths have no intersection with the
219-input native closure. All 219 inputs, 81 committed runtime sources, four
outputs, lock and schema remain unchanged. The original execution source stays
`2b54edf2bfabac25f5343d65bd66e100e57d88b7`; no native dispatch was repeated.

The inherited change routes compatible CI to the configured pool and corrects an
existing web-test expectation. It does not qualify the new runner environment by
itself: final source CI and its actual Scanner receipt must still pass there.
