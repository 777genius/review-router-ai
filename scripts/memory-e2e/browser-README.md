# Memory dashboard browser qualification

`browser-qualify.ts` checks the paused Memory dashboard in a real Next development
server and Chromium. It uses the application's installed NextAuth JWT encoder,
then exercises the unchanged session callback, workspace membership authorization,
Prisma client, server components, and browser hydration. No OAuth provider or
memory engine needs to be running.

## Prerequisites and command

Install the repository's locked dependencies and generate the Prisma client. Use
a separately prepared, disposable PostgreSQL database with the current schema and
memory projection migration. The script only accepts the exact database name
`reviewrouter_memory_browser_test` on a loopback host, without URL query options.
The fixture connection must be able to create a temporary login role and grant
read access to the non-memory application tables.

Supply an installed Chromium executable. `playwright-core` does not download a
browser during dependency installation. The command refuses local development
dotenv files in the repository root or `apps/web`, so unrelated deployment
credentials cannot enter the fixture server. Do not run a second Next development
server against this checkout's `apps/web` output directory at the same time.

```sh
MEMORY_E2E_BROWSER_DATABASE_URL=postgresql://memory_test@127.0.0.1:55467/reviewrouter_memory_browser_test \
MEMORY_E2E_BROWSER_EXECUTABLE=/absolute/path/to/chromium \
pnpm memory:qualify-browser
```

For a portable Chromium distribution, pass its required `LD_LIBRARY_PATH` and
`FONTCONFIG_PATH` if applicable. Optional `MEMORY_E2E_OUTPUT_DIR` changes the
artifact parent; the default is ignored `tmp/memory-e2e/browser`. Every invocation
creates a separate run directory with `next-app.log`, `result.json` on success,
and six PNG screenshots. Authentication secrets, role passwords, and session
cookies are generated per run and are never included in the result JSON.

## Assertions

The harness creates only one synthetic user, external identity, workspace, and
owner membership. The actual application connects through its own temporary
read-only role. This role receives no privilege on any `Memory*` table; the
harness verifies that denial for every currently present memory table. It does
not change the privileges of the fixture owner or `PUBLIC`.

The complete route matrix runs at **1440×1000**, **900×1100**, and **390×844**:

| Route                                                                             | Purpose                                                  |
| --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `/dashboard?section=memory`                                                       | Current authenticated product entry point                |
| `memory_mode=knowledge`                                                           | Previously addressable knowledge view                    |
| `memory_mode=suggestions&memory_suggestion=stale`                                 | Previously addressable suggestions and selection         |
| `memory_mode=table&memory_item=stale`                                             | Previously addressable table and selection               |
| `/dashboard/memory-preview?memory_mode=suggestions&mode=table&scenario=populated` | Preview enabled explicitly with stale fixture parameters |

Every case requires an HTTP 200, the same visible static notice, no interactive
element inside that notice, no forms, and no horizontal page overflow. Browser
runtime errors, memory API requests, external browser requests, and application
database permission errors fail the qualification. Base-dashboard and preview
screenshots are captured at each viewport. Source hashes in the result identify
the exact UI and schema bytes checked; concurrent changes to those bytes fail
the run.

The browser, owned Next process group, synthetic records, and temporary role are
cleaned up when the script exits normally or fails an assertion. Logs and
screenshots remain available for inspection. If the entire process is forcibly
killed, inspect the uniquely named `memory_browser_*` role and
`memory-browser-*` records before manually removing that run's fixture.

## Evidence boundaries

This is a real browser and application integration check against a disposable
database. It runs Next in development mode with Webpack; it does not replace the
production build or qualify live Infinity behavior. The supplied database is
prepared separately, so a successful browser run does not prove the complete
historical migration chain. Database privilege denial makes memory reads and
writes unavailable to the fixture app; it is not a statement-level query trace.
The focused `dashboard-loading-boundaries.test.tsx` tests separately assert that
the Memory render path never calls memory dependencies, and
`actions-memory-pause.test.ts` verifies all twelve stale mutation entrypoints
preserve authorization and refuse effects.
