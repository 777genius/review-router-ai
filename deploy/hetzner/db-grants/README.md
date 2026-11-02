# Hetzner database grants outside the canonical ACL

## Worker repository sync

`worker-repository-sync.sql` gives `reviewrouter_worker` column-level INSERT and UPDATE
on `RepositoryConnection`, limited to the columns the sync writes, and USAGE on the
inventory sequence. There is no table-level write privilege, and the worker cannot
update `id`, `githubRepositoryId` or `gitlabInstallationId`.

The identity column has one guarded UPDATE permission: the worker may complete
a first-time `scmRepositoryIdentityId` binding only when the identity already
declares the same connection and workspace. The existing migration 000133 guard
rejects retargeting, clearing and parent moves. The grant first verifies its exact
qualified body, trusted owner, search path and enabled complete trigger; it fails
before granting if these prerequisites drift. It does not replace a function,
alter activation trust roots or permit INSERT into the identity column.

Why it is a separate step: the release migration runner re-applies a canonical
runtime ACL after the schema migrations, and that ACL (and the verification that
follows it) makes `RepositoryConnection` read-only for api, web and worker. The
worker code still upserts repositories (`installation.sync_requested`). Without
the grant, every sync fails with `permission denied for table RepositoryConnection`
and ends in the dead letter queue. This happened in production from 2026-10-22 to
2026-10-31: no repository created after 2026-10-19 showed up in the dashboard.

The canonical ACL itself is unchanged on purpose. Its verification SQL is part of the
installed activation routines, whose body hash is a pinned trust root, so a change
there is a security decision of its own (see the tracking issue linked from the
rollout record).

Run it as the database owner after the ACL step of each release:

```bash
sudo -u reviewrouter_pg psql -h /var/lib/review-router-postgres/socket -p 5434 \
  -d review_router_dimy -X -f deploy/hetzner/db-grants/worker-repository-sync.sql
```

Then confirm with `node scripts/check-runtime-db-privileges.mjs` under the worker
role. Its seven checks include the specific identity UPDATE column, which an
any-column UPDATE probe cannot establish. It fails if a privilege is missing or
if recent events died with a permission error.

The post-ACL grant now installs a separate owner-controlled, SECURITY DEFINER,
BEFORE INSERT row guard. For the actual worker LOGIN, every inserted GitHub row
must bind to an existing GitHub installation **in the same workspace**, use
the matching GitHub repository ID and canonical source, and have no GitLab
installation or pre-bound SCM identity. The installation is row-locked during
validation to prevent a tenant-transfer race. The same post-ACL step revokes
all worker writes to `GitHubInstallation` (including independent column
privileges), so this LOGIN cannot forge, move, or delete the parent tenant
anchor. API-owned webhook writers are unaffected.
Missing, disabled, altered, or untrusted trigger/function metadata fails closed
before regranting INSERT.
The grant first commits a full table- **and column-level** worker INSERT/UPDATE
revoke, holding the activation advisory lock across the revoke and verification
transactions, so a previously granted worker cannot keep writes after a refused
re-verification. A failed post-ACL guard requires explicit operator repair.
Other roles retain their existing canonical ACL and sanctioned writer paths.
A disposable PG17 contract checks legitimate and adversarial INSERTs
using the real worker LOGIN, plus existing first-bind UPDATE and advisory locks.

This fixes the immediate cross-workspace INSERT hole but **does not** reconcile
the canonical ACL: that ACL still revokes worker write privileges on each
release. The existing release script must still apply this guarded grant
_after_ the canonical ACL, then qualify with the worker privilege checker.
The broader trust-root/canonical-ACL decision is still tracked in issue #761.
Do not treat merge or a passing disposable PG17 test as a production rollout.
