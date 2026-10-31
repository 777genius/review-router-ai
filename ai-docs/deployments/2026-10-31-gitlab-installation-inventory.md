# Atomic GitLab installation inventory: deployment

- Task ID: `2026-10-31-gitlab-installation-inventory`.
- Goal: Atomic GitLab installation inventory.
- Affected services: Web.
- Implementation: [PR #753](https://github.com/777genius/review-router-ai/pull/753); [plan](../plans/2026-10-31-gitlab-installation-inventory.md).
- Implementation reference: `dcd906400ecf4ed26c97a44f82621826a4eb952a` (reviewed baseline before remediation; the PR head is authoritative for later fixes, not proof of deployment).
- No schema migration, feature flag, manual activation or production secret changes are introduced.
- Last updated: `2026-10-31`.

## Environment status

| Environment | Status    | Installed release / image | Actual verification |
| ----------- | --------- | ------------------------- | ------------------- |
| staging     | `pending` | Not verified              | Not executed        |
| production  | `pending` | Not verified              | Not executed        |

`pending` means no verified deployment evidence is recorded, not observed absence.
This task does not authorize deployment.

## Ordered rollout

1. Inspect actual target versions and the installed-to-selected release range. Follow the [existing release runbook](../operations/07-environments-and-release-management.md) and reconcile earlier pending tasks.
2. Require exact selected-source type/format/architecture, build, test, relevant E2E, security review and mandatory CI gates. Real disposable PostgreSQL test runs in CI with GITLAB_INVENTORY_TEST_POSTGRES_ADMIN_URL and GITLAB_INVENTORY_REQUIRE_POSTGRES=1; check transaction rollback and ownership collision.
3. Deploy the authorized coherent Web build with the existing procedure. Replace coherent Web service build; verify DB advisory lock, cross-workspace owner guard, complete rollback and concurrent request ordering; preserve external GitLab changes and do not replay provisioning blindly.
4. Inspect normal health, error counters, retries, installation/session behavior and related downstream effects. Only after real verification, record installed commit/image, UTC timestamp, operator and durable evidence, then mark that environment `deployed`.

## Recovery and rollback

Use the [ordinary rollback process](../operations/07-environments-and-release-management.md#rollback).
If inventory persistence fails after GitLab provisioning, stop and inspect the
provider project settings, variables and setup merge requests alongside the
committed installation/repository rows. Compare each project with the failed
request's per-project result and retain timestamps and error evidence.

Only retry confirmed idempotent provider updates after checking their actual
values. Do not blindly repeat setup merge-request creation or other effects
that can create duplicates. Reconcile residual GitLab changes and existing
setup merge requests with the intended inventory before retrying; verify the
database transaction rolled back without partial ownership/deselection.
For an existing foreign ownership claim, require a support-led verification
of write authority and the current workspace owner before any manual release:
never reassign it automatically or disclose another tenant's identity.

Preserve persisted delivery/inventory/session facts. Never fabricate a successful
provider operation or replay an uncertain external effect. Verify compatible
rollback behavior against active sessions and the target fleet.

## Execution log

No rollout attempt or environment verification receipt is recorded.
