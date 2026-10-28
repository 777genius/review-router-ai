# Account/workspace deletion support command

This server-only command is an operator entrypoint, not a public API or UI action:
`apps/api/dist/workspace-account-delete-operator.js`. It requires migration127 and
the qualified SDK successor exposing `retirement` and `policyClosure`. The older
vendored SDK is not an execution fallback. Deliver those prerequisites through
the normal release before invoking this command.

Use the existing root-owned PostgreSQL operator holder and normal server-held
Gateway consumer-control credential. Do not use the API/web/worker DB role or an
execution/run-control bearer. Current production holder runs the normal pnpm
container as OS `reviewrouter_pg` UID993/GID983, mounts the existing PostgreSQL
socket read-only at `/run/rr-pg`, and uses peer authentication. It is not a new DB
role, credential, image or management grant. Root owns the invocation; no public
caller can supply the operator context.

Run `node --conditions=production apps/api/dist/workspace-account-delete-operator.js`
inside that maintained qualified holder. Supply one protected JSON document on
stdin through the existing root operator driver. Never put the Gateway token in
argv, terminal output, source control or browser storage. The document is capped
at32KiB and is not persisted by the command:

- `schemaVersion: 1`.
- `request`: `command` (`begin`, `read`, or `advance`), stable `operationId`, target
  `workspaceId`, and `expectedWorkspaceRevision` (required for begin/advance).
- `operator`: existing operator `workspaceId`, authenticated stable `userId`,
  `githubUserId`, and `githubLogin`. The command verifies the User join and the
  coordinator rechecks current operator admin/owner membership under lock.
- `postgres`: existing peer `socketDirectory`, `port`, `database`, `user`, and
  expected PostgreSQL `systemIdentifier`. No password. The command checks the
  actual session/current role, database/cluster and required table privileges
  before mutation. The current holder uses `/run/rr-pg`, port5434,
  `review_router_dimy`, `reviewrouter_pg`; deployment values are input, not built
  into deletion policy.
- `gateway`: existing normal SDK configuration with `role: "consumer-control"`,
  qualified `origin`, and its server-held `token`. Account/profile/owner scopes
  come from the stored RR target set and canonical owner namespace, not request
  overrides. Missing normal Gateway authority leaves the operation pending or
  refused; this command does not create a grant.

`begin` saves the immutable intent and denies new use. `read` reports its current
safe stage. Each `advance` performs one bounded fence/closure/retirement pass.
Repeat the same operation after a pending result with its returned current
workspace revision. There is no automatic loop, inference call or disable retry:
after a durable disable reservation, recovery only reads that original operation.
Changing a target, actor or original intent does not create a recovery shortcut.

A successful CLI exit means the command completed, not that deletion is complete.
Only `stage: "deleted"` follows complete policy closure and native credential
erasure. Retained UNKNOWN effects remain audit facts after actual transport
closure. Logical workspace tombstone retains IDs/history/FKs while removing
membership and repository selection. Do not interpret missing remote rows,
disable ACK, or an empty owner set as native closure/erasure proof.

The joined controlled Go/Node/PostgreSQL acceptance uses a separate disposable
fixture and does not prove production execution or apply migration127 there.
No production deletion is part of release qualification.
