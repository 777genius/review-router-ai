# Accounts UX real-browser reference E2E

This directory owns a narrowly scoped, executable TypeScript harness for the
Accounts UX at ReviewRouter baseline
`f4839fe0ca2329ca54fb3482138a3770a73bc5fc`. It launches the actual Next.js web
application, uses the checked-in Prisma migration runner, creates synthetic
users/identities/workspaces and source/binding fixtures, and drives Chromium
through the real DOM.

The harness adds no production login, session, auth, or provider bypass. It
generates a fresh fixture-only `AUTH_SECRET` and uses `next-auth/jwt` `encode`
to construct cookies for the exact source tuples the application's real
`auth-options.ts` and dashboard session reader map. It never reads a real
session or credential.

## Fixture boundary

- TEST database name: `review_router_accounts_reference_e2e_test`.
- Exact fixture IDs are declared in `src/contracts.ts`. They include the
  `rr-e2e-user-*`, `rr-e2e-ws-*`, `rr-e2e-source-*`, `rr-e2e-account-*`, and
  `rr-e2e-binding-*` families.
- The local database mode is an isolated PGlite data directory exposed only on
  `127.0.0.1`, migrated with
  `packages/platform/db/scripts/migrate-deploy.mjs`. It is suitable for harness
  development only because PGlite reports its internal database name as
  `postgres`.
- The orchestrator database mode accepts only an explicit loopback URL whose
  path is exactly `/review_router_accounts_reference_e2e_test`. The database
  must already exist and contain zero public tables and no `_prisma_migrations`
  table. The harness never falls back to `DATABASE_URL`, `TEST_DATABASE_URL`, a
  shared cluster, or production state.
- Gateway reads and binding-fence acknowledgements use the existing
  `REVIEW_ROUTER_ACCOUNT_GATEWAY_*_ORIGIN` and `*_TOKEN` configuration seams
  against an isolated loopback fixture. No GitHub/GitLab/provider API is
  called. The test context aborts and records any external request.
- These Gateway/network fixtures support UI/read contract and server
  authorization testing only. They do **not** prove native suspend, resume,
  credential erasure, transport cleanup, or lifecycle safety. Those assertions
  remain in the separate lifecycle integration lane.

## Prerequisites

- The repository-supported Node.js version and pnpm 11.28.7.
- The repository root dependencies installed without changing the root
  lockfile.
- Chromium installed to the owned cache path below. Linux environments that
  Playwright does not officially recognize may use its fallback build.
- For the orchestrator mode, PostgreSQL 17+ listening only on loopback and a
  freshly provisioned empty database with the exact TEST name. The repository
  migration runner rejects older PostgreSQL versions.
- Permission to bind and connect to isolated loopback sockets for PostgreSQL,
  the Gateway fixture, Next.js, and Chromium. If the execution sandbox blocks
  loopback, run the exact command in the project CI/runner that permits the
  designated TEST ports; do not weaken auth or replace the real browser run.

## Install and typecheck

The harness owns its lockfile and a separate pnpm workspace. Its build policy
approves only the locked `esbuild@0.28.2` and `sharp@0.34.5` lifecycle scripts;
these permissions do not extend to the application workspace. Do not pass
`--ignore-workspace`: pnpm would also ignore this local build policy.

Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --dir scripts/accounts-reference-e2e install --frozen-lockfile
export TMPDIR="$PWD/tmp/accounts-reference-e2e/tmp"
export PLAYWRIGHT_BROWSERS_PATH="$PWD/tmp/accounts-reference-e2e/browser-cache"
mkdir -p "$TMPDIR" "$PLAYWRIGHT_BROWSERS_PATH"
pnpm --dir scripts/accounts-reference-e2e exec playwright install chromium
pnpm --dir scripts/accounts-reference-e2e run check
pnpm --dir scripts/accounts-reference-e2e exec playwright test -c playwright.config.ts --list
```

These commands install only inside `scripts/accounts-reference-e2e/` and cache
only inside the repository-owned `tmp/`. They do not update the root lockfile.

## Local isolated run

For the Model page connection test, add `--probe-fixture` and set
`ACCOUNTS_REFERENCE_E2E_GREP='Gateway connection test'`. This opt-in lane drives
the actual form, signed session, migrated database, authorization, SDK HTTP
preparation/request/close and streamed progress through an isolated Gateway
fixture. It checks shared-account consumption, desktop/mobile rendering,
generation failure, cancellation, stale viewer context and cross-site denial.
The fixture supplies synthetic model SSE; this is transport/UI E2E evidence,
not a live sub2api/model-provider availability claim. The product button sends
one real provider request and consumes account quota.

This starts a fresh PGlite fixture, migrates it, starts the fixture Gateway and
actual Next app on fresh loopback ports, then runs the browser suite:

```bash
export TMPDIR="$PWD/tmp/accounts-reference-e2e/tmp"
export PLAYWRIGHT_BROWSERS_PATH="$PWD/tmp/accounts-reference-e2e/browser-cache"
pnpm --dir scripts/accounts-reference-e2e run e2e -- \
  --repo-root "$PWD" \
  --isolated-pglite \
  --work-dir "$PWD/tmp/accounts-reference-e2e/runs/local"
```

Use `--bootstrap-only` after `--work-dir ...` to verify migration, fixtures,
Next health, signed-out redirect, and generated-session access without running
the acceptance browser assertions.

## Orchestrator run against the integrated candidate

Provision a new database as the designated TEST database, then pass its URL
explicitly. The example deliberately does not use a production environment
fallback:

```bash
export TMPDIR="$PWD/tmp/accounts-reference-e2e/tmp"
export PLAYWRIGHT_BROWSERS_PATH="$PWD/tmp/accounts-reference-e2e/browser-cache"
export ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL='postgresql://test_role:fixture_password@127.0.0.1:55432/review_router_accounts_reference_e2e_test?schema=public'
pnpm --dir scripts/accounts-reference-e2e run e2e -- \
  --repo-root "$PWD" \
  --database-url "$ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL" \
  --lifecycle-fixture \
  --expected-revision f4839fe0ca2329ca54fb3482138a3770a73bc5fc \
  --work-dir "$PWD/tmp/accounts-reference-e2e/runs/candidate"
```

For an integrated candidate, keep `--expected-revision` at the baseline above
to record the comparison, or pass the candidate revision to make the expected
revision explicit. Revision mismatch is reported, not silently treated as a
browser pass.

## Exit behavior and artifacts

- Exit `0`: harness boot and all browser assertions passed.
- Exit `2`: harness booted but one or more acceptance assertions failed. This
  is expected on the baseline, which predates the accepted Accounts UX patch.
- Exit `1`: setup, migration, fixture, auth, app launch, or harness execution
  failed. This is not a browser acceptance result.
- `result.json`: no-secret summary with revision, database mode, resources,
  fixture boundary, boot state, and test counts.
- `runtime.json`, `boot-report.json`, `migrations.log`, `next-app.log`, and
  `gateway-requests.jsonl`: diagnostics. Tokens, JWTs, auth secrets, and
  database URLs are not written.
- On browser failure Playwright retains a trace and screenshot in the harness
  output. No video is recorded.

## Expected baseline failures and final integration assertions

The boot/auth/fixture-isolation test should pass wherever isolated loopback is
allowed. Do not claim a browser acceptance pass from that result. The baseline
is expected to fail at least these acceptance tests until the accepted UX is
integrated:

- organization combined rows use `you`/neutral owner handle/avatar semantics
  without provider names in owner/avatar accessibility text;
- the access action is named and behaves as `Доступ`, including a `Закрыть`
  action; literal open/close sends no POST, using authenticated GET read adapters;
- one source exposes both organization grants and removing one grant preserves
  the other grant and the source;
- sticky geometry removes the duplicate sidebar Current workspace/avatar/
  install/repo-count block and satisfies the four viewport/zoom samples;
- a real server-capable suspended source exposes only `Enable`, while a legacy
  disabled source exposes neither `Enable` nor repeated disable actions.

The personal one-row/source isolation and session cache-switch assertions may
also fail if integrated UI grouping changes their semantic DOM. Use the role,
name, heading, tab, dialog, article, and source-label identities already
exposed by production code; do not add test IDs or production hooks.

Final integration must run the entire command above against the integrated
candidate. Native suspend/resume/erasure and production credential lifecycle
proof must be supplied by the separate lifecycle integration lane, not this
fixture-backed UI/read harness.

## Integrated verifier notes

Use actual PostgreSQL 17 for acceptance. When shared-cluster authority roles make
fresh migration rehearsal unavailable, `--restored-empty-baseline` accepts only
the exact TEST database, zero users and sources, and the complete 133/134 migration
roster with every checksum and finished state matching this checkout. Restore
schema and migration records only, with no source fixture rows. This mode is
schema-restore evidence, **not** fresh migration rehearsal. `--resume-own-fixtures`
requires the exact three declared synthetic users and exact TEST database; it
preserves prior fixture effects and skips migration and seed. Preserve a full
post-run dump before any explicitly authorized reset of this disposable database.

The seed includes donor admin membership and original applied attach journals
for personal grants; these are required product authorization invariants. Journal
IDs and intent hashes are created by the checked-out policy functions. A successful
revoke assertion checks persisted A=revoked, B=active and unchanged source owner,
state and Gateway mapping. The organization test actually removes the donor role,
refreshes to check concealment, then restores only that synthetic membership.

`--lifecycle-fixture` requires the integrated 134-schema/SDK/server/UI candidate.
It enables the existing RR gate and advertises v2 capabilities through the
loopback fixture. Synthetic `resumeCustody: verified` is a **wire-contract fixture**,
not native attestation evidence. The browser checks truthful action exposure and
confirmation cancellation; native effects remain separately qualified.

Next runs with the repository's webpack extension aliases because Turbopack does
not resolve its existing `.js` source imports. The harness refuses live dotenv
files in either the repository root or app directory. NextAuth 4 fixture JWTs use
its default empty salt; boot verifies own source HTML, not merely HTTP 200.

All screenshots, traces, browser request logs and geometry receipts live under
the run directory in `tmp/`. Browser logs record method/origin/path, never request
bodies, cookies or auth headers. All non-loopback browser requests are blocked.
The 200% sample emulates browser layout using a 640x400 CSS viewport at DPR 2,
rendering a 1280x800 screenshot; CSS `zoom` stress is separate and does not emulate
browser breakpoint changes. `ACCOUNTS_REFERENCE_E2E_GREP` selects a bounded failed
scenario for follow-up without replaying successful mutation tests.

## Review Skills integration lane

`--skills-fixture` extends this same real Next/session/database harness with 61
synthetic Skills, 125 source repositories, two destination repositories, and a
repository-only GitHub writer. It starts a separate loopback GitHub App HTTP
fixture. That fixture verifies the signed App JWT before minting its synthetic
installation token, then returns exact collaborator identity and `write`
permission facts only for the declared repository. The application still runs
its ordinary session, live permission guard, feature service, and PostgreSQL
transaction. Workspace-admin shortcuts cannot prove the writer scenario.

The fixture transport is restricted to development, the explicit Skills E2E
flag, the exact TEST database name, and loopback database/API hosts. Production
configuration cannot activate it. A qualification-only Node preload prevents
existing catalog fetches from leaving loopback; no live OAuth, SCM, or model
provider is involved. Skills content and assignments use real persistence, not
an HTTP fixture or an in-memory substitute.

Run against a **fresh isolated PostgreSQL 17+ cluster** with the exact TEST
database. Existing cluster-level release authority roles affect historical
migration ownership requirements; use the project's separate disposable cluster
rather than altering production migrations or weakening their guards.

```bash
ACCOUNTS_REFERENCE_E2E_GREP='Skills real Next' \
  node --import ./scripts/accounts-reference-e2e/node_modules/tsx/dist/loader.mjs \
  scripts/accounts-reference-e2e/src/run.ts \
  --repo-root "$PWD" \
  --database-url 'postgresql://test_user@127.0.0.1:55442/review_router_accounts_reference_e2e_test?schema=public' \
  --work-dir "$PWD/tmp/accounts-reference-e2e/runs/skills" \
  --skills-fixture
```

The ten browser scenarios cover real creation and explicit Save, mobile navigation,
keyboard focus trapping and return, dirty-close cancellation, a maximum-size
text-only SKILL.md export/import round trip with exact Markdown whitespace,
concurrent-editor CAS conflicts with retained draft and explicit reconciliation,
a genuine server-action replay by a different current source admin, all 125
current repository IDs with mixed assignment counts, skill pagination and search
selection, empty-bulk creation retaining exact repositories even with 51 matching
name prefixes, additive Add/Remove, the explicit 1001-target rejection, a committed
Apply whose response is deliberately lost and then retried with the same delta,
canonical cross-workspace linking, author edits opened from a linked name with
source and destination library refresh, separate grant and destination acceptance,
revocation and unlink, local usage isolation, and the repository-only writer
removing a revoked dependency without seeing subsequent source changes. Single
repository checks exercise invalid and valid path scopes, two-editor scope CAS
reconciliation, repeated Add preserving existing scopes, and persisted Git-root
opt-in/out. Destination admins also remove an unavailable assignment from an
inactive repository and unlink its generic workspace row without source metadata.

The lane captures populated library and bulk-dialog screenshots on desktop and
at a 390×844 mobile viewport under its `browser-artifacts/` directory. Synthetic
fixtures use UTC explicitly. A narrow fixture-only `RepositoryConnection`
privilege grant reproduces the canonical schema owner's existing production
access for the row-lock helper; it gives the web role no additional authority.

`skills-github-requests.json` records only HTTP methods and paths, proving the App
token and collaborator permission transport was exercised. Cookies, JWTs, private
keys, request bodies, and database credentials are not printed by the harness.
Use `--resume-own-fixtures` only for bounded follow-up against this exact synthetic
fixture family; the final full lane should use fresh checked-in migrations.

The `Skills browser acceptance` GitHub workflow runs this same lane on a dedicated
hosted Ubuntu ARM64 runner with a fresh, digest-pinned PostgreSQL 17 service and the harness's
locked Chromium. It checks out the PR head explicitly, requires an unchanged
source tree, and verifies an exact-head receipt with all 23 scenarios passing
(the ten integration cases above plus thirteen UX resilience cases), zero
failures, and zero skips. The workflow retains logs, receipts, screenshots, and
failure traces as `skills-browser-<run-id>-<attempt>` artifacts for desktop/mobile
visual review. It uses only generated fixture authority and does not call live
SCM or model providers. The same workflow can be started with `workflow_dispatch`.

If the pinned Playwright browser download is unavailable, the existing
`--browser-executable /absolute/path/to/chromium` option now reaches the actual
Playwright launch configuration. Record the executable version and package pin
in evidence; never count a missing browser as a pass. The implementation run used
Chromium 153.0.8010.0 from the exact `@sparticuz/chromium@153.0.0` npm archive because
the default Playwright 1.64.1 Chromium archive returned a zero-length invalid ZIP.
That temporary browser package is stored under `tmp/` and is not a production or
workspace dependency.

## Public model catalogs

Use `ACCOUNTS_REFERENCE_E2E_GREP='public catalogs'` and `--catalog-fixture`
for the public catalog scenario. This opt-in mode enables the existing rotating
OAuth feature flag and preloads a harness-only HTTP fixture for the two fixed
public catalog URLs. The actual server composition, normalization and cache run
unchanged. The browser verifies all three vendors, native IDs, manual refresh,
cooldown, preserved selection, row removal and absence of automatic inference.
No provider credentials or external requests are needed.

Subscription connections use `--subscription-fixture` with
`ACCOUNTS_REFERENCE_E2E_GREP='subscription connections'`. This opt-in serves
qualified Kimi/GLM/MiniMax/Grok metadata, key/OAuth operations and cached v2 limits
from the existing loopback Gateway fixture. It exercises real RR SSR, session,
canonical storage, server actions and the installed SDK. The single xAI browser
authorization document is intercepted and fulfilled with synthetic HTML showing
one plain authorization code. The test pastes that code after reload and again
for reconnect; no provider network request is made. Synthetic subscription keys
and authorization codes are test data. This does not prove live provider eligibility, native transport,
refresh, credentials or actual subscription quota; those require the separate
native/Gateway/Codex qualification.
The controlled case also reconnects the same Grok account and removes it through
real RR lifecycle controls. Gateway retirement counters/closure are synthetic
fixtures; native erasure and transport closure require the separate native proof.
Use an explicit `--repo-root` when launching via `pnpm --dir` because the harness
has its own workspace file. `--browser-executable` is forwarded to Playwright.

For the account-scoped Codex catalog, run the current Providers edit/add flow
against the real Next app, session, PostgreSQL and installed Gateway SDK:

```bash
ACCOUNTS_REFERENCE_E2E_GREP='dynamic Codex account models' \
pnpm --dir scripts/accounts-reference-e2e run e2e -- \
  --repo-root "$PWD" --isolated-pglite --account-models-fixture \
  --work-dir "$PWD/tmp/accounts-reference-e2e/runs/codex-account-models"
```

The opt-in fixture advertises two authorized accounts with the same Codex
profile and different model catalogs through `POST /v1/account-models/read`.
It seeds the current provider registry with a historical saved model. The
browser verifies that the model remains visible, discovers an unseen model,
rejects a stale model now offered only by the other account, refreshes only the
selected account, saves its refreshed model, and adds the second account's
model. This is an HTTP dependency fixture, not a live Codex/native proof.
Use the existing explicit `--database-url` and `--browser-executable` options
where PostgreSQL or a preinstalled Chromium is required.
