# GitHub Action comment-create transport replay guard

- Task ID: `2026-11-05-action-comment-create-no-replay`
- Issue: [#816](https://github.com/777genius/review-router-ai/issues/816), follow-up audit of merged [#815](https://github.com/777genius/review-router-ai/pull/815).
- Implementation: [Draft PR #817](https://github.com/777genius/review-router-ai/pull/817), initial source/test HEAD `ba6d80c273c3f3e7d68ca075846b7eeadf6f8024`.
- Artifact qualification: [one-time pinned Action rebuild workflow #42029238379](https://github.com/777genius/review-router-ai/actions/runs/42029238379) (queued at record time; not accepted as passing evidence). Record the successful final exact-HEAD full CI run in PR #817 before merge; source commits must not retroactively claim checks on a different HEAD.
- Scope: prevent duplicate GitHub issue comments after an ambiguous create response. Preserve existing upsert marker, token custody and Action protocol. No migration, feature flag, new service or user-facing change.
- Affected artifact: `packages/features/codex-oauth-rotating/src/action/github-comment-publication.ts` and deterministic `action-dist/index.cjs`; the public Action channel is separately versioned.
- Release authority: source merge does not approve an Action tag, live workflow pin update, deployment or publication.

## Environment status

- Staging: `pending`. No deployed revision or verification evidence for this change.
- Production / public Action channel: `pending`. The currently installed version remains unverified for this change.
- Paired `777genius/review-router` distribution: `pending`; no tag or immutable ref is changed by this task.

## Preconditions and delivery

1. Run focused tests for lost response after committed create, retryable HTTP errors and the existing marker upsert, plus package typecheck, lint and formatting.
2. Build checked-in Action bundle under the pinned Node/pnpm toolchain and verify source/bundle parity and full exact-head CI/E2E.
3. If a release is separately authorized, reconcile this record with the [release process](../operations/07-environments-and-release-management.md) and the pending [Action ownership rollout](2026-11-05-action-runtime-ownership.md). Release only the selected immutable source/bundle pair with ordinary gates.
4. For an approved rollout, use an existing disposable GitHub App-first test repository to verify a successful comment publication, author identity and no duplicate on ambiguous network completion. Record installed immutable revisions and receipts.

## Retry and rollback

A failed publication with an uncertain network outcome must not be immediately replayed without checking the marker. If a rollout regresses, restore the previously verified immutable Action ref through the maintained release process. No data migration, secret rotation, or schema rollback is involved.

## Execution record

No staging or production rollout has been authorized or attempted. The implementation, CI evidence and eventual merge should be linked to the issue/PR; source merge alone is not a deployed status.
