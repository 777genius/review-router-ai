# GitHub Action comment-create transport replay guard

## Current code/distribution reconciliation (2026-11-14)

PR #817 merged as `f40a92f07fb06555c11e753348a12ec80118457a`; GitHub ancestry comparison to prior installed source 287 is ahead 184/behind 0. The no-replay code is therefore included in the private signed 234/source Ebe installation, with ordinary source/bundle checks retained by the exact-main 234 CI 43558212571 and paired immutable public 234 qualification. Public 234 is published and fleet primary 234 is live; workflow-channel promotion passed, while ambiguous-write live qualification is not inferred. This task is not an absent-code instruction to redeploy the application or move a channel again. Source/artifact inclusion does not prove a live ambiguous-response network scenario: guard-specific live acceptance remains unclaimed, and an unknown GitHub write must never be replayed to manufacture that proof. Staging remains unverified. Earlier Draft/no-release statements below are historical, superseded only for the established source/distribution facts.

- Task ID: `2026-11-05-action-comment-create-no-replay`
- Issue: [#816](https://github.com/777genius/review-router-ai/issues/816), follow-up audit of merged [#815](https://github.com/777genius/review-router-ai/pull/815).
- Implementation: [Draft PR #817](https://github.com/777genius/review-router-ai/pull/817), initial source/test HEAD `ba6d80c273c3f3e7d68ca075846b7eeadf6f8024`.
- Artifact qualification: [one-time pinned Action rebuild workflow #42029238379](https://github.com/777genius/review-router-ai/actions/runs/42029238379) (queued at record time; not accepted as passing evidence). Record the successful final exact-HEAD full CI run in PR #817 before merge; source commits must not retroactively claim checks on a different HEAD.
- Scope: prevent duplicate GitHub issue comments after an ambiguous create response. Preserve existing upsert marker, token custody and Action protocol. No migration, feature flag, new service or user-facing change.
- Affected artifact: `packages/features/codex-oauth-rotating/src/action/github-comment-publication.ts` and deterministic `action-dist/index.cjs`; the public Action channel is separately versioned.
- Release authority: source merge does not approve an Action tag, live workflow pin update, deployment or publication.

## Environment status

- Staging: `pending`. No deployed revision or verification evidence for this change.
- Production / private code: `installed` in signed 234/source Ebe. Public guard-specific live qualification remains pending; current fleet primary 234 is live; workflow-channel promotion passed, while ambiguous-write live qualification is not inferred.
- Paired distribution: public 234 is published through the normal release; this record makes no additional tag/channel change.

## Preconditions and delivery

1. Run focused tests for lost response after committed create, retryable HTTP errors and the existing marker upsert, plus package typecheck, lint and formatting.
2. Build checked-in Action bundle under the pinned Node/pnpm toolchain and verify source/bundle parity and full exact-head CI/E2E.
3. If a release is separately authorized, reconcile this record with the [release process](../operations/07-environments-and-release-management.md) and the pending [Action ownership rollout](2026-11-05-action-runtime-ownership.md). Release only the selected immutable source/bundle pair with ordinary gates.
4. For an approved rollout, use an existing disposable GitHub App-first test repository to verify a successful comment publication, author identity and no duplicate on ambiguous network completion. Record installed immutable revisions and receipts.

## Retry and rollback

A failed publication with an uncertain network outcome must not be immediately replayed without checking the marker. If a rollout regresses, restore the previously verified immutable Action ref through the maintained release process. No data migration, secret rotation, or schema rollback is involved.

## Execution record

The initial source-only task did not authorize rollout. Later coherent delivery supersedes that historical hold for ordinary code installation; source ancestry does not establish live ambiguous-write acceptance. Preserve the actual source and release identities above.
