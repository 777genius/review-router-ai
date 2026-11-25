# Engineering Foundation: default-on adoption and legacy coverage

Status: implementation candidate; **not qualified or deployed**. Review and merge only after pinned Foundation 3.1.0 consumer checks, parser/lint, test, and full CI succeed.

## Scope and authority

- Engineering Foundation is a development-only policy tool; application runtime must not import it.
- Every developer/agent uses the same canonical checks: `pnpm check:changed`, `pnpm check:fast`, `pnpm check`. They do not replace complete pull-request CI.
- New feature packages are rejected by the independent architecture admission check in PR #1001 unless they use the pinned Get Modular composition, include a conformance test, and declare Foundation source ownership.
- Current source-dependency profile remains the explicitly bounded v1 consumer scope in `architecture/foundation/provider-seams.yaml`. It is not a claim of all-workspace boundary conformance.

## Activated candidates

| Capability | Default candidate | Boundary |
| --- | --- | --- |
| `architecture.source-dependencies` | Existing | Explicit provider, memory and statistics ownership roots |
| `repository.agent-workflow` | New | Single AGENTS.md contract routed by CLAUDE.md, GEMINI.md and Copilot; changed/fast/full commands |
| `documentation.local-references` | New | Markdown roots `docs`, `ai-docs`, `architecture`; validates local references and anchors |
| `quality.suppression-governance` | New | API, worker, Web server/features, platform, UI, shared, protocol and 37 eligible feature packages; no waivers |

Suppression roots exclude six existing feature packages with known legacy `eslint-disable` or `@ts-expect-error` directives: `codex-oauth-rotating`, `provider-setup`, `review-config`, `review-skills`, `review-statistics`, and `workflow-provisioning`. Their existing behavior is unchanged. Each package must be separately brought into the strict, time-bound waiver policy or have its suppression removed after targeted tests. Do not use general ESLint aliases as Foundation waivers: Foundation intentionally rejects them.

## Required next phases before whole-workspace claim

1. Make current candidates green on exact commit and preserve all existing CI/quality gates. Baseline failures are failures, not `skipped`/pass.
2. Migrate the six remaining feature packages and remaining `apps/web/app` / scripts source deliberately, preserving their legitimate lint semantics.
3. Upgrade Foundation 3.1.0 to the separately published 4.0.0 only with a reviewed lockfile and matching source-coverage v5 topology/profile migration; retain the TS7 native toolchain.
4. Enable whole-workspace `workspace.dependency-declarations` only after the current non-catalog direct dependencies and vendor file pins have a qualified compatible policy. Do not fabricate a green contract.
5. Audit `repository.security-baseline` after dedicated dependency-review/SBOM workflow ownership and all permitted actions / privileged jobs are enumerated; the existing private workspaces are not publishable package baselines.
6. Adopt `quality.source-coverage` and other applicable capabilities with source topology and full consumer evidence. Public API compatibility and protobuf policies apply only when the repository owns those public release contracts.

## Safety

No feature flags, provider behavior, runtime dependencies, migrations, secret handling, or deployment changed. If any candidate capability fails on legacy links or suppressions, fix or explicitly narrow the source contract; never weaken baseline CI or claim full adoption from an installed dependency. The canonical source ownership remains with ReviewRouter, not the Foundation library.
