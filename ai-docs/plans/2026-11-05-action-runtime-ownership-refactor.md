# Critical foundation refactor — Action runtime ownership (Draft)

Date: 2026-11-05
Base: `abe7689025e79ea229ac44e449dbd3e6f8fa381b` (`main` at investigation)
Status: implementation in progress; all tests/CI and review evidence are **unverified** until separately recorded.

## Problem and evidence

ReviewRouter already uses feature packages, application ports and architecture checks. PR #810 has merged a large workflow-provisioning/publication ownership cleanup; do not repeat it. Open memory PR #806 is unrelated and must be left untouched.

The maintained GitHub Action entrypoint `packages/features/codex-oauth-rotating/src/action/github-action.ts` is **5,639 lines** and currently owns four unrelated low-level concerns as well as high-level review control:

1. HTTP retry, per-attempt abort and response-body cleanup (lines ~2698–2816). Numerous GitHub and control-plane operations depend on this contract.
2. Loopback Codex provider proxy (lines ~2834–3074), including nonce-route checking, request limits, selective header forwarding, streamed Responses usage observation and upstream cancellation. The proxy is a security boundary.
3. Process spawning and process-tree termination (lines ~5014–5306), redaction and capped output capture. This is a cleanup and secret-handling boundary.
4. Hosted account capacity/retry policy (lines ~1453–1540); it does not need access to the Action entrypoint and is distinct from GitHub transport.

The dashboard server actions and API production compositions are also large, but prior plans already moved feature decisions out of some of them. Size **alone** is not grounds for another generic facade or host extraction. This batch first removes four *specific* Action boundaries whose invariants are observable and testable without rewriting review protocol logic.

## Invariants to preserve

- External `github-action.ts` exports and Action runtime bundle behavior stay compatible.
- GitHub Actions/OIDC auth, pins, workflow ABI, prelease/finalization state and persisted data do not change.
- Proxy remains loopback-only, protected by unguessable path nonce, exact POST route, bounded requests/body, allowlisted forwarded headers and cancellation of active upstream work on close.
- HTTP policy preserves retryable statuses (408, 429, 5xx), per-attempt timeout, abort propagation, best-effort rejected-body disposal, bounded backoff and redacted public errors.
- Process policy preserves detached Unix process groups, captured descendants, SIGTERM/SIGKILL grace, timeout/abort cleanup, capped output and streaming log redaction.
- Hosted failover preserves explicit max-attempt bound, deadline budget, causal error and quota/auth classifications. No new retry beyond the existing bound.
- No new feature flags, generic services, DI container, database changes or release/deploy.

## Delivery plan, narrow by design

A. **Adapter boundaries**: move each of the four cohesive implementations into action-local modules. The Action entrypoint remains the orchestration/composition surface; compatibility exports and direct imports point to the single owners. Preserve unchanged logic before any behavioral refinement.

B. **Contract tests**: add focused tests for pure policy, network retry/abort and loopback limits/cleanup; retain existing comprehensive GitHub Action tests. Any discovered defect needs a discriminating regression first.

C. **Second debt slice**: inspect the still-large web dashboard action and API host compositions for *specific* feature decisions still owned by host. Only move a demonstrated owner, with targeted tests; reject cosmetic file splitting and avoid active PR files.

D. **Verification**: TypeScript build/typecheck, relevant vitest, Action artifact check, architecture boundaries and GitHub Actions on exact PR HEAD. Review the diff for import direction, security and behavioral equivalence; fix findings and recheck. Do not claim green gates without recorded evidence.

## Review lenses / falsification checklist

- **Security and trust**: can a re-export, proxy move, header policy or process log change expose credentials or permit extra remote authority?
- **Concurrency and failure semantics**: does abort during retry/backoff, streamed response cleanup, SIGTERM race, or quota failover change the observable outcome?
- **Architecture and scope**: is each extracted module a real owner with a stable caller, or just a new forwarding layer? Are there any reverse feature/infra imports, unnecessary new public API or circular runtime imports?
- **Test/compatibility**: do existing Action exports and bundled entrypoint still resolve with `.js` ESM imports, and are statuses/error strings stable?

Reject a finding if no concrete caller or failure mode exists. A moved line counts as changed diff but not new behavior. The requested ~10–15k changed lines is a **ceiling/target for worthwhile work**, not permission to inflate diff with formatting or migrations unrelated to these risks.

## Evidence journal

- Initial repository tree: 4,397 tracked blobs (includes generated assets), `apps/web/app/dashboard/actions.ts` ~4,007 LOC, `apps/api/src/review-action-v2-production-composition.ts` ~3,218 LOC, Action entrypoint ~5,639 LOC.
- `AGENTS.md`, maintained architecture guidance and previous plans read.
- PR #809 (quota runtime) merged, PR #810 (foundation ownership) merged; open #806 remains separate.
- Remote GitHub connector can write commits but the current sandbox cannot resolve github.com or run the pinned Node 26/pnpm 11 toolchain; validation must come from GitHub Actions. No claims of local E2E.

## Domain owner review — additional selected slice

Source audit on current `main`: `src/domain/codex-oauth-rotating.ts` is 3,292 lines and contains *both* OAuth/session/key material handling and approximately two thousand lines of canonical workflow rendering, YAML scanning, source attestation and Account Gateway workflow documents. These are distinct change axes: new workflow schema or branch permission rules should not require editing the OAuth/authentication/encryption owner.

A declaration-reference audit found an acyclic extraction boundary when the small shared workflow/action contract (schema/version constants, input patterns and safe Action references) is owned by `codex-contract.ts`, with `codex-workflow.ts` owning workflow construction/scanning/attestation, and the old domain path retained as a public facade. The OAuth/lease/secret implementation depends only on that contract; the workflow implementation never imports the OAuth implementation.

**Contract for this slice**:
- Move source *without changing parsing, schema values, YAML layout, action refs, exception strings, source hashes, canonical workflow attestation or workflow text*.
- Preserve all existing exports from `domain/codex-oauth-rotating`, including transitively via `src/index.ts`, and do not make internal regex/escaping helpers available through the existing facade.
- Keep domain modules free of Action/Next/Prisma/GitHub host dependencies; no runtime import cycles.
- Existing workflow-scanning and security tests must pass on the exact HEAD. Record the moved-versus-new line counts accurately.
- If import graph proves cyclic or CI is ambiguous, revert the slice rather than adding an abstraction container.

**Critic objections considered**: a mere one-file rename would not reduce coupling; reject it. The common contract must not grow into a service locator. This is one domain boundary extraction with two cohesive owners, not a proposed domain framework.

## Review/fix record — 2026-11-05

### Review pass 1 — static ownership, compatibility, concurrency

- Re-read GitHub PR #815 against exact `main` `abe7689025e79ea229ac44e449dbd3e6f8fa381b`; initial PR HEAD `61fc782fbf63fb67ae1bf22defc56d946a425119`, 19 changed files, 5,277 added and 4,485 deleted lines. No main divergence at that point.
- **Compatibility audit (symbol-level, not typecheck):** all 86 original named exported declarations from the Codex domain file remain represented by the old facade and its workflow/contract owners; all 36 original named GitHub Action exports remain represented in its facade/re-exports. This audit does not establish runtime ABI or TypeScript correctness.
- **Build-blocking import finding:** `github-action.ts` and `review-runtime-environment.ts` import `reviewThreadLifecycleResolveTokenEnvKey`, but its extracted owner had declared an unexported `const`. Fixed at `1263d3d3975a83889c53d940ff92f402b6a4b51f`; do not claim build green until CI runs.
- **Abort/concurrency finding:** after an HTTP 429/5xx or a network error, the old `sleep` backoff ignored caller abort until the next attempt. Fixed only the HTTP retry policy with an abort-aware, listener-cleaned wait at `89f630a2ffac61c297666053f43841e71c78709d`, and added two fake-timer regression cases at `ed43bea214a558b95969674d0c02d8a0a4faa4ed`.
- Consequently the initial **119/119 unchanged moved-function** claim applies to the original relocation at `61fc782` only. After the intentional HTTP retry improvement, **118/119** moved function bodies retain original semantics/text; `fetchWithRetry` is intentionally modified and must be covered by tests.
- Full CI on original `61fc782`: [run #41935346565](https://github.com/777genius/review-router-ai/actions/runs/41935346565), later superseded/cancelled for multiple jobs by newer pushes; individual completed success jobs do **not** validate later HEADs. Full CI on `1263d3d`: [run #41936521538](https://github.com/777genius/review-router-ai/actions/runs/41936521538), also superseded by subsequent commits. Full CI on `ed43bea`: [run #41936737362](https://github.com/777genius/review-router-ai/actions/runs/41936737362), jobs queued at inspection time; will be superseded by this plan update. Re-run the mandatory workflow on the final exact HEAD.

### Pending review pass 2 — evidence-driven falsification

- Confirm `pnpm` package typecheck, formatting/lint, static architecture and package tests on **exact HEAD**.
- Inspect the Action bundle artifact as well as integration/source-certification and GitHub-hosted/self-hosted E2E jobs; distinguish skipped/draft gates from actual success.
- Review secret/credential trust and process-tree/log cleanup under abort/timeout. Do not expand the diff for merely cosmetic decomposition; correct concrete regressions only.
- Record any failed steps and remediation with exact job IDs and links; leave PR Draft and do not merge/release.
