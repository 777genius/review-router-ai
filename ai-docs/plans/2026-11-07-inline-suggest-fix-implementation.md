# Implementation slice: inline `/rr suggest fix`

Paired Action Draft PR: https://github.com/777genius/review-router/pull/374.

## Boundary

Same-repo selected qualified managed Gateway; only a direct reply to an App-verified finding. One bounded proposed replacement for one current RIGHT-side anchored line on the current PR HEAD. Human clicks Apply. **No file or branch mutation**. Model output is untrusted; deterministic validator checks exact source, changed diff hunk and single anchored RIGHT-side line before emitting a GitHub `suggestion` Markdown fence. Race/stale/unsupported/unsafe => safe no-suggestion answer. No new model or service.

## Minimal implementation

- Extend read-only command parser and same source verification/one-source read from `/rr fixed`, avoiding duplicated roles, private file policies or GitHub API adapters.
- At most one model invocation under existing source-revision/claim bound, selected account, provider quota and publication reservation.
- Reuse a narrow pure `RIGHT`-side hunk verifier and correct multiline suggestion fence. Validate SHA, single anchored line, nonempty and bounded code, stale HEAD, filename and path, no sensitive data.
- Real PostgreSQL/Gateway and GitHub inline rendering in disposable repo; zero auto-commits; no fabricated suggestion when no eligible line/provider.

## Stop conditions and risk

Do not modify persisted schema or PR review lifecycle. If an Action interface or release pin needs an update, it belongs in paired Action #374. This is a distinct PR whose review/merge follows the `fixed` baseline if the small source port is shared. Aim ~280–650 maintained LOC for the incremental slice; generated verifier/source stamps excluded.
