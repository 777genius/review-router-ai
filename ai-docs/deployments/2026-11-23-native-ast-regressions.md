# Native AST regression repair: delivery

- Task ID: `2026-11-23-native-ast-regressions`.
- Goal: the native architecture/layout checks preserve transaction rejection and
  source import edges in the required CI route.
- Affected targets: development tooling and CI; no database or runtime activation.
- Implementation: branch `fix/ci-native-ast-regressions-20261123`; PR pending.
- Source parent: `b0e9985359b8c0041d4f6ce95a90eeb09578378d`, not shipping evidence.
- Dependencies: #977/#980/#982/#985 parser stack and #983 compatible root tooling.
- Last updated: 2026-11-23.

## Environment status

Required CI installation and execution are pending. No current-source successful
qualification, merged repair or installed final source is claimed. Application
staging/production activation is not part of this tooling-only slice.

## Applicability and ordered delivery

1. Verify the exact source, native compiler/parser pins and complete parent stack.
2. Run the rejecting transaction fixtures, source layout assertions, strict
   tooling checks and existing architecture suite on that source.
3. Complete independent review and all required CI before the authorized merge.
4. Verify the checks on the resulting main SHA and the original goal's automatic
   publication paths. Record actual workflow runs and source identities here.

## Verification, retry and rollback

The defect reproductions must fail before repair and pass afterward; nearby
allowed cases must remain allowed. Queued, skipped or partial checks are not
qualification. A failed integration is repaired without dropping checks or
running a legacy TypeScript implementation. An ordinary reviewed code revert is
the rollback path; this change adds no migration or activation command.

## Related links

- [Plan](../plans/2026-11-23-native-ast-regressions.md).
- [Quality gates](../operations/03-quality-gates.md).
- [Release process](../operations/07-environments-and-release-management.md).

## Execution log

2026-11-23: exact parent source inspection established the two malformed regular
expressions. Implementation and native reproductions remain pending.
