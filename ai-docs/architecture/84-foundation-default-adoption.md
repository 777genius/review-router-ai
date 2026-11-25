# Engineering Foundation: default-on adoption and legacy coverage

Status: implementation candidate; **not qualified or deployed**. Review and merge only after pinned Foundation 3.1.0 consumer checks, parser/lint, test, and full CI succeed.

## Scope and authority

- Engineering Foundation is a development-only policy tool; application runtime must not import it.
- Every developer/agent uses the same canonical checks: `pnpm check:changed`, `pnpm check:fast`, `pnpm check`. They do not replace complete pull-request CI.
- New feature packages are rejected by the independent architecture admission check in the combined [PR #998](https://github.com/777genius/review-router-ai/pull/998) unless they use the pinned Get Modular composition, include a conformance test, and declare Foundation source ownership.
- Current source-dependency profile remains the explicitly bounded v1 consumer scope in `architecture/foundation/provider-seams.yaml`. It is not a claim of all-workspace boundary conformance.

## Activated candidates in PR #998

| Capability                         | Default candidate | Boundary                                                                                                      |
| ---------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `architecture.source-dependencies` | Existing          | Explicit provider, memory and statistics ownership roots                                                      |
| `repository.agent-workflow`        | New               | Single AGENTS.md contract routed by CLAUDE.md, GEMINI.md and Copilot; changed/fast/full commands              |
| `quality.suppression-governance`   | New               | API, worker, Web server/features, platform, UI, shared, protocol and 37 eligible feature packages; no waivers |

Suppression roots exclude six existing feature packages with known legacy `eslint-disable` or `@ts-expect-error` directives: `codex-oauth-rotating`, `provider-setup`, `review-config`, `review-skills`, `review-statistics`, and `workflow-provisioning`. Their existing behavior is unchanged. Each package must be separately brought into the strict, time-bound waiver policy or have its suppression removed after targeted tests. Do not use general ESLint aliases as Foundation waivers: Foundation intentionally rejects them.

## Markdown adoption pending in PR #1002

The proposed `documentation.local-references` activation is retained separately in
[Draft PR #1002](https://github.com/777genius/review-router-ai/pull/1002). It is not
enabled by PR #998. Its intended roots remain `docs`, `ai-docs`, and `architecture`.

The immutable `docs/release-evidence/activation-catalog-policy-v29-schema-v5-independent-review.md`
contains historical absolute `/mnt/` references. Its provenance binds the exact
12,600 bytes with SHA-256
`7abaefccd0fa7771c6594824df794415801771f68f14bf0521d2d2461b360528`.
Foundation 3.1.0's native capability configuration provides directory roots and an
anchor profile, but no exact-file exception for this signed evidence. Source
inspection of 4.0.0 found the same limitation; an unqualified dependency upgrade
does not resolve it.

Preserve the evidence bytes, provenance checks, and full intended roots. Qualify
a compatible native policy before activating this candidate; do not rename the
artifact or remove governed documentation merely to obtain a passing check.
Editorial link repairs are independently deliverable in #998; they do not
establish complete capability acceptance. The remaining mechanism belongs to
Engineering Foundation. Its published 4.0.0 and current upstream
`fac03920e50ebde038ae415edeb7aa9e3d610ada` retain the same limitation. The open
choice is a bounded native policy for exact immutable evidence, qualified and
published before consumer adoption, or an explicit owner decision to defer this
activation. Neither choice is accepted by this record.

## Required next phases before whole-workspace claim

1. Make current candidates green on the exact commit and preserve all existing CI/quality gates. Baseline failures are failures, not `skipped`/pass.
2. Qualify the pending Markdown capability without changing frozen evidence or reducing its intended roots.
3. Migrate the six remaining feature packages and remaining `apps/web/app` / scripts source deliberately, preserving their legitimate lint semantics.
4. Upgrade Foundation 3.1.0 to the separately published 4.0.0 only with a reviewed lockfile and matching source-coverage v5 topology/profile migration; retain the TS7 native toolchain.
5. Enable whole-workspace `workspace.dependency-declarations` only after the current non-catalog direct dependencies and vendor file pins have a qualified compatible policy. Do not fabricate a green contract.
6. Audit `repository.security-baseline` after dedicated dependency-review/SBOM workflow ownership and all permitted actions / privileged jobs are enumerated; the existing private workspaces are not publishable package baselines.
7. Adopt `quality.source-coverage` and other applicable capabilities with source topology and full consumer evidence. Public API compatibility and protobuf policies apply only when the repository owns those public release contracts.

## Safety

No feature flags, provider behavior, runtime dependencies, migrations, secret handling, or deployment changed. A newly proposed capability that cannot satisfy its declared contract remains pending; never weaken an existing gate or claim full adoption from an installed dependency. The canonical source ownership remains with ReviewRouter, not the Foundation library.
