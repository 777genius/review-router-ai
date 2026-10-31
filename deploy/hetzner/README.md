# Hetzner production release

`release.sh` ships a commit to the Hetzner production host in one command, without waiting for CI or a registry.
The image is built on the host from a `git archive` of the exact commit.

## When to use it

Use it for a normal application release (web, api, worker, skills scan) when the image changes, with or without a
database migration. For env-only changes use `fleet-overlay/` directly. For grants only, see `db-grants/`.

## Steps, in order

1. `build <sha>`: archive the commit, upload it, `docker build` on the host, check the image revision label.
2. `backup`: start a full pgBackRest backup and print the last backup entry.
3. `migrate <sha>`: `prisma migrate deploy`, then the canonical runtime ACL, then the worker repository sync grant.
4. `swap <sha>`: upload the fleet overlay, run `prepare` and `plan`. It only applies with `--apply`.
5. `verify <sha>`: container state, restart counts, revisions, and the API `/ready` check.

`all <sha> [--apply]` runs every step. Without `--apply` it stops after the plan and does not run `verify`.
A full 40-character lowercase hex sha is required.

```bash
RR_DRY_RUN=1 deploy/hetzner/release.sh all <sha> --apply   # print the commands, run nothing
deploy/hetzner/release.sh all <sha>                        # up to the plan
deploy/hetzner/release.sh swap <sha> --apply               # replace the fleet
deploy/hetzner/release.sh verify <sha>
```

Settings: `RR_HOST` (default is the production ssh target) and `RR_API_READY` (readiness URL).
Test the script with `bash deploy/hetzner/release.test.sh`; it uses stub ssh, scp, curl and git.

## What it does not do

- It does not touch the native Gateway engine. That swap is a separate procedure.
- The worker grant step is required after the ACL step, because the canonical ACL revokes the worker repository
  sync privilege. The `migrate` step runs both in that order. Do not run the ACL alone.
- It does not run the runtime privilege check for you. Run `scripts/check-runtime-db-privileges.mjs` under the
  worker role afterwards (see `deploy/self-hosted/README.md`).

## Rollback

`swap --apply` stops the old containers and keeps them, renamed `*-before-ovl-<ts>`. To roll back, stop the new
containers and start the saved `*-before-ovl-*` containers on the host (`docker start <name>`). Database
migrations are not reverted, so only ship migrations that the previous image can run against.

## Where build state lives

The source archive is created in a private temporary directory on your machine, its
sha256 is checked on the host before it is extracted, and build state (including the
image id that later steps read) is kept in `/srv/platform/projects/review-router/builds`,
owned by root with mode 0700. Later steps refuse to run if that directory is not
root-only.
