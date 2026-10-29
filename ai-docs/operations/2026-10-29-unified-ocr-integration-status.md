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
prepare the handoff was blocked; no claim of publication is made. The blocked
operation was not retried through another transport.

The source resolver and workflow remain historical evidence in commit `62c3d8f`:

- `.github/ocr-recovery/merge-control.py` records the known exact-parent source
  resolutions.
- `.github/workflows/unified-ocr-recovery-snapshot.yml` records the two additional
  historical-test fixture corrections, formatting/build commands and checked
  tree identity.

Both temporary files have now been removed from the branch. Their historical
presence is evidence of the qualification recipe, not authorization to replay a
repository-write handoff. Continue implementation only on an authorized working
surface, with fresh remote-head checks and normal repository permissions.

The tested integration preserves main's workspace-scope reset and memory/Skills
work while retaining runtime-compatibility readiness guards and the shared
dispatch allowance. It fixes the narrow OIDC export boundary without allowing
wildcard exports, returns explicitly validated domain fields rather than an
unsafe cast, and uses the existing locked subscription-runtime installer in the
affected qualification workflows. These integrated production-source changes
are not all installed in the feature branch; do not infer that from the resolver
commits or the passing temporary-tree tests.

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

Generated `dist/*` must be rebuilt and committed; the curated public wrapper
must be synced from the exact committed, rebuilt SaaS revision with the existing
sync script. Regenerate protocol exports through the existing exporter, never
by editing exported source or handoff digests manually. The temporary Action
source resolver is retained only in Git history at
`468a7836fffaeab09cd88f5c23bcc677339b93fc`.

## Additional OAuth correction and fresh qualification

Action commit `dfa42d205b9ddd3c84f67dded35f75bce4b09dff` separates confirmed
rotation preservation from inference lifetime admission. Previously, a valid
short-lived access token could cause a newly rotated refresh token to be deleted
before encrypted writeback. Confirmed same-account rotation is now returned to
the existing writeback path; the prepared route still rejects insufficient
lifetime before model work. No OAuth retry, account fallback, or relaxed account
identity check was added. Malformed token/identity handling has not been
redefined by this correction.

Regression tests in `77d1157d1b8862cdab7c83f92386b73cee365165` cover short and
already-expired access tokens, preserve the rotated credential through the real
sealed-box format, and assert that inference is denied.

[OAuth regression run 40796208959](https://github.com/777genius/review-router/actions/runs/40796208959)
on `d96b63d0bd392d2246c1373e9790ab8d2f691e19` completed **successfully**:

- **27 suites, 226 tests passed; 0 failed and 0 skipped.** The command ran the
  entire `__tests__/unit/codex-oauth` directory and the real CLI refresh test.
- The pinned official Codex 0.147.0 binary refreshed synthetic credentials against
  a loopback OAuth fixture. This is real-executable qualification, not a real
  subscription login, paid provider request or live GitHub OIDC qualification.
- Full `npm run typecheck`, `npm run lint` and `npm run build` passed. Lint reported
  398 warnings and zero errors; this is not warning-free qualification.
- The build outputs were produced in the disposable runner, not committed back
  to the feature branch. Committed runtime artifacts still need regeneration.

[Test report artifact 12864440264](https://github.com/777genius/review-router/actions/runs/40796208959/artifacts/12864440264)
has ZIP SHA-256
`b7e29a0c707ce29dcf8f760903fba1e805e3a85e8f409f3f7d6f6a4ce1804e76`.
The run used read-only repository permissions and no production credentials.

The unchanged dependency installation also reported 20 audit vulnerabilities
(7 low, 4 moderate, 7 high, 2 critical). Their reachability and fixes were not
triaged in this iteration; do not interpret the passing code checks as a clean
security audit or run an unreviewed forced dependency upgrade.

## Temporary cleanup

Only this task's temporary recovery helpers/workflows were removed. The permanent
Unified OCR UI/paired acceptance workflow, native runtime qualification, source
regression tests, reviewed plan and evidence remain intact. No unrelated agent's
work was deleted.

Control-plane cleanup commits: `37b02a4932d685648a265837efb95262ebb67cb3` and
`6a78b92849e447fc2c1447031a61b6c502e1084d`.
Action cleanup commits: `b6fe7703eeee5b41c34923657049668a05207a00`,
`21e127c6fb2ee2bd0ccd5e2d2dbd0c7ebb307ba6` and
`f0773387f2e4a513e81759ec41aa1302536a92b5`.

## Remaining completion gates

Persist the reviewed main integration through an authorized Git write surface,
preserving both parents and checking the remote head before updating. Then finish
the Action integration and exact SaaS-to-Action contract/bundle sync. Run the
complete exact-head checks and permanent Unified OCR acceptance workflow,
including real Next rendering, disposable PostgreSQL, real managed OCR, paired
lifecycle scenarios and fresh desktop/mobile visual inspection. Earlier
screenshots and the earlier 18/18 paired acceptance run are not evidence for the
new merged pair.

Update the deployment index once main's deployment registry is present in the
feature. Keep both PRs draft until the implementation gates pass. Do not deploy,
promote tags, activate production history, update customers, or claim live
subscription/provider compatibility before the separately authorized final stage
with test credentials and actual fleet evidence.
