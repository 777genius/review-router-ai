# Review statistics — review record

The owner requested four sequential plan review rounds with three independent
GPT-6.1 Sol xhigh critics per round, followed by implementation reviews and E2E.
The initial research and this record are not implementation/test pass claims.

## Plan round 1 — candidate 1 to candidate 2

All three directions completed independent reviews against the same candidate.

| Direction          | Material findings                                                                                                                                                                         | Resolution in candidate 2                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Data/security      | Provisioned GitLab does not settle V2; historical availability cannot mean zero; delayed events can outlive a deleted/rebound repository.                                                 | Explicit source coverage, no invented GitLab telemetry, suppressed incomplete comparisons, durable capture boundary, immutable original tenant/connection and acknowledged deletion no-op.                                                                   |
| Architecture/scale | CAS/read/capture were not specified as one transaction; worker gates could block statistics draining; synthetic TS7 checks would not qualify real builds.                                 | Same transaction client for CAS, source, outbox and return read; independent handler registration; real affected consumers under TS7.0.2. Added deterministic earliest-event ordering, replay collision errors, Repeatable Read and named SQL qualification. |
| UX/qualification   | Period/current-day/availability rules and DTO were underspecified; actor cache isolation and rejected SSR seeds needed concrete behavior; initial errors could break the whole dashboard. | Only bounded 7/30/90 presets, same elapsed previous interval, shared DTO, feature-local initial failure handling, actor/workspace keys and whole-feature cache rejection. Added exact pagination/selector rules and accessible day table/browser matrix.     |

The plan retains the existing modular monolith, durable outbox and two compact
fact tables. No broker, separate service, custom GitLab reporting protocol,
historical backfill, rollup engine or unused observation subscriber was added.

## Plan round 2 — candidate 2 to candidate 3

All three critics independently verified the first fixes and found narrower
remaining gaps.

| Direction          | Findings                                                                                                                                                                           | Resolution in candidate 3                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data/security      | A GitHub certified-fork route also bypasses V2; provider name cannot establish source coverage. Personal workspaces need owner-only reads.                                         | Explicit source/mode matrix and bounded uncovered-source reasons, conservative admission/activation checks, owner-only personal scope.                                                                          |
| Architecture/scale | First new worker startup cannot prove old captureless owners stopped; capture callback mapping owner/signature remained ambiguous.                                                 | Nonrolling initial owner cutover, DB-time singleton before work and unavailable reads before activation; exact infrastructure callback, host mapping and mandatory production binding.                          |
| UX/qualification   | Activation-day partial history and unsupported-only zero labels, request shapes/page-1 ownership, fresh authorized seed identity and separate-page freshness remained unspecified. | Partial daily coverage preserves known counts; visible recorded-activity notice; exact endpoints, lazy issue query, actor/workspace/seed identity and period-bound issue keys; no cross-request snapshot claim. |

No additional service, producer migration or source reconstruction was added.

## Plan round 3 — candidate 3 to candidate 4

All three critics completed the third independent pass. Architecture/scale and
frontend had no remaining blocking design findings.

| Direction          | Findings                                                                                                                                      | Resolution in candidate 4                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data/security      | Decimal 2,000,000-byte capture limit was lower than the existing valid 2 MiB source ceiling; mandatory capture could reject valid completion. | Use the authoritative 2,097,152-byte execution ceiling; qualify exact-limit and one-byte-over inputs.                                                 |
| Architecture/scale | No remaining plan blocker.                                                                                                                    | Carry transaction/CAS, ungated handler, boundary and real TS7 qualification gates into implementation.                                                |
| UX/qualification   | Narrow acceptance notes for issue scope, unavailable chart rows and retry/reauthorization proof.                                              | Explicit visible/removable repository scope, separate unavailable/partial/current-day presentation, real-browser retry and fresh-seed recovery flows. |

## Plan round 4 — final candidate 4

All three independent critics reread the revised candidate and gave explicit GO
for implementation. No remaining material data/security, architecture/scale or
frontend/auth/accessibility plan blocker was reported. They reaffirmed the
existing transaction, PostgreSQL, SQL-volume, compiler and browser evidence gates.

All four sequential rounds are complete. Implementation starts after these
approvals. Plan approval is not an implementation or E2E pass claim.

## Implementation review and evidence

Implementation is published in PR #689. Independent data/security and
architecture reviews, plus root integration review, found and resolved terminal
publication/envelope validation, source-coverage history, original connection
retention on unbind/reordered delivery, and fresh-SSR browser-cache races.

Real PostgreSQL, source/capture contracts, component/API tests, composition and
boundary qualification results are recorded in
`2026-10-23-review-statistics-qualification.md`. The fresh full browser scenario
passed on the integrated main source, including actual access revocation/recovery
and all six populated viewport/theme captures. UI and root visual inspection
returned GO; final data/security and architecture reviews also returned GO.
Executed host builds and the protected remote merge gates are recorded separately
in the qualification record and PR checks; no unexecuted gate is counted as passing.

## External implementation review

Seven CodeRabbit threads were independently checked against current source.

| Finding                                                | Disposition                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stale migration evidence                               | Replaced with the fresh 146-migration result; old lost-volume evidence is explicitly historical.                                                                                                                                                                                                      |
| Next control-flow catch and diagnostics                | Genuine framework signals are rethrown; unexpected failures log only a fixed event and workspace scope. Real signal and sensitive-text regressions pass.                                                                                                                                              |
| Midnight rendered as 24:xx                             | UTC formatting now uses `h23`; the regression asserts `00:01`.                                                                                                                                                                                                                                        |
| Issue remount steals focus and scroll                  | Focus follows explicit issue navigation; filter/refetch remounts do not jump to the list. Component tests and genuine browser controls pass.                                                                                                                                                          |
| Native compiler missing in C1                          | Added explicit pinned compiler preparation after the intentional frozen `--ignore-scripts` install; retained existing policies.                                                                                                                                                                       |
| Statistics hook blocks superseded-no-effect completion | The claimed accepted path is not valid. Two independent traces and a 20-test completion/capture run prove no-effect publication becomes terminal `PublicationNotApplied` without snapshot work. Successfully published snapshot supersession remains countable; atomic invariant checks are retained. |
| Prisma tenant foreign-key names differ                 | Added explicit relation maps matching existing migration/database constraints; genuine Prisma validation/generation pass, SQL bytes unchanged.                                                                                                                                                        |

The capture review also checked authoritative envelope size, finding count,
occurrence states and lineage bounds before successful settlement. No valid
current-domain completion was found that the statistics guards would newly
reject. A future extension to live adjudication must qualify its own correction
and receipt ordering; this review does not claim correctness for a future path.
