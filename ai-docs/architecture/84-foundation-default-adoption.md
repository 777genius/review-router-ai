# Engineering Foundation: default-on adoption and legacy coverage

Status: the bounded source, agent-workflow and suppression adoption was merged in
PR #998. The full-root Markdown candidate in PR #1002 pins published Foundation
4.1.0; its exact-source consumer checks and required CI must pass before merge.
This tooling record does not claim product deployment or whole-workspace conformance.

## Scope and authority

- Engineering Foundation is a development-only policy tool; application runtime must not import it.
- Every developer/agent uses the same canonical checks: `pnpm check:changed`, `pnpm check:fast`, `pnpm check`. They do not replace complete pull-request CI.
- New feature packages are rejected by the independent architecture admission check in the combined [PR #998](https://github.com/777genius/review-router-ai/pull/998) unless they use the pinned Get Modular composition, include a conformance test, and declare Foundation source ownership.
- Current source-dependency profile remains the explicitly bounded v1 consumer scope in `architecture/foundation/provider-seams.yaml`. It is not a claim of all-workspace boundary conformance.

## Adopted capabilities from PR #998

| Capability                         | Default candidate | Boundary                                                                                                      |
| ---------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `architecture.source-dependencies` | Existing          | Explicit provider, memory and statistics ownership roots                                                      |
| `repository.agent-workflow`        | New               | Single AGENTS.md contract routed by CLAUDE.md, GEMINI.md and Copilot; changed/fast/full commands              |
| `quality.suppression-governance`   | New               | API, worker, Web server/features, platform, UI, shared, protocol and 37 eligible feature packages; no waivers |

Suppression roots exclude six existing feature packages with known legacy `eslint-disable` or `@ts-expect-error` directives: `codex-oauth-rotating`, `provider-setup`, `review-config`, `review-skills`, `review-statistics`, and `workflow-provisioning`. Their existing behavior is unchanged. Each package must be separately brought into the strict, time-bound waiver policy or have its suppression removed after targeted tests. Do not use general ESLint aliases as Foundation waivers: Foundation intentionally rejects them.

## Markdown adoption in PR #1002

The `documentation.local-references` candidate is delivered separately in
[PR #1002](https://github.com/777genius/review-router-ai/pull/1002). It was not
enabled by PR #998. Its complete roots remain `docs`, `ai-docs`, and `architecture`.

The immutable `docs/release-evidence/activation-catalog-policy-v29-schema-v5-independent-review.md`
contains historical absolute `/mnt/` references. Its provenance binds the exact
12,600 bytes with SHA-256
`7abaefccd0fa7771c6594824df794415801771f68f14bf0521d2d2461b360528`.
Foundation 3.1.0 rejected its 21 historical absolute references. The owner
authorized the necessary upstream policy and consumer qualification. Published
Foundation 4.1.0 includes that reviewed additive policy from
[Engineering Foundation #487](https://github.com/agent-teams-ai/engineering-foundation/pull/487).

The consumer's schema v2 declaration binds the exact artifact path, unchanged
raw digest and all 21 kind/location/target occurrences. Fully matching historical
references stay visible as informational diagnostics. A changed artifact,
missing or stale declaration, newly undeclared absolute occurrence or ordinary
broken reference still fails. The tool never resolves the historical absolute
targets. There are no exclusions, suppressions, local filtering wrappers or
automatic declaration refreshes.

This upgrades only the root development tool and its resolver-produced lockfile.
The bounded v1 source policy, agent workflow and suppression policy remain
adopted. The isolated WEB Host and review-skills consumers preserve their existing
package pins and profiles. Foundation 4's unrelated source-coverage v5 and
whole-workspace policies are not activated by this upgrade.

Acceptance requires the installed published CLI on the complete roots, a passing
report with exactly 21 historical informational diagnostics and no errors or
warnings, the existing rejecting immutable-evidence tests, the unchanged raw
artifact hash, and applicable required consumer CI. The artifact's provenance,
promotion contract and historical trust decision remain unchanged. Six ordinary
links to archived directories are repaired in maintained indexes; all 24 archived
images and the retained publication text keep their exact bytes.

## Required next phases before whole-workspace claim

1. Make current candidates green on the exact commit and preserve all existing CI/quality gates. Baseline failures are failures, not `skipped`/pass.
2. Qualify the pending Markdown capability without changing frozen evidence or reducing its intended roots.
3. Migrate the six remaining feature packages and remaining `apps/web/app` / scripts source deliberately, preserving their legitimate lint semantics.
4. Adopt source-coverage v5 only with its own reviewed topology/profile migration and consumer qualification; the root Foundation 4.1.0 pin alone does not adopt it. Retain the TS7 native toolchain.
5. Enable whole-workspace `workspace.dependency-declarations` only after the current non-catalog direct dependencies and vendor file pins have a qualified compatible policy. Do not fabricate a green contract.
6. Audit `repository.security-baseline` after dedicated dependency-review/SBOM workflow ownership and all permitted actions / privileged jobs are enumerated; the existing private workspaces are not publishable package baselines.
7. Adopt `quality.source-coverage` and other applicable capabilities with source topology and full consumer evidence. Public API compatibility and protobuf policies apply only when the repository owns those public release contracts.

## Safety

No feature flags, provider behavior, runtime dependencies, migrations, secret handling, or deployment changed. A newly proposed capability that cannot satisfy its declared contract remains pending; never weaken an existing gate or claim full adoption from an installed dependency. The canonical source ownership remains with ReviewRouter, not the Foundation library.
