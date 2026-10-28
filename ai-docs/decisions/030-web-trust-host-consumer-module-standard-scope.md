# ADR-030: Consumer Module Standard Scope for the WEB Trust-Overlap Host Slice

## Status

Accepted, scoped. Decided 2026-10-11 under Root delegation for this one slice. This record is bounded
on purpose:

- Organization-wide adoption: not claimed.
- Node26 qualification: not claimed.
- Full product CI: not claimed.
- Physical installed qualification: never proven by CI. It rests on an operator-run read-only gate; its actual
  receipt is recorded under Decision item 5.

## Context

The WEB trust-overlap successor (a private Python Host transition, installed generation C11) and its
public configuration-only finished-context factory boundary reached `web-trust-finished`, native
`ready54`, operation `868258c2-9846-474b-8365-84fce37cc576`. The Host source and its installed
closure live on the private host, not in this repository. This repository carries the scoped decision,
a profile of pins and boundaries, and a deterministic check.

## Decision

1. The slice is the exact C11 Host transition plus the factory boundary
   `web-trust-finished-context-derivative`. It is classified as a Host-owned lifecycle transition and
   a sealed derived factory of a retained owner. Neither is a graph node, and no node is created for
   feature-local helpers.
2. Authority pins are fixed content pins, never a moving branch:
   - Consumer Module Standard `agent-teams-ai/get-modular` `docs/architecture/common-assembly.md#consumer-module-standard`
     at commit `4728b276b87378ca9d72a7be2b89a5fd49b97eea`, Git blob
     `20c281b3137f5d3c198250e9f8101c0ecd4cbc75`, 54680 bytes, full-document SHA-256
     `859fbca1e8a0c61b6ae873bea0057735a55b80230100e6e73a74de22e123165a`. The reviewed d612 to 4728
     delta is retained as history (diff SHA-256
     `f5da152530e6c0830afb9a26f93863347eed8f76e9067aee9442db2c6c0717b6`).
   - Feature Module Standard v1: blob `d0bfff2033faf544fe65268c1dcdfd524d093015`, SHA-256
     `851653f96643cf0466b67ab22963661976b00de44840fa3144a48a8c054f95fa`.
   - Engineering Quality Standard `agent-teams-ai/.github` `docs/engineering-quality-standard.md`
     at commit `66d6d3d2c2643edac414ded48c0ee0586774dd07`, blob
     `705f14cd5048e24b7d61e1d8102b86395d7b014d`, 18080 bytes, SHA-256
     `d55f9f498da213dfa7b14aeac5df5b2fcf37b2cfed4c63dd88b51bde6f56ebe8`. It is a reference pin;
     its wording is not copied into product policy.
3. The profile is `architecture/consumer-module-standard/web-trust-host-profile.json`. It records the
   delivery authority (release, root, control, installer, source manifest, bundle pins, loader, sealed
   manifest, startup record and the publication record sha `71b8009e45462de000502e3793e3ea1748de49b1df1aa0b92fe95fef99f15c22`,
   601 bytes, mode 0600), the declared boundaries, the factory identity rules, legacy `not-adopted`
   entries and an empty exception list.
4. Enforcement is the deterministic check, whose pure API is `scripts/check-web-host-cms-profile.ts` and whose
   unconditional process entry point is `scripts/check-web-host-cms-profile-cli.ts` (it always checks the
   repository it lives in; no root override), run by
   `pnpm architecture:check` (and therefore by the CI step `Architecture boundaries`) and available as
   `pnpm architecture:web-host-cms`. It rejects a wrong pin or hash, an undeclared boundary or governed
   path, a foreign or weakened factory identity, a pending or unsupported adoption claim, a mismatch
   between the profile and this record, and removal or no-op replacement of the hook.
5. The installed state is qualified separately and by an operator, with the installed gate named in
   the profile (`qualification.installedGate`). CI never reports it as proven.
   Recorded fact: the operator ran the read-only gate against the installed C11 owner on the ALT host and it
   returned `cms-delivery-gate-pass` for operation `868258c2-9846-474b-8365-84fce37cc576`, native
   `ready54`, standard commit `4728b276b87378ca9d72a7be2b89a5fd49b97eea`, with no runtime effects. The
   retained receipt has SHA-256 `121108083bc53d95d006b1d725952ba02c704c015c68b4d72917676c411a043a`; the
   profile keeps its reference, that hash and a finite projection using the receipt's own field names, and
   the deterministic check rejects any altered projection; the receipt body is not copied. The receipt itself reports
   adoption `pending` and whole-organization qualification false. It proves the installed closure matched
   the profile at the time of the run, not the live lifecycle row, other generations or Node26, and it is
   re-run for any new installed generation.
6. Execution facts (strict typecheck and test runs of this slice's TypeScript gate, their counts, tool
   versions and input hashes) are not recorded in this source: they live in immutable operator evidence,
   so the decision and profile never fingerprint their own execution. Such runs are focused checks only:
   not full-project strict, not the full product CI, not Node26 qualification.

## Consequences

- Adding Host source, a new boundary or a changed pin to this repository fails the check until the
  profile and this record are updated together.
- Assembly authoring gates (`profileId` roots, `checkNamespaces`, `scoped`, contract lint, row oracle)
  apply only if the slice later declares those elements; none is declared.
- A successor decision is needed to widen the scope, to follow a newer standard, or to count the
  installed gate as a blocking CI step.

References: [profile](../../architecture/consumer-module-standard/web-trust-host-profile.json),
[check](../../scripts/check-web-host-cms-profile.ts),
[entry point](../../scripts/check-web-host-cms-profile-cli.ts).
