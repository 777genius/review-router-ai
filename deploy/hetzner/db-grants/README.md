# Hetzner database grants outside the canonical ACL

## Worker repository sync

`worker-repository-sync.sql` gives `reviewrouter_worker` INSERT and UPDATE on
`RepositoryConnection` and USAGE on the inventory sequence.

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
role. It fails if the privilege is missing or if recent events died with a
permission error.
