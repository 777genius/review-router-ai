# ADR-032: Review History ownership and scoped composition

Status: Accepted for the additive Review History implementation, 2026-10-28.

## Decision

Review History owns the compact, workspace-scoped logical-run ledger and its
asynchronous run/PR projections. Operational owners remain authoritative for
requests, executions, and publication. History captures compact facts in their
winning transactions and never decides publication or reads retained reports.

The new `packages/features/review-history/src` scope adopts the exact CMS and
authoring guide pins in
[`consumer-module-profile.json`](../../architecture/review-history/consumer-module-profile.json).
It maps FMS v1.1 roles to `domain`, `application/ports`, `adapters/outbound`,
`composition`, and tests. Only directories containing real files are created.
Private policy/SQL helpers remain static dependencies. One cohesive History
module publishes reader, projector, capture, and activation capabilities; its
single production root receives the host's borrowed Prisma client as a run input.
Existing asynchronous host startup constructs this root and passes closed ports
to existing synchronous constructors. There is no direct production fallback.

Hosts own database lifetime, worker loops, credentials, current session actors,
and activation. Construction performs no database or network I/O and creates no
resource manager. Capture activation is an explicit operator action after all
writers are ready. Repository disconnection and operational retention do not
delete history; original workspace ownership remains immutable.

The fixed API/worker/Web adapters listed by the profile translate existing
published language or render the History contract. They are not independently
replaceable graph nodes. Existing Statistics and WEB trust-host adoptions retain
their exact scope; this decision migrates no other feature or toolchain.

## Enforcement and limits

`pnpm history:architecture` checks the actual scoped files, pinned authorities,
production paths, commands and rejecting fixtures; Foundation enforces source
direction. `pnpm modular:qualify` typechecks the new root and runs genuine
conformance smoke, namespace and independent wiring-oracle checks. The profile
has no exceptions. New unowned modules, missing paths, drifted pins and disabled
commands fail. Tests and evidence are not a claim of production activation.

The accepted product and risk-based validation contract is
[the implementation plan](../plans/2026-10-28-review-history-implementation.md).
