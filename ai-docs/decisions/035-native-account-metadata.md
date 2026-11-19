# ADR-035: Native account information and scoped composition

Status: accepted for the bounded implementation. Date: 2026-11-19.

## Decision

Sub2API owns native email, subscription, credential dates, privacy and freshness.
Account Gateway provides the versioned safe account-info contract and replaceable
backend boundary. ReviewRouter owns membership, binding visibility and display.

One `account-metadata` feature within provider-accounts reads already-authorized
targets through a borrowed reader and rechecks live product authority after the
bounded batch. The host adapter positively projects the SDK fields. No provider
parsing, metadata database, recurring refresh or browser endpoint is added.

The [scoped profile](../../architecture/account-metadata/consumer-module-profile.json)
pins CMS, Module Authoring, FMS and Engineering Quality Standard to the reviewed
versions already used by Review History. The new feature has one descriptor,
declaration, implementation, group and root. The host invokes its `readMetadata`
API. Construction performs no SDK/SQL/authorization I/O and owns no resource.

The single metadata result is reused by `AccountView` and `AccountIdentity`.
Its application ports have no SDK, Prisma or React imports. A new account
aggregate or empty domain directory would not represent a new business rule.

The existing live source resolver is shared with limits. Its SQL and limits
semantics remain unchanged. Metadata is checked on the final hydrated account
array; per-detail checks alone do not cover a later selected-account await.
Facts never control readiness, model admission or permissions.

## Scope of the architecture claim

Foundation governs the new feature and shared SQL authorization adapter. The
existing RR source-boundary checker uses its TypeScript AST to enforce exact
public imports for the host service and SDK reader, with rejecting fixtures.
Foundation schema v1 cannot prove runtime export ownership in a package that also
contains test boundaries; moving all Web source to schema v2 would exceed this
scoped change. This split neither exempts governed sources nor labels runtime as
development. Existing lifecycle, limits and other features retain their current
adoption. Foundation and conformance remain development tools.

`metadata:architecture` checks real file layout and frozen profile identities.
`modular:qualify` includes real composition, independent wiring expectations and
wrong-root/binding rejection. `metadata:typecheck` uses TypeScript 7.0.2 with
`skipLibCheck: false`. Behavioral tests cover owner isolation, epochs, stalled
batches and final authorization; PostgreSQL/browser tests qualify the host path.

Provider additions extend native facts and qualified capabilities. They do not
add provider branches to this feature or duplicate the account management model.
