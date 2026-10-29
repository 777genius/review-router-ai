# Unified OCR integration checkpoint — 2026-10-29

## Current checkpoint: integrated pair published; final CI pending

Both main integrations, canonical contract/wrapper handoff and committed Action
bundles are complete in the existing draft PRs. This replaces the earlier
uncommitted-candidate status below. The final pair is published; its complete
GitHub CI on **M/A** remains **pending**. Source implementation reviews and the
final documentation critic recheck returned GO; both P2 wording findings are closed.

| Identity                                  | Exact revision                             |
| ----------------------------------------- | ------------------------------------------ |
| Canonical export and wrapper source **S** | `dccf5b628680bd7f3f8c9501e3108e432053495b` |
| SaaS format-only descendant **F**         | `eb937dcc2c087f5115894b6279b9f2ab38049e83` |
| Published Action-pin ancestor **P**       | `ff033fd0056e84f522c2b62799a48c56e5613cbd` |
| Final paired public Action **A**          | `cfe2b78fba925e3e7741d8c7f479324aa785d12b` |
| Published current-main merge **M**        | `841f44f0900409692559286cdbb00ac319a40664` |
| Exact merge tree                          | `092432c244ddfd2e7cfe03a5ee743bb1ff604cfa` |

**A** exports from committed **S**. **F** preserved 77 protected runtime
files byte-for-byte; **P** records the canonical Action pin. The later
format/pin changes do not claim a second canonical export. SaaS main integration
is already in feature history (`bcebb274`); Action integrates main
`8a6bb7395556ddabbda4b8275bc9e2de6fea4f8e`, retaining scoped model invocations,
composite review/description memory admission and main's opaque-template patch.

Current main `8ea78b9df1398e64fce917eecdc18d95e52d9e9f` adds only eight
test/docs files from #741. Published merge **M** into **P** retains both the genuine History
source-to-browser support and native OCR admission seams; the resolved-harness
critic returned **GO**. Protected runtime/canonical/wrapper bytes and **A/S**
remain unchanged. Focused types/lint/format and three selected existing PG cases
passed (11 filtered); no full 25-case or browser rerun is claimed. Final CI must
qualify the current-main merge descendant, not an earlier **P/A** run.

The unique candidate is **`1.13.1-rr.6` / `ocr-managed-v5`**, binary SHA-256
`9dd5f115747d24100f0767133a3288d268f3bc399675f5b826e7a867d101ee5c`.
Its reproducibility receipt is Action
`tools/ocr/qualifications/unified-model-routes-v3.manifest` (Go 1.26.10,
12 patches, pinned upstream). Previous catalog entries and manifests retain
their bytes, including main's `ocr-managed-v4` / `rr.5` / `9c666b25...` binding.
The feature's older `rr.5` / `a7bed0...` candidate and old paired Action pin
`e226a833...` are historical evidence, not the final pair.

### Observed evidence and its boundary

- **25/25** local paired cases passed: 17 shared protocol/fault cases, seven
  actual admitted production-runner routes and the comparison publication case. The route cases cover Gateway, OpenRouter, MiMo, Kimi, repository Codex,
  Hosted Codex and Claude; real OCR, PostgreSQL, two Git heads, shared verifier /
  allowance, App worker, native Hosted ledgers and effect-free completed replay
  run against synthetic provider/GitHub/OIDC boundaries. Gateway's saved model
  is outside its enrollment anchor. This is pre-publication source qualification,
  not a final **M/A** CI result.
- The reviewer's isolated P2 setup-cleanup correction then passed comparison
  **1/1**. That overlaps the 25-case scope and is not another unique case. An
  earlier full attempt failed with PostgreSQL ENOSPC; its failed receipts were
  preserved separately before the successful retry.
- Actual Next at `b0239454bf5cad4ef61419d425f302efb231e244` passed **2/2**
  desktop/mobile cases, with both themes and six inspected captures; Sol visual
  review returned **GO**. Its database receipt is a schema-only restored checked
  source roster, **not fresh-migration proof**. UI source is preserved in **S**;
  final **M/A** browser CI remains pending.
- Actual `dist/index.js` passed **3/3** long/short/expired rotated-auth cases,
  including decrypted synthetic sealed writeback and denied checkout/runner/model
  entry for insufficient lifetime. The latest rerun uses committed `f0067f4...`
  runtime bytes and a Git-HEAD-blob identity guard. It overlaps the earlier
  pre-commit 3-case run; ten runtime hashes remain unchanged across the CI-only
  delivery correction. Two original builds also matched all ten generated runtime-file hashes,
  including the seven tracked `dist` artifacts.
- A separate earlier official Codex 0.147.0 auth-only executable test passed
  **1/1** against isolated synthetic loopback OAuth. It is helper qualification,
  not a complete subscription workflow, paid inference or live OAuth proof.

Detailed receipts, scope and historical evidence are in the
[acceptance record](2026-10-27-unified-ocr-acceptance.md).

### Review and remaining gates

The completion plan passed three rounds with two critic roles; all blocking
plan findings closed. Implementation round 1 included Action/SaaS cross-review
and acceptance-fidelity review; the P2 cleanup finding above is closed. Round 2
has acceptance default-profile/readiness **GO**. Action delivery review found
that CI install/prepare could rebuild `dist` before artifact smoke tests; the
fix restores tracked `dist` after install and checks entrypoint bytes against
Git HEAD. Its local 3-case rerun passed; the corrected Action/pin are published as
**A/P** above. Their final CI result remains pending. Source implementation review rounds returned GO. The final documentation recheck returned GO; both P2 wording findings are closed. Reviewer roles repeat across rounds.

Complete the existing GitHub CI on published **M/A** and record actual
results before claiming final-pair acceptance. The first published
`f0067f4...` / `09b1df7...` pair is superseded by current **A/M** and that delivery correction;
its CI is not the final-pair result. Keep both PRs draft while these gates remain.
The owner has not supplied designated real credentials. Live provider access,
OAuth/writeback, GitHub OIDC/App effects, release registration and authorized
rollout remain separate. No live provider call, release/tag promotion,
production history activation, customer workflow update or deployment is claimed.

The type-only conversation companion is preserved through canonical export.
Optional contextual memory and managed conversation still depend on separately
reviewed SaaS [#734](https://github.com/777genius/review-router-ai/pull/734) server
implementation and rollout; ordinary OCR does not require that interaction path.
This completion added no schema migration or customer upgrade framework. The
existing 156-entry inventory and operational safeguards remain in place.

- [Control-plane draft #718](https://github.com/777genius/review-router-ai/pull/718)
- [Public Action draft #346](https://github.com/777genius/review-router/pull/346)
- [Completion plan and review record](../plans/2026-10-29-unified-ocr-completion.md)
- [Deployment task](../deployments/2026-10-29-unified-ocr.md)

## Historical temporary integration evidence (superseded checkpoint)

The following receipts retain their original scope and failure conclusions.
They describe the earlier recovery attempt, before the committed integrations
and source identities above; they are not final-pair qualification.

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
affected qualification workflows. At that historical checkpoint these
production-source changes were not all in the feature branch; the committed integration above supersedes
that pending status, without changing the temporary run's conclusion.

The combined migration inventory contains 156 entries with manifest
`sha256:67de1583cf2ae194e7b6dd5cef021d08b60eb64988d516cb2adcbc2d01bbbda3`.
Historical managed92 and historical96 inventories remain unchanged. Exact
historical152 and main155 inputs retain their existing separate identities;
unknown, reordered, missing, duplicated, or modified SQL remains rejected.
Imported vendor patch bytes must not be reformatted to silence whitespace that
already exists in the main parent.

## Historical public Action integration follow-up

The earlier pinned Action main was `056952b5a3d625fd1d19384942d452114804380f`; its actual
merge base with this feature is `dc0b3b340f911af7efcfb2f4fc3170fe304c349e`, not
the later main-only CI commit `a8cd9c5`.

The earlier conflict review required both:

1. The feature's `scopedModelInvocations` wrapper, so OCR discovery cannot bypass
   its shared durable dispatch scope.
2. Main's admitted memory behavior. The final merge above preserves the newer
   composite `reviewMemoryAdmissionForSessions(reviewMemory, descriptionMemory)`.

That checkpoint still required rebuilt committed `dist/*`, canonical export
and curated wrapper sync. Those source/build steps are now complete in **S/A**
as recorded above; final-pair CI remains separate. The temporary Action
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
  to the feature branch. Final committed runtime artifacts were subsequently
  regenerated in **A**; that does not change this older run's scope.

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

## Current remaining gates

The remaining qualification gate is final **M/A** GitHub CI. Source implementation
reviews and the final documentation recheck returned GO; both P2 wording findings
are closed. After that, designated
real credentials and separately authorized release/rollout evidence remain.
Follow the existing [deployment task](../deployments/2026-10-29-unified-ocr.md)
and release process; this checkpoint adds no new rollout playbook.
