# Paired Action226 CI prerequisite

- Task ID: `2026-11-02-paired-action-226-ci-pin`.
- Goal: qualify the selected private release against the already published exact
  public Action226 before the normal paired private release.
- Affected target: control-plane CI, followed by the separately owned private
  release/image and application rollout.
- Public implementation: `v1.0.226`, exact commit
  `fa3e87a71f500f63f9ef64bcbc63f640c4e4d7f8`.
- Private implementation: `e9a5c032941ebeacd632ab006aa30f162b9a1774` (the exact CI pin change), [Draft PR #795](https://github.com/777genius/review-router-ai/pull/795). Integration base: protected main `220b73c0e82d6c684dcaeb6f37a3641831391c16`; final Ready follows the integrated review batch.
- Dependencies: the [release source of truth](../operations/07-environments-and-release-management.md#release-order)
  and the final integrated private source containing the review batch.
- Release owner: the shared Root release workstream, chat prefix `01a196a4`.
  This task creates no parallel deployment owner.
- Last updated: `2026-11-02`.

## Environment status

| Environment / target | Status    | Actual version / image                    | Evidence / remaining work                                                                                |
| -------------------- | --------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| staging              | `pending` | Not verified                              | No environment change performed.                                                                         |
| production           | `pending` | No image or rollout selected by this task | Complete final-source private CI, then the shared release owner's normal private226 release and rollout. |

`pending` records missing completion evidence, not observed absence of an earlier
release. This pin is a normal private226 CI prerequisite. It does not register or
adopt a producer, promote `workflow-v1`, update installed callers, alter provider
settings, or activate automatic Memory learning. An approved225 producer/channel
may remain in use until the release owner separately adopts226. Tuning/hold-out
(T/H) qualification remains a gate for automatic-learning activation; this CI pin
neither supplies that evidence nor activates the feature.

## Verified public evidence

Read-only GitHub verification on November2 established:

- [Published release v1.0.226](https://github.com/777genius/review-router/releases/tag/v1.0.226)
  is neither Draft nor prerelease; published at `2026-11-02T12:43:12Z`.
- The exact tag is a commit ref to
  `fa3e87a71f500f63f9ef64bcbc63f640c4e4d7f8`, not a branch resolution.
- [Public CI41437296864](https://github.com/777genius/review-router/actions/runs/41437296864),
  push attempt1 on that exact SHA, completed successfully. Its `build` job
  `125250204388` passed lint, typecheck, required managed OCR tests, build, and
  committed runtime artifact verification. The exact workflow checks release
  metadata, a clean tracked diff, and no untracked files after rebuilding.
- [Public Release41438607878](https://github.com/777genius/review-router/actions/runs/41438607878)
  completed successfully on the same SHA. Job `125254562109` passed release-target
  validation, committed bundle verification, tag publication and GitHub Release
  creation.
- Those two runs expose zero downloadable Actions artifacts, and the GitHub
  Release has no attached assets. This record claims the exact-source committed
  bundle checks above, not an additional artifact digest or attestation.

## Ordered delivery and verification

1. Root creates the focused commit and Draft PR, recording their exact identities
   here. Preserve all other CI pins, especially `REVIEW_ROUTER_HOSTED_POOL_ACTION_SHA`,
   and all existing required gates.
2. Integrate the final main containing the review batch before final Ready. Review
   the resulting exact source and complete its required checks; intermediate Draft
   CI does not qualify a later integration head.
3. Merge through the normal PR process. Require the trusted CI on the resulting
   exact protected main, including successful, non-skipped `Dedicated Release
Authority PG17 contract` and `Full private PG16 to PG17 rehearsal` jobs and
   their exact-SHA evidence. Its `paired-action-release-gate` artifact must bind
   the published Action SHA above. Do not relabel a PR run or old-head artifact.
4. The shared release owner alone continues the normal private226 release/image,
   fleet reconciliation and authorized rollout. Record actual private release,
   image digest, environment and rollout/readiness evidence before closing this
   environment. No migration, configuration or activation is introduced by this
   pin; other tasks in the final shipping source retain their own prerequisites.
5. Producer adoption, workflow-channel promotion, installed-caller verification
   and automatic-learning activation remain separately evidenced operations under
   the release guide and their owning tasks. Preserve admitted225 runs and their
   original authority throughout any later adoption.

## Retry and rollback

Inspect the exact private head, public tag and failed gate before resuming. Reuse
valid unchanged-input evidence; never move the immutable public tag, weaken a
required gate, or repeat a release/deploy merely because observation timed out.
This change itself has no environment effect to undo. Any later image rollback
must use the release guide's protocol preflight and preserve active runs, producer
registrations and Memory data.

## Execution log

| Environment / target | Result                                                  | Next action                                                      |
| -------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| public evidence      | Exact tag, successful CI and release verified read-only | Retain public immutable identities.                              |
| private source       | Pin committed; Draft PR #795 created                    | Integrate final main before Ready.                               |
| staging / production | No release, deploy or configuration change performed    | Shared release owner completes only authorized remaining phases. |
