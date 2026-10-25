# Provider setup visual qualification

Tooling for stage S7 of the
[provider registry plan](../plans/2026-10-23-provider-registry-and-unified-setup.md):
one command seeds a fixed workspace data set, starts the real web app, signs
in fixture users with real session cookies and captures every scenario at
390 and 1440 px (dialogs also at 900 px) in the light and dark themes. With
`--flows` it also drives the end-to-end flows and checks what the
review-config store holds afterwards. Source: `scripts/provider-setup-visual/`.

## What is real and what is a fixture

Real: the Next.js app (`next dev --webpack`), PostgreSQL 17 migrated with the
checked-in migrations, NextAuth session cookies signed with the run's own
secret, the dashboard's authorization and readiness code, and Chromium.
Provider profiles, selections, the workspace default and Access rights are
written only through the `review-config` use cases by the user who would make
the change (`seed.ts`); the other rows (users, workspaces, repositories,
setup workflow and secret facts) are plain Prisma writes.

Fixtures, inside the run only: a preload in the Next server
(`github-fixture.ts`) answers the GitHub REST calls the dashboard makes
(installation token, repository metadata, `collaborators/{user}/permission`,
organization plan, user repository discovery, the open setup pull request and
repository secret metadata) from the data set and fails every other external
request as offline. Which repository secrets exist is read on every request
from `github-state.json`, which the runner rewrites after each reseed (the
secrets of repositories whose setup is confirmed) and a flow extends when it
adds a secret; the public model catalog is
served by the existing `accounts-reference-e2e` catalog fixture. The browser
blocks every non-app request. There is no Account Gateway, so Gateway
providers never become ready. Secrets, private key and recovery witness are
generated per run; the user token encryption key is fixture-only.

## Data set

Declared once in `fixture-contract.ts`; the seed test
(`seed.postgres.test.ts`) proves the resolved states and that a rerun
rebuilds the same data.

- Users: `owner`, `admin`, `member`. The member's GitHub permission differs
  per repository (`maintain`, `write`, `read`); owner and admin hold `admin`.
- `Visual Main` (Access rights off, default = Claude Code CI secret by owner):
  repositories in every stepper state (`setup-pr`, `merge-setup-pr`,
  `needs-secret`, `ready`), one with its own Gateway provider created by the
  admin, one with a provider the member created while attaching it, one whose
  workflow was rendered for the default (workflow update required), a GitLab
  project and, with `--rotating`, a rotating Codex repository. Profiles of
  every credential kind: Gateway (organization and the admin's personal
  account), managed MiMo key (applied to one repository), hosted pool, user
  CI secret, rotating.
- `Visual Locked` (Access rights on, no default): one repository with an
  admin-attached Gateway provider, one without a selection.
- `Visual Empty`: no providers, no default, no managed key; every repository
  needs a provider selection.

The model catalog is the synthetic one of the catalog fixture, so real model
IDs show as "not in the current catalog" or "not in the list". With
`--rotating` the rotating Codex selection uses the deepest review depth, which
only the default Codex model supports, so a model edit of that provider is
refused naming the repository.

## Run on the hosted worker

Workspace on `workers-fsn1-01` (verify machine ID
`d856d40da5ad4e23b4f67773e5942842` first):
`/srv/workers/adhoc/iliya/rr-provider-setup-20261023/s7/` with the checkout in
`src/`, `logs/` and `out/`. Ports: PostgreSQL `35711`, app `35712`. The
directory's `run.sh` (shared pnpm on `PATH`, `PLAYWRIGHT_BROWSERS_PATH`, `cd
src`) and `pg.sh up|down` wrap the commands below.

```bash
cd /srv/workers/adhoc/iliya/rr-provider-setup-20261023/s7
export PATH="$PWD/../.tools/node_modules/.bin:$PATH" PLAYWRIGHT_BROWSERS_PATH="$PWD/browsers"
sudo -n docker run -d --rm --name TEST-rr-provider-s7-pg --label owner=iliya \
  -e POSTGRES_USER=fixture_owner -e POSTGRES_DB=reviewrouter_provider_setup_visual \
  -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:35711:5432 postgres:17.10
cd src
pnpm install --frozen-lockfile --store-dir /srv/workers/adhoc/iliya/.pnpm-store
node node_modules/playwright-core/cli.js install --only-shell chromium   # once
export PROVIDER_VISUAL_DATABASE_URL=postgresql://fixture_owner@127.0.0.1:35711/reviewrouter_provider_setup_visual
pnpm provider-setup:visual --out "$PWD/../out/<run>" --port 35712 --flows
pnpm provider-setup:visual --out "$PWD/../out/<run>-rotating" --port 35712 --rotating \
  --only '^(workspace-repositories|stepper-rotating|dialog-rotating-.*|providers-model-edit-refused)$'
```

`--only REGEX` selects scenario and flow IDs; `--flows-only` skips the
screenshots. `--no-personal-sharing` turns personal account sharing off,
leaves the provider over the admin's personal account out of the data set
and serves the Account Gateway profile catalog from a loopback fixture
(`gateway-catalog-fixture.ts`), so a Gateway selection validates; its flow
runs only in that variant:

```bash
pnpm provider-setup:visual --out "$PWD/../out/<run>-no-sharing" --port 35712 \
  --no-personal-sharing --flows-only --only '^flow-member-gateway-attach$'
```

The database guard accepts only a loopback URL whose database is
`reviewrouter_provider_setup_visual`. Each run
migrates it and, before every shot, removes the fixture rows by their fixed
IDs and seeds them again, so nothing a shot, a background refresh or an
earlier run changed leaks into the next shot. `pnpm provider-setup:visual:seed
[--rotating]` seeds without the app. Local `.env` files are refused because
Next would load them over the fixture environment. `next dev` rewrites
`apps/web/next-env.d.ts` in the checkout; leave that change out of commits.

The seed test needs a migrated database. A second database in the same
cluster fails migration `000079` (its roles are cluster-wide), so run it
against the visual database while no run is active:
`REVIEW_ROUTER_TEST_DATABASE_URL=$PROVIDER_VISUAL_DATABASE_URL pnpm exec vitest run scripts/provider-setup-visual/seed.postgres.test.ts`.

## Output

`out/<run>/screens/<scenario>--<user>--<width>--<theme>.png`,
`out/<run>/flows/<flow>--<step>.png` and `manifest.json`: revision, flags,
summary, flow summary, network summary (GitHub fixture calls, unhandled
GitHub paths, blocked hosts), one record per flow with each check, its
detail and screenshots, and one record per shot with
HTTP status, final path, heading, page and console errors, blocked browser
requests and `probe` facts (repository screens record each row's step pill
beside the contract's expected step and list the workspace's repositories the
page does not show). `seed.json`, `next-app.log`, `migrate.log` and
`network.jsonl` (method, origin and path only) sit beside it.

A shot is `suspect` when the page shows an error, redirected away, rendered
the wrong theme, threw a page error, raised a Next dev overlay issue or
overflows horizontally. A flow fails at its first failed check and keeps a
screenshot of every open page. Exit `0`: every runnable shot captured cleanly
and every flow passed; `2`: a shot failed or is suspect, or a flow failed;
`1`: setup failed. Shots assert nothing about the provider UI: look at them.

## Scenarios and flows

`scenarios.ts` lists the screens; a scenario's `prepare` opens the dialog or
list action through the shared locators of `ui.ts` (the shipped roles and
labels). `flows.ts` holds the end-to-end flows; each starts from a fresh seed
and checks both the page and the stored result. New data states go into
`fixture-contract.ts`; the seed and the seed test pick them up.

## Cleanup

```bash
sudo -n docker rm -f TEST-rr-provider-s7-pg   # the PostgreSQL container and its data
rm -rf out/<run>                              # screenshots and logs of a run
```

Ctrl-C or SIGTERM stops a run together with its Next process group (checked
on the worker). After a `kill -9` of the runner, stop the leftover server by
its port and process group, never by a name pattern that could match another
run's server:

```bash
pid=$(ss -ltnpH 'sport = :35712' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
[ -n "$pid" ] && kill -TERM -- "-$(ps -o pgid= -p "$pid" | tr -d ' ')"
```

The workspace directory itself expires with the plan's host lease.
