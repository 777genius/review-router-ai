# Statistics browser qualification

Run only against a disposable, fully migrated PostgreSQL 17 database named
`reviewrouter_statistics_test` on loopback. The URL must have no query parameters.
The supplied account needs permission to create a temporary SELECT-only login
role and seed/remove fixtures. The harness refuses local dotenv files. No
production credentials, OAuth network login or external repository is required.

```sh
STATISTICS_E2E_DATABASE_URL=postgresql://statistics_test@127.0.0.1:55491/reviewrouter_statistics_test \
STATISTICS_E2E_BROWSER_EXECUTABLE=/absolute/path/to/chromium \
node --import tsx scripts/statistics-e2e/browser-qualify.ts
```

The default `full` scenario checks the six populated viewport/theme captures and
all interaction, empty, unavailable, read-failure and access/recovery flows. Use
`STATISTICS_E2E_SCENARIO=authorization-recovery` to repeat only actual membership
denial and fresh authorized server-seed recovery. The result records its scope;
the smaller scenario does not claim to repeat the visual matrix or other flows.

The application's genuine NextAuth encoder signs a temporary synthetic session.
The real session callback, durable user/identity reads, membership policy, SSR,
HTTP adapters and SQL reader run unchanged. Deterministic compact facts are
inserted directly for browser fixtures: three qualified repositories over 30 UTC
days, 90 published reviews, 12 period-distinct PRs, and 180 first-caught issues
across all four severities. A separate authorized workspace is empty. Durable
capture/projector behavior is qualified by the backend suites, not these direct
fixtures. A Pacific/Honolulu browser timezone checks UTC date labels.

The complete flow checks actual SSR and private/no-store API responses, 7/30/90
presets, keyboard chart/severity selection, fixed review ranking, all-severity
KPI scope, exact daily table counts, repository scope/reset, real cursor page 2,
a deliberately injected page-only 503 and retry, escaped finding metadata, empty
data, missing activation without zero cards, actual SELECT revocation causing
initial SSR failure and retry, actual membership removal causing 403 and whole
feature suppression, rejection of the old seed after membership restoration,
and recovery through a fresh authorized reload. Six captures cover 1440/900/390 px
in both themes with real SVG and horizontal-overflow assertions. All populated
and state captures reset scroll and settle before full-page screenshots.

The disposable programmatic Next dev server delegates to the installed config
loader and changes only compiler settings: run-local output, no persistent
webpack cache or debugger source-map plugin, existing webpack memory
optimization, a bounded Node heap, and post-response GC through `--expose-gc`.
Next 16's custom-server path ignores `options.conf`, so the helper wraps the
loader only inside the child process before Next captures its export. Product
configuration, routes, authorization and readers remain unchanged. Authorized
SSR and both protected APIs warm before Chromium launches; Chromium uses a
single process and reused context to bound memory. Serialize with large compiler
jobs on constrained hosts. This is development qualification, not a production
build, live OAuth-provider login or external runtime test.

Evidence goes under `tmp/statistics-e2e/run-*`: private app log, snapshots and
`result.json` with actual versions, executed checks, HTTP statuses, source hashes,
child exit status and cleanup result. Inspect screenshots separately. Failures
remain failures; independent scoped passes may qualify remaining behavior with
an explicit source boundary. The script always attempts browser/app shutdown,
owned build/profile cleanup, capture restoration, fixture deletion and role
removal. It restores only its own generated Next route-type reference after the
server stops. A cleanup failure fails the run. Synthetic credentials and session
cookies are redacted from failure output. Commit the harness and README, not
screenshots, logs or generated build/profile data.

## Reviews scenario

After applying migration `000151_review_history`, run the same harness with
`STATISTICS_E2E_SCENARIO=history`. Authentication, loopback database restrictions,
the SELECT-only application role, Next server, Chromium, evidence and cleanup are
shared with Statistics; no replacement auth path or product endpoint is used.

```sh
STATISTICS_E2E_SCENARIO=history \
STATISTICS_E2E_DATABASE_URL=postgresql://history_test@127.0.0.1:55493/reviewrouter_statistics_test \
STATISTICS_E2E_BROWSER_EXECUTABLE=/absolute/path/to/chromium \
node --import tsx scripts/statistics-e2e/browser-qualify.ts
```

The small `history-scenario.ts` extension seeds 35 canonical PR summaries in 30
repositories, all eight statuses, seven runs for one PR, nullable/long/escaped
titles, and the shared capture boundary. These are direct compact ledger fixtures,
not evidence that GitHub dispatch or publication ran. Capture, ordering and
projection are qualified separately by the backend PostgreSQL suite.

Reviews qualification covers initial server HTML and private/no-store APIs,
25-row page replacement, lazy five-run history and continuation, four filters,
browser Back, repository26+ selection and its pinned SSR label, invalid shared
URL recovery, local503/retry, empty/unavailable distinction, actual SELECT
revocation/recovery, actual membership403 and fresh authorized seed recovery,
and workspace data isolation. Six captures cover 1440/900/390px in both themes;
state and expanded-history captures are additional. Source hashes include the
changed Reviews surface and helper. Review the saved screenshots before claiming
visual acceptance. Existing `full` and `authorization-recovery` scenarios retain
their Statistics behavior.
