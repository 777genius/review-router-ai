# C2a binding policy fence handoff

The owned component is implemented and left as workspace edits. Qualification is
incomplete: actual PostgreSQL, generated Prisma, strict typechecks, formatter/lint,
focused Vitest catalog tests and independent exact-source review remain NOT_RUN.
The goal remains active. Do not integrate the component alone: the existing
production migration reader also needs the separate main-owned patch below.

Supplied base: `6cbcedd8f35eff280ab44b93012fdd5037d14437`. Observed HEAD is
UNVERIFIED. The single Git preflight failed because the linked worktree metadata
points to unavailable
`/srv/workers/jobs/review-router/account-gateway-v1/workspaces/source-c1-6cbcedd8-for-c2/.git/worktrees/binding-policy-fences-c2a`.
No Git index, commit, push or deployment operation was attempted. Before/after
hashes and a read-only integration guard are supplied; primary must prove the
exact base before applying either patch.

Contract53 was read and its complete bytes verified against the sole normative
SHA256 `66a2393e7a55f76df1a78281af44379d0b455a0770d82f34e587dcca284157b0`.
Source/check provenance is not assembled gateway/native/HTTP or E2E evidence.
Requested model lane is `gpt-6.1-sol/high/default`, NOFAST. No independent model
review ran here; primary owns exact-source xhigh/default review and controller
model/service-tier provenance.

The changes add independently stored `policyRevision` and expose the exact opaque
binding ID as `policySubject` alongside `bindingRevision`. Tuple validation bounds
both counters separately. No counter is reconstructed from the other. Existing
C1 revisions survive migration118 while the newly introduced policy version
starts at1; old revoked rows receive a retained fence intent for policy1.

Explicit revoke retains live workspace-admin authorization, workspace-only/XOR
ownership and snapshots of scope/revision/nested actor. Its existing connection
lock and binding CAS transaction increment each stored counter independently,
commit revoked state and one bounded pending operation/subject/required-version
intent together. The result explicitly says `local_denied` and `remote_pending`.
A fresh authorized grant preserves an outstanding fence. A later revoke replaces
it with a higher monotonic requirement; only that operation's actual durable ACK
can clear it. No paid-tier or operator-grant dependency is added.

The small consumer-owned delivery/repository ports and reconcile use case scan
1..100 pending rows per pass, with an explicit binding cursor and at most two
fence calls per row. They snapshot every page intent before delivery awaits,
submit/read back the same stable operation, and match applied operation, opaque
subject and required policy version exactly before bookkeeping CAS. Pending,
unknown, rejected, error and not_found/404 preserve pending status. A stale receipt
cannot clear a replacement. SDK authentication, HTTP validation and bounded
transport are later server composition; the port double proves only this honest
application boundary. There is no inference replay, scheduler or event table.

Migration118 replaces 117's guard in one table-locked SQL transaction. Identity
and guarded +1 transitions remain enforced; exact ACK-only changes leave state
and both counters unchanged. Grants cannot drop pending requirements or invent an
ACK. Intent/ACK shape, operation/subject bounds and positive integer constraints
are enforced. The migration does not update account mirrors/epochs, gateway
occupancy, spent allowances, credentials or transport state. Binding readback is
allowlisted; account mirrors remain display-only.

The actual PG suite retains all C1 SQL/auth/race/snapshot scenarios and adds:

- Bootstrap rows under actual117 SQL, proving independent backfill and ACK-only
  bookkeeping with different binding/policy versions.
- Actual application revoke, immediate local selection denial, atomic persisted
  exact intent, X/Y isolation and unchanged account mirror version/state.
- Wrong/stale/scope-invalid ACKs and raw SQL immutable/authority/negative/overflow
  failures, including grant attempts that drop outstanding requirements.
- Lost local ACK write, a new Prisma client and a separate scrubbed Node process
  reading the same retained operation from PostgreSQL.
- Actual authorized Prisma revoke queued ahead of actual stale Prisma ACK under
  a fixture row lock, with both blocking writers observed in pg_stat_activity.
- Higher pending replacement preserved across fresh grant, cleared only after
  its trusted applied response, unchanged ACK-only counters, no restoration on
  role regain and explicit fresh-authorized restoration.

Those scenarios are written, not PostgreSQL-qualified here. Gateway responses
remain deterministic boundary doubles; none proves remote HTTP/kernel/native
behavior. Native revoke, role-loss propagation, owner deletion, system-owned
server admission, settings/run pinning, fork/event/OIDC/config/UI/publication and
transport cleanup are later composition gates under53 sections5/6. No fake user
actor or blanket fork policy was introduced.

Observed checks on Node24.21.0:

- Two new tuple/validation tests against copied pre-edit domain: FAIL2/2 for
  behavioral assertions (missing independent policy tuple; accepted invalid
  storage values). See `before-policy-tests.log`.
- Two metadata-scope regressions against the prior C2a consumer: FAIL2/2.
  Extra pending metadata could override row identity or manufacture a matching
  subject/scope. Reconcile now copies only operation/subject/version primitives
  under the persisted row's binding/workspace scope. Wrong subject is rejected
  before I/O; unrelated metadata cannot redirect delivery or ACK. See
  `before-pending-scope-tests.log` and the guarded production-only reverse patch
  `pending-scope-production-baseline.patch`. The fresh-process readback fixture
  uses the same explicit allowlist.
- Final four-file Node focused command: PASS30/30, zero skips, retaining all16
  C1 auth/fixture cases. See `focused-tests.log`.
- TS/MTS syntax transformation: PASS23 files; JSON parsing and focused whitespace
  inspection pass. Syntax parsing is not a typecheck.
- Actual PG command without opt-in: SKIP1 root, zero database scenarios run.
  Actual PostgreSQL qualification is NOT_RUN. See `postgres-tests.log`.
- Feature typecheck and five-file Vitest command: NOT_RUN. The installed pnpm
  wrapper exits127 because pinned Corepack is missing; node_modules is absent.
  See `typecheck.log` and `catalog-tests.log`. No dependencies were installed.
- All116 preexisting SQL files through117 are SHA256 byte-identical. Removing
  only the six new binding columns exactly reconstructs the original full schema.
  The lockfile and dependency declarations are unchanged.

Run final focused policy/auth cases with:

```sh
node --import ./packages/features/provider-accounts/tests/register-source-loader.mjs \
  --test packages/features/provider-accounts/tests/use-cases.test.mts \
  packages/features/provider-accounts/tests/database-target.test.mts \
  packages/features/provider-accounts/tests/fences.test.mts \
  packages/features/provider-accounts/tests/binding-policy.test.mts
```

Primary supplies pinned dependencies, generates Prisma, and runs the package
`typecheck` (which includes the new strict TS/MTS test configuration), build,
formatter/lint and architecture checks. Then use a NEW EMPTY passwordless
loopback rr*gateway_test*\* database in a disposable PostgreSQL17.10 cluster,
with a synthetic migration-capable role. The existing fixture target and empty
DB guards remain intact; never reuse a populated fixture. Example public target:

```sh
RR_PROVIDER_ACCOUNTS_PG_TEST=1 RR_PROVIDER_ACCOUNTS_DISPOSABLE_CLUSTER=1 \
RR_PROVIDER_ACCOUNTS_PG_TEST_URL=postgresql://fixture_owner@127.0.0.1:5544/rr_gateway_test_c2a \
node --experimental-transform-types \
  --import ./packages/features/provider-accounts/tests/register-source-loader.mjs \
  --test packages/features/provider-accounts/tests/postgres.test.mts
```

There is one concrete ownership blocker. The authoritative existing production
reader is `scripts/lib/render-schema-handoff-policy.mjs`, which is outside the
explicit worker-owned paths. It hardcodes the previous116 checksum manifest.
The dynamic canonical scanner already sees117 files/latest118, but the untouched
reader rejects the new full checkout with `checkout_manifest`. Its source was
preserved. The separate guarded `main-owned-render-checkout.patch` adds only
exact current-checkout118 checksum/manifest admission. It preserves ALL old
manifests and managed92/89/76 authority. Owned tests preserve previous116 and
historical96 fixtures and cover the additional current tail. They require this
main-owned production patch before running.

The main-owned candidate was executed from an isolated copied SQL tree: full117
reads as117, managed reads as92, previous116 still partitions to92; changed118
bytes and missing predecessor are rejected. Managed76->89 and89->92 manifests
remain identical. This is bounded reader behavior evidence, not Vitest/PG/E2E.

SQL118 SHA256: `fe73ffe809b3c49b0739060e853e1a824ea6bf019a9922fccc8b729581db48db`.
Current117-file manifest:
`6bd2cd3c077f6cf56735c7192dd6e0f84a21bbec5a2657271cb5afaf1d2f20cf`.
Previous116 remains
`c5c0618f105799d06d21424433cec4a59fc052e63f594c2aace0657ebb52d1dd`.
The dynamic canonical catalog needed no source change. Review-execution real
store tests contain no current-checkout catalog entry, so they were preserved.

Evidence and guarded patch directory:
`/srv/worker-state/jobs/review-router/account-gateway-v1/jobs/review-router-account-gateway-v1-binding-policy-fences-c2a/tmp/agent/c2a-evidence/`.
Use `verify-patch.py BASE_CHECKOUT` before primary applies `component.patch` and
`main-owned-render-checkout.patch`; the guard performs read-only Git/head/index
lock checks, verifies every recorded preimage plus Contract53, checks absent new
paths and runs git apply --check for both together. It performs no integration
writes. Keep source diffs intact for the Project Integration controller.

Runtime limitations were reported without weakening isolation: linked Git
metadata is unavailable and pinned Corepack/dependencies are absent. External
Internet was not exercised; no network/provider, credential/secrets, install,
production or real-project runtime/agent test was performed. Initial command
startup stalled; an already running shell subsequently allowed source work and
focused checks. Existing CI is independent and its exact-head result was not
observed here. Qualification and review remain gates, not inferred successes.
