# Unified OCR integration checkpoint — 2026-10-29

## Status: incomplete draft, not a deployment approval

The complete task is not finished. The control-plane merge candidate passed the
checks below, but that merged tree has not been committed to the feature branch.
The public Action still needs its main integration, regenerated paired contracts,
rebuilt committed bundles, and exact-pair acceptance. Live provider qualification
remains a separate owner-credential gate; it is not the only remaining gate.

- [Control-plane draft #718](https://github.com/777genius/review-router-ai/pull/718)
- [Public Action draft #346](https://github.com/777genius/review-router/pull/346)
- [Reviewed implementation plan](../plans/2026-10-26-unified-ocr-review.md)
- [Previous acceptance evidence](2026-10-27-unified-ocr-acceptance.md)
- [Deployment task](../deployments/2026-10-29-unified-ocr.md)

## Exact control-plane integration evidence

Source feature: `62c3d8f2235c94c4168cbd10a2ee191af13764b1`.
Main parent: `5551a572fce38aaa3453bbef1ff9af79d3c293de`.
Merge base: `d3595c2e3e0b21ab539dea0fb7a06d35a4613faf`.
Tested temporary tree: `d90737f5c5e02f08b5b3e823c1a38e0ad1d30a3c`.

[Integration run 40795383130](https://github.com/777genius/review-router-ai/actions/runs/40795383130)
passed source integration, locked dependency installation, formatting of the
resolved files, full architecture checks, `pnpm action:build`, type checks for
review-run-control, action-control-plane, API and web, and `pnpm protocol:check`.
Vitest reported **631 passed, 9 skipped, 0 failed** across 29 passing files and
one explicitly database-gated skipped file. These counts are not PostgreSQL or
new-browser acceptance. The skipped suite is
`prisma-review-run-control-real.test.ts`.

The job's overall conclusion is **failure**: after all code checks passed, its
final attempt to create a Git tree returned HTTP 403 (`Resource not accessible
by integration`). No branch ref, release tag, deployment, or customer workflow
was updated by that step. Do not call this a successful complete CI run or assume
its candidate tree is already installed in the branch. A subsequent attempt to
prepare the handoff was blocked; no claim of publication is made.

The exact source resolver and workflow remain recoverable from commit `62c3d8f`:

- `.github/ocr-recovery/merge-control.py` resolves the known exact-parent conflicts.
- `.github/workflows/unified-ocr-recovery-snapshot.yml` contains the two additional
  historical-test fixture corrections, formatting/build commands, and checked
  tree identity. Its repository-write handoff must not be used without the
  appropriate authorized execution surface.

The integration preserves main's workspace-scope reset and memory/Skills work,
while retaining runtime-compatibility readiness guards and the shared dispatch
allowance. It fixes the narrow OIDC export boundary without allowing wildcard
exports, returns explicitly validated domain fields rather than an unsafe cast,
and uses the existing locked subscription-runtime installer in the affected
qualification workflows.

The combined migration inventory contains 156 entries with manifest
`sha256:67de1583cf2ae194e7b6dd5cef021d08b60eb64988d516cb2adcbc2d01bbbda3`.
Historical managed92 and historical96 inventories remain unchanged. Exact
historical152 and main155 inputs retain their existing separate identities;
unknown, reordered, missing, duplicated, or modified SQL remains rejected.
Imported vendor patch bytes must not be reformatted to silence whitespace that
already exists in the main parent.

## Public Action follow-up

The pinned Action main is `056952b5a3d625fd1d19384942d452114804380f`; its actual
merge base with this feature is `dc0b3b340f911af7efcfb2f4fc3170fe304c349e`, not
the later main-only CI commit `a8cd9c5`.

The known production-runner conflict must retain both:

1. The feature's `scopedModelInvocations` wrapper, so OCR discovery cannot bypass
   its shared durable dispatch scope.
2. Main's `memoryAdmission: reviewMemory`, preserving admitted review-memory
   behavior rather than silently dropping it during integration.

Generated `dist/*` must be rebuilt; the curated public wrapper must be synced
from the exact committed, rebuilt SaaS revision with the existing sync script.
Regenerate protocol exports through the existing exporter, never by editing the
exported source or handoff digests manually. The existing temporary Action
resolver is recorded at `468a7836fffaeab09cd88f5c23bcc677339b93fc`.

## Additional OAuth correction

Action commit `dfa42d205b9ddd3c84f67dded35f75bce4b09dff` separates confirmed
rotation preservation from inference lifetime admission. Previously, a valid
short-lived access token could cause a newly rotated refresh token to be deleted
before encrypted writeback. Confirmed same-account rotation is now returned to
the existing writeback path; the prepared route still rejects insufficient
lifetime before model work. No OAuth retry, account fallback, or relaxed account
identity check was added.

Regression tests in `77d1157d1b8862cdab7c83f92386b73cee365165` cover short and
already-expired access tokens, preserve the rotated credential through the real
sealed-box format, and assert that inference is denied. Their fresh execution
is tracked by the read-only OAuth regression workflow on `d96b63d0bd392d2246c1373e9790ab8d2f691e19`.
This document does not predeclare its result.

## Remaining completion gates

Persist the reviewed, tested main integration through an authorized Git write
surface, preserving both parents and checking the remote head before updating.
Then finish the Action integration and exact SaaS-to-Action contract/bundle sync.
Run the complete exact-head checks and the permanent Unified OCR acceptance
workflow, including real Next rendering, disposable PostgreSQL, real managed OCR,
paired lifecycle scenarios, and fresh desktop/mobile visual inspection. Earlier
screenshots and the earlier 18/18 paired acceptance run are not evidence for the
new merged pair.

Remove only this task's temporary recovery workflows/helpers after preserving
its evidence. Update the deployment index once main's deployment registry is
present in the feature. Keep both PRs draft until the implementation gates pass.
Do not deploy, promote tags, activate production history, update customers, or
claim live subscription/provider compatibility before the separately authorized
final stage with test credentials and actual fleet evidence.
