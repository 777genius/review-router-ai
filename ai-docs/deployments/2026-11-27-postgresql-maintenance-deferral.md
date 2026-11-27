# PostgreSQL automatic restart deferral

- Scope: production host needrestart service selection only; no ReviewRouter image, database schema, or apt upgrade policy change.
- Production: `pending` independent review and installation.
- Staging: `pending`.

On 2026-11-27 at 05:10:24 UTC needrestart, invoked by unattended upgrades, restarted PostgreSQL 17 ReviewRouter while a review was active. The database returned SQLSTATE 57P03 during shutdown and the review completed with gaps. The restart and the failed stream status/settlement were concurrent; the exact failing status or settlement operation was not recorded.

The narrowly scoped `deploy/hetzner/needrestart/90-reviewrouter-postgresql.conf` adds a default-selection override for `postgresql@17-reviewrouter.service`. Needrestart should report this service for deferred restart instead of restarting it automatically. Other services retain their existing selection and unattended package installation remains enabled. This does not prevent PostgreSQL package maintainer scripts, manual actions, failures or reboots from stopping PostgreSQL, nor does it provide high availability.

Before installation, independently review the exact host's needrestart version and effective existing overrides, and confirm the destination does not overwrite another operator's file. Test the installed selection against an isolated fixture. Install the reviewed file as root-owned mode 0644 only after the owner-authorized rollout. Confirm the effective override and that unattended upgrades remain enabled. Do not run an actual automatic restart as verification.

Package updates can leave PostgreSQL using old mapped libraries. Operators must inspect needrestart's deferred-service report after upgrades and arrange a bounded maintenance window: pause new ReviewRouter admission, allow active reviews and Gateway custody to drain, take and verify the normal backup when appropriate, restart PostgreSQL deliberately, verify its availability and the ReviewRouter fleet, then reopen admission. An overdue deferred security restart must be tracked to completion; the deferral is not a substitute for applying security updates. Do not stop in-flight work merely to test this setting.

Rollback: remove only the installed file after confirming its bytes match the reviewed version. This restores the previous needrestart selection and may again allow unattended restarts; schedule controlled maintenance first. Record the exact installed file hash, host, time and verification here and in the index.
