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
