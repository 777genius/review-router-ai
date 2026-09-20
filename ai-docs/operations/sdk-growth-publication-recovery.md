# SDK growth publication recovery

External activation is **HOLD**. The dependency-independent implementation is
not registered in the production worker. Activation requires the Lane A schema,
transaction-bound authority adapter, effect insertion, package exports and final
composition.

The publication effect has three nonterminal states: `ready`, `sending` and
`reconcile-required`. `applied`, `not-applied`, `superseded` and
`recovery-required` are terminal and cannot reopen automatically.

Each persisted attempt carries a monotonic reconciliation count. Every readback
result consumes one of 20 observations, including the immediate readback after
POST. An exact match or conflict terminates immediately; otherwise the twentieth
absent or unknown observation records its evidence and terminates as
`recovery-required`. Retries never reset the count or create a second attempt.

Each intent may start one provider mutation attempt. Persist the attempt before
POST. An acknowledgement, timeout, abort, elapsed time or empty readback does not
prove whether GitHub applied the mutation. Keep the same attempt and deterministic
external ID, traverse every check-run page with `filter=all`, and reconcile by
reading. Never issue a second POST for an uncertain attempt.

Terminal evidence is deliberately narrow:

- `applied` requires one exact normalized check observation.
- `not-applied` requires authenticated rejection or proven local pre-dispatch
  evidence that the provider mutation had no effect.
- `superseded` requires stale-authority evidence recorded before any attempt.
- duplicates, mismatches, partial reads and unresolved provider uncertainty stop
  in `recovery-required` when the reconciliation budget is exhausted.

Provider identity is numeric. The configured App, installation and repository IDs
must be canonical positive safe integers. The gateway derives the installation
from the Octokit installation-token authentication context and proves that the
repository appears in that credential's complete installation repository
inventory and requires the authenticated token's `checks: write` permission.
Check-run responses do not contain repository or installation
identity, so those identities are never invented on provider fixtures or read
from a check row. The row's numeric App ID must still match exactly. Slug, bot
login and display name never substitute for numeric identity. The check must also
match the repository locator, target SHA, reserved name, deterministic external
ID, completed status, conclusion, and complete normalized output, including
explicit `text` and `annotations_count` fields.

Every provider request uses one bounded call deadline. Abort signals are passed
inside Octokit's `request` options, and check creation disables automatic retry.
HTTP 408, aborts and ambiguous transport failures remain unknown and enter
readback reconciliation; they are never recorded as provider rejection.

The reserved check/status identity is `ReviewRouter / SDK growth authority`.
Generic check, status and compensation writers must reject it; compensation must
fetch and validate every target before mutating any target.
